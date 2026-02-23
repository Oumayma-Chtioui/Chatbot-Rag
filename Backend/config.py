import os
from dotenv import load_dotenv

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24

POSTGRES_URL = os.getenv("POSTGRES_URL")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "chatbot_rag")

UPLOAD_DIR = "./uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)