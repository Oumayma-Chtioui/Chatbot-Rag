from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models.user import UserModel
from schemas.schemas import RegisterRequest, LoginRequest
from auth.helpers import hash_password, verify_password, create_token, get_current_user

router = APIRouter(tags=["Auth"])

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

@router.get("/me")
def get_me(current_user: UserModel = Depends(get_current_user)):
    return {"id": current_user.id, "name": current_user.name, "email": current_user.email, "is_admin": current_user.is_admin}