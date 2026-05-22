"""TinyFish scraping service (subprocess wrapper)."""
from __future__ import annotations

import asyncio
import itertools
import json
import subprocess
import threading
from datetime import date, timedelta

import structlog

from app.config import get_settings
from app.services.deduplicator import DeduplicatorService, sha256_hash
from app.services.run_context import RunContext

logger = structlog.get_logger(__name__)
settings = get_settings()

_FRESHNESS_DAYS = 90

# Thread-safe round-robin over TinyFish API keys
_key_lock = threading.Lock()
_key_cycle: itertools.cycle | None = None


def _next_key() -> str:
    global _key_cycle
    keys = settings.tinyfish_keys_list
    if not keys:
        return ""
    with _key_lock:
        if _key_cycle is None:
            _key_cycle = itertools.cycle(keys)
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
    key = _next_key()
    cmd = ["tinyfish"] + args + (["--api-key", key] if key else []) + ["--json"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.stdout.strip():
            return json.loads(result.stdout)
        return {}
    except FileNotFoundError:
        logger.warning("tinyfish.not_installed")
        return {}
    except Exception as exc:
        logger.warning("tinyfish.error", exc=str(exc))
        return {}


def _build_queries(name: str) -> list[str]:
    after = (date.today() - timedelta(days=_FRESHNESS_DAYS)).isoformat()
    return [
        f'"{name}" roche after:{after}',
        f'"{name}" pharmaceutical after:{after}',
        f'"{name}" oncology after:{after}',
    ]


async def _save_post_and_extract(
    target_id: int,
    url: str,
    content: str,
    idempotency_key: str,
    run_id: int,
) -> tuple[bool, int | None]:
    """Persist a scraped post (if not duplicate) and fire extraction. Returns (saved, post_id)."""
    from app.database import AsyncSessionLocal
    from app.models import ScrapedPost

    h = sha256_hash(content)
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
        except Exception:
            await sess.rollback()
            return False, None

    # Fire embed + extract tasks
    from app.tasks.embed import embed_post
    from app.tasks.llm import extract_insights
    embed_post.delay(post.id)
    extract_insights.delay(post.id, run_id)
    return True, post.id


class ScrapeService:
    def __init__(self) -> None:
        self._dedup = DeduplicatorService()

    def scrape(self, target_id: int, ctx: RunContext, idempotency_key: str) -> dict:
        return asyncio.run(self._scrape_async(target_id, ctx, idempotency_key))

    async def _scrape_async(self, target_id: int, ctx: RunContext, idempotency_key: str) -> dict:
        from app.database import AsyncSessionLocal
        from app.models import Target

        async with AsyncSessionLocal() as sess:
            target = await sess.get(Target, target_id)
            if not target:
                return {"error": "target_not_found"}
            name = target.name

        new_posts = 0
        duplicates = 0
        queries = _build_queries(name)

        for query in queries:
            if ctx.should_stop:
                break
            search_result = _run_tinyfish(["search", query])
            urls: list[str] = search_result.get("urls", [])[:25]

            for url in urls:
                if ctx.should_stop:
                    break
                fetch_result = _run_tinyfish(["fetch", url])
                content: str = fetch_result.get("content", "")
                if not content.strip():
                    continue

                is_dup, _ = self._dedup.is_semantic_duplicate(content, target_id)
                if is_dup:
                    duplicates += 1
                    continue

                saved, _ = await _save_post_and_extract(
                    target_id, url, content, idempotency_key, ctx.run_id
                )
                if saved:
                    new_posts += 1
                else:
                    duplicates += 1

        return {"new_posts": new_posts, "duplicates": duplicates}

    def rescue_scrape(self, target_id: int, ctx: RunContext) -> dict:
        return asyncio.run(self._rescue_async(target_id, ctx))

    async def _rescue_async(self, target_id: int, ctx: RunContext) -> dict:
        from app.database import AsyncSessionLocal
        from app.models import Target
        import json as _json

        budget = AgentBudget(settings.agent_budget_per_run)

        async with AsyncSessionLocal() as sess:
            target = await sess.get(Target, target_id)
            if not target:
                return {"error": "target_not_found"}
            known_urls: list[str] = _json.loads(target.known_urls or "[]")

        rescued = 0
        for url in known_urls:
            if ctx.should_stop or not budget.consume():
                break
            fetch_result = _run_tinyfish(["agent", url])
            content: str = fetch_result.get("content", "")
            if not content.strip():
                continue
            is_dup, _ = self._dedup.is_semantic_duplicate(content, target_id)
            if is_dup:
                continue
            saved, _ = await _save_post_and_extract(
                target_id, url, content, f"rescue_{ctx.run_id}", ctx.run_id
            )
            if saved:
                rescued += 1

        return {"rescued_posts": rescued}
