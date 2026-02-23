from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from pymongo import MongoClient
from config import POSTGRES_URL, MONGO_URL, MONGO_DB

# ── PostgreSQL ─────────────────────────────────────────────────────────────────
engine = create_engine(POSTGRES_URL)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ── MongoDB ────────────────────────────────────────────────────────────────────
mongo_client = MongoClient(MONGO_URL, authSource="admin")
mongo_db = mongo_client[MONGO_DB]
documents_collection = mongo_db["documents"]