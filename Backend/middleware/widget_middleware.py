from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from routers import widgets, widget_chat

def configure_widget_middleware(app: FastAPI):
    """
    Call this in your main.py after creating the FastAPI app.
    Adds CORS, rate limiting, and registers the widget routers.
    """

    # ── Rate limiter ───────────────────────────────────────────────
    limiter = Limiter(key_func=get_remote_address)
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    # ── CORS ───────────────────────────────────────────────────────
    # For the widget, any origin must be allowed at the middleware level
    # because the per-bot origin check happens inside the route handler.
    # We open CORS for /widget/* only — your existing routes stay locked.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r".*",       # widget routes enforce per-bot origin
        allow_credentials=False,        # API key auth — no cookies needed
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["X-Api-Key", "Content-Type"],
    )

    # ── Routers ────────────────────────────────────────────────────
    app.include_router(widgets.router)
    app.include_router(widget_chat.router)


# ── Rate limit decorators to apply to widget_chat.py ───────────────
# Add @limiter.limit("30/minute") to widget_chat endpoint.
# Example:
#
#   from slowapi import Limiter
#   from slowapi.util import get_remote_address
#   limiter = Limiter(key_func=get_remote_address)
#
#   @router.post("/chat")
#   @limiter.limit("30/minute")
#   async def widget_chat(request: Request, ...):
#       ...