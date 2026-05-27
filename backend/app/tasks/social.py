"""Social trend scan — manual-trigger Apify scrape across platforms.

Reads the curated config from AppSettings (medical/drug/treatment keywords +
optionally KOL names), runs the per-platform Apify Actors, and ingests the
results into the social_posts table with real engagement counts. No LLM runs
during the scan — topic descriptions are generated on demand when the user
clicks a trend (see routers/social.py).
"""
import asyncio
import json

import structlog

from app.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)

_STATUS_KEY = "social_scan:status"


def _set_status(**fields) -> None:
    try:
        import redis as _redis
        from app.config import get_settings
        r = _redis.Redis.from_url(get_settings().redis_url, socket_timeout=2)
        existing = {}
        cur = r.get(_STATUS_KEY)
        if cur:
            try:
                existing = json.loads(cur)
            except Exception:
                existing = {}
        existing.update(fields)
        r.set(_STATUS_KEY, json.dumps(existing), ex=86400)
    except Exception:
        pass


@celery_app.task(
    bind=True,
    name="app.tasks.social.social_scan",
    queue="scrape",
    # Expensive (real Apify $) + manually triggered: never auto-requeue. A killed
    # or worker-lost scan is lost, not re-run — re-running would double-spend credits.
    acks_late=False,
    reject_on_worker_lost=False,
    max_retries=0,
    soft_time_limit=3000,
    time_limit=3300,
)
def social_scan(self) -> dict:
    """Run a full social trend scan based on the current AppSettings config."""
    import asyncio
    return asyncio.run(_run_scan())


async def _run_scan() -> dict:
    from datetime import datetime, timezone
    from app.database import CelerySessionLocal
    from app.models import AppSettings, SocialPost, Target
    from app.services import apify_client
    from app.services.deduplicator import sha256_hash
    from sqlalchemy import select
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    if not apify_client.is_configured():
        logger.warning("social_scan.no_apify_token")
        _set_status(running=False, error="APIFY_API_TOKEN not set")
        return {"error": "apify_not_configured"}

    # ── Load config ────────────────────────────────────────
    async with CelerySessionLocal() as sess:
        s = await sess.get(AppSettings, 1)
        keywords = json.loads(s.social_keywords) if s and s.social_keywords else []
        platforms = json.loads(s.social_platforms) if s and s.social_platforms else \
            ["instagram", "twitter", "tiktok", "facebook"]
        window = s.social_window_days if s else 180
        max_per_query = s.social_max_per_query if s else 30
        include_kols = s.social_include_kols if s else True
        fb_page_urls = json.loads(s.facebook_page_urls) if s and s.facebook_page_urls else []

        kol_names: list[str] = []
        if include_kols:
            rows = await sess.execute(select(Target.name).where(Target.active == True))  # noqa: E712
            kol_names = [r[0] for r in rows.all()]

    # Facebook uses page URLs, not keywords — handle it as one separate job.
    # All other platforms use keyword/hashtag terms.
    non_fb = [p for p in platforms if p != "facebook"]
    HASHTAG_PLATFORMS = {"instagram", "tiktok"}

    terms: list[tuple[str, str, list[str]]] = []
    for kw in keywords:
        terms.append((kw, "field", non_fb))
    for name in kol_names:
        # KOL names: only keyword-search platforms (Twitter); hashtag platforms need handles
        kol_platforms = [p for p in non_fb if p not in HASHTAG_PLATFORMS]
        if kol_platforms:
            terms.append((name, "kol", kol_platforms))

    # One Facebook job using all configured page URLs (if FB is enabled and URLs set)
    fb_job = "facebook" in platforms and bool(fb_page_urls)

    if not terms and not fb_job:
        logger.warning("social_scan.no_terms")
        _set_status(running=False, error="No keywords, KOLs, or Facebook pages configured")
        return {"error": "no_terms"}

    total_jobs = sum(len(p) for _, _, p in terms) + (1 if fb_job else 0)
    _set_status(running=True, error=None, total=total_jobs, done=0,
                inserted=0, started_at=datetime.now(timezone.utc).isoformat())
    logger.info("social_scan.start", terms=len(terms), fb_job=fb_job, jobs=total_jobs)

    loop = asyncio.get_running_loop()
    # Bounded concurrency: max 4 simultaneous Apify runs to avoid saturating the
    # account and hitting Apify's concurrent-run limit.
    sem = asyncio.Semaphore(4)
    done_count = 0
    inserted_count = 0
    lock = asyncio.Lock()

    async def _run_one(term: str, kind: str, platform: str) -> None:
        nonlocal done_count, inserted_count
        async with sem:
            posts = await loop.run_in_executor(
                None,
                lambda p=platform, t=term: apify_client.fetch_platform(
                    p, t, max_results=max_per_query, window_days=window,
                    page_urls=fb_page_urls if p == "facebook" else None,
                ),
            )
        local_inserted = 0
        for post in posts:
            ch = sha256_hash(post["post_url"])
            stmt = pg_insert(SocialPost).values(
                platform=post["platform"],
                post_url=post["post_url"],
                author=post.get("author"),
                text=post.get("text"),
                thumbnail_url=post.get("thumbnail_url"),
                likes=post.get("likes", 0),
                comments=post.get("comments", 0),
                views=post.get("views", 0),
                shares=post.get("shares", 0),
                hashtags=json.dumps(post.get("hashtags", [])),
                query=term,
                kind=kind,
                topic=term,
                posted_at=post.get("posted_at"),
                content_hash=ch,
            ).on_conflict_do_nothing(index_elements=["content_hash"])
            async with CelerySessionLocal() as wsess:
                try:
                    res = await wsess.execute(stmt)
                    await wsess.commit()
                    if res.rowcount:
                        local_inserted += 1
                except Exception as exc:
                    await wsess.rollback()
                    logger.debug("social_scan.insert_failed", exc=str(exc)[:120])
        async with lock:
            done_count += 1
            inserted_count += local_inserted
            _set_status(done=done_count, inserted=inserted_count)

    jobs = [
        _run_one(term, kind, platform)
        for term, kind, term_platforms in terms
        for platform in term_platforms
    ]
    if fb_job:
        jobs.append(_run_one("", "field", "facebook"))
    await asyncio.gather(*jobs, return_exceptions=True)

    _set_status(running=False, done=done_count, inserted=inserted_count,
                finished_at=datetime.now(timezone.utc).isoformat())
    logger.info("social_scan.done", jobs=done_count, inserted=inserted_count)
    return {"jobs": done_count, "inserted": inserted_count}


_DISCOVER_STATUS_KEY = "social_discover:status:{q}"


def _set_discover_status(query: str, **fields) -> None:
    try:
        import redis as _redis
        from app.config import get_settings
        r = _redis.Redis.from_url(get_settings().redis_url, socket_timeout=2)
        r.set(_DISCOVER_STATUS_KEY.format(q=query.lower().strip()),
              json.dumps(fields), ex=3600)
    except Exception:
        pass


@celery_app.task(
    bind=True,
    name="app.tasks.social.discover_fetch",
    queue="scrape",
    # Costs Apify $ per run — don't auto-requeue on timeout/worker loss.
    acks_late=False,
    reject_on_worker_lost=False,
    max_retries=0,
    soft_time_limit=600,
    time_limit=720,
)
def discover_fetch(self, query: str) -> dict:
    """Ad-hoc bounded Apify fetch for a single Discovery query across platforms."""
    import asyncio
    return asyncio.run(_run_discover(query))


async def _run_discover(query: str) -> dict:
    from app.database import CelerySessionLocal
    from app.models import AppSettings, SocialPost
    from app.services import apify_client
    from app.services.deduplicator import sha256_hash
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    if not apify_client.is_configured():
        _set_discover_status(query, running=False, error="apify_not_configured")
        return {"error": "apify_not_configured"}

    async with CelerySessionLocal() as sess:
        s = await sess.get(AppSettings, 1)
        platforms = json.loads(s.social_platforms) if s and s.social_platforms else \
            ["instagram", "twitter", "tiktok", "facebook"]
        window = s.social_window_days if s else 180

    # Discovery is interactive — keep the per-platform pull small for latency/cost.
    per_platform = 12
    _set_discover_status(query, running=True, error=None, inserted=0)
    logger.info("discover_fetch.start", query=query, platforms=platforms)

    loop = asyncio.get_running_loop()
    # Fire all platforms concurrently so total latency ≈ one actor, not the sum.
    results = await asyncio.gather(*[
        loop.run_in_executor(
            None,
            lambda p=p: apify_client.fetch_platform(p, query, max_results=per_platform, window_days=window),
        )
        for p in platforms
    ], return_exceptions=True)

    inserted = 0
    for res in results:
        if isinstance(res, Exception) or not res:
            continue
        for post in res:
            ch = sha256_hash(post["post_url"])
            stmt = pg_insert(SocialPost).values(
                platform=post["platform"], post_url=post["post_url"],
                author=post.get("author"), text=post.get("text"),
                thumbnail_url=post.get("thumbnail_url"),
                likes=post.get("likes", 0), comments=post.get("comments", 0),
                views=post.get("views", 0), shares=post.get("shares", 0),
                hashtags=json.dumps(post.get("hashtags", [])),
                query=query, kind="field", topic=query,
                posted_at=post.get("posted_at"), content_hash=ch,
            ).on_conflict_do_nothing(index_elements=["content_hash"])
            async with CelerySessionLocal() as wsess:
                try:
                    r = await wsess.execute(stmt)
                    await wsess.commit()
                    if r.rowcount:
                        inserted += 1
                except Exception:
                    await wsess.rollback()

    _set_discover_status(query, running=False, inserted=inserted)
    logger.info("discover_fetch.done", query=query, inserted=inserted)
    return {"inserted": inserted}
