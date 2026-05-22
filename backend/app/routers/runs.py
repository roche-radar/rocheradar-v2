"""Run management: trigger, stop, poll progress, history."""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import RunLog, RunStatus, Target

router = APIRouter(prefix="/api/runs", tags=["runs"])


class TriggerRequest(BaseModel):
    limit: int | None = None


class RunOut(BaseModel):
    id: int
    status: str
    started_at: str
    completed_at: str | None
    total_targets: int
    targets_processed: int
    new_posts_found: int
    insights_extracted: int
    pdfs_generated: int
    current_target: str | None
    error_message: str | None
    llm_calls_used: int

    model_config = {"from_attributes": True}


def _run_to_out(r: RunLog) -> RunOut:
    return RunOut(
        id=r.id,
        status=r.status if isinstance(r.status, str) else r.status.value,
        started_at=r.started_at.isoformat(),
        completed_at=r.completed_at.isoformat() if r.completed_at else None,
        total_targets=r.total_targets,
        targets_processed=r.targets_processed,
        new_posts_found=r.new_posts_found,
        insights_extracted=r.insights_extracted,
        pdfs_generated=r.pdfs_generated,
        current_target=r.current_target,
        error_message=r.error_message,
        llm_calls_used=r.llm_calls_used,
    )


@router.post("/trigger")
async def trigger_run(body: TriggerRequest, db: AsyncSession = Depends(get_db)):
    from celery import chain, chord, group
    from app.tasks.scrape import scrape_target
    from app.tasks.llm import generate_summary
    from app.tasks.pdf import generate_target_pdf, generate_daily_summary_pdf

    # Reject if a run is already in progress
    existing = await db.execute(
        select(RunLog).where(RunLog.status == RunStatus.running).limit(1)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A run is already in progress")

    idempotency_key = str(uuid.uuid4())

    rows = await db.execute(
        select(Target).where(Target.active == True).order_by(Target.name)
    )
    targets = rows.scalars().all()
    if body.limit:
        targets = targets[: body.limit]

    if not targets:
        raise HTTPException(status_code=422, detail="No active targets configured")

    run = RunLog(
        idempotency_key=idempotency_key,
        status=RunStatus.running,
        total_targets=len(targets),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    # Per-target: scrape → summary → PDF. All targets run in parallel (group).
    # After all complete, generate daily summary PDF.
    target_chains = []
    for t in targets:
        per_target = chain(
            scrape_target.si(t.id, run.id, idempotency_key),
            generate_summary.si(t.id, run.id),
            generate_target_pdf.si(t.id, run.id),
        )
        target_chains.append(per_target)

    pipeline = chord(group(*target_chains), generate_daily_summary_pdf.si(run.id))
    async_result = pipeline.apply_async()

    # Store the chord task id for potential cancellation
    run.celery_task_id = async_result.id
    await db.commit()

    return {"run_id": run.id, "idempotency_key": idempotency_key, "targets": len(targets)}


@router.get("/current")
async def current_run(db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        select(RunLog).where(RunLog.status == RunStatus.running)
        .order_by(RunLog.started_at.desc()).limit(1)
    )
    run = row.scalar_one_or_none()
    if not run:
        return {"running": False}
    return {"running": True, **_run_to_out(run).model_dump()}


@router.post("/stop")
async def stop_run(db: AsyncSession = Depends(get_db)):
    row = await db.execute(
        select(RunLog).where(RunLog.status == RunStatus.running)
        .order_by(RunLog.started_at.desc()).limit(1)
    )
    run = row.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="No active run")
    if run.celery_task_id:
        from app.tasks.celery_app import celery_app
        celery_app.control.revoke(run.celery_task_id, terminate=True, signal="SIGTERM")
    run.status = RunStatus.cancelled
    await db.commit()
    return {"stopped": True, "run_id": run.id}


@router.get("/", response_model=list[RunOut])
async def list_runs(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(RunLog).order_by(desc(RunLog.started_at)).limit(50))
    return [_run_to_out(r) for r in rows.scalars().all()]


@router.get("/{run_id}", response_model=RunOut)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    run = await db.get(RunLog, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_out(run)
