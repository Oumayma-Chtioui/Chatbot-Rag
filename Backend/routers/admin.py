"""
routers/admin.py  (updated)

Changes vs original:
  /admin/overview now returns:
    - revenue_per_day         (30-day revenue + new-user curve)
    - user_change_ww/mom/yoy  (growth evolution % badges)
    - avg_response_ms         (platform-wide average response time)
    - response_time_per_day   (30-day sparkline)
    - tokens_used_this_month  (sum of token fields in widget_messages)
    - tokens_quota_this_month (derived from active subscriptions)
    - doc_types               (PDF / URL / DOCX / TXT breakdown)
    - messages_change_pct     (MoM message % change)
    - total_sessions          (for avg msgs/session)
  All other endpoints are unchanged.
"""

import uuid
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta, date
from typing import Optional
import psutil

from database import get_db, mongodb
from models.user import UserModel, ChatSessionModel
from models.widget import WidgetApiKey, WidgetBot, WidgetMessage, WidgetFeedback
from models.billing import Subscription
from auth.helpers import get_current_user
from services.faiss_service import get_all_indexes

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Auth guard ────────────────────────────────────────────────────────────────

def require_admin(current_user: UserModel = Depends(get_current_user)) -> UserModel:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Plan config ───────────────────────────────────────────────────────────────

PLAN_MRR = {"free": 0, "starter": 29, "growth": 79, "enterprise": 249}
PLAN_QUOTAS = {
    "free":       {"messages": 500,   "docs": 5,  "storage_gb": 0.5, "api_keys": 1,  "tokens": 100_000},
    "starter":    {"messages": 2000,  "docs": 20, "storage_gb": 2,   "api_keys": 3,  "tokens": 500_000},
    "growth":     {"messages": 5000,  "docs": 50, "storage_gb": 5,   "api_keys": 5,  "tokens": 2_000_000},
    "enterprise": {"messages": 50000, "docs": 500,"storage_gb": 50,  "api_keys": 20, "tokens": 20_000_000},
}

def _quota_breakdown(messages_used, messages_quota, docs_used, docs_quota, storage_used, storage_quota):
    msg_pct = (messages_used / messages_quota * 100) if messages_quota else 0
    doc_pct = (docs_used     / docs_quota     * 100) if docs_quota     else 0
    sto_pct = (storage_used  / storage_quota  * 100) if storage_quota  else 0
    total = msg_pct + doc_pct + sto_pct or 1
    return [
        {"label": "Messages", "pct": round(msg_pct / total * 100, 1), "color": "#7F77DD"},
        {"label": "Docs",     "pct": round(doc_pct / total * 100, 1), "color": "#BA7517"},
        {"label": "Storage",  "pct": round(sto_pct / total * 100, 1), "color": "#1D9E75"},
    ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _date_range(days: int):
    """Return list of date strings for the last `days` days (inclusive today)."""
    today = date.today()
    return [(today - timedelta(days=d)).isoformat() for d in range(days - 1, -1, -1)]


# ── /admin/overview ───────────────────────────────────────────────────────────

@router.get("/overview")
def admin_overview(admin=Depends(require_admin), db: Session = Depends(get_db)):
    now            = datetime.utcnow()
    m_ago          = now - timedelta(days=30)
    prev_30_start  = now - timedelta(days=60)
    w_ago          = now - timedelta(days=7)
    prev_w_start   = now - timedelta(days=14)
    y_ago          = now - timedelta(days=365)

    messages_col = mongodb["widget_messages"]

    # ── Users ─────────────────────────────────────────────────────────────────
    total_users          = db.query(func.count(UserModel.id)).scalar() or 0
    new_users_this_month = db.query(func.count(UserModel.id)).filter(UserModel.created_at >= m_ago).scalar() or 0
    new_users_prev_month = db.query(func.count(UserModel.id)).filter(
        UserModel.created_at >= prev_30_start, UserModel.created_at < m_ago).scalar() or 0
    new_users_this_week  = db.query(func.count(UserModel.id)).filter(UserModel.created_at >= w_ago).scalar() or 0
    new_users_prev_week  = db.query(func.count(UserModel.id)).filter(
        UserModel.created_at >= prev_w_start, UserModel.created_at < w_ago).scalar() or 0
    users_year_ago       = db.query(func.count(UserModel.id)).filter(UserModel.created_at < y_ago).scalar() or 0

    def _pct(curr, prev):
        if prev == 0:
            return 0.0
        return round((curr - prev) / prev * 100, 1)

    user_change_ww  = _pct(new_users_this_week,  new_users_prev_week)
    user_change_mom = _pct(new_users_this_month, new_users_prev_month)
    user_change_yoy = _pct(total_users, users_year_ago) if users_year_ago > 0 else 0.0

    # ── Sessions ──────────────────────────────────────────────────────────────
    total_sessions = db.query(func.count(ChatSessionModel.id)).scalar() or 0

    # ── Bots ──────────────────────────────────────────────────────────────────
    total_bots = db.query(func.count(WidgetBot.id)).scalar() or 0

    # ── Messages ──────────────────────────────────────────────────────────────
    try:
        total_messages = messages_col.count_documents({})
    except Exception:
        total_messages = 0

    try:
        messages_this_month = messages_col.count_documents({"created_at": {"$gte": m_ago}})
        messages_prev_month = messages_col.count_documents({"created_at": {"$gte": prev_30_start, "$lt": m_ago}})
    except Exception:
        messages_this_month = messages_prev_month = 0

    messages_change_pct = _pct(messages_this_month, messages_prev_month)

    # ── Revenue ───────────────────────────────────────────────────────────────
    subs = db.query(Subscription).filter(Subscription.status == "active").all()
    mrr  = sum(PLAN_MRR.get(s.plan.lower(), 0) for s in subs)
    arr  = mrr * 12

    this_month_start = now.replace(day=1)
    prev_month_start = (this_month_start - timedelta(days=1)).replace(day=1)

    revenue_this_month = sum(
        PLAN_MRR.get(s.plan.lower(), 0) for s in subs
        if s.created_at >= this_month_start or (hasattr(s, "renewed_at") and s.renewed_at and s.renewed_at >= this_month_start)
    ) if subs else mrr

    revenue_last_month = sum(
        PLAN_MRR.get(s.plan.lower(), 0)
        for s in db.query(Subscription).filter(
            Subscription.status == "active",
            Subscription.created_at < this_month_start,
        ).all()
    ) or 0

    revenue_change_pct = _pct(revenue_this_month, revenue_last_month)

    # ── Revenue per day (30-day curve) ────────────────────────────────────────
    # We don't have per-day revenue in DB, so approximate from subscription start dates.
    # Each new subscription in a day contributes its MRR to that day's revenue.
    days_30 = _date_range(30)
    rev_by_day: dict = {d: 0 for d in days_30}
    new_users_by_day: dict = {d: 0 for d in days_30}

    new_subs_30 = db.query(Subscription).filter(
        Subscription.created_at >= m_ago, Subscription.status == "active"
    ).all()
    for s in new_subs_30:
        day_str = s.created_at.date().isoformat()
        if day_str in rev_by_day:
            rev_by_day[day_str] += PLAN_MRR.get(s.plan.lower(), 0)

    new_users_30 = db.query(UserModel).filter(UserModel.created_at >= m_ago).all()
    for u in new_users_30:
        day_str = u.created_at.date().isoformat()
        if day_str in new_users_by_day:
            new_users_by_day[day_str] += 1

    revenue_per_day = [
        {"date": d, "revenue": rev_by_day[d], "new_users": new_users_by_day[d]}
        for d in days_30
    ]

    # ── Avg response time ────────────────────────────────────────────────────
    avg_response_ms = 0
    response_time_per_day = []
    try:
        rt_pipeline = [
            {"$match": {"response_time_ms": {"$ne": None, "$exists": True, "$gt": 0}}},
            {"$group": {"_id": None, "avg": {"$avg": "$response_time_ms"}}},
        ]
        rt_rows = list(messages_col.aggregate(rt_pipeline))
        avg_response_ms = round(rt_rows[0]["avg"]) if rt_rows else 0

        # Daily sparkline (30 days)
        for day_str in days_30:
            day_dt     = datetime.fromisoformat(day_str)
            next_day_dt = day_dt + timedelta(days=1)
            rt_day = list(messages_col.aggregate([
                {"$match": {
                    "created_at": {"$gte": day_dt, "$lt": next_day_dt},
                    "response_time_ms": {"$ne": None, "$exists": True, "$gt": 0},
                }},
                {"$group": {"_id": None, "avg": {"$avg": "$response_time_ms"}}},
            ]))
            response_time_per_day.append({
                "date":   day_str,
                "avg_ms": round(rt_day[0]["avg"]) if rt_day else avg_response_ms,
            })
    except Exception:
        response_time_per_day = [{"date": d, "avg_ms": avg_response_ms} for d in days_30]

    # ── Token consumption ────────────────────────────────────────────────────
    tokens_used_this_month = 0
    try:
        tok_pipeline = [
            {"$match": {"created_at": {"$gte": m_ago}, "tokens_used": {"$exists": True, "$ne": None}}},
            {"$group": {"_id": None, "total": {"$sum": "$tokens_used"}}},
        ]
        tok_rows = list(messages_col.aggregate(tok_pipeline))
        tokens_used_this_month = tok_rows[0]["total"] if tok_rows else 0
    except Exception:
        # Fallback: estimate from message count (avg ~1200 tokens/msg)
        tokens_used_this_month = messages_this_month * 1200

    tokens_quota_this_month = sum(
        PLAN_QUOTAS.get(s.plan.lower(), PLAN_QUOTAS["free"])["tokens"] for s in subs
    ) or max(tokens_used_this_month * 2, 1_000_000)

    # ── Document type breakdown ───────────────────────────────────────────────
    doc_types = []
    try:
        from database import documents_collection
        type_pipeline = [
            {"$group": {"_id": "$type", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        type_rows = list(documents_collection.aggregate(type_pipeline))
        doc_types = [
            {"type": (row.get("_id") or "unknown").upper(), "count": row["count"]}
            for row in type_rows
        ]
    except Exception:
        pass

    # ── Plan breakdown ────────────────────────────────────────────────────────
    plan_groups: dict = {}
    for s in subs:
        p = s.plan.lower()
        plan_groups.setdefault(p, {"plan": p, "count": 0, "revenue": 0})
        plan_groups[p]["count"]   += 1
        plan_groups[p]["revenue"] += PLAN_MRR.get(p, 0)
    plan_breakdown = sorted(plan_groups.values(), key=lambda x: -x["revenue"])

    # ── Top 5 clients (by messages) ─────────────────────────────────────────────

    # 1. Fetch all bots with full detail (id, owner_id, name, accent_color)
    bots = db.query(WidgetBot).all()
    bot_owner_map = {b.id: b.owner_id for b in bots}

    # 2. Aggregate messages per bot (last 30 days)
    bot_msg_counts_map: dict = {}
    user_msg_counts: dict = {}

    try:
        pipeline = [
            {"$match": {"created_at": {"$gte": m_ago}}},
            {"$group": {"_id": "$bot_id", "count": {"$sum": 1}}},
        ]
        for row in messages_col.aggregate(pipeline):
            bid   = row["_id"]
            count = row["count"]
            bot_msg_counts_map[bid] = count
            owner_id = bot_owner_map.get(bid)
            if owner_id:
                user_msg_counts[owner_id] = user_msg_counts.get(owner_id, 0) + count
    except Exception:
        pass

    # 3. Aggregate doc counts per bot from MongoDB
    bot_doc_counts_map: dict = {}
    try:
        from database import documents_collection as docs_col
        for row in docs_col.aggregate([
            {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
        ]):
            bot_doc_counts_map[row["_id"]] = row["count"]
    except Exception:
        pass

    # 4. Build top clients list
    top_clients = []
    all_users   = db.query(UserModel).all()

    for u in all_users:
        msgs_used = user_msg_counts.get(u.id, 0)

        sub    = db.query(Subscription).filter_by(owner_id=u.id, status="active").first()
        plan   = sub.plan.lower() if sub else "free"
        quotas = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])

        # Storage (safe fallback)
        storage_gb = 0.0
        user_bots  = [b for b in bots if b.owner_id == u.id]
        try:
            indexes    = get_all_indexes([b.id for b in user_bots])
            storage_gb = sum(idx.get("size_mb", 0) for idx in indexes) / 1024
        except Exception:
            pass

        usage_pct = max(
            (msgs_used / quotas["messages"] * 100) if quotas["messages"] else 0,
            (storage_gb / quotas["storage_gb"] * 100) if quotas["storage_gb"] else 0,
        )

        # Per-bot breakdown — shown in the expandable bots list on the frontend
        bots_detail = [
            {
                "id":            b.id,
                "name":          b.name,
                "message_count": bot_msg_counts_map.get(b.id, 0),
                "doc_count":     bot_doc_counts_map.get(b.id, 0),
                "accent_color":  getattr(b, "accent_color", None) or "#7F77DD",
            }
            for b in user_bots
        ]
        # Sort bots by message count descending so the busiest bot comes first
        bots_detail.sort(key=lambda x: -x["message_count"])

        top_clients.append({
            "id":               u.id,
            "name":             u.name or u.email.split("@")[0],
            "email":            u.email,
            "plan":             plan,
            "messages_used":    msgs_used,
            "messages_quota":   quotas["messages"],
            "storage_used_gb":  round(storage_gb, 2),
            "storage_quota_gb": quotas["storage_gb"],
            "mrr":              PLAN_MRR.get(plan, 0),
            "usage_pct":        round(usage_pct, 1),
            "bots":             bots_detail,          # ← NEW: full per-bot breakdown
        })

    # 5. Sort & keep top 5
    top_clients.sort(key=lambda c: (-c["messages_used"], -c["mrr"]))
    top_clients = top_clients[:5]

    # ── Activity feed ─────────────────────────────────────────────────────────
    recent_msgs = (
        db.query(WidgetMessage, WidgetBot.name)
        .join(WidgetBot, WidgetBot.id == WidgetMessage.bot_id)
        .filter(WidgetMessage.role == "user")
        .order_by(desc(WidgetMessage.created_at))
        .limit(10)
        .all()
    )
    # Also try from MongoDB if SQL is empty
    if not recent_msgs:
        try:
            mongo_msgs = list(
                messages_col.find({"role": "user"}, {"_id": 0, "bot_id": 1, "content": 1, "created_at": 1})
                .sort("created_at", -1).limit(10)
            )
            bot_name_cache = {}
            activity_feed = []
            for m in mongo_msgs:
                bid = m.get("bot_id", "")
                if bid not in bot_name_cache:
                    bot_obj = db.query(WidgetBot).filter_by(id=bid).first()
                    bot_name_cache[bid] = bot_obj.name if bot_obj else bid
                activity_feed.append({
                    "bot_name":   bot_name_cache[bid],
                    "message":    (m.get("content") or "")[:120],
                    "created_at": str(m.get("created_at", now.isoformat())),
                })
        except Exception:
            activity_feed = []
    else:
        activity_feed = [
            {
                "bot_name":   bot_name,
                "message":    msg.content[:120],
                "created_at": msg.created_at.isoformat(),
            }
            for msg, bot_name in recent_msgs
        ]

    # ── Response ──────────────────────────────────────────────────────────────
    return {
        # Users
        "total_users":           total_users,
        "new_users_this_month":  new_users_this_month,
        "user_change_ww":        user_change_ww,
        "user_change_mom":       user_change_mom,
        "user_change_yoy":       user_change_yoy,

        # Sessions
        "total_sessions":        total_sessions,

        # Bots
        "total_bots":            total_bots,

        # Messages
        "total_messages":        total_messages,
        "messages_this_month":   messages_this_month,
        "messages_change_pct":   messages_change_pct,

        # Revenue
        "mrr":                   mrr,
        "arr":                   arr,
        "revenue_this_month":    revenue_this_month,
        "revenue_last_month":    revenue_last_month,
        "revenue_change_pct":    round(revenue_change_pct, 1),
        "revenue_per_day":       revenue_per_day,

        # Performance
        "avg_response_ms":       avg_response_ms,
        "response_time_per_day": response_time_per_day,

        # Tokens
        "tokens_used_this_month":  tokens_used_this_month,
        "tokens_quota_this_month": tokens_quota_this_month,

        # Document types
        "doc_types":             doc_types,

        # Plans
        "plan_breakdown":        plan_breakdown,

        # Top clients
        "top_clients":           top_clients,

        # Activity
        "activity_feed":         activity_feed,
    }


# ── /admin/clients ────────────────────────────────────────────────────────────

@router.get("/clients")
def admin_clients(admin=Depends(require_admin), db: Session = Depends(get_db)):
    now   = datetime.utcnow()
    m_ago = now - timedelta(days=30)
    users = db.query(UserModel).order_by(desc(UserModel.created_at)).all()

    clients = []
    for u in users:
        sub    = db.query(Subscription).filter_by(owner_id=u.id, status="active").first()
        plan   = sub.plan.lower() if sub else "free"
        quotas = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])

        bots    = db.query(WidgetBot).filter_by(owner_id=u.id).all()
        bot_ids = [b.id for b in bots]

        msgs_used = 0
        try:
            msgs_used = (
                mongodb["widget_messages"].count_documents({
                    "bot_id": {"$in": bot_ids}, "created_at": {"$gte": m_ago}
                }) if bot_ids else 0
            )
        except Exception:
            pass

        docs_indexed = sum(b.docs_indexed or 0 for b in bots)

        storage_gb = 0.0
        try:
            indexes = get_all_indexes(bot_ids)
            storage_gb = sum(idx.get("size_mb", 0) for idx in indexes) / 1024
        except Exception:
            pass

        breakdown = _quota_breakdown(
            msgs_used, quotas["messages"],
            docs_indexed, quotas["docs"],
            storage_gb, quotas["storage_gb"],
        )

        renewal = (sub.created_at + timedelta(days=30)).isoformat() if sub else None

        clients.append({
            "id":               u.id,
            "name":             u.name or u.email.split("@")[0],
            "email":            u.email,
            "plan":             plan,
            "messages_used":    msgs_used,
            "messages_quota":   quotas["messages"],
            "docs_indexed":     docs_indexed,
            "docs_quota":       quotas["docs"],
            "storage_used_gb":  round(storage_gb, 2),
            "storage_quota_gb": quotas["storage_gb"],
            "mrr":              PLAN_MRR.get(plan, 0),
            "renewal_date":     renewal,
            "quota_breakdown":  breakdown,
        })

    return {"clients": clients}


@router.patch("/clients/{client_id}/plan")
def update_client_plan(
    client_id: str,
    body: dict,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    sub = db.query(Subscription).filter_by(owner_id=client_id, status="active").first()
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription found")
    new_plan = body.get("plan", "").lower()
    if new_plan not in PLAN_MRR:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {new_plan}")
    sub.plan = new_plan
    db.commit()
    return {"ok": True, "plan": new_plan}


# ── /admin/bots ───────────────────────────────────────────────────────────────

@router.get("/bots")
def admin_bots(admin=Depends(require_admin), db: Session = Depends(get_db)):
    bots = db.query(WidgetBot).order_by(desc(WidgetBot.created_at)).all()

    messages_col = mongodb["widget_messages"]
    bot_ids_all  = [b.id for b in bots]
    mongo_counts: dict = {}
    try:
        pipeline = [
            {"$match": {"bot_id": {"$in": bot_ids_all}}},
            {"$group": {"_id": "$bot_id", "count": {"$sum": 1}}},
        ]
        for row in messages_col.aggregate(pipeline):
            mongo_counts[row["_id"]] = row["count"]
    except Exception:
        pass

    # Batch-fetch real doc counts from MongoDB (one aggregation, not N queries)
    from database import documents_collection
    mongo_doc_counts: dict = {}
    try:
        for row in documents_collection.aggregate([
            {"$match": {"user_id": {"$in": bot_ids_all}}},
            {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
        ]):
            mongo_doc_counts[row["_id"]] = row["count"]
    except Exception:
        pass

    result = []
    for bot in bots:
        owner = db.query(UserModel).filter_by(id=bot.owner_id).first()

        total_msgs = mongo_counts.get(bot.id, 0)
        success_rate = 0
        avg_response_ms = 0
        try:
            answered = messages_col.count_documents({"bot_id": bot.id, "answered": True})
            success_rate = round(answered / total_msgs * 100, 1) if total_msgs > 0 else 0

            rt_rows = list(messages_col.aggregate([
                {"$match": {"bot_id": bot.id, "response_time_ms": {"$ne": None, "$exists": True}}},
                {"$group": {"_id": None, "avg": {"$avg": "$response_time_ms"}}},
            ]))
            avg_response_ms = round(rt_rows[0]["avg"]) if rt_rows else 0
        except Exception:
            pass

        owner_name  = (getattr(owner, "name", None) or "") if owner else ""
        owner_email = owner.email if owner else ""
        real_doc_count = mongo_doc_counts.get(bot.id, 0)

        result.append({
            "id":              bot.id,
            "name":            bot.name,
            "owner_id":        bot.owner_id,
            "owner_email":     owner_email or "—",
            "owner":           {"name": owner_name or "—", "email": owner_email or "—"},
            "allowed_origin":  bot.allowed_origin,
            "accent_color":    getattr(bot, "accent_color", "#7F77DD") or "#7F77DD",
            "welcome_message": getattr(bot, "welcome_message", "Hi! How can I help you today?") or "Hi! How can I help you today?",
            "system_prompt":   getattr(bot, "system_prompt", "You are a helpful assistant.") or "You are a helpful assistant.",
            "is_active":       bot.is_active,
            "total_messages":  total_msgs,
            "message_count":   total_msgs,
            "success_rate":    success_rate,
            "avg_response_ms": avg_response_ms,
            "docs_indexed":    real_doc_count,
            "doc_count":       real_doc_count,
            "created_at":      bot.created_at.isoformat() if bot.created_at else None,
        })

    return {"bots": result}


# ── /admin/system ─────────────────────────────────────────────────────────────
import os

@router.get("/system")
def admin_system(admin=Depends(require_admin)):
    from config import UPLOAD_DIR

    mongo_collections = []
    try:
        for col_name in mongodb.list_collection_names():
            col_stats = mongodb.command("collstats", col_name)
            mongo_collections.append({
                "name":    col_name,
                "size_mb": round(col_stats.get("size", 0) / 1024 / 1024, 2),
                "count":   col_stats.get("count", 0),
            })
    except Exception:
        mongo_collections = []

    faiss_total_indexes = 0
    faiss_total_size_mb = 0.0
    user_faiss: dict = defaultdict(lambda: {"indexes": 0, "size_mb": 0.0})

    vector_root = os.path.join(os.getcwd(), "vector_store")
    try:
        if os.path.isdir(vector_root):
            for user_dir in os.scandir(vector_root):
                if not user_dir.is_dir():
                    continue
                for session_dir in os.scandir(user_dir.path):
                    if not session_dir.is_dir():
                        continue
                    faiss_file = os.path.join(session_dir.path, "index.faiss")
                    if os.path.exists(faiss_file):
                        size_mb = os.path.getsize(faiss_file) / (1024 * 1024)
                        faiss_total_indexes += 1
                        faiss_total_size_mb += size_mb
                        user_faiss[user_dir.name]["indexes"] += 1
                        user_faiss[user_dir.name]["size_mb"] = round(
                            user_faiss[user_dir.name]["size_mb"] + size_mb, 2
                        )
    except Exception:
        pass

    faiss_user_breakdown = [
        {"user": user, "indexes": v["indexes"], "size_mb": round(v["size_mb"], 2)}
        for user, v in sorted(user_faiss.items())
    ]

    upload_file_count = 0
    upload_size_mb    = 0.0
    try:
        if os.path.isdir(UPLOAD_DIR):
            for entry in os.scandir(UPLOAD_DIR):
                if entry.is_file():
                    upload_file_count += 1
                    upload_size_mb    += entry.stat().st_size / (1024 * 1024)
    except Exception:
        pass

    try:
        cpu_pct = psutil.cpu_percent(interval=0.5)
        ram     = psutil.virtual_memory()
        disk    = psutil.disk_usage("/")
        cpu  = round(cpu_pct, 1)
        ram_ = round(ram.percent, 1)
        disk_= round(disk.percent, 1)
    except Exception:
        cpu = ram_ = disk_ = 0.0

    return {
        "mongo_collections": mongo_collections,
        "faiss": {
            "total_indexes":  faiss_total_indexes,
            "total_size_mb":  round(faiss_total_size_mb, 2),
            "user_breakdown": faiss_user_breakdown,
        },
        "uploads": {
            "file_count": upload_file_count,
            "size_mb":    round(upload_size_mb, 2),
        },
        "cpu_pct":  cpu,
        "ram_pct":  ram_,
        "disk_pct": disk_,
    }


# ── /admin/feedback ───────────────────────────────────────────────────────────

@router.get("/feedback")
def admin_feedback(admin=Depends(require_admin), db: Session = Depends(get_db)):
    try:
        col = mongodb["widget_feedback"]
        rows = list(col.find({}, {"_id": 0}).sort("created_at", -1).limit(500))
    except Exception:
        rows = []

    bot_cache: dict = {}
    for row in rows:
        bid = row.get("bot_id", "")
        if bid and bid not in bot_cache:
            bot_obj = db.query(WidgetBot).filter_by(id=bid).first()
            bot_cache[bid] = bot_obj.name if bot_obj else bid
        row["bot_name"] = bot_cache.get(bid, bid)

    bots_map: dict = defaultdict(lambda: {
        "bot_id": "", "bot_name": "", "avg_score": 0.0,
        "total_feedback": 0, "feedback_list": [],
    })

    for row in rows:
        bid = row.get("bot_id", "unknown")
        entry = bots_map[bid]
        entry["bot_id"]   = bid
        entry["bot_name"] = row.get("bot_name", bid)
        entry["total_feedback"] += 1
        entry["feedback_list"].append({
            "id":         row.get("id", ""),
            "bot_id":     bid,
            "user_name":  row.get("user_name", ""),
            "rating":     row.get("rating", 0),
            "comment":    row.get("comment", ""),
            "category":   row.get("category", ""),
            "created_at": str(row.get("created_at", "")),
        })

    for entry in bots_map.values():
        ratings = [f["rating"] for f in entry["feedback_list"]]
        entry["avg_score"] = round(sum(ratings) / len(ratings), 2) if ratings else 0.0

    overall_avg = (
        round(sum(r.get("rating", 0) for r in rows) / len(rows), 2) if rows else 0.0
    )

    return {"feedback": list(bots_map.values()), "avg_score": overall_avg}


@router.delete("/feedback/{bot_id}")
def delete_bot_feedback(bot_id: str, admin=Depends(require_admin)):
    result = mongodb["widget_feedback"].delete_many({"bot_id": bot_id})
    return {"ok": True, "deleted": result.deleted_count}


# ── /admin/billing ────────────────────────────────────────────────────────────

@router.get("/billing")
def admin_billing(admin=Depends(require_admin), db: Session = Depends(get_db)):
    import os
    from database import documents_collection

    now   = datetime.utcnow()
    m_ago = now - timedelta(days=30)

    users = db.query(UserModel).order_by(UserModel.created_at.desc()).all()

    clients = []
    for u in users:
        sub  = db.query(Subscription).filter_by(owner_id=u.id, status="active").first()
        plan = sub.plan.lower() if sub else "free"

        bots    = db.query(WidgetBot).filter_by(owner_id=u.id).all()
        bot_ids = [b.id for b in bots]

        messages_count = 0
        sessions_set   = set()
        try:
            col = mongodb["widget_messages"]
            messages_count = col.count_documents({
                "bot_id": {"$in": bot_ids}, "created_at": {"$gte": m_ago},
            }) if bot_ids else 0
            if bot_ids:
                sessions_set = set(col.distinct("session_id", {"bot_id": {"$in": bot_ids}}))
        except Exception:
            pass

        docs_count = 0
        storage_mb = 0.0
        try:
            docs_cursor = list(
                documents_collection.find(
                    {"user_id": {"$in": bot_ids}},
                    {"size": 1, "path": 1, "type": 1, "_id": 0},
                )
            ) if bot_ids else []

            docs_count  = len(docs_cursor)
            total_bytes = 0
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
                        if "GB" in unit:   total_bytes += int(num * 1024 ** 3)
                        elif "MB" in unit: total_bytes += int(num * 1024 ** 2)
                        else:              total_bytes += int(num * 1024)
                    except Exception:
                        pass
            storage_mb = round(total_bytes / (1024 * 1024), 2)
        except Exception:
            pass

        clients.append({
            "name": (getattr(u, "name", None) or getattr(u, "name", None) or u.email.split("@")[0]),
            "email":          u.email,
            "plan_tier":      plan,
            "mrr":            PLAN_MRR.get(plan, 0),
            "messages_count": messages_count,
            "docs_count":     docs_count,
            "sessions_count": len(sessions_set),
            "storage_mb":     storage_mb,
        })

    clients.sort(key=lambda c: (-c["mrr"], -c["messages_count"]))
    return {"clients": clients}


# ── /admin/users ──────────────────────────────────────────────────────────────

@router.get("/users")
def get_users(admin=Depends(require_admin), db: Session = Depends(get_db)):
    users = db.query(UserModel).order_by(UserModel.created_at.desc()).all()

    messages_col = mongodb["widget_messages"]
    all_bot_ids  = [b.id for b in db.query(WidgetBot).filter_by(is_active=True).all()]
    mongo_msg_counts: dict = {}
    try:
        pipeline = [
            {"$match": {"bot_id": {"$in": all_bot_ids}}},
            {"$group": {"_id": "$bot_id", "count": {"$sum": 1}}},
        ]
        for row in messages_col.aggregate(pipeline):
            mongo_msg_counts[row["_id"]] = row["count"]
    except Exception:
        pass

    result = []
    for u in users:
        user_bots     = db.query(WidgetBot).filter_by(owner_id=u.id, is_active=True).all()
        session_count = db.query(func.count(ChatSessionModel.id)).filter_by(user_id=u.id).scalar() or 0
        display_name  = getattr(u, "name", None) or ""

        # Fetch real doc counts for this user's bots from MongoDB
        from database import documents_collection as docs_col
        bot_doc_counts: dict = {}
        user_bot_ids = [b.id for b in user_bots]
        try:
            for row in docs_col.aggregate([
                {"$match": {"user_id": {"$in": user_bot_ids}}},
                {"$group": {"_id": "$user_id", "count": {"$sum": 1}}},
            ]):
                bot_doc_counts[row["_id"]] = row["count"]
        except Exception:
            pass

        result.append({
            "id":            u.id,
            "name":          display_name,
            "email":         u.email,
            "is_admin":      u.is_admin,
            "is_verified":   u.is_verified,
            "created_at":    u.created_at.isoformat() if u.created_at else None,
            "session_count": session_count,
            "bots": [
                {
                    "id":            b.id,
                    "name":          b.name,
                    "doc_count":     bot_doc_counts.get(b.id, 0),
                    "message_count": mongo_msg_counts.get(b.id, 0),
                    "accent_color":  getattr(b, "accent_color", "#7F77DD") or "#7F77DD",
                }
                for b in user_bots
            ],
        })
    return result


# ── /admin/bots/{bot_id}/preview-key ─────────────────────────────────────────

from datetime import timezone

@router.post("/bots/{bot_id}/preview-key")
def create_preview_key(
    bot_id: str,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    from auth.widget_auth import generate_api_key

    bot = db.query(WidgetBot).filter_by(id=bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    active_session = mongodb["widget_test_sessions"].find_one({"bot_id": bot_id, "is_active": True})
    if not active_session:
        raise HTTPException(status_code=403, detail="No active test session. The bot owner must grant test access first.")

    expires_at = active_session.get("expires_at")
    if expires_at:
        if isinstance(expires_at, str) and expires_at.endswith("Z"):
            expires_at = expires_at.replace("Z", "+00:00")
        try:
            expires_at_dt = datetime.fromisoformat(expires_at)
            if expires_at_dt.tzinfo is None:
                expires_at_dt = expires_at_dt.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires_at_dt:
                raise HTTPException(status_code=400, detail="The bot owner must grant test access.")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expiration format.")

    raw_key, key_hash = generate_api_key()
    api_key = WidgetApiKey(
        id=str(uuid.uuid4()),
        bot_id=bot_id,
        key_hash=key_hash,
        key_prefix=raw_key[:10],
    )
    db.add(api_key)
    db.commit()
    return {"key": raw_key}


# ── /admin/bots/{bot_id}/analytics ───────────────────────────────────────────

@router.get("/bots/{bot_id}/analytics")
def get_bot_analytics_admin(
    bot_id: str,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    bot = db.query(WidgetBot).filter_by(id=bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    from services.analytics_service import get_bot_analytics
    return get_bot_analytics(bot_id, db)


# ── /admin/documents ──────────────────────────────────────────────────────────

@router.get("/documents")
def get_all_documents(admin=Depends(require_admin)):
    from database import documents_collection
    docs = list(documents_collection.find({}, {"_id": 0}).limit(500))
    # Documents are stored with user_id = bot_id throughout the codebase.
    # Expose bot_id explicitly so the frontend can filter by it.
    for d in docs:
        if "bot_id" not in d and "user_id" in d:
            d["bot_id"] = d["user_id"]
    return {"documents": docs}

@router.delete("/bots/{bot_id}")
def admin_delete_bot(
    bot_id: str,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Hard-delete a bot regardless of ownership.
    Cleans up: Mongo messages, Mongo feedback, API keys (SQL),
    FAISS vector store, and the bot row itself.
    """
    import shutil

    bot = db.query(WidgetBot).filter_by(id=bot_id).first()
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")

    # 1. MongoDB — messages & feedback
    try:
        mongodb["widget_messages"].delete_many({"bot_id": bot_id})
        mongodb["widget_feedback"].delete_many({"bot_id": bot_id})
    except Exception:
        pass

    # 2. MongoDB — documents metadata
    try:
        from database import documents_collection
        documents_collection.delete_many({"user_id": bot_id})
    except Exception:
        pass

    # 3. FAISS vector store (stored under vector_store/user_{bot_id}/)
    try:
        vector_root = os.path.join(os.getcwd(), "vector_store", f"user_{bot_id}")
        if os.path.isdir(vector_root):
            shutil.rmtree(vector_root, ignore_errors=True)
    except Exception:
        pass

    # 4. SQL — API keys, then the bot row
    db.query(WidgetApiKey).filter(WidgetApiKey.bot_id == bot_id).delete(synchronize_session=False)
    db.delete(bot)
    db.commit()

    return {"ok": True, "deleted": bot_id}



@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    admin=Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.query(UserModel).filter_by(id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    bots    = db.query(WidgetBot).filter_by(owner_id=user_id).all()
    bot_ids = [b.id for b in bots]

    if bot_ids:
        try:
            mongodb["widget_messages"].delete_many({"bot_id": {"$in": bot_ids}})
            mongodb["widget_feedback"].delete_many({"bot_id": {"$in": bot_ids}})
        except Exception:
            pass

        # Delete MongoDB document metadata for every bot
        try:
            from database import documents_collection
            documents_collection.delete_many({"user_id": {"$in": bot_ids}})
        except Exception:
            pass

        # Delete FAISS vector stores — one directory per bot (user_{bot_id})
        import shutil
        for bid in bot_ids:
            vector_dir = os.path.join(os.getcwd(), "vector_store", f"user_{bid}")
            if os.path.exists(vector_dir):
                shutil.rmtree(vector_dir, ignore_errors=True)

    db.query(WidgetApiKey).filter(WidgetApiKey.bot_id.in_(bot_ids)).delete(synchronize_session=False)
    db.query(WidgetBot).filter_by(owner_id=user_id).delete(synchronize_session=False)
    db.query(Subscription).filter_by(owner_id=user_id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()

    return {"ok": True, "deleted": user_id}