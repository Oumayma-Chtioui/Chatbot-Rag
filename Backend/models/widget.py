from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

class WidgetBot(Base):
    __tablename__ = "widget_bots"

    id          = Column(String, primary_key=True)      # uuid
    owner_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    name        = Column(String, nullable=False)
    system_prompt = Column(String, default="You are a helpful assistant.")
    allowed_origin = Column(String, nullable=True)      # CORS domain lock
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, default=datetime.utcnow)

    api_keys = relationship("WidgetApiKey", back_populates="bot", cascade="all, delete")


class WidgetApiKey(Base):
    __tablename__ = "widget_api_keys"

    id         = Column(String, primary_key=True)       # uuid
    bot_id     = Column(String, ForeignKey("widget_bots.id"), nullable=False)
    key_hash   = Column(String, unique=True, nullable=False)   # bcrypt hash
    key_prefix = Column(String, nullable=False)                # first 8 chars (for display)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_used  = Column(DateTime, nullable=True)

    bot = relationship("WidgetBot", back_populates="api_keys")