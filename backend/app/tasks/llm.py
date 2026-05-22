"""LLM tasks — run on the 'llm' queue."""
import structlog

from app.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(
    bind=True,
    name="app.tasks.llm.extract_insights",
    queue="llm",
    max_retries=4,
    default_retry_delay=30,
    acks_late=True,
)
def extract_insights(self, post_id: int, run_id: int) -> dict:
    """Run LLM insight extraction on a single scraped post."""
    from app.services.extractor import ExtractorService
    from app.services.run_context import RunContext
    from app.tasks.utils import patch_run

    log = logger.bind(post_id=post_id, run_id=run_id, task_id=self.request.id)
    log.info("extract_insights.started")
    try:
        ctx = RunContext(run_id=run_id, task_id=self.request.id)
        result = ExtractorService().extract(post_id=post_id, ctx=ctx)
        saved = result.get("insights_saved", 0)
        log.info("extract_insights.done", insights=saved)
        patch_run(run_id, **{"+insights_extracted": saved, "+llm_calls_used": 1})
        return result
    except Exception as exc:
        log.warning("extract_insights.retry", exc=str(exc), retries=self.request.retries)
        raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries))


@celery_app.task(
    bind=True,
    name="app.tasks.llm.generate_summary",
    queue="llm",
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def generate_summary(self, target_id: int, run_id: int) -> dict:
    """Generate PersonSummary (bullets + so-what) for a target after extraction."""
    from app.services.extractor import ExtractorService
    from app.services.run_context import RunContext

    log = logger.bind(target_id=target_id, run_id=run_id, task_id=self.request.id)
    log.info("generate_summary.started")
    try:
        ctx = RunContext(run_id=run_id, task_id=self.request.id)
        result = ExtractorService().summarise(target_id=target_id, run_id=run_id, ctx=ctx)
        log.info("generate_summary.done")
        return result
    except Exception as exc:
        log.warning("generate_summary.retry", exc=str(exc))
        raise self.retry(exc=exc)
