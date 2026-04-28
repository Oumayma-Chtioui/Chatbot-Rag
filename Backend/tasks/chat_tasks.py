from celery_app import celery_app
from services.chatservice import generate_answer
import logging

logger = logging.getLogger(__name__)

@celery_app.task(bind=True, name="run_rag_query")
def run_rag_query_task(self, user_id: int, session_id: str, question: str):
    try:
        self.update_state(state="STARTED", meta={"status": "Retrieving context..."})
        result = generate_answer(user_id, session_id, question)
        return result  # {"answer": ..., "sources": ..., "trace_id": ...}
    except Exception as exc:
        logger.error(f"run_rag_query_task failed: {exc}")
        raise self.retry(exc=exc, countdown=3, max_retries=1)