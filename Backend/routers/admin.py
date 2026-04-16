import os
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from database import get_db, documents_collection, messages_collection
from models.user import UserModel, ChatSessionModel, MessageModel
from models.widget import WidgetBot, WidgetApiKey
from auth.helpers import get_admin_user
from auth.widget_auth import generate_api_key
from database import get_db, documents_collection, messages_collection, mongodb
import shutil
router = APIRouter(prefix="/admin", tags=["Admin"])


# ── User Management ───────────────────────────────────────────────────────────

@router.get("/users")
def get_all_users(
    current_user: UserModel = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    users = db.query(UserModel).all()
    return [
        {
            "id": u.id,
            "name": u.name,
            "email": u.email,
            "is_admin": u.is_admin,
            "session_count": len(u.sessions),
        }
        for u in users
    ]


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: UserModel = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # 1. Collect session IDs before deletion (needed for MongoDB cleanup)
    sessions = db.query(ChatSessionModel).filter(
        ChatSessionModel.user_id == user_id
    ).all()
    session_ids = [s.id for s in sessions]
 
    # 2. Collect widget bots owned by this user
    bots = db.query(WidgetBot).filter(WidgetBot.owner_id == user_id).all()
    bot_ids = [b.id for b in bots]
 
    # 3. Delete PostgreSQL rows — cascade handles sessions, messages, api_keys
    for bot in bots:
        db.delete(bot)
    db.delete(user)
    db.commit()
 
    # 4. Delete MongoDB chat documents and messages
    documents_collection.delete_many({"user_id": user_id})
    if session_ids:
        messages_collection.delete_many({"session_id": {"$in": session_ids}})
 
    # 5. Delete widget analytics / intervention data for this user's bots
    if mongodb is not None and bot_ids:
        mongodb["widget_messages"].delete_many({"bot_id": {"$in": bot_ids}})
        mongodb["intervention_tickets"].delete_many({"bot_id": {"$in": bot_ids}})
        # Also clean bot-scoped documents stored under bot_id as user_id
        documents_collection.delete_many({"user_id": {"$in": bot_ids}})
 
    # 6. Delete FAISS vector stores from disk
    vector_path = os.path.join(os.getcwd(), "vector_store", f"user_{user_id}")
    if os.path.exists(vector_path):
        shutil.rmtree(vector_path, ignore_errors=True)
 
    # 7. Delete bot-scoped vector stores (stored under bot UUID)
    for bot_id in bot_ids:
        bot_vector_path = os.path.join(os.getcwd(), "vector_store", f"user_{bot_id}")
        if os.path.exists(bot_vector_path):
            shutil.rmtree(bot_vector_path, ignore_errors=True)
    return {"ok": True}


@router.patch("/users/{user_id}/toggle-admin")
def toggle_admin(
    user_id: int,
    current_user: UserModel = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    user = db.query(UserModel).filter(UserModel.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_admin = not user.is_admin
    db.commit()
    return {"id": user.id, "is_admin": user.is_admin}


# ── Document Management ───────────────────────────────────────────────────────

@router.get("/documents")
def get_all_documents(current_user: UserModel = Depends(get_admin_user)):
    docs = list(documents_collection.find({}, {"_id": 0}))
    return {"count": len(docs), "documents": docs}


@router.delete("/documents/{doc_id}")
def admin_delete_document(
    doc_id: str,
    current_user: UserModel = Depends(get_admin_user)
):
    doc = documents_collection.find_one({"id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("path") and doc.get("type") != "url":
        if os.path.exists(doc["path"]):
            os.remove(doc["path"])
    documents_collection.delete_one({"id": doc_id})
    return {"ok": True}


# ── Usage Statistics ──────────────────────────────────────────────────────────

@router.get("/stats")
def get_stats(
    current_user: UserModel = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    total_users = db.query(UserModel).count()
    total_sessions = db.query(ChatSessionModel).count()
    total_messages = db.query(MessageModel).count()
    total_documents = documents_collection.count_documents({})
    total_bots = db.query(WidgetBot).count()

    # Messages per day (last 7 days)
    messages_per_day = []
    for i in range(6, -1, -1):
        day = datetime.utcnow() - timedelta(days=i)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day.replace(hour=23, minute=59, second=59)
        count = db.query(MessageModel).filter(
            MessageModel.created_at >= day_start,
            MessageModel.created_at <= day_end,
            MessageModel.role == "user"
        ).count()
        messages_per_day.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "count": count
        })

    # Active sessions (last 24h)
    active_sessions = db.query(ChatSessionModel).filter(
        ChatSessionModel.updated_at >= datetime.utcnow() - timedelta(hours=24)
    ).count()

    return {
        "total_users": total_users,
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "total_documents": total_documents,
        "active_sessions_24h": active_sessions,
        "messages_per_day": messages_per_day,
        "total_bots": total_bots,
    }


# ── System Health ─────────────────────────────────────────────────────────────

@router.get("/system")
def get_system_health(current_user: UserModel = Depends(get_admin_user)):
    vector_store_path = os.path.join(os.getcwd(), "vector_store")
    
    # Count FAISS indexes and total size
    total_indexes = 0
    total_size_mb = 0.0
    user_breakdown = []

    if os.path.exists(vector_store_path):
        for user_dir in os.listdir(vector_store_path):
            user_path = os.path.join(vector_store_path, user_dir)
            if not os.path.isdir(user_path):
                continue
            user_indexes = 0
            user_size = 0.0
            for session_dir in os.listdir(user_path):
                session_path = os.path.join(user_path, session_dir)
                if os.path.exists(os.path.join(session_path, "index.faiss")):
                    user_indexes += 1
                    for f in os.listdir(session_path):
                        fpath = os.path.join(session_path, f)
                        user_size += os.path.getsize(fpath) / (1024 * 1024)
            total_indexes += user_indexes
            total_size_mb += user_size
            user_breakdown.append({
                "user": user_dir,
                "indexes": user_indexes,
                "size_mb": round(user_size, 2)
            })

    # Upload folder size
    upload_path = os.path.join(os.getcwd(), "uploads")
    upload_size_mb = 0.0
    upload_count = 0
    if os.path.exists(upload_path):
        for f in os.listdir(upload_path):
            fpath = os.path.join(upload_path, f)
            if os.path.isfile(fpath):
                upload_size_mb += os.path.getsize(fpath) / (1024 * 1024)
                upload_count += 1

    return {
        "faiss": {
            "total_indexes": total_indexes,
            "total_size_mb": round(total_size_mb, 2),
            "user_breakdown": user_breakdown,
        },
        "uploads": {
            "file_count": upload_count,
            "size_mb": round(upload_size_mb, 2),
        }
    }


@router.get("/billing")
def get_billing(current_user: UserModel = Depends(get_admin_user), db: Session = Depends(get_db)):
    users = db.query(UserModel).all()
    results = []
    for user in users:
        bots = db.query(WidgetBot).filter_by(owner_id=user.id).all()
        bot_ids = [bot.id for bot in bots]
        messages_count = messages_collection.count_documents({"bot_id": {"$in": bot_ids}}) if bot_ids else 0
        docs_count = documents_collection.count_documents({"user_id": {"$in": bot_ids}}) if bot_ids else 0
        sessions_count = len(messages_collection.distinct("session_id", {"bot_id": {"$in": bot_ids}})) if bot_ids else 0
        plan_tier = "Starter"
        if messages_count > 5000 or docs_count > 50:
            plan_tier = "Growth"
        if messages_count > 20000 or docs_count > 200:
            plan_tier = "Enterprise"

        results.append({
            "email": user.email,
            "messages_count": messages_count,
            "docs_count": docs_count,
            "sessions_count": sessions_count,
            "storage_mb": 0.0,
            "plan_tier": plan_tier,
        })
    return {"clients": results}


@router.get("/bots")
def get_all_bots(current_user: UserModel = Depends(get_admin_user), db: Session = Depends(get_db)):
    bots = db.query(WidgetBot).filter_by(is_active=True).all()
    bot_stats = []
    for bot in bots:
        doc_count = documents_collection.count_documents({"user_id": bot.id})
        message_count = messages_collection.count_documents({"bot_id": bot.id})
        owner = db.query(UserModel).filter_by(id=bot.owner_id).first()
        bot_stats.append({
            "id": bot.id,
            "name": bot.name,
            "status": "active" if bot.is_active else "inactive",
            "doc_count": doc_count,
            "message_count": message_count,
            "allowed_origin": bot.allowed_origin,
            "created_at": bot.created_at.isoformat() if bot.created_at else None,
            "owner": {
                "id": owner.id if owner else None,
                "name": owner.name if owner else "Unknown",
                "email": owner.email if owner else "Unknown",
            } if owner else None,
        })
    return {"bots": bot_stats}


@router.get("/feedback")
def get_feedback_summary(current_user: UserModel = Depends(get_admin_user), db: Session = Depends(get_db)):
    feedback_col = documents_collection.database["widget_feedback"] if hasattr(documents_collection, 'database') else None
    if feedback_col is None:
        return {"feedback": []}

    # Get all feedback entries with full details
    all_feedback = list(feedback_col.find({}, {"_id": 0}).sort("created_at", -1))

    # Group by bot_id for summary
    bot_feedback = {}
    for item in all_feedback:
        bot_id = item.get("bot_id")
        if not bot_id:
            continue
        if bot_id not in bot_feedback:
            bot_feedback[bot_id] = {
                "bot_id": bot_id,
                "bot_name": "Unknown",
                "ratings": [],
                "total_feedback": 0,
                "feedback_list": []
            }
        bot_feedback[bot_id]["ratings"].append(item.get("rating", 0))
        bot_feedback[bot_id]["total_feedback"] += 1
        bot_feedback[bot_id]["feedback_list"].append(item)

    result = []
    for bot_id, entry in bot_feedback.items():
        bot = db.query(WidgetBot).filter_by(id=bot_id).first()
        result.append({
            "bot_id": bot_id,
            "bot_name": bot.name if bot else entry["bot_name"],
            "avg_score": round(sum(entry["ratings"]) / len(entry["ratings"]), 2) if entry["ratings"] else 0.0,
            "total_feedback": entry["total_feedback"],
            "feedback_list": entry["feedback_list"]
        })
    return {"feedback": result}


@router.delete("/feedback/{bot_id}")
def delete_feedback(bot_id: str, current_user: UserModel = Depends(get_admin_user), db: Session = Depends(get_db)):
    feedback_col = documents_collection.database["widget_feedback"] if hasattr(documents_collection, 'database') else None
    if feedback_col is None:
        raise HTTPException(status_code=404, detail="Feedback collection not found")
    
    result = feedback_col.delete_many({"bot_id": bot_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="No feedback found for this bot")
    
    return {"message": f"Deleted {result.deleted_count} feedback entries"}


@router.post("/bots/{bot_id}/preview-key")
def create_preview_key(
    bot_id: str,
    current_user: UserModel = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, is_active=True).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    raw_key, key_hash = generate_api_key()
    api_key = WidgetApiKey(
        id=str(uuid.uuid4()),
        bot_id=bot_id,
        key_hash=key_hash,
        key_prefix=raw_key[:10],
        is_active=True,
    )
    db.add(api_key)
    db.commit()

    return {
        "key": raw_key,
        "prefix": raw_key[:10],
        "is_active": True,
        "created_at": api_key.created_at,
    }

@router.delete("/bots/{bot_id}")
def delete_bot(
    bot_id: str,
    current_user: UserModel = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    bot.is_active = False
    db.commit()
    return {"ok": True}