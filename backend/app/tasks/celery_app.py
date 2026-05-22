from celery import Celery
from celery.schedules import crontab

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
        "app.tasks.scheduler",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Europe/Paris",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_routes={
        "app.tasks.scrape.*": {"queue": "scrape"},
        "app.tasks.llm.*": {"queue": "llm"},
        "app.tasks.pdf.*": {"queue": "pdf"},
        "app.tasks.embed.*": {"queue": "embed"},
        "app.tasks.scheduler.*": {"queue": "llm"},
    },
    # Beat schedule: fire check_daily_run every minute so it can compare against DB settings
    beat_schedule={
        "check-daily-run": {
            "task": "app.tasks.scheduler.check_daily_run",
            "schedule": crontab(minute="*"),
        },
    },
)
