from sqlalchemy import Boolean, Float, Enum, Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from database import Base
from models.widget import PlanTier, WidgetMessage, WidgetFeedback


class UserModel(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    name            = Column(String)
    email           = Column(String, unique=True, index=True)
    hashed_password = Column(String, nullable=True)
    google_id       = Column(String, unique=True, index=True, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    is_admin        = Column(Boolean, default=False)

    # Admin / billing fields
    plan             = Column(Enum(PlanTier), default=PlanTier.free, nullable=False)
    mrr              = Column(Float,   default=0.0)
    renewal_date     = Column(DateTime, nullable=True)
    messages_quota   = Column(Integer, default=1_000)
    messages_used    = Column(Integer, default=0)
    docs_quota       = Column(Integer, default=100)
    docs_indexed     = Column(Integer, default=0)
    storage_quota_gb = Column(Float,   default=1.0)
    storage_used_gb  = Column(Float,   default=0.0)

    # Relationships
    sessions     = relationship("ChatSessionModel", back_populates="user", cascade="all, delete")
    bots         = relationship("WidgetBot",        back_populates="owner", cascade="all, delete")
    feedback     = relationship("WidgetFeedback",   back_populates="user")
    subscription = relationship("Subscription",     back_populates="owner", uselist=False)
    
    is_verified = Column(Boolean, default=False)
    verified_at = Column(DateTime, nullable=True)
    verification_token  = Column(String, nullable=True)

    verification_token_expires = Column(DateTime, nullable=True)


class ChatSessionModel(Base):
    __tablename__ = "chat_sessions"

    id         = Column(String,  primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id    = Column(Integer, ForeignKey("users.id"))
    title      = Column(String,  default="New chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user     = relationship("UserModel", back_populates="sessions")
    messages = relationship("WidgetMessage", back_populates="session",
                            cascade="all, delete", order_by="WidgetMessage.created_at",
                            foreign_keys="WidgetMessage.session_id",
                            primaryjoin="ChatSessionModel.id == WidgetMessage.session_id")


# Aliases so existing imports don't break
MessageModel = WidgetMessage