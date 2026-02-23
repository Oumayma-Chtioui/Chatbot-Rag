from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from config import SECRET_KEY, ALGORITHM, TOKEN_EXPIRE_MINUTES
from database import get_db
from models.user import UserModel

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

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