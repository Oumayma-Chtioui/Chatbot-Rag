from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import Base, engine
from models.user import UserModel, ChatSessionModel, MessageModel  # register models
from routers import auth, sessions, documents

# Create all PostgreSQL tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Chatbot-RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(documents.router)

@app.get("/")
def root():
    return {"status": "NovaMind API running"}