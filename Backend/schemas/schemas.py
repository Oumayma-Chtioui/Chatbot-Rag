from pydantic import BaseModel
from typing import Optional, List

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class SessionCreate(BaseModel):
    title: Optional[str] = "New chat"

class AssignSessionRequest(BaseModel):
    doc_ids: List[str]
    session_id: str

class MessageCreate(BaseModel):
    role: str
    content: str
    sources: Optional[List[str]] = []

class UrlDocRequest(BaseModel):
    url: str