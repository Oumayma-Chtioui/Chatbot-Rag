import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from database import get_db
from models.user import UserModel, ChatSessionModel, MessageModel
from schemas.schemas import SessionCreate, MessageCreate
from auth.helpers import get_current_user
from database import get_db, documents_collection


router = APIRouter(tags=["Sessions"])

@router.get("/sessions")
def get_sessions(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = db.query(ChatSessionModel).filter(
        ChatSessionModel.user_id == current_user.id
    ).order_by(ChatSessionModel.updated_at.desc()).all()
    return [{"id": s.id, "title": s.title, "time": s.updated_at.strftime("%Y-%m-%d %H:%M")} for s in sessions]

@router.post("/sessions/create")
def create_session_simple(current_user: UserModel = Depends(get_current_user)):
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    return {"session_id": session_id}

@router.post("/sessions")
def create_session(req: SessionCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = ChatSessionModel(user_id=current_user.id, title=req.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"id": session.id, "title": session.title, "time": session.created_at.strftime("%Y-%m-%d %H:%M")}

@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == session_id,
        ChatSessionModel.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()

    from services.rag_services import delete_session_vectors
    delete_session_vectors(current_user.id, session_id)

    from database import documents_collection, messages_collection
    documents_collection.delete_many({"session_id": session_id, "user_id": current_user.id})
    messages_collection.delete_many({"session_id": session_id})

    return {"ok": True}

@router.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == session_id,
        ChatSessionModel.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources.split(",") if m.sources else [],
            "time": m.created_at.strftime("%H:%M")
        }
        for m in session.messages
    ]

@router.post("/sessions/{session_id}/messages")
def add_message(session_id: str, req: MessageCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == session_id,
        ChatSessionModel.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    msg = MessageModel(
        session_id=session_id,
        role=req.role,
        content=req.content,
        sources=",".join(req.sources or [])
    )
    db.add(msg)
    if req.role == "user" and session.title == "New chat":
        session.title = req.content[:40]
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)
    return {"id": msg.id, "role": msg.role, "content": msg.content, "sources": req.sources, "time": msg.created_at.strftime("%H:%M")}

@router.get("/sessions/{session_id}/documents")
def get_session_documents_pg(
    session_id: str,
    current_user: UserModel = Depends(get_current_user)
):
    """Get documents for a session from MongoDB"""
    docs = list(documents_collection.find(
        {"user_id": current_user.id, "session_id": session_id},
        {"_id": 0}
    ))
    return {"session_id": session_id, "documents": docs}