import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from database import get_db
from models.user import UserModel
from models.widget import WidgetBot, WidgetApiKey
from auth.helpers import get_current_user
from auth.widget_auth import generate_api_key

from database import mongodb
from collections import Counter
import re
import traceback
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/widgets", tags=["Widgets"])

_STOP = {
    # English
    "the","a","an","is","are","was","were","be","been","have","has","had",
    "do","does","did","will","would","could","should","may","might","can",
    "i","you","he","she","it","we","they","me","him","her","us","them",
    "my","your","his","its","our","their","this","that","these","those",
    "what","which","who","how","when","where","why","and","or","but","if",
    "in","on","at","to","for","of","with","by","from","about","into","not",
    # French
    "je","tu","il","elle","nous","vous","ils","elles","le","la","les","un",
    "une","des","est","sont","avec","pour","dans","sur","par","que","qui",
    "quoi","comment","quand","où","pourquoi","pas","plus","très","bien",
    "aussi","mais","donc","car","comme","tout","tous","toute","toutes",
    "du","au","aux","ce","cet","cette","ces","mon","ton","son","nos","vos",
    "leur","leurs","quel","quelle","quels","quelles","entre","sans","après",
    "avant","depuis","pendant","selon","vers","contre","malgré",
}
 
_NO_ANSWER = [
    "i don't have information","i couldn't find","not found in the documents",
    "no relevant information","i don't know","cannot answer","not mentioned",
    "no information about","i'm unable to find","there is no information",
    "document does not contain","not available in","i cannot find",
    "i was unable to","no data available","je n'ai pas trouvé",
    "je ne trouve pas","aucune information","pas d'information",
    "n'est pas mentionné","ne figure pas","introuvable",
    "je n'ai pas d'information","je ne peux pas répondre",
    "il n'y a pas d'information","les documents ne contiennent pas",
]
 
 
def _extract_keywords(text: str) -> list:
    words = re.findall(r"\b[a-zA-ZÀ-ÿ]{3,}\b", text.lower())
    return [w for w in words if w not in _STOP][:10]
 
 
def _is_answered(answer: str) -> bool:
    if not answer:
        return False
    lower = answer.lower()
    return not any(phrase in lower for phrase in _NO_ANSWER)
 
 
def _safe_date_str(val) -> str:
    """Convert datetime object OR string to ISO string safely."""
    if val is None:
        return ""
    if hasattr(val, "isoformat"):      # datetime object
        return val.isoformat()
    return str(val)                    # already a string
 

class CreateBotRequest(BaseModel):
    name: str
    system_prompt: Optional[str] = "You are a helpful assistant."
    allowed_origin: Optional[str] = None   # e.g. "https://myshop.com"


class UpdateBotRequest(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    allowed_origin: Optional[str] = None


@router.post("/bots")
def create_bot(
    req: CreateBotRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = WidgetBot(
        id=str(uuid.uuid4()),
        owner_id=current_user.id,
        name=req.name,
        system_prompt=req.system_prompt,
        allowed_origin=req.allowed_origin,
    )
    db.add(bot)
    db.commit()
    return {"bot_id": bot.id, "name": bot.name}


@router.get("/bots")
def list_bots(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bots = db.query(WidgetBot).filter_by(owner_id=current_user.id, is_active=True).all()
    return [{"id": b.id, "name": b.name, "allowed_origin": b.allowed_origin} for b in bots]


@router.delete("/bots/{bot_id}")
def delete_bot(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    bot.is_active = False
    db.commit()
    return {"ok": True}

@router.delete("/bots/{bot_id}/documents/{doc_id}")
def delete_bot_document(
    bot_id: str,
    doc_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from database import documents_collection
    import os

    # 1. Verify bot ownership in PostgreSQL
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    # 2. Get document metadata from MongoDB to find the file path
    doc = documents_collection.find_one({"id": doc_id, "user_id": bot_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # 3. Delete physical source file from UPLOAD_DIR
    file_path = doc.get("path")
    if file_path and doc.get("type") != "url":
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info(f"🗑️ Deleted source file: {file_path}")
            except Exception as e:
                logger.error(f"❌ Failed to delete file: {e}")

    # 4. Delete vectors from FAISS index surgically
    from services.rag_services import delete_document_from_index
    session_id = doc.get("session_id", f"bot_{bot_id}")
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    try:
        delete_document_from_index(bot_id, clean_session_id, doc_id)
        logger.info(f"✅ Removed vectors for doc: {doc_id}")
    except Exception as e:
        logger.error(f"❌ Failed to remove vectors: {e}")

    # 5. Delete metadata from MongoDB
    documents_collection.delete_one({"id": doc_id, "user_id": bot_id})
    
    return {"ok": True, "deleted": doc_id}
    

@router.post("/bots/{bot_id}/keys")
def create_api_key(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    raw_key, key_hash = generate_api_key()

    api_key = WidgetApiKey(
        id=str(uuid.uuid4()),
        bot_id=bot_id,
        key_hash=key_hash,
        key_prefix=raw_key[:10],   # "nm_XXXXXXXX"
    )
    db.add(api_key)
    db.commit()

    return {
        "key": raw_key,          # shown ONCE — user must copy it now
        "prefix": raw_key[:10],
        "warning": "Save this key — it will not be shown again."
    }


@router.get("/bots/{bot_id}/keys")
def list_keys(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    keys = db.query(WidgetApiKey).filter_by(bot_id=bot_id).all()
    return [
        {
            "id": k.id,
            "prefix": k.key_prefix,
            "is_active": k.is_active,
            "last_used": k.last_used,
            "created_at": k.created_at,
        }
        for k in keys
    ]

@router.get("/bots/{bot_id}/documents")
def get_bot_documents(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from database import documents_collection

    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    docs = list(documents_collection.find(
        {"user_id": bot_id},
        {"_id": 0}
    ))
    return {"documents": docs, "count": len(docs)}

@router.delete("/bots/{bot_id}/keys/{key_id}")
def revoke_key(
    bot_id: str,
    key_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    key = db.query(WidgetApiKey).filter_by(id=key_id, bot_id=bot_id).first()
    if not key:
        raise HTTPException(status_code=404, detail="Key not found")

    key.is_active = False
    db.commit()
    return {"ok": True, "revoked": key_id}
from datetime import datetime, timedelta

@router.get("/bots/{bot_id}/analytics")
def get_bot_analytics(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from database import documents_collection
    import pymongo

    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    # Count documents
    total_documents = documents_collection.count_documents({"user_id": bot_id})

    # Count messages from MongoDB widget sessions
    from database import mongodb as mongo_db
    messages_col = mongo_db["widget_messages"]

    total_messages = messages_col.count_documents({"bot_id": bot_id})
    total_sessions = len(messages_col.distinct("session_id", {"bot_id": bot_id}))

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    messages_today = messages_col.count_documents({
        "bot_id": bot_id,
        "created_at": {"$gte": today}
    })

    # Messages per day for last 14 days
    messages_per_day = []
    for i in range(13, -1, -1):
        day = today - timedelta(days=i)
        next_day = day + timedelta(days=1)
        count = messages_col.count_documents({
            "bot_id": bot_id,
            "created_at": {"$gte": day, "$lt": next_day}
        })
        messages_per_day.append({
            "date": day.isoformat(),
            "count": count
        })

    return {
        "total_messages": total_messages,
        "total_sessions": total_sessions,
        "total_documents": total_documents,
        "messages_today": messages_today,
        "messages_per_day": messages_per_day,
        "top_questions": []
    }

class BotFeedbackRequest(BaseModel):
    rating: int
    comment: Optional[str] = None
    category: str


@router.post("/bots/{bot_id}/feedback")
def create_bot_feedback(
    bot_id: str,
    req: BotFeedbackRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    if req.rating < 1 or req.rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

    allowed_categories = {"Accuracy", "Speed", "Relevance", "Missing Info"}
    if req.category not in allowed_categories:
        raise HTTPException(status_code=400, detail="Invalid category")

    feedback_col = mongodb["widget_feedback"]
    feedback_data = {
        "id": str(uuid.uuid4()),
        "bot_id": bot_id,
        "user_id": current_user.id,
        "user_name": current_user.name,
        "rating": req.rating,
        "comment": req.comment or "",
        "category": req.category,
        "created_at": datetime.utcnow().isoformat(),
    }
    result = feedback_col.insert_one(feedback_data)
    return {
        "ok": True,
        "feedback": {**feedback_data, "_id": str(result.inserted_id)}
    }


@router.get("/bots/{bot_id}/feedback")
def list_bot_feedback(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    feedback_col = mongodb["widget_feedback"]
    feedbacks = list(feedback_col.find({"bot_id": bot_id}, {"_id": 0}).sort("created_at", -1))
    avg_score = round(sum(item.get("rating", 0) for item in feedbacks) / len(feedbacks), 2) if feedbacks else 0.0
    return {
        "feedback": feedbacks,
        "avg_score": avg_score,
        "total_feedback": len(feedbacks),
    }


@router.patch("/bots/{bot_id}")
def update_bot(
    bot_id: str,
    req: UpdateBotRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    if req.name is not None:
        bot.name = req.name
    if req.system_prompt is not None:
        bot.system_prompt = req.system_prompt
    if req.allowed_origin is not None:
        bot.allowed_origin = req.allowed_origin
    else:
        bot.allowed_origin = None
    db.commit()
    return {"id": bot.id, "name": bot.name, "allowed_origin": bot.allowed_origin}

from fastapi import UploadFile, File
from services.rag_services import load_document, load_url
from pydantic import BaseModel as PydanticBase
import shutil
import os

class BotUrlRequest(PydanticBase):
    url: str
    max_pages: int = 1

@router.post("/bots/{bot_id}/documents/upload")
async def upload_bot_document(
    bot_id: str,
    file: UploadFile = File(...),
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    from database import documents_collection
    from config import UPLOAD_DIR
    import uuid
    from datetime import datetime

    ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".docx"}
    file_extension = os.path.splitext(file.filename)[1].lower()
    if file_extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail=f"Unsupported file type '{file_extension}'")

    MAX_FILE_SIZE = 50 * 1024 * 1024
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Max 50MB.")
    await file.seek(0)

    doc_id = str(uuid.uuid4())
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    temp_path = os.path.join(UPLOAD_DIR, f"temp_{doc_id}{file_extension}")

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_size = os.path.getsize(temp_path)

    process_result = await load_document(
        file, file_path=temp_path,
        user_id=bot_id,
        session_id=f"bot_{bot_id}",
        max_pages=0, doc_id=doc_id
    )

    if not process_result.get("success"):
        raise HTTPException(status_code=500, detail=process_result.get("error", "Processing failed"))

    doc_record = {
        "id": doc_id, "user_id": bot_id,
        "session_id": f"bot_{bot_id}",
        "name": file.filename,
        "type": file_extension[1:],
        "size": f"{file_size / 1024:.1f} KB",
        "path": temp_path,
        "status": "indexed",
        "chunks": process_result.get("chunks", 0),
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc_record, "_id": doc_id})

    return {"document": doc_record}


@router.post("/bots/{bot_id}/documents/url")
async def add_bot_url_document(
    bot_id: str,
    req: BotUrlRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    from database import documents_collection
    import uuid
    from datetime import datetime

    doc_id = str(uuid.uuid4())

    process_result = await load_url(
        file=None, file_path=req.url,
        user_id=bot_id,
        session_id=f"bot_{bot_id}",
        max_pages=req.max_pages, doc_id=doc_id
    )

    if not process_result.get("success"):
        raise HTTPException(status_code=500, detail=process_result.get("error", "Failed to load URL"))

    doc_record = {
        "id": doc_id, "user_id": bot_id,
        "session_id": f"bot_{bot_id}",
        "name": req.url, "type": "url",
        "size": "Web page", "path": req.url,
        "status": "indexed",
        "chunks": process_result.get("chunks", 0),
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc_record, "_id": doc_id})

    return {"document": doc_record}

@router.get("/bots/{bot_id}/analytics/advanced")
async def get_advanced_analytics(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
        if not bot:
            raise HTTPException(status_code=404, detail="Bot not found")

        messages = list(
            mongodb["widget_messages"]
            .find({"bot_id": bot_id}, {"_id": 0})
            .sort("created_at", -1)
            .limit(5000)
        )

        total = len(messages)

        # ── Answered / unanswered ──────────────────────────────────────────────
        success_list = []
        failure_list = []
        for m in messages:
            answered_flag = m.get("answered")
            if answered_flag is None:
                answered_flag = _is_answered(m.get("answer") or "")
            if answered_flag:
                success_list.append(m)
            else:
                failure_list.append(m)

        success_count = len(success_list)
        failure_count = len(failure_list)
        success_rate  = round(success_count / total * 100, 1) if total > 0 else 0.0

        # ── Keywords ───────────────────────────────────────────────────────────
        all_keywords = []
        for m in messages:
            kws = m.get("keywords")
            if kws:
                all_keywords.extend(kws)
            else:
                all_keywords.extend(_extract_keywords(m.get("question") or ""))
        kw_counts    = Counter(all_keywords)
        top_keywords = [{"word": w, "count": c} for w, c in kw_counts.most_common(20)]

        # ── Unanswered questions ───────────────────────────────────────────────
        unanswered = [
            {
                "question":   m.get("question") or "",
                "created_at": _safe_date_str(m.get("created_at")),
            }
            for m in failure_list
        ][-25:]

        # ── Avg messages per session ───────────────────────────────────────────
        session_counts = Counter(m.get("session_id") or "unknown" for m in messages)
        avg_messages   = (
            round(sum(session_counts.values()) / len(session_counts), 1)
            if session_counts else 0.0
        )

        # ── Pending tickets ────────────────────────────────────────────────────
        try:
            pending_tickets = mongodb["intervention_tickets"].count_documents({
                "bot_id": bot_id,
                "status": "pending_response",
            })
        except Exception:
            pending_tickets = 0

        # ── NEW: Response times per day ────────────────────────────────────────
        # Group messages that have a response_time_ms field by calendar day.
        from collections import defaultdict
        rt_by_day = defaultdict(list)
        for m in messages:
            rt = m.get("response_time_ms")
            if rt is None:
                continue
            created = m.get("created_at")
            if hasattr(created, "strftime"):
                day_key = created.strftime("%Y-%m-%d")
            else:
                # stored as string
                day_key = str(created)[:10]
            rt_by_day[day_key].append(rt)

        # Build last-30-days series (fill gaps with None so the frontend can skip them)
        from datetime import timedelta
        today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        response_times = []
        for i in range(29, -1, -1):
            day = today - timedelta(days=i)
            key = day.strftime("%Y-%m-%d")
            times = rt_by_day.get(key, [])
            response_times.append({
                "date":   key,
                "avg_ms": round(sum(times) / len(times)) if times else None,
                "count":  len(times),
            })

        # ── NEW: Messages per day (last 30 days) ──────────────────────────────
        msg_by_day = defaultdict(int)
        for m in messages:
            created = m.get("created_at")
            if hasattr(created, "strftime"):
                day_key = created.strftime("%Y-%m-%d")
            else:
                day_key = str(created)[:10]
            msg_by_day[day_key] += 1

        messages_per_day = []
        for i in range(29, -1, -1):
            day = today - timedelta(days=i)
            key = day.strftime("%Y-%m-%d")
            messages_per_day.append({"date": key, "count": msg_by_day.get(key, 0)})

        # ── NEW: Document usage (citation counts) ──────────────────────────────
        # Count how many messages cited each source document.
        doc_citation_counts: Counter = Counter()
        for m in messages:
            source_docs = m.get("source_docs", [])
            # De-duplicate per message so one long answer doesn't inflate a doc's count
            for doc_name in set(source_docs):
                if doc_name:
                    doc_citation_counts[doc_name] += 1

        document_usage = [
            {"name": name, "citations": count}
            for name, count in doc_citation_counts.most_common(10)
        ]

        # ── Real quota numbers ────────────────────────────────────────────────
        from database import documents_collection as docs_col
        real_doc_count = docs_col.count_documents({"user_id": bot_id})
 
        # Storage: prefer actual file size on disk; fall back to stored "size" string
        docs_cursor = list(docs_col.find({"user_id": bot_id}, {"size": 1, "path": 1, "type": 1, "_id": 0}))
        total_bytes = 0
        for d in docs_cursor:
            # URL docs have no file on disk — skip
            if d.get("type") == "url":
                continue
            file_path = d.get("path", "")
            if file_path and os.path.exists(file_path):
                # Most accurate — read the actual file size
                total_bytes += os.path.getsize(file_path)
            else:
                # Fallback: parse stored size string ("12.3 KB" / "1.2 MB")
                raw = str(d.get("size", "0"))
                try:
                    parts = raw.strip().split()
                    num  = float(parts[0])
                    unit = parts[1].upper() if len(parts) > 1 else "KB"
                    if "GB" in unit:
                        total_bytes += int(num * 1024 * 1024 * 1024)
                    elif "MB" in unit:
                        total_bytes += int(num * 1024 * 1024)
                    else:  # KB default
                        total_bytes += int(num * 1024)
                except Exception:
                    pass
 
        storage_mb = round(total_bytes / (1024 * 1024), 2)
 
        # API keys count
        from models.widget import WidgetApiKey
        api_key_count = db.query(WidgetApiKey).filter_by(bot_id=bot_id, is_active=True).count()
 
        quota = {
            "messages_used":    total,
            "messages_limit":   5000,
            "docs_used":        real_doc_count,
            "docs_limit":       50,
            "storage_mb":       storage_mb,
            "storage_limit_mb": 5120,   # 5 GB
            "api_keys_used":    api_key_count,
            "api_keys_limit":   5,
        }

        return {
            "total":                    total,
            "success_count":            success_count,
            "failure_count":            failure_count,
            "success_rate":             success_rate,
            "top_keywords":             top_keywords,
            "unanswered_questions":     unanswered,
            "avg_messages_per_session": avg_messages,
            "total_sessions":           len(session_counts),
            "pending_tickets":          pending_tickets,
            # NEW ↓
            "response_times":           response_times,
            "messages_per_day":         messages_per_day,
            "document_usage":           document_usage,
            "quota":                    quota,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Advanced analytics error: %s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Analytics error: {str(e)}")

import os
import shutil
 
@router.delete("/bots/{bot_id}/memory")
def clear_bot_memory(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Delete all FAISS conversation-memory indexes for every active session
    belonging to this bot. The document index (bot_{bot_id}) is untouched.
    """
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
 
    # This points to the project root assuming admin.py is in /app/routers/
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    vector_root = os.path.join(BASE_DIR, "vector_store", f"user_{bot_id}")
    
    deleted = []
    errors = []

    # 2. Use the try-block for safer directory scanning
    try:
        if not os.path.isdir(vector_root):
            return {"ok": True, "deleted": [], "message": "No memory found."}

        with os.scandir(vector_root) as it:
            for entry in it:
                # Skip document index, only remove session memory
                if entry.is_dir() and entry.name.endswith("_memory"):
                    try:
                        shutil.rmtree(entry.path)
                        deleted.append(entry.name)
                    except Exception as e:
                        errors.append({"folder": entry.name, "error": str(e)})

    except FileNotFoundError:
        return {"ok": True, "deleted": [], "message": "No memory folder exists for this bot."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OS Error: {str(e)}")

    return {
        "ok": len(errors) == 0,
        "deleted": deleted,
        "errors": errors,
        "message": f"Cleared {len(deleted)} memory session(s).",
    }