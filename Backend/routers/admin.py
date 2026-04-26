"""
routers/admin.py

Admin-only endpoints for the dashboard.
All routes require is_admin=True on the current user.

Endpoints:
  GET /admin/overview   – KPIs, top clients, activity feed
  GET /admin/clients    – all clients with quota details + breakdown
  PATCH /admin/clients/{id}/plan  – update plan
  GET /admin/bots       – all bots with health metrics
  GET /admin/system     – MongoDB + FAISS sizes, CPU/RAM/disk
  GET /admin/feedback   – all feedback across all bots
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from typing import Optional
import psutil

from database import get_db, mongodb
from models.user import UserModel
from models.widget import WidgetBot, WidgetMessage, WidgetFeedback
from models.billing import Subscription        # adjust to your billing model
from auth.helpers import get_current_user
from services.faiss_service import get_all_indexes  # adjust as needed

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Auth guard ────────────────────────────────────────────────────────────────

def require_admin(current_user: UserModel = Depends(get_current_user)) -> UserModel:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ── Plan config (adjust prices to match your Stripe plans) ───────────────────

PLAN_MRR = {"free": 0, "starter": 29, "growth": 79, "enterprise": 249}
PLAN_QUOTAS = {
    "free":       {"messages": 500,   "docs": 5,  "storage_gb": 0.5, "api_keys": 1},
    "starter":    {"messages": 2000,  "docs": 20, "storage_gb": 2,   "api_keys": 3},
    "growth":     {"messages": 5000,  "docs": 50, "storage_gb": 5,   "api_keys": 5},
    "enterprise": {"messages": 50000, "docs": 500,"storage_gb": 50,  "api_keys": 20},
}


def _quota_breakdown(messages_used, messages_quota, docs_used, docs_quota, storage_used, storage_quota):
    """
    Build the per-segment usage breakdown for the donut chart.
    Each segment is expressed as a % of its own quota, then normalised so the
    three segments together sum to 100 when all quotas are fully used.
    """
    msg_pct = (messages_used / messages_quota * 100) if messages_quota else 0
    doc_pct = (docs_used     / docs_quota     * 100) if docs_quota     else 0
    sto_pct = (storage_used  / storage_quota  * 100) if storage_quota  else 0

    total = msg_pct + doc_pct + sto_pct or 1   # avoid div/0
    return [
        {"label": "Messages", "pct": round(msg_pct / total * 100, 1), "color": "#7F77DD"},
        {"label": "Docs",     "pct": round(doc_pct / total * 100, 1), "color": "#BA7517"},
        {"label": "Storage",  "pct": round(sto_pct / total * 100, 1), "color": "#1D9E75"},
    ]


# ── /admin/overview ───────────────────────────────────────────────────────────

@router.get("/overview")
def admin_overview(admin=Depends(require_admin), db: Session = Depends(get_db)):
    now   = datetime.utcnow()
    m_ago = now - timedelta(days=30)

    # users
    total_users         = db.query(func.count(UserModel.id)).scalar() or 0
    new_users_this_month = db.query(func.count(UserModel.id)).filter(UserModel.created_at >= m_ago).scalar() or 0

    # bots
    total_bots  = db.query(func.count(WidgetBot.id)).scalar() or 0
    active_bots = (
        db.query(func.count(func.distinct(WidgetMessage.bot_id)))
        .filter(WidgetMessage.created_at >= m_ago)
        .scalar() or 0
    )

    # messages
    total_messages        = db.query(func.count(WidgetMessage.id)).scalar() or 0
    messages_this_month   = db.query(func.count(WidgetMessage.id)).filter(WidgetMessage.created_at >= m_ago).scalar() or 0

    # revenue — pulled from subscriptions table
    subs = db.query(Subscription).filter(Subscription.status == "active").all()
    mrr  = sum(PLAN_MRR.get(s.plan.lower(), 0) for s in subs)
    arr  = mrr * 12

    prev_month_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1)
    this_month_start = now.replace(day=1)

    revenue_this_month = sum(
        PLAN_MRR.get(s.plan.lower(), 0)
        for s in subs
        if s.created_at >= this_month_start or s.renewed_at >= this_month_start
    ) if subs else mrr

    revenue_last_month = sum(
        PLAN_MRR.get(s.plan.lower(), 0)
        for s in db.query(Subscription).filter(
            Subscription.status == "active",
            Subscription.created_at < this_month_start,
        ).all()
    ) or 0

    revenue_change_pct = (
        ((revenue_this_month - revenue_last_month) / revenue_last_month * 100)
        if revenue_last_month > 0 else 0
    )

    # plan breakdown
    plan_groups: dict[str, dict] = {}
    for s in subs:
        p = s.plan.lower()
        if p not in plan_groups:
            plan_groups[p] = {"plan": p, "count": 0, "revenue": 0}
        plan_groups[p]["count"]   += 1
        plan_groups[p]["revenue"] += PLAN_MRR.get(p, 0)
    plan_breakdown = sorted(plan_groups.values(), key=lambda x: -x["revenue"])

    # top 5 clients by MRR
    top_users = (
        db.query(UserModel)
        .join(Subscription, Subscription.owner_id == UserModel.id)
        .filter(Subscription.status == "active")
        .order_by(desc(Subscription.plan))
        .limit(10)
        .all()
    )

    top_clients = []
    for u in top_users:
        sub     = db.query(Subscription).filter_by(owner_id=u.id, status="active").first()
        plan    = sub.plan.lower() if sub else "free"
        quotas  = PLAN_QUOTAS.get(plan, PLAN_QUOTAS["free"])
        bots    = db.query(WidgetBot).filter_by(owner_id=u.id).all()
        bot_ids = [b.id for b in bots]

        msgs_used = (
            db.query(func.count(WidgetMessage.id))
            .filter(WidgetMessage.bot_id.in_(bot_ids), WidgetMessage.created_at >= m_ago)
            .scalar() or 0
        ) if bot_ids else 0

        # storage: sum of FAISS index sizes (approximate)
        storage_gb = 0.0
        try:
            indexes = get_all_indexes(bot_ids)
            storage_gb = sum(idx.get("size_mb", 0) for idx in indexes) / 1024
        except Exception:
            pass

        overall_pct = max(
            msgs_used / quotas["messages"] * 100 if quotas["messages"] else 0,
            storage_gb / quotas["storage_gb"] * 100 if quotas["storage_gb"] else 0,
        )

        top_clients.append({
            "id":               u.id,
            "name":             u.full_name or u.email.split("@")[0],
            "email":            u.email,
            "plan":             plan,
            "messages_used":    msgs_used,
            "messages_quota":   quotas["messages"],
            "storage_used_gb":  round(storage_gb, 2),
            "storage_quota_gb": quotas["storage_gb"],
            "mrr":              PLAN_MRR.get(plan, 0),
            "usage_pct":        round(overall_pct, 1),
        })

    top_clients.sort(key=lambda c: -c["mrr"])
    top_clients = top_clients[:5]

    # activity feed — last 10 messages across all bots
    recent_msgs = (
        db.query(WidgetMessage, WidgetBot.name)
        .join(WidgetBot, WidgetBot.id == WidgetMessage.bot_id)
        .filter(WidgetMessage.role == "user")
        .order_by(desc(WidgetMessage.created_at))
        .limit(10)
        .all()
    )
    activity_feed = [
        {
            "bot_name":   bot_name,
            "message":    msg.content[:120],
            "created_at": msg.created_at.isoformat(),
        }
        for msg, bot_name in recent_msgs
    ]

    return {
        "total_users":          total_users,
        "new_users_this_month": new_users_this_month,
        "total_bots":           total_bots,
        "active_bots":          active_bots,
        "total_messages":       total_messages,
        "messages_this_month":  messages_this_month,
        "mrr":                  mrr,
        "arr":                  arr,
        "revenue_this_month":   revenue_this_month,
        "revenue_last_month":   revenue_last_month,
        "revenue_change_pct":   round(revenue_change_pct, 1),
        "plan_breakdown":       plan_breakdown,
        "top_clients":          top_clients,
        "activity_feed":        activity_feed,
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

        msgs_used = (
            db.query(func.count(WidgetMessage.id))
            .filter(WidgetMessage.bot_id.in_(bot_ids), WidgetMessage.created_at >= m_ago)
            .scalar() or 0
        ) if bot_ids else 0

        docs_indexed = sum(b.docs_indexed or 0 for b in bots)

        storage_gb = 0.0
        try:
            indexes = get_all_indexes(bot_ids)
            storage_gb = sum(idx.get("size_mb", 0) for idx in indexes) / 1024
        except Exception:
            pass

        breakdown = _quota_breakdown(
            msgs_used,        quotas["messages"],
            docs_indexed,     quotas["docs"],
            storage_gb,       quotas["storage_gb"],
        )

        renewal = (sub.created_at + timedelta(days=30)).isoformat() if sub else None

        clients.append({
            "id":               u.id,
            "name":             u.full_name or u.email.split("@")[0],
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
    result = []
    for bot in bots:
        owner = db.query(UserModel).filter_by(id=bot.owner_id).first()

        total_msgs = db.query(func.count(WidgetMessage.id)).filter_by(bot_id=bot.id).scalar() or 0

        # success rate: messages marked as answered
        answered = (
            db.query(func.count(WidgetMessage.id))
            .filter_by(bot_id=bot.id, is_answered=True)
            .scalar() or 0
        )
        success_rate = round(answered / total_msgs * 100, 1) if total_msgs > 0 else 0

        # average response time in ms
        avg_rt_row = (
            db.query(func.avg(WidgetMessage.response_time_ms))
            .filter(WidgetMessage.bot_id == bot.id, WidgetMessage.response_time_ms != None)
            .scalar()
        )
        avg_response_ms = round(avg_rt_row or 0)

        result.append({
            "id":              bot.id,
            "name":            bot.name,
            "owner_email":     owner.email if owner else "—",
            "total_messages":  total_msgs,
            "success_rate":    success_rate,
            "avg_response_ms": avg_response_ms,
            "docs_indexed":    bot.docs_indexed or 0,
            "created_at":      bot.created_at.isoformat(),
        })

    return {"bots": result}


# ── /admin/system ─────────────────────────────────────────────────────────────

@router.get("/system")
def admin_system(admin=Depends(require_admin)):
    # MongoDB collection stats
    mongo_collections = []
    try:
        db_stats = mongodb.command("dbstats")
        for col_name in mongodb.list_collection_names():
            col_stats = mongodb.command("collstats", col_name)
            mongo_collections.append({
                "name":    col_name,
                "size_mb": round(col_stats.get("size", 0) / 1024 / 1024, 2),
                "count":   col_stats.get("count", 0),
            })
    except Exception:
        mongo_collections = []

    # FAISS indexes
    faiss_indexes = []
    try:
        faiss_indexes = get_all_indexes()  # returns list of {bot_id, vectors, size_mb}
    except Exception:
        pass

    # System resources
    cpu_pct = psutil.cpu_percent(interval=0.5)
    ram     = psutil.virtual_memory()
    disk    = psutil.disk_usage("/")

    return {
        "mongo_collections": mongo_collections,
        "faiss_indexes":     faiss_indexes,
        "cpu_pct":           round(cpu_pct, 1),
        "ram_pct":           round(ram.percent, 1),
        "disk_pct":          round(disk.percent, 1),
        "uploads": {
            "file_count": 0
        }    }


# ── /admin/feedback ───────────────────────────────────────────────────────────

@router.get("/feedback")
def admin_feedback(admin=Depends(require_admin), db: Session = Depends(get_db)):
    rows = (
        db.query(WidgetFeedback, WidgetBot.name)
        .join(WidgetBot, WidgetBot.id == WidgetFeedback.bot_id)
        .order_by(desc(WidgetFeedback.created_at))
        .limit(200)
        .all()
    )
    feedback = [
        {
            "id":         f.id,
            "bot_name":   bot_name,
            "rating":     f.rating,
            "comment":    f.comment,
            "category":   f.category,
            "user_name":  f.user_name,
            "created_at": f.created_at.isoformat(),
        }
        for f, bot_name in rows
    ]
    avg_score = (
        db.query(func.avg(WidgetFeedback.rating)).scalar() or 0
    )
    return {"feedback": feedback, "avg_score": round(float(avg_score), 2)}