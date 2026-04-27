from datetime import datetime, timedelta
from collections import defaultdict, Counter
from database import mongodb, documents_collection
import re
import os

_STOP = {
    "the","a","an","is","are","was","were","be","been","have","has","had",
    "do","does","did","will","would","could","should","may","might","can",
    "i","you","he","she","it","we","they","me","him","her","us","them",
    "my","your","his","its","our","their","this","that","these","those",
    "what","which","who","how","when","where","why","and","or","but","if",
    "in","on","at","to","for","of","with","by","from","about","into","not",
    "je","tu","il","elle","nous","vous","ils","elles","le","la","les","un",
    "une","des","est","sont","avec","pour","dans","sur","par","que","qui",
}

_NO_ANSWER = [
    "i don't have information","i couldn't find","not found in the documents",
    "no relevant information","i don't know","cannot answer","not mentioned",
    "no information about","i'm unable to find","there is no information",
    "je n'ai pas trouvé","je ne trouve pas","aucune information",
]

def _extract_keywords(text: str) -> list:
    words = re.findall(r"\b[a-zA-ZÀ-ÿ]{3,}\b", text.lower())
    return [w for w in words if w not in _STOP][:10]

def _is_answered(answer: str) -> bool:
    if not answer:
        return False
    lower = answer.lower()
    return not any(phrase in lower for phrase in _NO_ANSWER)

def _safe_date_str(val) -> str:
    if val is None:
        return ""
    if hasattr(val, "isoformat"):
        return val.isoformat()
    return str(val)

def get_bot_analytics(bot_id: str, db) -> dict:
    messages = list(
        mongodb["widget_messages"]
        .find({"bot_id": bot_id}, {"_id": 0})
        .sort("created_at", -1)
        .limit(5000)
    )

    total = len(messages)

    # success / failure
    success_list, failure_list = [], []
    for m in messages:
        answered_flag = m.get("answered")
        if answered_flag is None:
            answered_flag = _is_answered(m.get("answer") or "")
        if answered_flag:
            success_list.append(m)
        else:
            failure_list.append(m)

    success_count = len(success_list)
    failure_count = len(failure_list)
    success_rate  = round(success_count / total * 100, 1) if total > 0 else 0.0

    # keywords
    all_keywords = []
    for m in messages:
        kws = m.get("keywords")
        if kws:
            all_keywords.extend(kws)
        else:
            all_keywords.extend(_extract_keywords(m.get("question") or ""))
    top_keywords = [{"word": w, "count": c} for w, c in Counter(all_keywords).most_common(20)]

    # unanswered questions
    unanswered = [
        {"question": m.get("question") or "", "created_at": _safe_date_str(m.get("created_at"))}
        for m in failure_list
    ][-25:]

    # sessions
    session_counts = Counter(m.get("session_id") or "unknown" for m in messages)
    avg_messages   = round(sum(session_counts.values()) / len(session_counts), 1) if session_counts else 0.0

    # pending tickets
    try:
        pending_tickets = mongodb["intervention_tickets"].count_documents({
            "bot_id": bot_id, "status": "pending_response"
        })
    except Exception:
        pending_tickets = 0

    # response times per day
    rt_by_day = defaultdict(list)
    for m in messages:
        rt = m.get("response_time_ms")
        if rt is None:
            continue
        created = m.get("created_at")
        day_key = created.strftime("%Y-%m-%d") if hasattr(created, "strftime") else str(created)[:10]
        rt_by_day[day_key].append(rt)

    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    response_times = []
    for i in range(29, -1, -1):
        day = today - timedelta(days=i)
        key = day.strftime("%Y-%m-%d")
        times = rt_by_day.get(key, [])
        response_times.append({
            "date":   key,
            "avg_ms": round(sum(times) / len(times)) if times else None,
            "count":  len(times),
        })

    # messages per day
    msg_by_day = defaultdict(int)
    for m in messages:
        created = m.get("created_at")
        day_key = created.strftime("%Y-%m-%d") if hasattr(created, "strftime") else str(created)[:10]
        msg_by_day[day_key] += 1

    messages_per_day = []
    for i in range(29, -1, -1):
        day = today - timedelta(days=i)
        key = day.strftime("%Y-%m-%d")
        messages_per_day.append({"date": key, "count": msg_by_day.get(key, 0)})

    # document usage
    doc_citation_counts: Counter = Counter()
    for m in messages:
        for doc_name in set(m.get("source_docs", [])):
            if doc_name:
                doc_citation_counts[doc_name] += 1
    document_usage = [
        {"name": name, "citations": count}
        for name, count in doc_citation_counts.most_common(10)
    ]

    # quota
    from models.widget import WidgetApiKey
    real_doc_count = documents_collection.count_documents({"user_id": bot_id})
    docs_cursor    = list(documents_collection.find({"user_id": bot_id}, {"size": 1, "path": 1, "type": 1, "_id": 0}))
    total_bytes    = 0
    for d in docs_cursor:
        if d.get("type") == "url":
            continue
        file_path = d.get("path", "")
        if file_path and os.path.exists(file_path):
            total_bytes += os.path.getsize(file_path)
        else:
            raw = str(d.get("size", "0"))
            try:
                parts = raw.strip().split()
                num   = float(parts[0])
                unit  = parts[1].upper() if len(parts) > 1 else "KB"
                if "GB" in unit:   total_bytes += int(num * 1024 * 1024 * 1024)
                elif "MB" in unit: total_bytes += int(num * 1024 * 1024)
                else:              total_bytes += int(num * 1024)
            except Exception:
                pass

    storage_mb    = round(total_bytes / (1024 * 1024), 2)
    api_key_count = db.query(WidgetApiKey).filter_by(bot_id=bot_id, is_active=True).count()

    quota = {
        "messages_used":    total,
        "messages_limit":   5000,
        "docs_used":        real_doc_count,
        "docs_limit":       50,
        "storage_mb":       storage_mb,
        "storage_limit_mb": 5120,
        "api_keys_used":    api_key_count,
        "api_keys_limit":   5,
    }

    return {
        "total":                    total,
        "success_count":            success_count,
        "failure_count":            failure_count,
        "success_rate":             success_rate,
        "top_keywords":             top_keywords,
        "unanswered_questions":     unanswered,
        "avg_messages_per_session": avg_messages,
        "total_sessions":           len(session_counts),
        "pending_tickets":          pending_tickets,
        "response_times":           response_times,
        "messages_per_day":         messages_per_day,
        "document_usage":           document_usage,
        "quota":                    quota,
    }