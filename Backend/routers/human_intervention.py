"""
routers/human_intervention.py
Handles the full human-intervention ticket lifecycle:
  POST /widget/intervention/request   – user asks for help, gets email code
  POST /widget/intervention/verify    – user confirms code, notifies client
  GET  /widgets/tickets               – client lists their tickets (JWT-protected)
  GET  /widgets/tickets/{id}          – single ticket (for respond page)
  POST /widgets/tickets/{id}/respond  – client submits answer, emails user
"""
import random
import string
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db, mongodb
from models.widget import WidgetBot
from models.user import UserModel
from auth.helpers import get_current_user
from auth.widget_auth import require_api_key
from services.email_service import (
    send_verification_code,
    send_intervention_request_to_client,
    send_answer_to_user,
)

router = APIRouter()


# ── helpers ──────────────────────────────────────────────────────────────────

def _gen_code() -> str:
    return "".join(random.choices(string.digits, k=6))

def _gen_ticket_id() -> str:
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    return f"tkt_{suffix}"


def _fetch_chat_history(bot_id: str, session_id: str) -> list:
    """
    Fetch the conversation messages for the given session from widget_messages.
    Returns a list of {"role": "user"|"assistant", "content": str, "created_at": str}
    ordered oldest → newest, capped at the last 50 exchanges (100 docs).
    """
    try:
        raw = list(
            mongodb["widget_messages"]
            .find(
                {"bot_id": bot_id, "session_id": session_id},
                {"_id": 0, "question": 1, "answer": 1, "created_at": 1},
            )
            .sort("created_at", 1)
            .limit(100)
        )

        history = []
        for msg in raw:
            created = msg.get("created_at")
            ts = created.isoformat() if hasattr(created, "isoformat") else str(created)

            if msg.get("question"):
                history.append({"role": "user",      "content": msg["question"], "created_at": ts})
            if msg.get("answer"):
                history.append({"role": "assistant", "content": msg["answer"],   "created_at": ts})

        return history
    except Exception as exc:
        print(f"[INTERVENTION] Could not fetch chat history: {exc}")
        return []


# ── schemas ───────────────────────────────────────────────────────────────────

class InterventionRequestBody(BaseModel):
    question: str
    session_id: str
    user_email: str

class VerifyBody(BaseModel):
    ticket_id: str
    code: str

class RespondBody(BaseModel):
    answer: str


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.post("/widget/intervention/request")
async def request_intervention(
    body: InterventionRequestBody,
    bot: WidgetBot = Depends(require_api_key),
    db: Session = Depends(get_db),
):
    """
    Called by the widget when the chatbot can't answer.
    Saves a ticket (including full chat history snapshot) and emails a
    verification code to the user.
    """
    client = db.query(UserModel).filter_by(id=bot.owner_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Bot owner not found")

    code      = _gen_code()
    ticket_id = _gen_ticket_id()

    # Snapshot the conversation that led to this intervention so the client
    # has full context in the ticket detail view (not sent in the email).
    chat_history = _fetch_chat_history(bot.id, body.session_id)

    mongodb["intervention_tickets"].insert_one({
        "ticket_id":          ticket_id,
        "bot_id":             bot.id,
        "bot_name":           bot.name,
        "question":           body.question,
        "session_id":         body.session_id,
        "user_email":         body.user_email,
        "client_email":       client.email,
        "verification_code":  code,
        "code_expires_at":    (datetime.utcnow() + timedelta(minutes=15)).isoformat(),
        "verified":           False,
        "status":             "pending_verification",   # pending_verification | pending_response | answered
        "answer":             None,
        "chat_history":       chat_history,             # ← conversation snapshot
        "created_at":         datetime.utcnow().isoformat(),
        "answered_at":        None,
    })

    try:
        send_verification_code(body.user_email, code)
    except Exception as e:
        print(f"[INTERVENTION] Error sending verification code: {str(e)}")
        # Don't fail the request if email fails, just log it

    return {"ticket_id": ticket_id, "message": "Verification code sent"}


@router.post("/widget/intervention/verify")
async def verify_intervention(body: VerifyBody):
    """
    User submits the 6-digit code.  On success, the client (bot owner) receives
    an email with a link to respond.
    """
    ticket = mongodb["intervention_tickets"].find_one(
        {"ticket_id": body.ticket_id}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket["verified"]:
        raise HTTPException(status_code=400, detail="Already verified")
    if ticket["verification_code"] != body.code:
        raise HTTPException(status_code=400, detail="Invalid code")
    if datetime.utcnow() > datetime.fromisoformat(ticket["code_expires_at"]):
        raise HTTPException(status_code=400, detail="Code expired")

    mongodb["intervention_tickets"].update_one(
        {"ticket_id": body.ticket_id},
        {"$set": {"verified": True, "status": "pending_response"}},
    )

    # Email does NOT include chat history — context lives in the portal only.
    send_intervention_request_to_client(
        ticket["client_email"],
        ticket["question"],
        body.ticket_id,
        ticket["bot_name"],
    )

    return {"message": "Email verified. The support team has been notified."}


def _hydrate_history(ticket: dict) -> dict:
    """
    If the ticket was created before chat_history snapshotting was added,
    attempt a live lookup from widget_messages using the stored session_id.
    Mutates and returns the ticket dict.
    """
    if ticket.get("chat_history") is None:
        history = _fetch_chat_history(
            ticket.get("bot_id", ""),
            ticket.get("session_id", ""),
        )
        ticket["chat_history"] = history
    return ticket


@router.get("/widgets/tickets")
async def list_tickets(
    current_user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Client portal — lists all tickets for bots owned by the current user."""
    from models.widget import WidgetBot as WB
    owned_bot_ids = [b.id for b in db.query(WB).filter_by(owner_id=current_user.id).all()]
    tickets = list(
        mongodb["intervention_tickets"]
        .find({"bot_id": {"$in": owned_bot_ids}}, {"_id": 0})
        .sort("created_at", -1)
        .limit(100)
    )
    # Backfill history for any ticket that pre-dates the snapshot feature
    tickets = [_hydrate_history(t) for t in tickets]
    return {"tickets": tickets}


@router.get("/widgets/tickets/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    current_user: UserModel = Depends(get_current_user),
):
    ticket = mongodb["intervention_tickets"].find_one(
        {"ticket_id": ticket_id}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    # Backfill history for tickets that pre-date the snapshot feature
    ticket = _hydrate_history(ticket)
    return ticket


@router.post("/widgets/tickets/{ticket_id}/respond")
async def respond_to_ticket(
    ticket_id: str,
    body: RespondBody,
    current_user: UserModel = Depends(get_current_user),
):
    ticket = mongodb["intervention_tickets"].find_one(
        {"ticket_id": ticket_id}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket["status"] == "answered":
        raise HTTPException(status_code=400, detail="Already answered")

    mongodb["intervention_tickets"].update_one(
        {"ticket_id": ticket_id},
        {"$set": {
            "status":      "answered",
            "answer":      body.answer,
            "answered_at": datetime.utcnow().isoformat(),
        }},
    )

    send_answer_to_user(
        ticket["user_email"],
        ticket["question"],
        body.answer,
        ticket["bot_name"],
    )

    return {"message": "Answer sent to user"}


@router.delete("/widgets/tickets/{ticket_id}")
async def delete_ticket(
    ticket_id: str,
    current_user: UserModel = Depends(get_current_user),
):
    """Delete a ticket. Only the bot owner can delete tickets."""
    ticket = mongodb["intervention_tickets"].find_one(
        {"ticket_id": ticket_id}, {"_id": 0}
    )
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Verify the current user owns the bot
    from models.widget import WidgetBot as WB
    from database import get_db
    db = next(get_db())
    bot = db.query(WB).filter_by(id=ticket["bot_id"], owner_id=current_user.id).first()
    if not bot:
        raise HTTPException(status_code=403, detail="Not authorized to delete this ticket")

    mongodb["intervention_tickets"].delete_one({"ticket_id": ticket_id})
    return {"message": "Ticket deleted"}