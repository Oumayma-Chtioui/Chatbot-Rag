from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.user import UserModel
from schemas.schemas import RegisterRequest, LoginRequest
from auth.helpers import hash_password, verify_password, create_token, get_current_user

router = APIRouter(tags=["Auth"])
from pydantic import BaseModel

class GoogleAuthRequest(BaseModel):
    credential: str

@router.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(UserModel).filter(UserModel.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = UserModel(
        name=req.name,
        email=req.email,
        hashed_password=hash_password(req.password)
    )
    db.add(user)
    db.commit()
    token = create_token({"sub": req.email, "name": req.name})
    return {"access_token": token, "token_type": "bearer", "name": req.name, "email": req.email}

@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token({"sub": user.email, "name": user.name})
    return {"access_token": token, "token_type": "bearer", "name": user.name, "email": user.email, "is_admin": user.is_admin}

@router.post("/admin/auth/login")
def admin_login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.email == req.email, UserModel.is_admin == True).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid admin credentials")
    token = create_token({"sub": user.email, "name": user.name, "role": "admin"})
    return {"access_token": token, "token_type": "bearer", "name": user.name, "email": user.email, "is_admin": True}

@router.post("/auth/google")
def google_auth(req: GoogleAuthRequest, db: Session = Depends(get_db)):
    from google.oauth2 import id_token
    from google.auth.transport import requests as g_requests
    import os
 
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "970335989460-el84bl527om9eftfscr0vdurf0d7uek6.apps.googleusercontent.com")
 
    try:
        id_info = id_token.verify_oauth2_token(
            req.credential,
            g_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")
 
    google_id = id_info["sub"]
    email     = id_info["email"]
    name      = id_info.get("name", email.split("@")[0])
 
    # Look up by google_id first, then fall back to email (links existing accounts)
    user = db.query(UserModel).filter(UserModel.google_id == google_id).first()
    if not user:
        user = db.query(UserModel).filter(UserModel.email == email).first()
        if user:
            user.google_id = google_id   # link existing email account
        else:
            user = UserModel(name=name, email=email, google_id=google_id)
            db.add(user)
    db.commit()
    db.refresh(user)
 
    token = create_token({"sub": user.email, "name": user.name})
    return {
        "access_token": token,
        "token_type":   "bearer",
        "name":         user.name,
        "email":        user.email,
        "is_admin":     user.is_admin,
    }
 

@router.get("/me")
def get_me(current_user: UserModel = Depends(get_current_user)):
    return {"id": current_user.id, "name": current_user.name, "email": current_user.email, "is_admin": current_user.is_admin}