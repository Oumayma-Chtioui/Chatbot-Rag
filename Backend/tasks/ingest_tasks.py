import asyncio
from datetime import datetime
from celery_app import celery_app
from services.rag_services import load_document, load_url, is_url
import logging
from database import documents_collection


logger = logging.getLogger(__name__)

@celery_app.task(bind=True, name="ingest_document", queue="ingest")
def ingest_document_task(self, file_path: str, filename: str,
                          user_id: int, session_id: str,
                          max_pages: int = 1, doc_id: str = None):
    """
    Wraps load_document / load_url in a Celery task.
    `bind=True` gives access to `self` for updating task state.
    """
    try:
        self.update_state(state="STARTED", meta={"status": "Loading document..."})

        class FakeFile:
            def __init__(self, name): self.filename = name

        fake_file = FakeFile(filename) if filename else None

        if is_url(file_path):
            result = asyncio.run(
                load_url(fake_file, file_path, user_id, session_id, max_pages, doc_id)
            )
        else:
            result = asyncio.run(
                load_document(fake_file, file_path, user_id, session_id, max_pages, doc_id)
            )

        if not result.get("success"):
            documents_collection.update_one(
                {"id": doc_id},
                {"$set": {"status": "failed", "error": result.get("error")}}
            )
            self.update_state(state="FAILURE", meta={"error": result.get("error")})
            raise Exception(result.get("error", "Ingestion failed"))

        documents_collection.update_one(
            {"id": doc_id},
            {"$set": {
                "status": "indexed",
                "chunks": result.get("chunks", 0),
                "indexed_at": datetime.utcnow().isoformat()
            }}
        )
        return result

    except Exception as exc:
        logger.error(f"ingest_document_task failed: {exc}")
        documents_collection.update_one(
            {"id": doc_id},
            {"$set": {"status": "failed", "error": str(exc)}}
        )
        raise self.retry(exc=exc, countdown=5, max_retries=2)
    
@celery_app.task(bind=True, name="ingest_url", queue="ingest")
def ingest_url_task(self, url, user_id, session_id, max_pages, doc_id):
    try:
        result = asyncio.run(
            load_url(None, url, user_id, session_id, max_pages, doc_id)
        )
        documents_collection.update_one(
            {"id": doc_id},
            {"$set": {
                "status": "indexed" if result.get("success") else "failed",
                "chunks": result.get("chunks", 0),
            }}
        )
        return result
    except Exception as exc:
        documents_collection.update_one(
            {"id": doc_id},
            {"$set": {"status": "failed", "error": str(exc)}}
        )
        raise self.retry(exc=exc, countdown=5, max_retries=2)