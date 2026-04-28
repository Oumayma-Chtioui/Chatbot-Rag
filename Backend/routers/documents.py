from typing import List
from unittest import result

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
import shutil, os, uuid
from datetime import datetime

from typing import Optional
from database import documents_collection
from models.user import UserModel
from schemas.schemas import AssignSessionRequest, UrlDocRequest
from auth.helpers import get_current_user
from config import UPLOAD_DIR
from services.rag_services import load_document, load_url

import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter(tags=["Documents"])

from services.shared_state import cancellation_registry

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


from tasks.ingest_tasks import ingest_document_task

@router.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    session_id: Optional[str] = None,
    current_user: UserModel = Depends(get_current_user)
):
    doc_id = str(uuid.uuid4())
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    file_extension = os.path.splitext(file.filename)[1]
    if file_extension not in {".pdf", ".txt", ".md", ".docx"}:
        raise HTTPException(status_code=415, detail=f"Unsupported file type '{file_extension}'")

    contents = await file.read()
    if len(contents) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large. Max 50MB.")

    # Save file — worker reads it from this path
    temp_path = os.path.join(UPLOAD_DIR, f"temp_{doc_id}{file_extension}")
    with open(temp_path, "wb") as f:
        f.write(contents)

    if not session_id:
        session_id = f"session_{uuid.uuid4()}"

    # Save a "processing" record to MongoDB immediately
    doc_record = {
        "id": doc_id,
        "user_id": current_user.id,
        "name": file.filename,
        "type": file_extension[1:],
        "size": f"{len(contents) / 1024:.1f} KB",
        "path": temp_path,
        "status": "processing",   # ← not "indexed" yet
        "chunks": 0,
        "created_at": datetime.utcnow().isoformat(),
        "session_id": session_id
    }
    documents_collection.insert_one(doc_record)

    # Dispatch to Celery — does NOT block
    task = ingest_document_task.delay(
        file_path=temp_path,
        filename=file.filename,
        user_id=current_user.id,
        session_id=session_id,
        max_pages=0,
        doc_id=doc_id,
    )

    return {
        "task_id": task.id,
        "doc_id": doc_id,
        "session_id": session_id,
        "status": "processing"
        # client polls GET /task/{task_id}/status to know when it's done
    }
    
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
        old_session_id = doc.get("session_id")
        if old_session_id and old_session_id != request.session_id:
            clean_old = old_session_id.replace("session_", "").replace("session-", "")
            clean_new = request.session_id.replace("session_", "").replace("session-", "")
            
            old_path = os.path.join(os.getcwd(), "vector_store", f"user_{current_user.id}", f"session_{clean_old}")
            new_path = os.path.join(os.getcwd(), "vector_store", f"user_{current_user.id}", f"session_{clean_new}")
            
            if os.path.exists(old_path):
                import shutil
                if os.path.exists(new_path):
                    # Merge: copy files into existing store directory
                    for f in os.listdir(old_path):
                        shutil.copy2(os.path.join(old_path, f), new_path)
                    shutil.rmtree(old_path)
                else:
                    shutil.move(old_path, new_path)
                logger.info(f"✅ Moved vector store from {old_path} to {new_path}")

        # Update session_id in MongoDB
        documents_collection.update_one(
            {"id": doc_id, "user_id": current_user.id},
            {"$set": {
                "session_id": request.session_id,
                "updated_at": datetime.utcnow().isoformat()
            }}
        )
        updated_count += 1

    return {
        "message": f"Assigned {updated_count} documents to session",
        "session_id": request.session_id,
        "updated_count": updated_count
    }

from tasks.ingest_tasks import ingest_url_task  # new task, see below

@router.post("/documents/url")
async def add_url_document(
    req: UrlDocRequest,
    session_id: Optional[str] = None,
    current_user: UserModel = Depends(get_current_user)
):
    doc_id = str(uuid.uuid4())

    if not session_id:
        session_id = f"session_{uuid.uuid4()}"

    # Save "processing" record immediately
    doc_record = {
        "id": doc_id,
        "user_id": current_user.id,
        "session_id": session_id,
        "name": req.url,
        "type": "url",
        "size": "Web page",
        "path": req.url,
        "status": "processing",
        "chunks": 0,
        "created_at": datetime.utcnow().isoformat(),
    }
    documents_collection.insert_one({**doc_record, "_id": doc_id})

    task = ingest_url_task.delay(
        url=req.url,
        user_id=current_user.id,
        session_id=session_id,
        max_pages=req.max_pages,
        doc_id=doc_id,
    )

    return {
        "task_id": task.id,
        "doc_id": doc_id,
        "session_id": session_id,
        "status": "processing"
    }

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

@router.post("/documents/cancel/{doc_id}")
def cancel_document_processing(doc_id: str, current_user: UserModel = Depends(get_current_user)):
    cancellation_registry[doc_id] = True
    logger.info(f"🛑 Cancellation requested for doc: {doc_id}")
    return {"ok": True, "cancelled": doc_id}

from celery.result import AsyncResult

@router.get("/documents/{doc_id}/status")
def get_document_status(
    doc_id: str,
    current_user: UserModel = Depends(get_current_user)
):
    """
    Polls MongoDB for the document's current processing status.
    Frontend calls this after upload until status != 'processing'.
    """
    doc = documents_collection.find_one(
        {"id": doc_id, "user_id": current_user.id},
        {"_id": 0}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    return {
        "doc_id": doc_id,
        "status": doc.get("status"),   # "processing" | "indexed" | "failed"
        "chunks": doc.get("chunks", 0),
        "error": doc.get("error")
    }

@router.get("/task/{task_id}/status")
async def get_task_status(task_id: str):
    result = AsyncResult(task_id)
    if result.state == "PENDING":
        return {"state": "PENDING", "status": "Waiting in queue..."}
    elif result.state == "STARTED":
        return {"state": "STARTED", "status": result.info.get("status", "Processing...")}
    elif result.state == "SUCCESS":
        return {"state": "SUCCESS", "result": result.result}
    elif result.state == "FAILURE":
        return {"state": "FAILURE", "error": str(result.info)}
    return {"state": result.state}

@router.post("/chat")
async def chat(user_id: int, session_id: str, question: str):
    task = run_rag_query_task.delay(user_id, session_id, question)
    return {"task_id": task.id, "status": "queued"}
