"""
routers/test_sessions.py

Manages temporary admin test-access sessions for widget bots.
Clients can grant time-limited (or permanent) access so admins can
debug/test the embedded widget without exposing it publicly.

Endpoints:
  POST   /widgets/bots/{bot_id}/test-sessions   – create a test session
  GET    /widgets/bots/{bot_id}/test-sessions   – list active sessions
  DELETE /widgets/bots/{bot_id}/test-sessions/{session_id} – revoke
  GET    /widget/test-access/{token}            – validate (used by widget auth)
"""

import uuid
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db, mongodb
from models.widget import WidgetBot
from models.user import UserModel
from auth.helpers import get_current_user
from datetime import timezone


router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class CreateTestSessionRequest(BaseModel):
    duration_minutes: int = 60   # 0 = forever


# ── Helpers ───────────────────────────────────────────────────────────────────

def _col():
    return mongodb["widget_test_sessions"]


def _is_active(session: dict) -> bool:
    expires_at = session.get("expires_at")
    if expires_at is None:
        return True   # forever
    try:
        dt = datetime.fromisoformat(expires_at)
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)  # strip tz, treat as UTC
        return datetime.utcnow() < dt
    except (ValueError, TypeError):
        return False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/widgets/bots/{bot_id}/test-sessions")
def create_test_session(
    bot_id: str,
    req: CreateTestSessionRequest,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Grant temporary (or permanent) admin test access for a bot widget.
    Only the bot owner can create test sessions.
    """
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    expires_at: Optional[str] = None
    if req.duration_minutes > 0:
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=req.duration_minutes)).isoformat()
    duration_label = "Forever"
    if req.duration_minutes == 30:
        duration_label = "30 min"
    elif req.duration_minutes == 60:
        duration_label = "1 hour"
    elif req.duration_minutes == 360:
        duration_label = "6 hours"
    elif req.duration_minutes == 1440:
        duration_label = "24 hours"
    elif req.duration_minutes == 10080:
        duration_label = "7 days"

    session_id   = str(uuid.uuid4())
    access_token = secrets.token_urlsafe(32)

    doc = {
        "session_id":      session_id,
        "bot_id":          bot_id,
        "owner_id":        current_user.id,
        "email":           current_user.email,
        "access_token":    access_token,
        "duration_minutes": req.duration_minutes,
        "duration_label":  duration_label,
        "granted_at": datetime.now(timezone.utc).isoformat(),
        "expires_at":      expires_at,
        "is_active":       True,
    }
    _col().insert_one({**doc, "_id": session_id})

    return {
        "id":              session_id,
        "access_token":    access_token,
        "expires_at":      expires_at,
        "duration_label":  duration_label,
        "granted_at":      doc["granted_at"],
    }


@router.get("/widgets/bots/{bot_id}/test-sessions")
def list_test_sessions(
    bot_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all test sessions for a bot (owner only)."""
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    raw = list(_col().find({"bot_id": bot_id}, {"_id": 0}))
    sessions = []
    for s in raw:
        active = _is_active(s)
        sessions.append({**s, "is_active": active})

    return {"sessions": sessions}


@router.delete("/widgets/bots/{bot_id}/test-sessions/{session_id}")
def revoke_test_session(
    bot_id: str,
    session_id: str,
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Revoke a test session (owner only)."""
    bot = db.query(WidgetBot).filter_by(id=bot_id, owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    result = _col().delete_one({"session_id": session_id, "bot_id": bot_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Test session not found")

    return {"ok": True, "revoked": session_id}


@router.get("/widget/test-access/{access_token}")
def validate_test_token(access_token: str):
    """
    Called by the widget embed or admin portal to check if a test token is valid.
    Returns the bot_id if valid, 404 otherwise.
    """
    session = _col().find_one({"access_token": access_token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Invalid or expired test token")

    if not _is_active(session):
        raise HTTPException(status_code=403, detail="Test session has expired")

    return {
        "valid":      True,
        "bot_id":     session["bot_id"],
        "expires_at": session.get("expires_at"),
    }