from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from pymongo import MongoClient
from config import POSTGRES_URL, MONGO_URL, MONGO_DB
import os 

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
MONGODB_URL = "mongodb://host.docker.internal:27017/your_database"
MONGODB_DB = os.getenv("MONGODB_DB", "chatbot_db")

# Connect to MongoDB
USE_MONGODB = True
mongo_client = None
mongodb = None
documents_collection = None
messages_collection = None
try:
    mongo_client = MongoClient(
        MONGODB_URL,
        serverSelectionTimeoutMS=5000,  # 5 seconds timeout
        connectTimeoutMS=5000)
    # Test connection
    mongo_client.admin.command('ping')
    print("✅ MongoDB connected successfully")
    
    # Get database and collection
    mongodb = mongo_client[MONGODB_DB]
    documents_collection = mongodb.documents
    messages_collection = mongodb.messages
    
    # Create indexes for better performance
    documents_collection.create_index([("user_id", 1)])
    documents_collection.create_index([("session_id", 1)])
    documents_collection.create_index([("id", 1)], unique=True)
    messages_collection.create_index([("session_id", 1)])  # ✅ add this
    messages_collection.create_index([("timestamp", 1)])   # ✅ add this
    print(f"✅ Using database: {MONGODB_DB}, collection: documents")
    
except Exception as e:
    USE_MONGODB = False
    print(f"❌ MongoDB connection failed: {e}")
    
    # Create dummy collection for testing
    class DummyCollection:
        def find(self, *args, **kwargs):
            return []
        def insert_one(self, *args, **kwargs):
            print("⚠️ MongoDB not available - using dummy collection")
            return type('obj', (object,), {'inserted_id': 'dummy'})()
        def count_documents(self, *args, **kwargs):
            return 0
    
    documents_collection = DummyCollection()
    messages_collection = DummyCollection()