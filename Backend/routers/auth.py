from datetime import datetime, timedelta
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
from models.user import UserModel
from schemas.schemas import RegisterRequest, LoginRequest
from auth.helpers import hash_password, verify_password, create_token, get_current_user

router = APIRouter(tags=["Auth"])
from pydantic import BaseModel

from routers.widget_chat import limiter

class GoogleAuthRequest(BaseModel):
    credential: str

from services.email_service import send_verification_email

@router.post("/register")
@limiter.limit("3/minute")
def register(request: Request, req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(UserModel).filter(UserModel.email == req.email).first()
    
    if existing:
        # if verified, reject — real account
        if existing.is_verified:
            raise HTTPException(status_code=400, detail="Email already registered")
        # if unverified, overwrite and resend
        existing.name = req.name
        existing.hashed_password = hash_password(req.password)
        existing.verification_token = secrets.token_urlsafe(32)
        db.commit()
        send_verification_email(req.email, req.name, existing.verification_token)
        return {"message": "Verification email resent. Please check your inbox."}
    
    token = secrets.token_urlsafe(32)
    token_expiry = datetime.utcnow() + timedelta(hours=24)
    user = UserModel(
        name=req.name,
        email=req.email,
        hashed_password=hash_password(req.password),
        verification_token=token,
        verification_token_expires=token_expiry,
        is_verified=False
    )
    db.add(user)
    db.commit()
    send_verification_email(req.email, req.name, token)
    return {"message": "Registration successful. Please check your email to verify your account."}

@router.post("/login")
@limiter.limit("5/minute")
async def login(request: Request,req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(UserModel.email == req.email).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not user.is_verified:
        user.verification_token = secrets.token_urlsafe(32)
        db.commit()
        send_verification_email(user.email, user.name, user.verification_token)
        raise HTTPException(status_code=403, detail="Email not verified. A new verification link has been sent to your inbox.")
    
    token = create_token({"sub": user.email, "name": user.name})
    return {"access_token": token, "token_type": "bearer", "name": user.name, 
            "email": user.email, "is_admin": user.is_admin}

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

@router.get("/verify-email/{token}")
def verify_email(token: str, db: Session = Depends(get_db)):
    user = db.query(UserModel).filter(
        UserModel.verification_token == token
    ).first()
    
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    
    # handle old tokens that have no expiry set
    if user.verification_token_expires is not None:
        if user.verification_token_expires < datetime.utcnow():
            raise HTTPException(status_code=400, detail="Verification link has expired. Please register again.")
    
    user.is_verified = True
    user.verified_at = datetime.utcnow()
    user.verification_token = None
    user.verification_token_expires = None
    db.commit()
    return {"message": "Email verified successfully. You can now log in."}