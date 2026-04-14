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

router = APIRouter(prefix="/widgets", tags=["Widgets"])


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
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
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