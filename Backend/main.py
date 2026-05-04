from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from database import Base, engine
from models.user import UserModel, ChatSessionModel, MessageModel
from models.widget import WidgetBot, WidgetApiKey

from routers import admin, auth, sessions, documents, chat, widgets
from routers.widgets import router as widgets_router
from routers.widget_chat import router as widget_chat_router
from routers.widget_chat import limiter
from routers import test_sessions

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Create all PostgreSQL tables (includes widget tables now)
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Chatbot-RAG API")

# Rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Single CORS middleware — allows both your frontend and widget origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "null"],  # null for local files
    allow_origin_regex=r".*",   # widget requests can come from any site
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type", "X-Api-Key", "Accept", "Origin"],
    expose_headers=["*"],
)

# Existing routers
app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(admin.router)


# Widget routers
app.include_router(widgets_router)
app.include_router(widget_chat_router)

# Static files (serves widget.js)
from fastapi.responses import FileResponse
import os as _os

@app.get("/static/{filename}")
async def serve_static(filename: str):
    file_path = _os.path.join("static", filename)
    if not _os.path.exists(file_path):
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        file_path,
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        }
    )

from routers.human_intervention import router as intervention_router
app.include_router(intervention_router, tags=["Intervention"])

app.include_router(test_sessions.router)

@app.get("/")
def root():
    return {"status": "NovaMind API running"}