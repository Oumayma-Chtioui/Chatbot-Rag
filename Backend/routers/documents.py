from typing import List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
import shutil, os, uuid
from datetime import datetime

from typing import Optional
from database import documents_collection
from models.user import UserModel
from schemas.schemas import AssignSessionRequest, UrlDocRequest
from auth.helpers import get_current_user
from config import UPLOAD_DIR
from services.rag_services import process_document 

import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(tags=["Documents"])

@router.get("/documents")
def get_documents(session_id: Optional[str] = None,current_user: UserModel = Depends(get_current_user)):
    """
    Get user's documents, optionally filtered by session_id.
    If session_id is provided, returns only documents for that conversation.
    """
    query = {"user_id": current_user.id}
    
    if session_id:
        query["session_id"] = session_id
        logger.info(f"📂 Fetching documents for user {current_user.id}, session {session_id}")
    else:
        logger.info(f"📂 Fetching all documents for user {current_user.id}")
    
    docs = list(documents_collection.find(query, {"_id": 0}))
    
    return {
        "count": len(docs),
        "documents": docs
    }


@router.post("/documents/upload")
async def upload_document(file: UploadFile = File(...), session_id: Optional[str] = None, current_user: UserModel = Depends(get_current_user)):
    logger.info(f"📤 Uploading file: {file.filename} for user: {current_user.id}")
    if session_id:
        logger.info(f"📎 Assigning to session: {session_id}")
    # Create unique document ID
    doc_id = str(uuid.uuid4())
    
    # Ensure upload directory exists
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    # Save file temporarily
    file_extension = os.path.splitext(file.filename)[1]
    temp_filename = f"temp_{doc_id}{file_extension}"
    temp_path = os.path.join(UPLOAD_DIR, temp_filename)
    
    try:
        # Save the uploaded file
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        logger.info(f"✅ File saved to: {temp_path}")
        
        # Get file size
        file_size = os.path.getsize(temp_path)

        # Process document (create embeddings, etc.)
        logger.info("🔄 Processing document...")
        if not session_id:
            session_id = f"session_{uuid.uuid4()}"
            logger.info(f"🆕 No session_id provided, generated: {session_id}")

        process_result = await process_document(
            file,
            temp_path,
            current_user.id,
            session_id or "default"
        )
        
        # Create document record for MongoDB
        doc_record = {
            "id": doc_id,
            "user_id": current_user.id,
            "name": file.filename,
            "type": file_extension[1:] if file_extension else "unknown",
            "size": f"{file_size / 1024:.1f} KB",
            "path": temp_path,
            "status": "indexed" if process_result.get("success") else "failed",
            "chunks": process_result.get("chunks", 0),
            "created_at": datetime.utcnow().isoformat(),
        }
        
        # Save to MongoDB
        result = documents_collection.insert_one(doc_record)
        logger.info(f"✅ Saved to MongoDB with ID: {result.inserted_id}")
        
        return {
            "message": "Document processed and indexed successfully",
            "document": {
                "id": doc_id,
                "name": file.filename,
                "chunks": process_result.get("chunks", 0),
                "session_id": session_id
            }
        }
        
    except Exception as e:
        logger.error(f"❌ Upload failed: {e}")
        # Clean up temp file if it exists
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=str(e))
    
@router.post("/documents/assign-session")
def assign_documents_to_session(
    request: AssignSessionRequest,  # ← Changed this
    current_user: UserModel = Depends(get_current_user)
):
    """
    Assign multiple documents to a session (conversation).
    Used when starting a chat with uploaded documents.
    """
    
    updated_count = 0
    for doc_id in request.doc_ids:
        # Verify document belongs to user
        doc = documents_collection.find_one({
            "id": doc_id,
            "user_id": current_user.id
        })
        
        if not doc:
            logger.warning(f"⚠️  Document {doc_id} not found or doesn't belong to user")
            continue
        
        # Update session_id
        result = documents_collection.update_one(
            {"id": doc_id, "user_id": current_user.id},
            {"$set": {
                "session_id": request.session_id,
                "updated_at": datetime.utcnow().isoformat()
            }}
        )
        
        if result.modified_count > 0:
            updated_count += 1
            logger.info(f"✅ Assigned document {doc_id} to session {request.session_id}")
    
    return {
        "message": f"Assigned {updated_count} documents to session",
        "session_id": request.session_id,
        "updated_count": updated_count
    }

@router.post("/documents/url")
def add_url_document(req: UrlDocRequest,session_id: Optional[str] = None, current_user: UserModel = Depends(get_current_user)):
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
    logger.info(f"🔗 Added URL document: {req.url}")
    return {"id": doc["id"], "name": doc["name"], "type": doc["type"], "size": doc["size"], "status": doc["status"]}
    
@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, current_user: UserModel = Depends(get_current_user)):
    doc = documents_collection.find_one({"id": doc_id, "user_id": current_user.id})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("path") and doc.get("type") != "url":
        file_path = doc["path"]
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info(f"🗑️  Deleted file: {file_path}")
            except Exception as e:
                logger.error(f"❌ Failed to delete file: {e}")
    
    # Delete from database
    documents_collection.delete_one({"id": doc_id})
    logger.info(f"✅ Deleted document: {doc_id}")
    
    return {"ok": True, "deleted": doc_id}

@router.get("/sessions/{session_id}/documents")
def get_session_documents(
    session_id: str,
    current_user: UserModel = Depends(get_current_user)
):
    """Get all documents for a specific conversation session"""
    docs = list(documents_collection.find(
        {
            "user_id": current_user.id,
            "session_id": session_id
        },
        {"_id": 0}
    ))
    
    return {
        "session_id": session_id,
        "count": len(docs),
        "documents": docs
    }

@router.get("/documents/{doc_id}")
def get_document(
    doc_id: str,
    current_user: UserModel = Depends(get_current_user)
):
    """Get a specific document by ID"""
    doc = documents_collection.find_one(
        {
            "id": doc_id,
            "user_id": current_user.id
        },
        {"_id": 0}
    )
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return doc