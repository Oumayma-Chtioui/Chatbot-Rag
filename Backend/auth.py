from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from typing import Optional, List
import shutil, os, uuid

from sqlalchemy import create_engine, Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship

# ── Config ─────────────────────────────────────────────────────────────────────
SECRET_KEY = "change-this-to-a-random-secret"
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24
UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ── Database ───────────────────────────────────────────────────────────────────
engine = create_engine("sqlite:///./novamind.db", connect_args={"check_same_thread": False})
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
    documents = relationship("DocumentModel", back_populates="user", cascade="all, delete")

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
    role = Column(String)  # "user" or "assistant"
    content = Column(Text)
    sources = Column(Text, default="")  # comma-separated source strings
    created_at = Column(DateTime, default=datetime.utcnow)
    session = relationship("ChatSessionModel", back_populates="messages")

class DocumentModel(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String)
    type = Column(String)  # "pdf", "url", "image"
    size = Column(String)
    path = Column(String)  # file path or URL
    status = Column(String, default="ready")
    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("UserModel", back_populates="documents")

Base.metadata.create_all(bind=engine)

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
app = FastAPI(title="NovaMind API")

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

# ── Chat Session Routes ────────────────────────────────────────────────────────
@app.get("/sessions")
def get_sessions(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    sessions = db.query(ChatSessionModel).filter(ChatSessionModel.user_id == current_user.id).order_by(ChatSessionModel.updated_at.desc()).all()
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
    session = db.query(ChatSessionModel).filter(ChatSessionModel.id == session_id, ChatSessionModel.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(session)
    db.commit()
    return {"ok": True}

# ── Message Routes ─────────────────────────────────────────────────────────────
@app.get("/sessions/{session_id}/messages")
def get_messages(session_id: str, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(ChatSessionModel.id == session_id, ChatSessionModel.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [{"id": m.id, "role": m.role, "content": m.content, "sources": m.sources.split(",") if m.sources else [], "time": m.created_at.strftime("%H:%M")} for m in session.messages]

@app.post("/sessions/{session_id}/messages")
def add_message(session_id: str, req: MessageCreate, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    session = db.query(ChatSessionModel).filter(ChatSessionModel.id == session_id, ChatSessionModel.user_id == current_user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    msg = MessageModel(session_id=session_id, role=req.role, content=req.content, sources=",".join(req.sources or []))
    db.add(msg)
    # Auto-update session title from first user message
    if req.role == "user" and session.title == "New chat":
        session.title = req.content[:40]
    session.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(msg)
    return {"id": msg.id, "role": msg.role, "content": msg.content, "sources": req.sources, "time": msg.created_at.strftime("%H:%M")}

# ── Document Routes ────────────────────────────────────────────────────────────
@app.get("/documents")
def get_documents(current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = db.query(DocumentModel).filter(DocumentModel.user_id == current_user.id).all()
    return [{"id": d.id, "name": d.name, "type": d.type, "size": d.size, "status": d.status} for d in docs]

@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...), current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    size_kb = os.path.getsize(file_path) / 1024
    size_str = f"{size_kb:.0f} KB" if size_kb < 1024 else f"{size_kb/1024:.1f} MB"
    doc_type = "image" if ext.lower() in [".png", ".jpg", ".jpeg", ".webp"] else "pdf"
    doc = DocumentModel(user_id=current_user.id, name=file.filename, type=doc_type, size=size_str, path=file_path)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "name": doc.name, "type": doc.type, "size": doc.size, "status": doc.status}

@app.post("/documents/url")
def add_url_document(req: UrlDocRequest, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = DocumentModel(user_id=current_user.id, name=req.url, type="url", size="Web page", path=req.url)
    db.add(doc)
    db.commit()
    db.refresh(doc)
    return {"id": doc.id, "name": doc.name, "type": doc.type, "size": doc.size, "status": doc.status}

@app.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: UserModel = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(DocumentModel).filter(DocumentModel.id == doc_id, DocumentModel.user_id == current_user.id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.path and os.path.exists(doc.path):
        os.remove(doc.path)
    db.delete(doc)
    db.commit()
    return {"ok": True}

# ── Chat (RAG) Route ───────────────────────────────────────────────────────────
@app.post("/chat")
def chat(body: dict, current_user: UserModel = Depends(get_current_user)):
    # TODO: plug in your LangChain RAG chain here
    # query = body.get("query")
    # response = chain.invoke(query)
    return {"answer": "Connect your LangChain chain here.", "sources": []}