import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from database import get_db, mongodb
from models.widget import WidgetBot
from auth.widget_auth import require_api_key
from services.chatservice import generate_answer

from slowapi import Limiter
from slowapi.util import get_remote_address

import re
from collections import Counter

router = APIRouter(prefix="/widget", tags=["Widget Chat"])

STOP_WORDS = {
    # English
    "the","a","an","is","are","was","were","be","been","have","has","had",
    "do","does","did","will","would","could","should","may","might","can",
    "i","you","he","she","it","we","they","me","him","her","us","them",
    "my","your","his","its","our","their","this","that","these","those",
    "what","which","who","how","when","where","why","and","or","but","if",
    "in","on","at","to","for","of","with","by","from","about","into","not",
    # French
    "je","tu","il","elle","nous","vous","ils","elles","le","la","les","un",
    "une","des","est","sont","avec","pour","dans","sur","par","que","qui",
    "quoi","comment","quand","où","pourquoi","pas","plus","très","bien","aussi",
    "mais","donc","car","comme","plus","même","tout","tous","toute","toutes",
    "du","au","aux","ce","cet","cette","ces","mon","ton","son","nos","vos",
    "leur","leurs","quel","quelle","quels","quelles","entre","sans","après",
    "avant","depuis","pendant","lors","selon","chez","vers","contre","malgré",
}
 
NO_ANSWER_PHRASES = [
    # English
    "i don't have information", "i couldn't find", "not found in the documents",
    "no relevant information", "i don't know", "cannot answer", "not mentioned",
    "no information about", "i'm unable to find", "there is no information",
    "document does not contain", "not available in", "based on the provided",
    "the document does not", "i cannot find", "unfortunately, i don't",
    "i was unable to", "no data available",
    # French
    "je n'ai pas trouvé", "je ne trouve pas", "aucune information",
    "pas d'information", "n'est pas mentionné", "ne figure pas",
    "introuvable", "je n'ai pas d'information", "je ne peux pas répondre",
    "il n'y a pas d'information", "les documents ne contiennent pas",
    "je suis désolé, je ne", "malheureusement, je n'ai",
]

def extract_keywords(text: str) -> list:
    """Return up to 10 meaningful words from the question."""
    words = re.findall(r"\b[a-zA-ZÀ-ÿ]{3,}\b", text.lower())
    return [w for w in words if w not in STOP_WORDS][:10]
 
 
def is_question_answered(answer: str) -> bool:
    """Return False if the answer signals the bot couldn't find relevant info."""
    lower = answer.lower()
    return not any(phrase in lower for phrase in NO_ANSWER_PHRASES)
 

def get_api_key_or_ip(request: Request) -> str:
    """
    Rate limit key: use the API key if present, fall back to IP.
    This means each API key gets its own 30/min bucket — not shared across keys.
    """
    return request.headers.get("X-Api-Key") or get_remote_address(request)


limiter = Limiter(key_func=get_api_key_or_ip)


class WidgetMessageRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


@router.post("/chat")
@limiter.limit("30/minute")
async def widget_chat(
    request: Request,
    req: WidgetMessageRequest,
    bot: WidgetBot = Depends(require_api_key),
):
    # CORS origin check
    if bot.allowed_origin:
        origin = request.headers.get("origin", "")
        if origin and bot.allowed_origin not in origin:
            raise HTTPException(
                status_code=403,
                detail=f"Origin {origin} not allowed for this widget"
            )

    # ── Session IDs ────────────────────────────────────────────────────────────
    # doc_session_id  → always points to the bot's FAISS document index (shared)
    # chat_session_id → unique per end-user conversation (isolated memory)
    doc_session_id  = f"bot_{bot.id}"
    chat_session_id = req.session_id or f"widget_{uuid.uuid4()}"

    try:
        result = generate_answer(
            question=req.message,
            user_id=bot.id,
            session_id=doc_session_id,          # FAISS document lookup
            memory_session_id=chat_session_id,  # per-user conversation memory
            
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Save to MongoDB for analytics
    if mongodb is not None:
        try:
            answered = is_question_answered(result.get("answer", ""))
            keywords = extract_keywords(req.message)
            
            mongodb["widget_messages"].insert_one({
                "bot_id":     bot.id,
                "session_id": chat_session_id,
                "question":   req.message,
                "answer":     result.get("answer", ""),
                "answered":   answered,      # ← NEW
                "keywords":   keywords,      # ← NEW
                "created_at": datetime.utcnow(),
            })
        except Exception:
            pass  # never let analytics failure break the response

    return {
        "answer": result.get("answer", ""),
        "sources": result.get("sources", []),
        "session_id": chat_session_id,
        "answered": answered, 
    }