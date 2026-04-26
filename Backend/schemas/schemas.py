from pydantic import BaseModel, EmailStr
from typing import Optional, List

class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str
    is_admin: bool = False

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
    max_pages: int = 1