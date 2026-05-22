"""Scrape tasks — run on the 'scrape' queue."""
import structlog
from celery import shared_task

from app.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(
    bind=True,
    name="app.tasks.scrape.scrape_target",
    queue="scrape",
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def scrape_target(self, target_id: int, run_id: int, idempotency_key: str) -> dict:
    """Scrape one KOL target and persist raw posts. Returns a summary dict."""
    from app.services.scraper import ScrapeService
    from app.services.run_context import RunContext

    log = logger.bind(target_id=target_id, run_id=run_id, task_id=self.request.id)
    log.info("scrape_target.started")
    try:
        ctx = RunContext(run_id=run_id, task_id=self.request.id)
        result = ScrapeService().scrape(target_id=target_id, ctx=ctx, idempotency_key=idempotency_key)
        log.info("scrape_target.done", new_posts=result["new_posts"])
        return result
    except Exception as exc:
        log.warning("scrape_target.retry", exc=str(exc), retries=self.request.retries)
        raise self.retry(exc=exc)


@celery_app.task(
    bind=True,
    name="app.tasks.scrape.rescue_scrape_target",
    queue="scrape",
    max_retries=2,
    default_retry_delay=120,
    acks_late=True,
)
def rescue_scrape_target(self, target_id: int, run_id: int) -> dict:
    """Agent-only deep scrape on known_urls for zero-insight targets."""
    from app.services.scraper import ScrapeService
    from app.services.run_context import RunContext

    log = logger.bind(target_id=target_id, run_id=run_id, task_id=self.request.id)
    log.info("rescue_scrape.started")
    try:
        ctx = RunContext(run_id=run_id, task_id=self.request.id)
        result = ScrapeService().rescue_scrape(target_id=target_id, ctx=ctx)
        log.info("rescue_scrape.done", rescued_posts=result.get("rescued_posts", 0))
        return result
    except Exception as exc:
        log.warning("rescue_scrape.retry", exc=str(exc))
        raise self.retry(exc=exc)
