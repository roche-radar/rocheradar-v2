"""PDF generation tasks — run on the 'pdf' queue."""
import structlog

from app.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(
    bind=True,
    name="app.tasks.pdf.generate_target_pdf",
    queue="pdf",
    max_retries=2,
    default_retry_delay=30,
    acks_late=True,
)
def generate_target_pdf(self, target_id: int, run_id: int) -> dict:
    """Generate per-target PDF report and validate the output file."""
    from app.services.pdf_generator import PDFService
    from app.services.run_context import RunContext

    log = logger.bind(target_id=target_id, run_id=run_id, task_id=self.request.id)
    log.info("generate_target_pdf.started")
    try:
        ctx = RunContext(run_id=run_id, task_id=self.request.id)
        result = PDFService().generate_target_report(target_id=target_id, run_id=run_id, ctx=ctx)
        log.info("generate_target_pdf.done", path=result.get("path"))
        return result
    except Exception as exc:
        log.warning("generate_target_pdf.retry", exc=str(exc))
        raise self.retry(exc=exc)


@celery_app.task(
    bind=True,
    name="app.tasks.pdf.generate_daily_summary_pdf",
    queue="pdf",
    max_retries=2,
    default_retry_delay=30,
    acks_late=True,
)
def generate_daily_summary_pdf(self, run_id: int) -> dict:
    """Generate the combined daily summary PDF after all target PDFs are ready."""
    from app.services.pdf_generator import PDFService
    from app.services.run_context import RunContext

    log = logger.bind(run_id=run_id, task_id=self.request.id)
    log.info("generate_daily_summary_pdf.started")
    try:
        ctx = RunContext(run_id=run_id, task_id=self.request.id)
        result = PDFService().generate_daily_summary(run_id=run_id, ctx=ctx)
        log.info("generate_daily_summary_pdf.done", path=result.get("path"))
        return result
    except Exception as exc:
        log.warning("generate_daily_summary_pdf.retry", exc=str(exc))
        raise self.retry(exc=exc)
