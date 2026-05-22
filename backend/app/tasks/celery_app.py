from celery import Celery
from celery.utils.log import get_task_logger

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "rocheradar",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.scrape",
        "app.tasks.llm",
        "app.tasks.pdf",
        "app.tasks.embed",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Paris",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,                  # re-queue on worker crash
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,         # fair dispatch for long tasks
    task_routes={
        "app.tasks.scrape.*": {"queue": "scrape"},
        "app.tasks.llm.*": {"queue": "llm"},
        "app.tasks.pdf.*": {"queue": "pdf"},
        "app.tasks.embed.*": {"queue": "embed"},
    },
    # Dead-letter: failed tasks land in 'dead_letter' queue after max retries
    task_queues_max_priority=None,
    # Retry defaults (overridden per task)
    task_max_retries=3,
    task_default_retry_delay=30,
)

logger = get_task_logger(__name__)
