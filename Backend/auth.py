from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, List
import shutil, os, uuid
from dotenv import load_dotenv

# ── PostgreSQL (users, sessions, messages) ─────────────────────────────────────
from sqlalchemy import create_engine, Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, Session, relationship

# ── MongoDB (documents) ────────────────────────────────────────────────────────
from pymongo import MongoClient

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24
UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── PostgreSQL Setup ───────────────────────────────────────────────────────────
POSTGRES_URL = os.getenv("POSTGRES_URL")
engine = create_engine(POSTGRES_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class UserModel(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    hashed_password = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    sessions = relationship("ChatSessionModel", back_populates="user", cascade="all, delete")

class ChatSessionModel(Base):
    __tablename__ = "chat_sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"))
    title = Column(String, default="New chat")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user = relationship("UserModel", back_populates="sessions")
    messages = relationship("MessageModel", back_populates="session", cascade="all, delete", order_by="MessageModel.created_at")

class MessageModel(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"))
    role = Column(String)
    content = Column(Text)
    sources = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    session = relationship("ChatSessionModel", back_populates="messages")

Base.metadata.create_all(bind=engine)

# ── MongoDB Setup ──────────────────────────────────────────────────────────────
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "chatbot_rag")
mongo_client = MongoClient(MONGO_URL, authSource="admin")
mongo_db = mongo_client[MONGO_DB]
documents_collection = mongo_db["documents"]

# ── Auth Helpers ───────────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)

def create_token(data: dict) -> str:
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE_MINUTES)
    return jwt.encode({**data, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> UserModel:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if not email:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(UserModel).filter(UserModel.email == email).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ── Schemas ────────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class MessageCreate(BaseModel):
    role: str
    content: str
    sources: Optional[List[str]] = []

class SessionCreate(BaseModel):
    title: Optional[str] = "New chat"

class UrlDocRequest(BaseModel):
    url: str

# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Chatbot-RAG API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth Routes ────────────────────────────────────────────────────────────────
@app.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(UserModel).filter(UserModel.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = UserModel(name=req.name, email=req.email, hashed_password=hash_password(req.password))
    db.add(user)
    db.commit()
    token = create_token({"sub": req.email, "name": req.name})
    return {"access_token": token, "token_type": "bearer", "name": req.name, "email": req.email}

@app.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token({"sub": user.email, "name": user.name})
    return {"access_token": token, "token_type": "bearer", "name": user.name, "email": user.email}

@app.get("/me")
def get_me(current_user: UserModel = Depends(get_current_user)):
    return {"id": current_user.id, "name": current_user.name, "email": current_user.email}

# ── Session Routes (PostgreSQL) ────────────────────────────────────────────────
@app.get("/sessions")
def get_sessions(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = db.query(ChatSessionModel).filter(
        ChatSessionModel.user_id == current_user.id
    ).order_by(ChatSessionModel.updated_at.desc()).all()
    return [{"id": s.id, "title": s.title, "time": s.updated_at.strftime("%Y-%m-%d %H:%M")} for s in sessions]

@app.post("/sessions")
def create_session(req: SessionCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = ChatSessionModel(user_id=current_user.id, title=req.title)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"id": session.id, "title": session.title, "time": session.created_at.strftime("%Y-%m-%d %H:%M")}

@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == session_id,
        ChatSessionModel.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"ok": True}

# ── Message Routes (PostgreSQL) ────────────────────────────────────────────────
@app.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == session_id,
        ChatSessionModel.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": m.sources.split(",") if m.sources else [],
            "time": m.created_at.strftime("%H:%M")
        }
        for m in session.messages
    ]

@app.post("/sessions/{session_id}/messages")
def add_message(session_id: str, req: MessageCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(
        ChatSessionModel.id == session_id,
        ChatSessionModel.user_id == current_user.id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    msg = MessageModel(
        session_id=session_id,
        role=req.role,
        content=req.content,
        sources=",".join(req.sources or [])
    )
    db.add(msg)
    if req.role == "user" and session.title == "New chat":
        session.title = req.content[:40]
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)
    return {"id": msg.id, "role": msg.role, "content": msg.content, "sources": req.sources, "time": msg.created_at.strftime("%H:%M")}

# ── Document Routes (MongoDB) ──────────────────────────────────────────────────
@app.get("/documents")
def get_documents(current_user: UserModel = Depends(get_current_user)):
    docs = list(documents_collection.find({"user_id": current_user.id}, {"_id": 0}))
    return docs

@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...), current_user: UserModel = Depends(get_current_user)):
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size_kb = os.path.getsize(file_path) / 1024
    size_str = f"{size_kb:.0f} KB" if size_kb < 1024 else f"{size_kb / 1024:.1f} MB"
    doc_type = "image" if ext.lower() in [".png", ".jpg", ".jpeg", ".webp"] else "pdf"

    doc = {
        "id": file_id,
        "user_id": current_user.id,
        "name": file.filename,
        "type": doc_type,
        "size": size_str,
        "path": file_path,
        "status": "ready",
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc, "_id": file_id})
    return {"id": doc["id"], "name": doc["name"], "type": doc["type"], "size": doc["size"], "status": doc["status"]}

@app.post("/documents/url")
def add_url_document(req: UrlDocRequest, current_user: UserModel = Depends(get_current_user)):
    doc_id = str(uuid.uuid4())
    doc = {
        "id": doc_id,
        "user_id": current_user.id,
        "name": req.url,
        "type": "url",
        "size": "Web page",
        "path": req.url,
        "status": "ready",
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc, "_id": doc_id})
    return {"id": doc["id"], "name": doc["name"], "type": doc["type"], "size": doc["size"], "status": doc["status"]}

@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: UserModel = Depends(get_current_user)):
    doc = documents_collection.find_one({"id": doc_id, "user_id": current_user.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("path") and os.path.exists(doc["path"]):
        os.remove(doc["path"])
    documents_collection.delete_one({"id": doc_id})
    return {"ok": True}

# ── Chat (RAG) Route ───────────────────────────────────────────────────────────
@app.post("/chat")
def chat(body: dict, current_user: UserModel = Depends(get_current_user)):
    # TODO: plug in your LangChain RAG chain here
    # query = body.get("query")
    # response = chain.invoke(query)
    return {"answer": "Connect your LangChain chain here.", "sources": []}