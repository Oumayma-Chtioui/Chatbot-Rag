from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging

from auth.helpers import get_current_user
from models.user import UserModel
from services.chatservice import generate_answer
from sqlalchemy.orm import Session as DBSession


from models.user import UserModel, ChatSessionModel, MessageModel
from database import get_db


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: str
    doc_ids: Optional[List[str]] = None


class ChatResponse(BaseModel):
    answer: str
    sources: List[dict]
    session_id: str
    context_used: bool = False

class SourceItem(BaseModel):
    source: str
    content_preview: str

@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: UserModel = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """
    Chat endpoint with RAG - uses per-session document isolation
    """
    logger.info(f"💬 Chat request from user {current_user.id}")
    logger.info(f"📝 Session ID: {request.session_id}")
    logger.info(f"❓ Question: {request.message[:100]}...")
    
    try:
        # Generate answer using RAG with user_id and session_id
        result = generate_answer(
            question=request.message,
            user_id=current_user.id,
            session_id=request.session_id,
            memory_session_id=request.session_id,
        )
        
        logger.info(f"✅ Generated answer: {result['answer'][:100]}...")
        
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

        # Save user message
        user_msg = MessageModel(
            session_id=request.session_id,
            role="user",
            content=request.message,
            sources=""
        )
        db.add(user_msg)

        # Save assistant message
        sources_str = ",".join([s.get("source", "") for s in result.get("sources", [])])
        assistant_msg = MessageModel(
            session_id=request.session_id,
            role="assistant",
            content=result["answer"],
            sources=sources_str
        )
        db.add(assistant_msg)

        # Update session title and timestamp
        if session.title == "New chat" or session.title == "New conversation":
            session.title = request.message[:40]
        from datetime import datetime
        session.updated_at = datetime.utcnow()

        db.commit()
        logger.info("✅ Messages saved to PostgreSQL")

        return ChatResponse(
            answer=result["answer"],
            sources=result.get("sources", []),
            session_id=request.session_id,
            context_used=result.get("context_used", False)
        )
        
    except Exception as e:
        logger.error(f"❌ Chat error: {e}")
        import traceback
        traceback.print_exc()
        
        raise HTTPException(
            status_code=500,
            detail=f"Error generating response: {str(e)}"
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