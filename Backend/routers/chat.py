from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List
import logging
import json
from datetime import datetime

from auth.helpers import get_current_user
from models.user import UserModel, ChatSessionModel
from services.chatservice import generate_answer_stream
from sqlalchemy.orm import Session as DBSession
from database import get_db


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: str
    doc_ids: Optional[List[str]] = None


class SourceItem(BaseModel):
    source: str
    content_preview: str


@router.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: UserModel = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """
    Streaming chat endpoint with RAG - uses per-session document isolation.
    Streams tokens as plain text, ending with a __SOURCES__:{json} chunk.
    """
    logger.info(f"💬 Chat request from user {current_user.id}")
    logger.info(f"📝 Session ID: {request.session_id}")
    logger.info(f"❓ Question: {request.message[:100]}...")

    # Ensure session exists in DB before streaming starts
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == request.session_id
    ).first()

    if not session:
        session = ChatSessionModel(
            id=request.session_id,
            user_id=current_user.id,
            title=request.message[:40]
        )
        db.add(session)
        db.flush()

    if session.title in ("New chat", "New conversation"):
        session.title = request.message[:40]
    session.updated_at = datetime.utcnow()
    db.commit()
    logger.info("✅ User message saved to PostgreSQL")

    async def stream_and_save():
        full_answer = ""
        sources = []

        try:
            async for chunk in generate_answer_stream(
                question=request.message,
                user_id=current_user.id,
                session_id=request.session_id,
                memory_session_id=request.session_id,
            ):
                if chunk.startswith("__SOURCES__:"):
                    # Parse sources but don't stream this chunk to client as-is
                    try:
                        sources = json.loads(chunk[len("__SOURCES__:"):])
                    except Exception:
                        sources = []
                    # Send sources as a structured SSE-style marker so the
                    # frontend can parse them separately
                    yield chunk + "\n"
                else:
                    full_answer += chunk
                    yield chunk

        except Exception as e:
            logger.error(f"❌ Streaming error: {e}")
            import traceback
            traceback.print_exc()
            yield f"\n[Error: {str(e)}]"
            return

        logger.info("✅ Stream complete, messages saved to MongoDB by chatservice")

    return StreamingResponse(
        stream_and_save(),
        media_type="text/plain",
        headers={
            "X-Session-ID": request.session_id,
            "Access-Control-Allow-Origin": "http://localhost:5173",
            "Access-Control-Allow-Credentials": "true",
        }
    )


@router.get("/chat/status")
async def chat_status(current_user: UserModel = Depends(get_current_user)):
    """
    Check chat service status
    """
    from services.chatservice import check_system_status

    status = check_system_status()

    return {
        "user_id": current_user.id,
        "status": status,
        "ready": all(status.values())
    }


@router.get("/chat/{session_id}/history")
async def get_history(
    session_id: str,
    current_user: UserModel = Depends(get_current_user)
):
    from database import messages_collection
    messages = list(
        messages_collection.find(
            {"session_id": session_id, "user_id": current_user.id},
            {"_id": 0, "session_id": 0, "user_id": 0, "timestamp": 0}
        ).sort("timestamp", 1)
    )
    return {"messages": messages}