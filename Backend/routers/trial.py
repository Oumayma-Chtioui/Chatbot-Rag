"""
routers/trial.py

Visitor / pre-auth trial chatbot experience.

What this module does
─────────────────────
• POST /trial/session          – create an ephemeral trial session (no auth)
• DELETE /trial/session/{id}   – purge everything for that session
• POST /trial/session/{id}/delete – beacon-compatible alias (sendBeacon can only POST)
• POST /trial/upload           – upload a single file, indexed under the session
• POST /trial/chat/stream      – streaming RAG chat, limited to MAX_TURNS

Limits (enforced server-side, mirrored in TrialChat.tsx)
────────────────────────────────────────────────────────
MAX_TURNS  = 6   (user messages per session)
MAX_FILES  = 1   (uploaded files per session)
SESSION_TTL = 2 hours (sessions older than this are auto-purged by cleanup)

Data lifecycle
──────────────
All data lives under a namespaced user_id  "trial_{session_id}".
Deleting the session calls delete_session_vectors() and removes all
MongoDB documents + message records — same as the normal DELETE /sessions
endpoint does for authenticated users.
"""

import json
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import UPLOAD_DIR
from database import documents_collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/trial", tags=["Trial"])

# ── Limits ────────────────────────────────────────────────────────────────────

MAX_TURNS     = 6
MAX_FILES     = 1
SESSION_TTL   = 60 * 120        # 2 hours in seconds
MAX_FILE_SIZE = 50 * 1024 * 1024


# ── In-memory session registry ────────────────────────────────────────────────
# { session_id: { "turns": int, "files": int, "created_at": datetime } }
# For multi-worker deployments swap this for a Redis hash.

_sessions: dict[str, dict] = {}


def _get_session(session_id: str) -> dict:
    """Return session meta or None (never raises — callers decide)."""
    return _sessions.get(session_id)


def _trial_user_id(session_id: str) -> str:
    return f"trial_{session_id}"


# ── Core purge logic (shared by DELETE and POST beacon alias) ─────────────────

def _purge_session(session_id: str) -> dict:
    """
    Hard-delete all data for a trial session.
    Returns a result dict with what was cleaned up.
    Raises on vector-deletion failure so callers know cleanup was incomplete.
    """
    _sessions.pop(session_id, None)

    user_id = _trial_user_id(session_id)
    result  = {"vectors": False, "files_removed": 0, "docs_deleted": 0, "messages_deleted": 0}

    # 1. Delete FAISS vectors — raise if this fails, it's the critical step
    try:
        from services.rag_services import delete_session_vectors
        delete_session_vectors(user_id, session_id)
        result["vectors"] = True
        logger.info(f"[trial] Vectors deleted for session {session_id}")
    except Exception as e:
        # Log the real error and re-raise so the caller gets a 500, not a silent ok
        logger.error(f"[trial] Vector deletion FAILED for {session_id}: {e}", exc_info=True)
        raise RuntimeError(f"Vector cleanup failed: {e}") from e

    # 2. Delete uploaded files from disk
    docs = list(documents_collection.find(
        {"user_id": user_id, "session_id": session_id},
        {"_id": 0, "path": 1, "type": 1}
    ))
    for doc in docs:
        if doc.get("type") != "url" and doc.get("path") and os.path.exists(doc["path"]):
            try:
                os.remove(doc["path"])
                result["files_removed"] += 1
            except Exception as e:
                logger.warning(f"[trial] Could not remove file {doc['path']}: {e}")

    # 3. Delete MongoDB document records
    del_docs = documents_collection.delete_many({"user_id": user_id, "session_id": session_id})
    result["docs_deleted"] = del_docs.deleted_count

    # 4. Delete chat messages
    try:
        from database import messages_collection as msg_col
        del_msgs = msg_col.delete_many({"session_id": session_id})
        result["messages_deleted"] = del_msgs.deleted_count
    except Exception as e:
        logger.warning(f"[trial] Message cleanup failed for {session_id}: {e}")

    logger.info(f"[trial] Purged session {session_id}: {result}")
    return result


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/session")
def create_trial_session():
    """Create a new ephemeral trial session."""
    session_id = f"trial_{uuid.uuid4().hex[:16]}"
    _sessions[session_id] = {
        "turns":      0,
        "files":      0,
        "created_at": datetime.utcnow(),
    }
    logger.info(f"[trial] Created session {session_id}")
    return {"session_id": session_id}


@router.delete("/session/{session_id}")
def delete_trial_session(session_id: str):
    """
    Purge all data for this trial session.
    Called by the frontend on SPA unmount or explicit dismiss.
    """
    try:
        result = _purge_session(session_id)
    except RuntimeError as e:
        # Vector deletion failed — surface this as a 500 so it's visible
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "purged": session_id, **result}


@router.post("/session/{session_id}/delete")
def beacon_delete_trial_session(session_id: str):
    """
    POST alias for DELETE — required because navigator.sendBeacon can only POST.
    The browser fires this on tab close / refresh / navigation.
    Returns 200 even if vectors fail (beacon responses are ignored by the browser),
    but logs the error properly.
    """
    try:
        result = _purge_session(session_id)
    except RuntimeError as e:
        # Can't do anything about beacon failures at the browser end,
        # but at least log it loudly so you can investigate
        logger.error(f"[trial] Beacon purge FAILED for {session_id}: {e}")
        return {"ok": False, "error": str(e), "purged": session_id}
    return {"ok": True, "purged": session_id, **result}


@router.post("/upload")
async def trial_upload(
    session_id: str,
    file: UploadFile = File(...),
):
    """Upload and index a single document for the trial session."""
    session = _get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Trial session not found or expired")

    if session["files"] >= MAX_FILES:
        raise HTTPException(
            status_code=429,
            detail=f"Trial sessions are limited to {MAX_FILES} document(s)."
        )

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".pdf", ".txt", ".md", ".docx"}:
        raise HTTPException(status_code=415, detail=f"Unsupported file type '{ext}'")

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large. Max 50 MB for trial.")

    doc_id    = str(uuid.uuid4())
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    temp_path = os.path.join(UPLOAD_DIR, f"trial_{doc_id}{ext}")
    with open(temp_path, "wb") as f:
        f.write(contents)

    user_id = _trial_user_id(session_id)

    doc_record = {
        "id":         doc_id,
        "user_id":    user_id,
        "session_id": session_id,
        "name":       file.filename,
        "type":       ext[1:],
        "size":       f"{len(contents) / 1024:.1f} KB",
        "path":       temp_path,
        "status":     "processing",
        "chunks":     0,
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one(doc_record)

    class _FakeFile:
        def __init__(self, name): self.filename = name

    try:
        from services.rag_services import load_document
        result = await load_document(
            _FakeFile(file.filename), temp_path, user_id, session_id, 0, doc_id
        )
        status = "indexed" if result.get("success") else "failed"
        documents_collection.update_one(
            {"id": doc_id},
            {"$set": {
                "status":     status,
                "chunks":     result.get("chunks", 0),
                "indexed_at": datetime.utcnow().isoformat(),
                "error":      result.get("error") if not result.get("success") else None,
            }}
        )
        if not result.get("success"):
            logger.error(f"[trial] Indexing failed for {doc_id}: {result.get('error')}")
    except Exception as e:
        logger.error(f"[trial] Indexing exception for {doc_id}: {e}", exc_info=True)
        documents_collection.update_one(
            {"id": doc_id}, {"$set": {"status": "failed", "error": str(e)}}
        )

    session["files"] += 1
    return {"doc_id": doc_id, "session_id": session_id, "status": "indexed"}


# ── Chat ──────────────────────────────────────────────────────────────────────

class TrialChatRequest(BaseModel):
    message:    str
    session_id: str


@router.post("/chat/stream")
async def trial_chat_stream(req: TrialChatRequest):
    """Streaming RAG chat for trial visitors. No auth required."""
    session = _get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Trial session not found or expired")

    if session["turns"] >= MAX_TURNS:
        raise HTTPException(
            status_code=429,
            detail=f"Trial limit reached. You've used all {MAX_TURNS} free messages."
        )

    user_id = _trial_user_id(req.session_id)

    async def event_stream():
        full_answer = ""
        sources     = []

        try:
            from services.chatservice import generate_answer_stream
            async for chunk in generate_answer_stream(
                question=req.message,
                user_id=user_id,
                session_id=req.session_id,
                memory_session_id=req.session_id,
            ):
                if chunk.startswith("__SOURCES__:"):
                    try:
                        sources = json.loads(chunk[len("__SOURCES__:"):])
                    except Exception:
                        pass
                else:
                    full_answer += chunk
                    yield chunk

            yield f"\n__SOURCES__:{json.dumps(sources)}"

        except Exception as e:
            logger.error(f"[trial] Stream error for {req.session_id}: {e}", exc_info=True)
            yield f"[Error: {str(e)}]"
            return

        session["turns"] += 1
        logger.info(f"[trial] Session {req.session_id}: turn {session['turns']}/{MAX_TURNS}")

    return StreamingResponse(
        event_stream(),
        media_type="text/plain",
        headers={"X-Trial-Session": req.session_id},
    )


# ── Cleanup cron endpoint ─────────────────────────────────────────────────────

@router.delete("/cleanup")
def cleanup_expired_sessions(secret: Optional[str] = None):
    """Purge sessions older than SESSION_TTL. Protect with a shared secret in production."""
    cutoff  = datetime.utcnow() - timedelta(seconds=SESSION_TTL)
    expired = [
        sid for sid, meta in list(_sessions.items())
        if meta["created_at"] < cutoff
    ]
    failed = []
    for sid in expired:
        try:
            _purge_session(sid)
        except Exception as e:
            logger.error(f"[trial] Cleanup failed for {sid}: {e}")
            failed.append(sid)

    return {
        "purged":    len(expired) - len(failed),
        "failed":    failed,
        "remaining": len(_sessions),
    }