import os
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from database import get_db, documents_collection, messages_collection
from models.user import UserModel, ChatSessionModel, MessageModel
from auth.helpers import get_admin_user

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
    db.delete(user)
    db.commit()
    # Clean MongoDB docs
    documents_collection.delete_many({"user_id": user_id})
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