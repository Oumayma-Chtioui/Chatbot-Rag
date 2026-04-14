import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, mongodb
from models.widget import WidgetBot
from auth.widget_auth import require_api_key
from services.chatservice import generate_answer

from slowapi import Limiter
from slowapi.util import get_remote_address

router = APIRouter(prefix="/widget", tags=["Widget Chat"])


def get_api_key_or_ip(request: Request) -> str:
    """
    Rate limit key: use the API key if present, fall back to IP.
    This means each API key gets its own 30/min bucket — not shared across keys.
    """
    return request.headers.get("X-Api-Key") or get_remote_address(request)


limiter = Limiter(key_func=get_api_key_or_ip)


class WidgetMessageRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


@router.post("/chat")
@limiter.limit("30/minute")
async def widget_chat(
    request: Request,
    req: WidgetMessageRequest,
    bot: WidgetBot = Depends(require_api_key),
):
    # CORS origin check
    if bot.allowed_origin:
        origin = request.headers.get("origin", "")
        if origin and bot.allowed_origin not in origin:
            raise HTTPException(
                status_code=403,
                detail=f"Origin {origin} not allowed for this widget"
            )

    # ── Session IDs ────────────────────────────────────────────────────────────
    # doc_session_id  → always points to the bot's FAISS document index (shared)
    # chat_session_id → unique per end-user conversation (isolated memory)
    doc_session_id  = f"bot_{bot.id}"
    chat_session_id = req.session_id or f"widget_{uuid.uuid4()}"

    try:
        result = generate_answer(
            question=req.message,
            user_id=bot.id,
            session_id=doc_session_id,          # FAISS document lookup
            memory_session_id=chat_session_id,  # per-user conversation memory
            
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Save to MongoDB for analytics
    if mongodb is not None:
        try:
            mongodb["widget_messages"].insert_one({
                "bot_id": bot.id,
                "session_id": chat_session_id,
                "question": req.message,
                "answer": result.get("answer", ""),
                "created_at": datetime.utcnow(),
            })
        except Exception:
            pass  # never let analytics failure break the response

    return {
        "answer": result.get("answer", ""),
        "sources": result.get("sources", []),
        "session_id": chat_session_id,
    }