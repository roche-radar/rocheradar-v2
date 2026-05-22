"""LLM extraction service: post content → structured insights."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import structlog

from app.services.llm_router import call_pro
from app.services.run_context import RunContext

logger = structlog.get_logger(__name__)

_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def _load_prompt(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


def _strip_fences(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1].rsplit("```", 1)[0]
    return s.strip()


class ExtractorService:
    def extract(self, post_id: int, ctx: RunContext) -> dict:
        return asyncio.run(self._extract_async(post_id, ctx))

    async def _extract_async(self, post_id: int, ctx: RunContext) -> dict:
        from app.database import AsyncSessionLocal
        from app.models import ScrapedPost, ExtractedInsight

        ctx.increment_llm_calls()
        system_prompt = _load_prompt("extract.txt")

        async with AsyncSessionLocal() as sess:
            post = await sess.get(ScrapedPost, post_id)
            if not post or not post.raw_content:
                return {"error": "no_content"}

            content = post.raw_content[:12000]
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"TARGET_ID: {post.target_id}\n\nCONTENT:\n{content}"},
            ]

            try:
                raw = call_pro(messages)
            except Exception as exc:
                logger.warning("extractor.llm_failed", post_id=post_id, exc=str(exc))
                return {"insights_saved": 0, "error": str(exc)}

            try:
                parsed = json.loads(_strip_fences(raw))
            except json.JSONDecodeError:
                logger.warning("extractor.json_parse_failed", post_id=post_id)
                return {"insights_saved": 0, "error": "json_parse_failed"}

            meta = parsed.get("post_metadata", {})
            if meta.get("published_date"):
                post.published_date = meta["published_date"]
            if meta.get("title"):
                post.title = meta["title"]
            if meta.get("source_name"):
                post.source_name = meta["source_name"]

            insights_saved = 0
            for item in parsed.get("insights", []):
                ins = ExtractedInsight(
                    scraped_post_id=post.id,
                    target_id=post.target_id,
                    topic=item.get("topic"),
                    context=item.get("context"),
                    what_they_said=item.get("what_they_said"),
                    sentiment=item.get("sentiment"),
                    category=item.get("category"),
                    window_tag="primary",
                )
                sess.add(ins)
                insights_saved += 1

            await sess.commit()
            return {"insights_saved": insights_saved}

    def summarise(self, target_id: int, run_id: int, ctx: RunContext) -> dict:
        return asyncio.run(self._summarise_async(target_id, run_id, ctx))

    async def _summarise_async(self, target_id: int, run_id: int, ctx: RunContext) -> dict:
        from app.database import AsyncSessionLocal
        from app.models import ExtractedInsight, PersonSummary
        from sqlalchemy import select

        ctx.increment_llm_calls()
        system_prompt = _load_prompt("summarize.txt")

        async with AsyncSessionLocal() as sess:
            rows = await sess.execute(
                select(ExtractedInsight)
                .where(ExtractedInsight.target_id == target_id)
                .order_by(ExtractedInsight.extracted_at.desc())
                .limit(50)
            )
            insights = rows.scalars().all()

        if not insights:
            return {"bullets": 0, "so_what_saved": False}

        insights_text = "\n\n".join(
            f"TOPIC: {i.topic}\nCONTEXT: {i.context}\nSTATEMENT: {i.what_they_said}\nSENTIMENT: {i.sentiment}"
            for i in insights
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": insights_text},
        ]
        try:
            raw = call_pro(messages, max_tokens=2048)
        except Exception as exc:
            logger.warning("summarise.llm_failed", target_id=target_id, exc=str(exc))
            return {"error": str(exc)}

        try:
            parsed = json.loads(_strip_fences(raw))
        except json.JSONDecodeError:
            logger.warning("summarise.json_parse_failed", target_id=target_id)
            return {"error": "json_parse_failed"}

        async with AsyncSessionLocal() as sess:
            summary = PersonSummary(
                target_id=target_id,
                run_id=run_id,
                summary_bullets=json.dumps(parsed.get("bullets", [])),
                so_what_pharma=parsed.get("so_what_pharma", ""),
                insights_count=len(insights),
            )
            sess.add(summary)
            await sess.commit()

        return {"bullets": len(parsed.get("bullets", [])), "so_what_saved": True}
