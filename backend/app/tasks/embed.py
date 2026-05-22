"""Embedding tasks — run on the 'embed' queue."""
import structlog

from app.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(
    bind=True,
    name="app.tasks.embed.embed_post",
    queue="embed",
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def embed_post(self, post_id: int) -> dict:
    """Generate and store embedding for a scraped post in ChromaDB.

    Returns chroma_id so the caller can update scraped_posts.chroma_id.
    """
    from app.services.embedder import EmbedService

    log = logger.bind(post_id=post_id, task_id=self.request.id)
    log.info("embed_post.started")
    try:
        result = EmbedService().embed(post_id=post_id)
        log.info("embed_post.done", chroma_id=result.get("chroma_id"))
        return result
    except Exception as exc:
        log.warning("embed_post.retry", exc=str(exc))
        raise self.retry(exc=exc)
