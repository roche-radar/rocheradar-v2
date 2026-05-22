"""TinyFish scraping service (subprocess wrapper)."""
from __future__ import annotations

import asyncio
import itertools
import json
import subprocess
import threading
from datetime import date, timedelta
from pathlib import Path

import structlog

from app.config import get_settings
from app.services.deduplicator import DeduplicatorService, sha256_hash
from app.services.run_context import RunContext

logger = structlog.get_logger(__name__)
settings = get_settings()

_FRESHNESS_DAYS = 90
_EXTENDED_DAYS = 180

# Thread-safe round-robin over TinyFish API keys
_key_cycle_lock = threading.Lock()
_key_cycle = itertools.cycle(settings.tinyfish_keys_list) if settings.tinyfish_keys_list else None


def _next_key() -> str:
    if _key_cycle is None:
        return settings.tinyfish_api_key
    with _key_cycle_lock:
        return next(_key_cycle)


class AgentBudget:
    def __init__(self, limit: int) -> None:
        self._limit = limit
        self._used = 0
        self._lock = threading.Lock()

    def consume(self) -> bool:
        with self._lock:
            if self._used >= self._limit:
                return False
            self._used += 1
            return True

    @property
    def remaining(self) -> int:
        return max(0, self._limit - self._used)


def _run_tinyfish(args: list[str]) -> dict:
    """Run tinyfish CLI and return parsed JSON output."""
    cmd = ["tinyfish"] + args + ["--json"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return json.loads(result.stdout) if result.stdout.strip() else {}
    except Exception as exc:
        logger.warning("tinyfish.error", exc=str(exc), cmd=cmd)
        return {}


def _build_queries(target_name: str) -> list[str]:
    after = (date.today() - timedelta(days=_FRESHNESS_DAYS)).isoformat()
    return [
        f'"{target_name}" roche after:{after}',
        f'"{target_name}" pharmaceutical after:{after}',
        f'"{target_name}" oncology after:{after}',
    ]


class ScrapeService:
    def __init__(self) -> None:
        self._dedup = DeduplicatorService()

    def scrape(self, target_id: int, ctx: RunContext, idempotency_key: str) -> dict:
        import asyncio as _asyncio
        from app.database import AsyncSessionLocal
        from app.models import Target, ScrapedPost
        from sqlalchemy import select

        async def _run() -> dict:
            async with AsyncSessionLocal() as sess:
                target = await sess.get(Target, target_id)
                if not target:
                    return {"error": "target_not_found"}
                known_urls: list[str] = json.loads(target.known_urls or "[]")

            queries = _build_queries(target.name)
            new_posts = 0
            duplicates = 0

            for query in queries:
                if ctx.should_stop:
                    break
                search_result = _run_tinyfish(["search", query, "--api-key", _next_key()])
                urls: list[str] = search_result.get("urls", [])[:25]

                for url in urls:
                    if ctx.should_stop:
                        break
                    fetch_result = _run_tinyfish(["fetch", url, "--api-key", _next_key()])
                    content: str = fetch_result.get("content", "")
                    if not content.strip():
                        continue

                    h = sha256_hash(content)
                    is_dup, _ = self._dedup.is_semantic_duplicate(content, target_id)

                    if is_dup:
                        duplicates += 1
                        continue

                    post = ScrapedPost(
                        target_id=target_id,
                        source_url=url,
                        raw_content=content,
                        content_hash=h,
                        idempotency_key=f"{idempotency_key}:{h[:16]}",
                    )
                    async with AsyncSessionLocal() as sess:
                        try:
                            sess.add(post)
                            await sess.commit()
                            await sess.refresh(post)
                            new_posts += 1
                            # Fire embed task (non-blocking)
                            from app.tasks.embed import embed_post
                            embed_post.delay(post.id)
                        except Exception:
                            await sess.rollback()
                            duplicates += 1

            return {"new_posts": new_posts, "duplicates": duplicates}

        return _asyncio.get_event_loop().run_until_complete(_run())

    def rescue_scrape(self, target_id: int, ctx: RunContext) -> dict:
        """Deep agent-based scrape against known_urls for zero-insight targets."""
        import asyncio as _asyncio
        from app.database import AsyncSessionLocal
        from app.models import Target, ScrapedPost
        from sqlalchemy import select

        budget = AgentBudget(settings.agent_budget_per_run)

        async def _run() -> dict:
            async with AsyncSessionLocal() as sess:
                target = await sess.get(Target, target_id)
                if not target:
                    return {"error": "target_not_found"}
                known_urls: list[str] = json.loads(target.known_urls or "[]")

            rescued = 0
            for url in known_urls:
                if ctx.should_stop or not budget.consume():
                    break
                fetch_result = _run_tinyfish(["agent", url, "--api-key", _next_key()])
                content: str = fetch_result.get("content", "")
                if not content.strip():
                    continue

                h = sha256_hash(content)
                is_dup, _ = self._dedup.is_semantic_duplicate(content, target_id)
                if is_dup:
                    continue

                post = ScrapedPost(
                    target_id=target_id,
                    source_url=url,
                    raw_content=content,
                    content_hash=h,
                )
                async with AsyncSessionLocal() as sess:
                    try:
                        sess.add(post)
                        await sess.commit()
                        await sess.refresh(post)
                        rescued += 1
                        from app.tasks.embed import embed_post
                        embed_post.delay(post.id)
                    except Exception:
                        await sess.rollback()

            return {"rescued_posts": rescued}

        return _asyncio.get_event_loop().run_until_complete(_run())
