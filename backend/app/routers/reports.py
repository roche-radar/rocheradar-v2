from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import ExtractedInsight, Target

router = APIRouter(prefix="/api/reports", tags=["reports"])
settings = get_settings()


@router.get("/")
async def list_pdfs():
    """Walk reports dir and return all PDF paths."""
    reports_dir = Path(settings.reports_dir)
    if not reports_dir.exists():
        return []
    pdfs = sorted(reports_dir.rglob("*.pdf"), reverse=True)
    return [
        {"path": str(p.relative_to(reports_dir)), "name": p.name, "size": p.stat().st_size}
        for p in pdfs
    ]


@router.get("/latest")
async def latest_insights(limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Return most recent extracted insights across all targets."""
    rows = await db.execute(
        select(ExtractedInsight, Target)
        .join(Target, ExtractedInsight.target_id == Target.id)
        .order_by(desc(ExtractedInsight.extracted_at))
        .limit(limit)
    )
    result = []
    for ins, target in rows.all():
        result.append({
            "id": ins.id,
            "target_name": target.name,
            "topic": ins.topic,
            "what_they_said": ins.what_they_said,
            "sentiment": ins.sentiment,
            "category": ins.category,
            "extracted_at": ins.extracted_at.isoformat(),
        })
    return result


@router.get("/download/{file_path:path}")
async def download_pdf(file_path: str):
    full = Path(settings.reports_dir) / file_path
    if not full.exists() or full.suffix != ".pdf":
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(full), media_type="application/pdf", filename=full.name)
