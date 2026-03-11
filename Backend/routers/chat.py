from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import logging

from auth.helpers import get_current_user
from models.user import UserModel
from services.chatservice import generate_answer

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


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    current_user: UserModel = Depends(get_current_user)
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
            user_id=current_user.id,
            session_id=request.session_id,
            question=request.message
        )
        
        logger.info(f"✅ Generated answer: {result['answer'][:100]}...")
        
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