"""WeasyPrint PDF generation service."""
from __future__ import annotations

import json
import os
from datetime import date
from pathlib import Path

import structlog
from jinja2 import Environment, FileSystemLoader

from app.config import get_settings
from app.services.run_context import RunContext

logger = structlog.get_logger(__name__)
settings = get_settings()

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"


def _get_jinja_env() -> Environment:
    return Environment(loader=FileSystemLoader(str(_TEMPLATES_DIR)), autoescape=True)


def _validate_pdf(path: Path) -> None:
    """Raise if the PDF is missing or suspiciously small."""
    if not path.exists():
        raise FileNotFoundError(f"PDF not written: {path}")
    size = path.stat().st_size
    if size < 1024:
        raise ValueError(f"PDF too small ({size} bytes), likely corrupt: {path}")


class PDFService:
    def generate_target_report(self, target_id: int, run_id: int, ctx: RunContext) -> dict:
        import asyncio
        from app.database import AsyncSessionLocal
        from app.models import Target, ExtractedInsight, PersonSummary
        from sqlalchemy import select

        async def _load():
            async with AsyncSessionLocal() as sess:
                target = await sess.get(Target, target_id)
                insights_rows = await sess.execute(
                    select(ExtractedInsight)
                    .where(ExtractedInsight.target_id == target_id)
                    .order_by(ExtractedInsight.extracted_at.desc())
                    .limit(100)
                )
                insights = insights_rows.scalars().all()
                summary_row = await sess.execute(
                    select(PersonSummary)
                    .where(PersonSummary.target_id == target_id, PersonSummary.run_id == run_id)
                    .order_by(PersonSummary.generated_at.desc())
                    .limit(1)
                )
                summary = summary_row.scalar_one_or_none()
                return target, insights, summary

        target, insights, summary = asyncio.get_event_loop().run_until_complete(_load())
        if not target:
            return {"error": "target_not_found"}

        today = date.today().isoformat()
        out_dir = Path(settings.reports_dir) / today / target.name.replace(" ", "_")
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"{target.name.replace(' ', '_')}.pdf"

        bullets = []
        if summary and summary.summary_bullets:
            bullets = json.loads(summary.summary_bullets)

        env = _get_jinja_env()
        try:
            tmpl = env.get_template("target_report.html")
        except Exception:
            # Fallback minimal template
            html = self._minimal_html(target.name, insights, bullets, summary)
        else:
            html = tmpl.render(target=target, insights=insights, bullets=bullets, summary=summary, date=today)

        from weasyprint import HTML
        HTML(string=html).write_pdf(str(pdf_path))
        _validate_pdf(pdf_path)

        logger.info("pdf.target_generated", path=str(pdf_path), size=pdf_path.stat().st_size)
        return {"path": str(pdf_path)}

    def generate_daily_summary(self, run_id: int, ctx: RunContext) -> dict:
        import asyncio
        from app.database import AsyncSessionLocal
        from app.models import RunLog, PersonSummary, Target
        from sqlalchemy import select

        async def _load():
            async with AsyncSessionLocal() as sess:
                run = await sess.get(RunLog, run_id)
                rows = await sess.execute(
                    select(PersonSummary, Target)
                    .join(Target, PersonSummary.target_id == Target.id)
                    .where(PersonSummary.run_id == run_id)
                )
                return run, rows.all()

        run, summaries = asyncio.get_event_loop().run_until_complete(_load())

        today = date.today().isoformat()
        out_dir = Path(settings.reports_dir) / today
        out_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = out_dir / f"Daily_Summary_{today}.pdf"

        html = self._daily_summary_html(today, summaries)

        from weasyprint import HTML
        HTML(string=html).write_pdf(str(pdf_path))
        _validate_pdf(pdf_path)

        logger.info("pdf.daily_summary_generated", path=str(pdf_path))
        return {"path": str(pdf_path)}

    @staticmethod
    def _minimal_html(name: str, insights: list, bullets: list, summary) -> str:
        bullets_html = "".join(f"<li>{b}</li>" for b in bullets)
        insights_html = "".join(
            f"<div class='insight'><h3>{i.topic}</h3><p>{i.what_they_said}</p></div>"
            for i in insights
        )
        so_what = (summary.so_what_pharma or "") if summary else ""
        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {{ font-family: Arial, sans-serif; margin: 40px; color: #1a1a1a; }}
  h1 {{ color: #003087; }} h2 {{ color: #0066cc; border-bottom: 1px solid #ccc; }}
  .insight {{ background: #f9f9f9; padding: 12px; margin: 12px 0; border-left: 4px solid #0066cc; }}
</style></head>
<body>
<h1>{name} — Intelligence Report</h1>
<h2>Key Findings</h2><ul>{bullets_html}</ul>
<h2>Analyst Note</h2><p>{so_what}</p>
<h2>Detailed Insights</h2>{insights_html}
</body></html>"""

    @staticmethod
    def _daily_summary_html(date_str: str, summaries: list) -> str:
        sections = ""
        for ps, target in summaries:
            bullets = json.loads(ps.summary_bullets or "[]")
            bullets_html = "".join(f"<li>{b}</li>" for b in bullets)
            sections += f"<h2>{target.name}</h2><ul>{bullets_html}</ul><hr>"
        return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  body {{ font-family: Arial, sans-serif; margin: 40px; color: #1a1a1a; }}
  h1 {{ color: #003087; }} h2 {{ color: #0066cc; margin-top: 30px; }}
  hr {{ border: none; border-top: 1px solid #ddd; margin: 20px 0; }}
</style></head>
<body>
<h1>RocheRadar Daily Summary — {date_str}</h1>
{sections}
</body></html>"""
