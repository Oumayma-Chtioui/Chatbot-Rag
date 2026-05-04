from sqlalchemy import Column, String, Integer, Float, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from database import Base


# ── Plan tier enum ────────────────────────────────────────────────────────────

class PlanTier(str, enum.Enum):
    free       = "free"
    starter    = "starter"
    growth     = "growth"
    enterprise = "enterprise"


# ── WidgetBot ─────────────────────────────────────────────────────────────────

class WidgetBot(Base):
    __tablename__ = "widget_bots"

    id             = Column(String,  primary_key=True)
    owner_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    name           = Column(String,  nullable=False)
    system_prompt  = Column(String,  default="You are a helpful assistant.")
    allowed_origin = Column(String,  nullable=True)
    accent_color   = Column(String,  default="#7F77DD", nullable=True)
    welcome_message = Column(String, default="Hi! How can I help you today?", nullable=True)
    is_active      = Column(Boolean, default=True)
    docs_indexed   = Column(Integer, default=0)
    created_at     = Column(DateTime, default=datetime.utcnow)

    api_keys = relationship("WidgetApiKey", back_populates="bot", cascade="all, delete")
    owner    = relationship("UserModel", back_populates="bots", foreign_keys="WidgetBot.owner_id")
    messages = relationship("WidgetMessage", back_populates="bot", cascade="all, delete")
    feedback = relationship("WidgetFeedback", back_populates="bot", cascade="all, delete")


# ── WidgetApiKey ──────────────────────────────────────────────────────────────

class WidgetApiKey(Base):
    __tablename__ = "widget_api_keys"

    id         = Column(String,  primary_key=True)
    bot_id     = Column(String,  ForeignKey("widget_bots.id"), nullable=False)
    key_hash   = Column(String,  unique=True, nullable=False)
    key_prefix = Column(String,  nullable=False)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used  = Column(DateTime, nullable=True)

    bot = relationship("WidgetBot", back_populates="api_keys")


# ── WidgetMessage ─────────────────────────────────────────────────────────────

class WidgetMessage(Base):
    __tablename__ = "messages"

    id               = Column(String,  primary_key=True)
    bot_id           = Column(String,  ForeignKey("widget_bots.id"), nullable=True, index=True)
    session_id       = Column(String,  nullable=True, index=True)
    role             = Column(String,  nullable=False)
    content          = Column(Text,    nullable=False)
    success          = Column(Boolean, default=True)
    response_ms      = Column(Integer, nullable=True)
    response_time_ms = Column(Integer, nullable=True)
    is_answered      = Column(Boolean, default=False)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)

    bot     = relationship("WidgetBot",        back_populates="messages")
    session = relationship("ChatSessionModel", back_populates="messages",
                           foreign_keys=[session_id],
                           primaryjoin="WidgetMessage.session_id == ChatSessionModel.id")


# ── WidgetFeedback ────────────────────────────────────────────────────────────

class WidgetFeedback(Base):
    __tablename__ = "feedback"

    id         = Column(String,  primary_key=True)
    bot_id     = Column(String,  ForeignKey("widget_bots.id"), nullable=False, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    rating     = Column(Integer, nullable=False)
    comment    = Column(Text,    nullable=True)
    category   = Column(String,  nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    bot  = relationship("WidgetBot",  back_populates="feedback")
    user = relationship("UserModel",  back_populates="feedback")


# ── Aliases ───────────────────────────────────────────────────────────────────
Feedback = WidgetFeedback