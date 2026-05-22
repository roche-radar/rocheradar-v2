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

_settings = get_settings()

# ── Structlog ─────────────────────────────────────────────
structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.dev.ConsoleRenderer() if not _settings.is_production
        else structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        __import__("logging").getLevelName(_settings.log_level)
    ),
    context_class=dict,
    logger_factory=structlog.PrintLoggerFactory(),
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
            sess.add(AppSettings(id=1))
            await sess.commit()
            logger.info("seeded_app_settings")

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
    allow_origins=["*"] if not _settings.is_production else [
        "https://rocheradar.yourdomain.com"
    ],
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


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/api/stats")
async def stats():
    from app.database import AsyncSessionLocal
    from app.models import Target, ExtractedInsight, RunLog, RunStatus
    from sqlalchemy import select, func, desc
    from datetime import date, timedelta

    async with AsyncSessionLocal() as sess:
        active_targets = await sess.execute(select(func.count()).select_from(Target).where(Target.active == True))
        total_insights = await sess.execute(select(func.count()).select_from(ExtractedInsight))
        today_start = date.today()
        today_insights = await sess.execute(
            select(func.count()).select_from(ExtractedInsight)
            .where(ExtractedInsight.extracted_at >= today_start.isoformat())
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
        "last_run_status": last.status.value if last else None,
    }


# ── SPA fallback ──────────────────────────────────────────
_spa_dir = Path(__file__).parent.parent.parent / "frontend" / "dist"
if _spa_dir.exists():
    app.mount("/assets", StaticFiles(directory=str(_spa_dir / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        index = _spa_dir / "index.html"
        return FileResponse(str(index))
