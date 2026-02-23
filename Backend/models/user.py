from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base

class UserModel(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    sessions = relationship("ChatSessionModel", back_populates="user", cascade="all, delete")

class ChatSessionModel(Base):
    __tablename__ = "chat_sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, default="New chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user = relationship("UserModel", back_populates="sessions")
    messages = relationship("MessageModel", back_populates="session", cascade="all, delete", order_by="MessageModel.created_at")

class MessageModel(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"))
    role = Column(String)
    content = Column(Text)
    sources = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    session = relationship("ChatSessionModel", back_populates="messages")