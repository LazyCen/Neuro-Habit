from celery import Celery
from core.config import REDIS_URL

celery_app = Celery(
    "neuro_habit",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["services.tasks"]
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=300,  # 5 minutes
)
