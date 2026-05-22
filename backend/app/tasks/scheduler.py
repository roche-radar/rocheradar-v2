"""Daily run scheduler task — Celery beat fires this every minute.

It reads AppSettings from DB and decides whether to kick off the pipeline.
This replaces APScheduler from v1 with a DB-backed, Celery-native approach.
"""
import asyncio
from datetime import datetime, timezone

import structlog

from app.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(name="app.tasks.scheduler.check_daily_run", queue="llm")
def check_daily_run() -> None:
    """Run every minute via beat. Triggers pipeline if cron_enabled and it's the right time."""
    asyncio.run(_check())


async def _check() -> None:
    from app.database import AsyncSessionLocal
    from app.models import AppSettings, RunLog, RunStatus

    async with AsyncSessionLocal() as sess:
        s = await sess.get(AppSettings, 1)
        if not s or not s.cron_enabled:
            return

        now = datetime.now(timezone.utc)
        if now.hour != s.cron_hour or now.minute != s.cron_minute:
            return

        # Don't double-trigger within the same minute
        from sqlalchemy import select, func
        from datetime import timedelta
        one_min_ago = now - timedelta(minutes=2)
        recent = await sess.execute(
            select(func.count()).select_from(RunLog)
            .where(RunLog.started_at >= one_min_ago)
        )
        if recent.scalar() > 0:
            logger.info("scheduler.skip_already_ran_recently")
            return

    logger.info("scheduler.triggering_daily_run", hour=s.cron_hour, minute=s.cron_minute)
    # Trigger via HTTP to reuse the existing run orchestration logic
    import httpx
    try:
        httpx.post("http://localhost:8008/api/runs/trigger", json={}, timeout=10)
    except Exception as exc:
        logger.warning("scheduler.trigger_failed", exc=str(exc))
