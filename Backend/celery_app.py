from celery import Celery
import os

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "rag_worker",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["tasks.ingest_tasks", "tasks.chat_tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,       # enables STARTED state
    result_expires=3600,           # results live 1 hour in Redis
    worker_prefetch_multiplier=1,  # one task at a time per worker (heavy tasks)
)