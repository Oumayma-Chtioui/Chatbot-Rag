from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
import shutil, os, uuid
from datetime import datetime
from database import documents_collection
from models.user import UserModel
from schemas.schemas import UrlDocRequest
from auth.helpers import get_current_user
from config import UPLOAD_DIR

router = APIRouter(tags=["Documents"])

@router.get("/documents")
def get_documents(current_user: UserModel = Depends(get_current_user)):
    docs = list(documents_collection.find({"user_id": current_user.id}, {"_id": 0}))
    return docs

@router.post("/documents/upload")
async def upload_document(file: UploadFile = File(...), current_user: UserModel = Depends(get_current_user)):
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1]
    file_path = os.path.join(UPLOAD_DIR, f"{file_id}{ext}")

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    size_kb = os.path.getsize(file_path) / 1024
    size_str = f"{size_kb:.0f} KB" if size_kb < 1024 else f"{size_kb / 1024:.1f} MB"
    doc_type = "image" if ext.lower() in [".png", ".jpg", ".jpeg", ".webp"] else "pdf"

    doc = {
        "id": file_id,
        "user_id": current_user.id,
        "name": file.filename,
        "type": doc_type,
        "size": size_str,
        "path": file_path,
        "status": "ready",
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc, "_id": file_id})
    return {"id": doc["id"], "name": doc["name"], "type": doc["type"], "size": doc["size"], "status": doc["status"]}

@router.post("/documents/url")
def add_url_document(req: UrlDocRequest, current_user: UserModel = Depends(get_current_user)):
    doc_id = str(uuid.uuid4())
    doc = {
        "id": doc_id,
        "user_id": current_user.id,
        "name": req.url,
        "type": "url",
        "size": "Web page",
        "path": req.url,
        "status": "ready",
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc, "_id": doc_id})
    return {"id": doc["id"], "name": doc["name"], "type": doc["type"], "size": doc["size"], "status": doc["status"]}

@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: UserModel = Depends(get_current_user)):
    doc = documents_collection.find_one({"id": doc_id, "user_id": current_user.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("path") and os.path.exists(doc["path"]):
        os.remove(doc["path"])
    documents_collection.delete_one({"id": doc_id})
    return {"ok": True}