"""WeasyPrint PDF generation service."""
from __future__ import annotations

import asyncio
import json
from datetime import date
from pathlib import Path

import structlog

from app.config import get_settings
from app.services.run_context import RunContext

logger = structlog.get_logger(__name__)
settings = get_settings()


def _validate_pdf(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(f"PDF not written: {path}")
    if path.stat().st_size < 1024:
        raise ValueError(f"PDF too small ({path.stat().st_size} bytes): {path}")


class PDFService:
    def generate_target_report(self, target_id: int, run_id: int, ctx: RunContext) -> dict:
        return asyncio.run(self._target_async(target_id, run_id))

    async def _target_async(self, target_id: int, run_id: int) -> dict:
        from app.database import AsyncSessionLocal
        from app.models import Target, ExtractedInsight, PersonSummary
        from sqlalchemy import select

        async with AsyncSessionLocal() as sess:
            target = await sess.get(Target, target_id)
            if not target:
                return {"error": "target_not_found"}
            ins_rows = await sess.execute(
                select(ExtractedInsight)
                .where(ExtractedInsight.target_id == target_id)
                .order_by(ExtractedInsight.extracted_at.desc())
                .limit(100)
            )
            insights = ins_rows.scalars().all()
            sum_row = await sess.execute(
                select(PersonSummary)
                .where(PersonSummary.target_id == target_id, PersonSummary.run_id == run_id)
                .order_by(PersonSummary.generated_at.desc())
                .limit(1)
            )
            summary = sum_row.scalar_one_or_none()

        today = date.today().isoformat()
        safe_name = target.name.replace(" ", "_")
        out_dir = Path(settings.reports_dir) / today / safe_name
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"{safe_name}.pdf"

        bullets = json.loads(summary.summary_bullets or "[]") if summary else []
        so_what = (summary.so_what_pharma or "") if summary else ""
        html = _minimal_target_html(target.name, insights, bullets, so_what, today)

        from weasyprint import HTML
        HTML(string=html).write_pdf(str(pdf_path))
        _validate_pdf(pdf_path)

        logger.info("pdf.target_generated", path=str(pdf_path))
        return {"path": str(pdf_path)}

    def generate_daily_summary(self, run_id: int, ctx: RunContext) -> dict:
        return asyncio.run(self._daily_async(run_id))

    async def _daily_async(self, run_id: int) -> dict:
        from app.database import AsyncSessionLocal
        from app.models import PersonSummary, Target
        from sqlalchemy import select

        async with AsyncSessionLocal() as sess:
            rows = await sess.execute(
                select(PersonSummary, Target)
                .join(Target, PersonSummary.target_id == Target.id)
                .where(PersonSummary.run_id == run_id)
            )
            summaries = rows.all()

        today = date.today().isoformat()
        out_dir = Path(settings.reports_dir) / today
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"Daily_Summary_{today}.pdf"

        html = _daily_summary_html(today, summaries)
        from weasyprint import HTML
        HTML(string=html).write_pdf(str(pdf_path))
        _validate_pdf(pdf_path)

        logger.info("pdf.daily_generated", path=str(pdf_path))
        return {"path": str(pdf_path)}


def _minimal_target_html(name: str, insights: list, bullets: list, so_what: str, today: str) -> str:
    bullets_html = "".join(f"<li>{b}</li>" for b in bullets)
    insights_html = "".join(
        f"""<div class="insight">
            <div class="meta">{i.category or ''} · {i.sentiment or ''}</div>
            <h3>{i.topic or ''}</h3>
            <p>{i.what_they_said or ''}</p>
        </div>"""
        for i in insights
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {{ font-family: Arial, sans-serif; margin: 48px; color: #1a1a1a; line-height: 1.6; }}
  h1 {{ color: #003087; border-bottom: 3px solid #003087; padding-bottom: 8px; }}
  h2 {{ color: #0066cc; margin-top: 32px; }}
  h3 {{ margin: 0 0 4px; font-size: 14px; }}
  .insight {{ background: #f8f9fa; padding: 14px 16px; margin: 12px 0; border-left: 4px solid #0066cc; }}
  .meta {{ font-size: 11px; color: #666; margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }}
  li {{ margin-bottom: 6px; }}
</style></head>
<body>
  <h1>{name}</h1>
  <p style="color:#666;font-size:13px">Intelligence Report · {today}</p>
  <h2>Key Findings</h2>
  <ul>{bullets_html}</ul>
  <h2>Analyst Note</h2>
  <p>{so_what}</p>
  <h2>Detailed Insights</h2>
  {insights_html}
</body></html>"""


def _daily_summary_html(date_str: str, summaries: list) -> str:
    sections = ""
    for ps, target in summaries:
        bullets = json.loads(ps.summary_bullets or "[]")
        bullets_html = "".join(f"<li>{b}</li>" for b in bullets)
        sections += f"<h2>{target.name}</h2><ul>{bullets_html}</ul><hr>"
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {{ font-family: Arial, sans-serif; margin: 48px; color: #1a1a1a; line-height: 1.6; }}
  h1 {{ color: #003087; border-bottom: 3px solid #003087; padding-bottom: 8px; }}
  h2 {{ color: #0066cc; margin-top: 28px; font-size: 16px; }}
  li {{ margin-bottom: 5px; }}
  hr {{ border: none; border-top: 1px solid #e0e0e0; margin: 24px 0; }}
</style></head>
<body>
  <h1>RocheRadar Daily Summary</h1>
  <p style="color:#666;font-size:13px">{date_str}</p>
  {sections}
</body></html>"""
