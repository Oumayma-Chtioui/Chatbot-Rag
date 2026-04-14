import hashlib
import secrets
from fastapi import Depends, Request, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from models.widget import WidgetApiKey, WidgetBot
from database import get_db

def generate_api_key() -> tuple[str, str]:
    """
    Returns (raw_key, key_hash).
    raw_key is shown once to the user — never stored.
    key_hash is stored in the DB.
    """
    raw = "nm_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    return raw, key_hash


def hash_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode()).hexdigest()


async def require_api_key(request: Request, db: Session= Depends(get_db)) -> WidgetBot:
    """
    FastAPI dependency — validates X-Api-Key header.
    Returns the associated WidgetBot or raises 401.
    """
    raw_key = request.headers.get("X-Api-Key")
    if not raw_key:
        raise HTTPException(status_code=401, detail="Missing API key")

    key_hash = hash_key(raw_key)
    api_key = db.query(WidgetApiKey).filter_by(key_hash=key_hash, is_active=True).first()

    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")

    bot = db.query(WidgetBot).filter_by(id=api_key.bot_id, is_active=True).first()
    if not bot:
        raise HTTPException(status_code=401, detail="Bot not found or inactive")

    # Update last_used without blocking
    api_key.last_used = datetime.utcnow()
    db.commit()

    return bot