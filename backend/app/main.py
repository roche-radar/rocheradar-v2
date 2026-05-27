import logging
import structlog
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from app.config import get_settings
from app.database import engine, Base
from app.routers import targets, runs, reports, settings as settings_router, agent
from app.routers import discovery as discovery_router
from app.routers import social as social_router

_settings = get_settings()

# ── Logging: console + JSON file in /tmp (kept outside the repo) ──
LOG_FILE = Path("/tmp/rocheradar-backend.log")

_log_level = logging.getLevelName(_settings.log_level)

# Stdlib root logger → JSON file. Also attached to uvicorn loggers so access logs land here too.
_file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
_file_handler.setLevel(_log_level)
_file_handler.setFormatter(logging.Formatter("%(message)s"))
logging.basicConfig(level=_log_level, handlers=[_file_handler, logging.StreamHandler()], force=True)

# Route uvicorn / celery loggers through root (which has the file handler).
# Clear their own handlers and enable propagation so records hit the file exactly once.
for _uv in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi", "celery", "celery.task"):
    _l = logging.getLogger(_uv)
    _l.handlers = []
    _l.propagate = True
    _l.setLevel(_log_level)

# Silence noisy stdlib loggers so the log view stays useful
for _noisy in ("sqlalchemy.engine", "sqlalchemy.engine.Engine", "watchfiles",
               "watchfiles.main", "httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(_log_level),
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger(__name__)

# ── Sentry ────────────────────────────────────────────────
if _settings.sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(dsn=_settings.sentry_dsn, environment=_settings.environment, traces_sample_rate=0.1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("startup", env=_settings.environment)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _seed_defaults()
    yield
    logger.info("shutdown")
    await engine.dispose()


async def _seed_defaults() -> None:
    """Seed AppSettings singleton and optional target pre-load from targets.json."""
    from app.database import AsyncSessionLocal
    from app.models import AppSettings, Target
    import json

    async with AsyncSessionLocal() as sess:
        s = await sess.get(AppSettings, 1)
        if not s:
            # Pick the best available provider based on which API key is in .env
            # Priority: Gemini (fast+cheap) → NVIDIA (fallback) → others
            if _settings.gemini_api_key:
                provider, model = "gemini", "gemini-2.5-flash"
            elif _settings.nvidia_api_key:
                provider, model = "nvidia", "meta/llama-3.3-70b-instruct"
            elif _settings.anthropic_api_key:
                provider, model = "anthropic", "claude-haiku-4-5-20251001"
            elif _settings.openai_api_key:
                provider, model = "openai", "gpt-4o-mini"
            elif _settings.openrouter_api_key:
                provider, model = "openrouter", "openai/gpt-4o-mini"
            else:
                provider, model = "vertex", "gemini-2.5-flash"
            sess.add(AppSettings(id=1, llm_provider=provider, llm_model=model))
            await sess.commit()
            logger.info("seeded_app_settings", provider=provider)
            s = await sess.get(AppSettings, 1)

        # Seed default Facebook page URLs if none set yet.
        # Uses apify/facebook-posts-scraper with known pharma/oncology/medical pages
        # (keyword search doesn't work on FB without auth; page-URL scraping does).
        if s and not s.facebook_page_urls:
            default_fb_pages = [
                # Major pharma companies
                "https://www.facebook.com/roche",
                "https://www.facebook.com/Novartis",
                "https://www.facebook.com/pfizer",
                "https://www.facebook.com/AstraZenecaGlobal",
                "https://www.facebook.com/BristolMyersSquibb",
                "https://www.facebook.com/merck",
                "https://www.facebook.com/abbvie",
                "https://www.facebook.com/Genentech",
                # Cancer / oncology orgs
                "https://www.facebook.com/AmericanCancerSociety",
                "https://www.facebook.com/CancerResearchUK",
                "https://www.facebook.com/LUNGevity",
                "https://www.facebook.com/LLS",
                # MS / neurology
                "https://www.facebook.com/nationalMSsociety",
                # General health / regulatory
                "https://www.facebook.com/NIH.gov",
                "https://www.facebook.com/WHO",
            ]
            s.facebook_page_urls = json.dumps(default_fb_pages)
            await sess.commit()
            logger.info("seeded_facebook_page_urls", count=len(default_fb_pages))

        # Seed a starter social-scan keyword list if none set yet
        if s and not s.social_keywords:
            default_keywords = [
                # Roche / Genentech drugs
                "Tecentriq", "Ocrevus", "Hemlibra", "Kadcyla", "Perjeta",
                "Avastin", "Herceptin", "Polivy", "Lunsumio", "Roche",
                # Medical field / disease areas / treatments
                "oncology", "lungcancer", "NSCLC", "breastcancer", "immunotherapy",
                "multiplesclerosis", "hemophilia", "clinicaltrial", "biomarker",
                "cancertreatment",
            ]
            s.social_keywords = json.dumps(default_keywords)
            await sess.commit()
            logger.info("seeded_social_keywords", count=len(default_keywords))

        # Seed targets if file exists and table is empty
        targets_file = Path(__file__).parent / "targets.json"
        if targets_file.exists():
            from sqlalchemy import select, func
            count = await sess.execute(select(func.count()).select_from(Target))
            if count.scalar() == 0:
                raw = json.loads(targets_file.read_text())
                for item in raw:
                    sess.add(Target(
                        name=item["name"],
                        known_urls=json.dumps(item.get("known_urls", [])),
                        notes=item.get("notes"),
                    ))
                await sess.commit()
                logger.info("seeded_targets", count=len(raw))


app = FastAPI(
    title="RocheRadar v2",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────
app.include_router(targets.router)
app.include_router(runs.router)
app.include_router(reports.router)
app.include_router(settings_router.router)
app.include_router(agent.router)
app.include_router(discovery_router.router)
app.include_router(social_router.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/api/stats/topics")
async def stats_topics(days: int = 7, disease_area: str | None = None):
    """Return top discussed topics and categories for the dashboard graphs."""
    import math
    from app.database import AsyncSessionLocal
    from app.models import ExtractedInsight, Target, ScrapedPost
    from sqlalchemy import select, desc
    from datetime import datetime, timezone, timedelta
    from collections import Counter

    since = datetime.now(timezone.utc) - timedelta(days=days)
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as sess:
        q = (
            select(ExtractedInsight, Target, ScrapedPost)
            .join(Target, ExtractedInsight.target_id == Target.id)
            .join(ScrapedPost, ExtractedInsight.scraped_post_id == ScrapedPost.id)
            .where(ExtractedInsight.extracted_at >= since)
            .order_by(desc(ExtractedInsight.extracted_at))
        )
        if disease_area and disease_area != "all":
            q = q.where(Target.disease_area == disease_area)
        rows = await sess.execute(q)
        insights = rows.all()

    cat_counts: Counter = Counter()
    topic_counts: Counter = Counter()
    topic_trend: dict[str, float] = {}
    topic_likes: dict[str, int] = {}
    topic_views: dict[str, int] = {}
    topic_urls: dict[str, str] = {}
    sentiment_counts: Counter = Counter({"positive": 0, "neutral": 0, "negative": 0})
    kol_counts: Counter = Counter()

    for ins, target, post in insights:
        cat = (ins.category or "other").replace("_", " ").title()
        cat_counts[cat] += 1
        if ins.topic:
            topic_counts[ins.topic] += 1
            # Recency-weighted trend score (5-day half-life)
            age_days = (now - ins.extracted_at).total_seconds() / 86400
            decay = math.exp(-age_days / 5)
            topic_trend[ins.topic] = topic_trend.get(ins.topic, 0.0) + decay
            topic_likes[ins.topic] = topic_likes.get(ins.topic, 0) + (post.likes or 0)
            topic_views[ins.topic] = topic_views.get(ins.topic, 0) + (post.views or 0)
            if ins.topic not in topic_urls and post.source_url:
                topic_urls[ins.topic] = post.source_url
        sentiment_counts[(ins.sentiment or "neutral").lower()] += 1
        kol_counts[target.name] += 1

    # Combine trend + engagement into final score
    def _score(topic: str) -> float:
        return (
            topic_trend.get(topic, 0.0)
            + topic_likes.get(topic, 0) * 0.001
            + topic_views.get(topic, 0) * 0.0001
        )

    sorted_topics = sorted(topic_counts.keys(), key=_score, reverse=True)[:10]

    return {
        "period_days": days,
        "total": len(insights),
        "categories": [
            {"name": k, "count": v}
            for k, v in cat_counts.most_common(8)
        ],
        "top_topics": [
            {
                "topic": t,
                "count": topic_counts[t],
                "trend_score": round(_score(t), 3),
                "likes": topic_likes.get(t, 0),
                "views": topic_views.get(t, 0),
                "url": topic_urls.get(t),
            }
            for t in sorted_topics
        ],
        "sentiment": [
            {"name": k.capitalize(), "count": v}
            for k, v in sentiment_counts.most_common()
        ],
        "top_kols": [
            {"name": k, "count": v}
            for k, v in kol_counts.most_common(10)
        ],
    }


@app.get("/api/stats")
async def stats():
    from app.database import AsyncSessionLocal
    from app.models import Target, ExtractedInsight, RunLog, RunStatus
    from sqlalchemy import select, func, desc
    from datetime import datetime, timezone

    # Use UTC midnight so insights stored as UTC timestamps are counted correctly
    # regardless of the server's local timezone.
    now_utc = datetime.now(timezone.utc)
    today_start_utc = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)

    async with AsyncSessionLocal() as sess:
        active_targets = await sess.execute(select(func.count()).select_from(Target).where(Target.active == True))
        total_insights = await sess.execute(select(func.count()).select_from(ExtractedInsight))
        today_insights = await sess.execute(
            select(func.count()).select_from(ExtractedInsight)
            .where(ExtractedInsight.extracted_at >= today_start_utc)
        )
        last_run = await sess.execute(
            select(RunLog).order_by(desc(RunLog.started_at)).limit(1)
        )
        last = last_run.scalar_one_or_none()

    return {
        "active_targets": active_targets.scalar(),
        "total_insights": total_insights.scalar(),
        "today_insights": today_insights.scalar(),
        "last_run_at": last.started_at.isoformat() if last else None,
        "last_run_status": last.status if last else None,
    }


# ── SPA fallback ──────────────────────────────────────────
_spa_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
if _spa_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_spa_dir / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # Let real API 404s through — don't swallow them with the SPA shell
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not found")
        index = _spa_dir / "index.html"
        return FileResponse(str(index))
