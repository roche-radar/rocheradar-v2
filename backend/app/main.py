import logging
import structlog
from contextlib import asynccontextmanager

from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

from sqlalchemy import text
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
        # Enable pgvector if available — silently skip if not installed locally
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception:
            pass
        try:
            await conn.run_sync(Base.metadata.create_all)
        except Exception as _e:
            if "vector" in str(_e).lower():
                logger.warning("startup.create_all_skipped_vector_missing",
                               hint="Install pgvector or run against Railway DB")
            else:
                raise
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
                # Roche France + global
                "https://www.facebook.com/roche",
                "https://www.facebook.com/RocheFrance",
                # French pharma & health institutions
                "https://www.facebook.com/sanofi",
                "https://www.facebook.com/INCa.Institut.National.Cancer",  # Institut National du Cancer
                "https://www.facebook.com/liguecancerfrance",               # Ligue contre le cancer
                "https://www.facebook.com/fondationARC",                    # ARC cancer research
                "https://www.facebook.com/unicancer.fr",                    # Unicancer
                "https://www.facebook.com/inserm.fr",                       # INSERM
                "https://www.facebook.com/has.sante",                       # HAS (French health authority)
                "https://www.facebook.com/ansm.sante.fr",                   # ANSM (French medicines agency)
                # French patient communities
                "https://www.facebook.com/RespirEspoir",                    # Lung cancer France
                "https://www.facebook.com/Cancer.Info.Service",
                # Global pharma (for competitive intelligence)
                "https://www.facebook.com/AstraZenecaGlobal",
                "https://www.facebook.com/BristolMyersSquibb",
                "https://www.facebook.com/merck",
                "https://www.facebook.com/LillyOncology",
                # Oncology congresses
                "https://www.facebook.com/ASCO.org",
                "https://www.facebook.com/esmo.oncology",
                # WHO / global health
                "https://www.facebook.com/WHO",
            ]
            s.facebook_page_urls = json.dumps(default_fb_pages)
            await sess.commit()
            logger.info("seeded_facebook_page_urls", count=len(default_fb_pages))

        # Seed a starter social-scan keyword list if none set yet
        if s and not s.social_keywords:
            default_keywords = [
                # Roche / Genentech brands
                # Roche brand & drug names (universal — no translation needed)
                "Tecentriq", "Ocrevus", "Hemlibra", "Kadcyla", "Perjeta",
                "Avastin", "Herceptin", "Polivy", "Lunsumio", "Roche", "Genentech",
                "RocheFrance",
                # Competitor drugs
                "Keytruda", "Opdivo", "Imfinzi", "Libtayo",
                # ── FRENCH oncology disease keywords (hashtag-safe, no spaces) ──
                "cancerdusein", "cancerdupoumon", "cancercolorectal",
                "cancerovaire", "cancerprostate", "leucémie", "lymphome",
                "myélome", "mélanome", "tumeur", "métastase",
                # French treatments / research
                "immunothérapie", "chimiothérapie", "essaiclinique",
                "rechercheclinique", "rechercheencancérologie", "biomarqueurs",
                "médecinepersonnalisée", "thérapieciblée", "oncologie",
                # French patient communities
                "luttecontrelecancer", "patientsexperts", "cancersurvivants",
                "octobrerose", "marsbleu", "vaincrelecancer",
                # French congresses / institutions
                "ASCO2026", "ESMO2026", "INCa", "ligueducancer",
                "fondationARC", "unicancer", "InsermFrance",
                # English oncology fallbacks (some French KOLs post in English)
                "lungcancer", "NSCLC", "breastcancer", "immunotherapy",
                "clinicaltrial", "biomarker", "patientadvocacy",
                # Neurology / rare disease (French)
                "scléroseenplaques", "maladieraresfrance", "hémophilie",
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


def _extract_brief_strings(raw: str) -> list[str]:
    """Extract quoted sentences from LLM response even if array is truncated."""
    import re as _re
    strings = _re.findall(r'"((?:[^"\\]|\\.)+[.!?])"', raw)
    if not strings:
        strings = [s for s in _re.findall(r'"((?:[^"\\]|\\.){20,})"', raw) if not s.startswith("http")]
    return strings


def _brief_priority(s: str) -> str:
    roche_terms = {"roche","tecentriq","atezolizumab","alecensa","alectinib","perjeta","herceptin","avastin","kadcyla","polivy","hemlibra","ocrevus","vabysmo"}
    flags = ["competitor","unmet","concern","critical","negative","threat","gap","emerging"]
    return "high" if any(t in s.lower() for t in roche_terms) or any(w in s.lower() for w in flags) else "medium"


@app.get("/api/stats/daily-brief")
async def daily_brief(refresh: bool = False):
    """Combined KOL + Social brief — 6-month data window. Cached 6h."""
    import json as _json, re as _re
    from datetime import datetime, timezone, timedelta

    _KEY = "combined_brief:v3"
    r = None
    try:
        import redis as _redis
        from app.config import get_settings as _gs
        r = _redis.Redis.from_url(_gs().redis_url, socket_timeout=2)
        if not refresh:
            cached = r.get(_KEY)
            if cached:
                return _json.loads(cached)
        else:
            r.delete(_KEY)
    except Exception:
        r = None

    from app.database import AsyncSessionLocal
    from app.models import ExtractedInsight, Target, SocialPost
    from sqlalchemy import select, desc

    now = datetime.now(timezone.utc)
    six_months = now - timedelta(days=180)

    async with AsyncSessionLocal() as sess:
        ins_rows = await sess.execute(
            select(ExtractedInsight, Target.name)
            .join(Target, ExtractedInsight.target_id == Target.id)
            .where(ExtractedInsight.extracted_at >= six_months)
            .order_by(desc(ExtractedInsight.extracted_at))
            .limit(60)
        )
        insights = ins_rows.all()

        social_rows = await sess.execute(
            select(SocialPost)
            .where(SocialPost.scraped_at >= six_months)
            .order_by(desc(SocialPost.likes + SocialPost.comments * 2))
            .limit(20)
        )
        social_posts = social_rows.scalars().all()

    if not insights and not social_posts:
        return {"points": [], "generated_at": None, "cached": False, "kol_count": 0, "social_count": 0, "error": None}

    insights_text = "\n".join(
        f"- KOL:{name} | topic:{ins.topic} | sentiment:{ins.sentiment or 'neutral'} | said:\"{(ins.what_they_said or '')[:200]}\""
        for ins, name in insights
    ) or "No KOL insights."

    social_text = "\n".join(
        f"- [{p.platform},{p.likes}likes] topic:{p.topic} | \"{(p.text or '')[:120]}\""
        for p in social_posts
    ) or "No social posts."

    from app.services.llm_router import call_pro
    import structlog as _sl
    _log = _sl.get_logger("combined_brief")

    prompt = (
        "You are a senior pharma intelligence analyst for Roche's oncology strategy team.\n\n"
        "Below are real KOL statements and top social media posts from the last 6 months.\n"
        "Generate 5 sharp, SPECIFIC intelligence points combining both KOL and social signals.\n\n"
        "Rules:\n"
        "- Mention actual drug names, KOL names, or specific data when available\n"
        "- Each point must be actionable: what should Roche watch, do, or address?\n"
        "- Flag competitive threats or unmet needs explicitly\n"
        "- Do NOT write generic statements — trace every point back to the data\n"
        "- Each point max 30 words\n\n"
        f"KOL STATEMENTS ({len(insights)}):\n{insights_text}\n\n"
        f"TOP SOCIAL POSTS ({len(social_posts)}):\n{social_text}\n\n"
        "Return ONLY a JSON array of 5 strings. No markdown:\n"
        '["point 1", "point 2", "point 3", "point 4", "point 5"]'
    )

    llm_error = None
    points = []
    try:
        raw = call_pro([{"role": "user", "content": prompt}], max_tokens=2048)
        _log.info("combined_brief.llm_raw", raw=raw[:400])
        strings = _extract_brief_strings(raw)
        points = [{"text": s, "source": "both", "priority": _brief_priority(s)} for s in strings[:7]]
        if not points:
            llm_error = f"No strings extracted: {raw[:200]}"
    except Exception as exc:
        llm_error = str(exc)[:300]
        _log.warning("combined_brief.failed", exc=llm_error)

    result = {
        "points": points,
        "generated_at": now.isoformat(),
        "cached": False,
        "kol_count": len(insights),
        "social_count": len(social_posts),
        "error": llm_error,
    }

    # Only cache if we got actual points
    try:
        if r and points:
            r.set(_BRIEF_KEY, _json.dumps(result), ex=21600)
    except Exception:
        pass

    return result


class BriefDetailRequest(BaseModel):
    point: str


@app.post("/api/stats/brief-detail")
async def brief_detail(body: BriefDetailRequest):
    """Expand a brief point into full detail: KOL evidence, social evidence, so-what, links."""
    from datetime import datetime, timezone, timedelta
    import json as _json

    point_text = body.point.strip()
    if not point_text:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="point required")

    from app.database import AsyncSessionLocal
    from app.models import ExtractedInsight, Target, SocialPost
    from app.models.discovery_result import DiscoveryResult
    from sqlalchemy import select, desc, or_, func

    # Extract keywords from the point (words > 4 chars)
    import re as _re
    keywords = [w.lower() for w in _re.findall(r'\b[a-zA-Z]{4,}\b', point_text)][:8]

    async with AsyncSessionLocal() as sess:
        # Find matching KOL insights
        kol_rows = await sess.execute(
            select(ExtractedInsight, Target.name)
            .join(Target, ExtractedInsight.target_id == Target.id)
            .where(or_(
                *[func.lower(ExtractedInsight.topic).contains(kw) for kw in keywords[:4]],
                *[func.lower(ExtractedInsight.what_they_said).contains(kw) for kw in keywords[:4]],
            ))
            .order_by(desc(ExtractedInsight.extracted_at))
            .limit(8)
        )
        kol_insights = kol_rows.all()

        # Find matching social posts
        social_rows = await sess.execute(
            select(SocialPost)
            .where(or_(
                *[func.lower(SocialPost.text).contains(kw) for kw in keywords[:4]],
                *[func.lower(SocialPost.topic).contains(kw) for kw in keywords[:4]],
            ))
            .order_by(desc(SocialPost.likes + SocialPost.comments * 2))
            .limit(6)
        )
        social_posts = social_rows.scalars().all()

        # Find relevant discovery links
        link_rows = await sess.execute(
            select(DiscoveryResult.url, DiscoveryResult.title, DiscoveryResult.source_name)
            .where(or_(
                *[func.lower(DiscoveryResult.snippet).contains(kw) for kw in keywords[:3]],
                *[func.lower(DiscoveryResult.title).contains(kw) for kw in keywords[:3]],
            ))
            .order_by(desc(DiscoveryResult.scraped_at))
            .limit(5)
        )
        links = [{"url": r.url, "title": r.title or r.source_name or r.url} for r in link_rows]

    kol_text = "\n".join(
        f"- {name} ({ins.sentiment or 'neutral'}): {(ins.what_they_said or '')[:200]}"
        for ins, name in kol_insights
    ) or "No matching KOL insights."

    social_text = "\n".join(
        f"- [{p.platform}, {p.likes}likes] {(p.text or '')[:150]}"
        for p in social_posts
    ) or "No matching social posts."

    from app.services.llm_router import call_pro
    import re as _re2

    def _extract_sec(text: str, marker: str) -> str:
        m = _re2.search(rf'##{marker}##\s*(.*?)(?=##[A-Z_]+##|$)', text, _re2.DOTALL | _re2.IGNORECASE)
        return m.group(1).strip() if m else ""

    prompt = (
        f"You are a pharma intelligence analyst for Roche.\n\n"
        f"INTELLIGENCE POINT: {point_text}\n\n"
        f"KOL EVIDENCE:\n{kol_text}\n\n"
        f"SOCIAL EVIDENCE:\n{social_text}\n\n"
        "Write a detailed pharma intelligence briefing using EXACTLY these section markers:\n\n"
        "##SUMMARY##\n"
        "Write 5-15 sentences: what KOLs said, which drugs/trials are involved, sentiment, "
        "supporting social signals, and any competitive implications.\n\n"
        "##SO_WHAT##\n"
        "Write 3-5 sentences: specific impact on Roche — pipeline, competitive position, "
        "strategic opportunity or threat.\n\n"
        "##ACTION##\n"
        "Write 2-3 concrete actions Roche should take with timelines."
    )

    detail = {}
    try:
        raw = call_pro([{"role": "user", "content": prompt}], max_tokens=3000)
        detail = {
            "summary": _extract_sec(raw, "SUMMARY") or point_text,
            "so_what": _extract_sec(raw, "SO_WHAT"),
            "action":  _extract_sec(raw, "ACTION"),
        }
    except Exception as exc:
        detail = {"summary": point_text, "so_what": "", "action": ""}

    return {
        "point": point_text,
        "summary": detail.get("summary", point_text),
        "so_what": detail.get("so_what", ""),
        "action": detail.get("action", ""),
        "kol_insights": [
            {"kol": name, "topic": ins.topic, "said": (ins.what_they_said or "")[:300], "sentiment": ins.sentiment}
            for ins, name in kol_insights
        ],
        "social_posts": [
            {"platform": p.platform, "text": (p.text or "")[:200], "likes": p.likes, "url": p.post_url}
            for p in social_posts
        ],
        "links": links,
    }


@app.get("/api/stats/social-brief")
async def social_brief(refresh: bool = False):
    """Sector-grouped social trends brief — 200 posts, 6-month window."""
    import json as _json, re as _re
    from datetime import datetime, timezone, timedelta
    from collections import defaultdict

    _KEY = "social_brief:v3"
    r = None
    try:
        import redis as _redis
        from app.config import get_settings as _gs
        r = _redis.Redis.from_url(_gs().redis_url, socket_timeout=2)
        if not refresh:
            cached = r.get(_KEY)
            if cached:
                return _json.loads(cached)
        else:
            r.delete(_KEY)
    except Exception:
        r = None

    from app.database import AsyncSessionLocal
    from app.models import SocialPost
    from sqlalchemy import select, desc

    now = datetime.now(timezone.utc)
    six_months = now - timedelta(days=180)

    async with AsyncSessionLocal() as sess:
        rows = await sess.execute(
            select(SocialPost)
            .where(SocialPost.scraped_at >= six_months)
            .order_by(desc(SocialPost.likes + SocialPost.comments * 2 + SocialPost.shares * 1.5))
            .limit(200)
        )
        posts = rows.scalars().all()

    if not posts:
        return {"sections": [], "total_posts": 0, "generated_at": None, "cached": False, "error": None}

    # Build topic engagement stats
    topic_stats: dict = defaultdict(lambda: {"count": 0, "likes": 0, "comments": 0, "platforms": set()})
    for p in posts:
        t = p.topic or p.query or "other"
        topic_stats[t]["count"] += 1
        topic_stats[t]["likes"] += p.likes or 0
        topic_stats[t]["comments"] += p.comments or 0
        topic_stats[t]["platforms"].add(p.platform)

    top_topics = sorted(topic_stats.items(), key=lambda x: x[1]["likes"] + x[1]["comments"] * 2, reverse=True)[:12]
    topics_detail = "\n".join(
        f"- topic:{t} | posts:{s['count']} | likes:{s['likes']} | comments:{s['comments']} | platforms:{','.join(s['platforms'])}"
        for t, s in top_topics
    )

    # Sample posts per top topic
    topic_set = {t for t, _ in top_topics}
    posts_sample = "\n".join(
        f"- [{p.platform},{p.likes}♥,{p.comments}💬] topic:{p.topic or p.query} | \"{(p.text or '')[:180]}\""
        for p in posts[:80] if (p.topic or p.query) in topic_set
    )

    from app.services.llm_router import call_pro
    import structlog as _sl
    _log = _sl.get_logger("social_brief")

    prompt = (
        "You are a senior pharma social media intelligence analyst for Roche.\n\n"
        f"Analyzed {len(posts)} posts from Instagram, X, LinkedIn, Facebook over 6 months.\n\n"
        f"TOP TOPICS BY ENGAGEMENT:\n{topics_detail}\n\n"
        f"SAMPLE POSTS:\n{posts_sample}\n\n"
        "Generate a structured intelligence report organized into 4-5 SECTORS "
        "(e.g. 'Oncology Treatments', 'Clinical Trials & Data', 'Competitive Landscape', "
        "'Patient Community', 'Regulatory & Policy', 'Conferences & Events').\n\n"
        "For each sector provide 2-3 specific intelligence points.\n"
        "Rules:\n"
        "- Reference actual drug names, hashtags, or platforms from the data\n"
        "- Each point must be actionable for Roche: what to monitor, respond to, or leverage\n"
        "- Flag engagement spikes, sentiment shifts, or emerging competitor mentions\n"
        "- Each point max 35 words\n\n"
        "Return ONLY this JSON structure, no markdown:\n"
        '{"sections": [{"sector": "sector name", "key_signal": "one-line summary", '
        '"points": ["point 1", "point 2", "point 3"]}]}'
    )

    llm_error = None
    sections = []
    try:
        raw = call_pro([{"role": "user", "content": prompt}], max_tokens=3000)
        _log.info("social_brief.llm_raw", raw=raw[:500])
        raw_clean = _re.sub(r'```(?:json)?\s*|\s*```', '', raw).strip()
        m = _re.search(r'\{.*\}', raw_clean, _re.DOTALL)
        if m:
            parsed = _json.loads(m.group(0))
            raw_sections = parsed.get("sections", [])
            for sec in raw_sections:
                pts = sec.get("points", [])
                sections.append({
                    "sector": sec.get("sector", "General"),
                    "key_signal": sec.get("key_signal", ""),
                    "points": [{"text": p, "source": "social", "priority": _brief_priority(p)} for p in pts if isinstance(p, str)],
                })
        if not sections:
            # Fallback: extract strings
            strings = _extract_brief_strings(raw)
            if strings:
                sections = [{"sector": "Social Trends", "key_signal": "", "points": [{"text": s, "source": "social", "priority": "medium"} for s in strings[:10]]}]
            else:
                llm_error = f"Parse failed: {raw[:200]}"
    except Exception as exc:
        llm_error = str(exc)[:300]
        _log.warning("social_brief.failed", exc=llm_error)

    result = {
        "sections": sections,
        "points": [p for sec in sections for p in sec["points"]],  # flat list for compatibility
        "total_posts": len(posts),
        "top_topics": [{"topic": t, "count": s["count"], "engagement": s["likes"] + s["comments"] * 2} for t, s in top_topics[:8]],
        "generated_at": now.isoformat(),
        "cached": False,
        "error": llm_error,
    }
    try:
        if r and sections:
            r.set(_KEY, _json.dumps(result), ex=21600)
    except Exception:
        pass
    return result


@app.get("/api/stats/kol-brief")
async def kol_brief(refresh: bool = False):
    """KOL-only brief — 6-month insights window. Cached 6h."""
    import json as _json, re as _re
    from datetime import datetime, timezone, timedelta

    _KEY = "kol_brief:v3"
    r = None
    try:
        import redis as _redis
        from app.config import get_settings as _gs
        r = _redis.Redis.from_url(_gs().redis_url, socket_timeout=2)
        if not refresh:
            cached = r.get(_KEY)
            if cached:
                return _json.loads(cached)
        else:
            r.delete(_KEY)
    except Exception:
        r = None

    from app.database import AsyncSessionLocal
    from app.models import ExtractedInsight, Target
    from sqlalchemy import select, desc

    now = datetime.now(timezone.utc)
    six_months = now - timedelta(days=180)

    async with AsyncSessionLocal() as sess:
        ins_rows = await sess.execute(
            select(ExtractedInsight, Target.name)
            .join(Target, ExtractedInsight.target_id == Target.id)
            .where(ExtractedInsight.extracted_at >= six_months)
            .order_by(desc(ExtractedInsight.extracted_at))
            .limit(60)
        )
        insights = ins_rows.all()

    if not insights:
        return {"points": [], "generated_at": None, "cached": False, "kol_count": 0, "social_count": 0, "error": None}

    insights_text = "\n".join(
        f"- KOL:{name} | topic:{ins.topic} | sentiment:{ins.sentiment or 'neutral'} | category:{ins.category or ''} | said:\"{(ins.what_they_said or '')[:200]}\""
        for ins, name in insights
    )

    from app.services.llm_router import call_pro
    import structlog as _sl
    _log = _sl.get_logger("kol_brief")

    prompt = (
        "You are a senior pharma intelligence analyst for Roche's oncology strategy team.\n\n"
        f"Below are {len(insights)} real KOL statements from the last 6 months.\n"
        "Generate 5 sharp, SPECIFIC intelligence points based ONLY on what these KOLs said.\n\n"
        "Rules:\n"
        "- Quote actual KOL names and drug names from the data\n"
        "- Every point must be actionable for Roche's strategy\n"
        "- Flag competitive threats, unmet needs, or sentiment shifts explicitly\n"
        "- Do NOT write generic statements — trace every point back to a specific KOL\n"
        "- Each point max 30 words\n\n"
        f"KOL STATEMENTS:\n{insights_text}\n\n"
        "Return ONLY a JSON array of 5 strings. No markdown:\n"
        '["point 1", "point 2", "point 3", "point 4", "point 5"]'
    )

    llm_error = None
    points = []
    try:
        raw = call_pro([{"role": "user", "content": prompt}], max_tokens=2048)
        _log.info("kol_brief.llm_raw", raw=raw[:400])
        strings = _extract_brief_strings(raw)
        points = [{"text": s, "source": "kol", "priority": _brief_priority(s)} for s in strings[:7]]
        if not points:
            llm_error = f"No strings extracted: {raw[:200]}"
    except Exception as exc:
        llm_error = str(exc)[:300]
        _log.warning("kol_brief.failed", exc=llm_error)

    result = {
        "points": points,
        "generated_at": now.isoformat(),
        "cached": False,
        "kol_count": len(insights),
        "social_count": 0,
        "error": llm_error,
    }
    try:
        if r and points:
            r.set(_KEY, _json.dumps(result), ex=21600)
    except Exception:
        pass
    return result


@app.get("/api/stats/comparison-brief")
async def comparison_brief(refresh: bool = False):
    """Compare KOL signals vs social trends — alignment, gaps, strategic implications."""
    import json as _json, re as _re
    from datetime import datetime, timezone, timedelta

    _KEY = "comparison_brief:v1"
    r = None
    try:
        import redis as _redis
        from app.config import get_settings as _gs
        r = _redis.Redis.from_url(_gs().redis_url, socket_timeout=2)
        if not refresh:
            cached = r.get(_KEY)
            if cached:
                return _json.loads(cached)
        else:
            r.delete(_KEY)
    except Exception:
        r = None

    from app.database import AsyncSessionLocal
    from app.models import ExtractedInsight, Target, SocialPost
    from sqlalchemy import select, desc

    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as sess:
        ins_rows = await sess.execute(
            select(ExtractedInsight, Target.name)
            .join(Target, ExtractedInsight.target_id == Target.id)
            .order_by(desc(ExtractedInsight.extracted_at))
            .limit(30)
        )
        insights = ins_rows.all()

        social_rows = await sess.execute(
            select(SocialPost)
            .where(SocialPost.scraped_at >= now - timedelta(days=30))
            .order_by(desc(SocialPost.likes + SocialPost.comments * 2))
            .limit(20)
        )
        social_posts = social_rows.scalars().all()

    if not insights and not social_posts:
        return {"points": [], "generated_at": None, "cached": False, "kol_count": 0, "social_count": 0, "error": None}

    kol_text = "\n".join(
        f"- {name}: topic={ins.topic}, sentiment={ins.sentiment or 'neutral'}, \"{(ins.what_they_said or '')[:150]}\""
        for ins, name in insights
    ) or "No KOL data."

    social_text = "\n".join(
        f"- [{p.platform},{p.likes}likes] topic={p.topic}, \"{(p.text or '')[:120]}\""
        for p in social_posts
    ) or "No social data."

    from app.services.llm_router import call_pro
    import structlog as _sl
    _log = _sl.get_logger("comparison_brief")

    prompt = (
        "You are a senior pharma intelligence analyst for Roche.\n\n"
        "Compare what KOLs (Key Opinion Leaders) are saying vs what is trending on social media.\n"
        "Generate 5 comparison intelligence points for Roche's strategy team.\n\n"
        "Focus on:\n"
        "- Topics where KOL views ALIGN with social trends (validation signal)\n"
        "- Topics where KOLs discuss something NOT yet trending socially (early signal)\n"
        "- Topics trending socially that KOLs have NOT addressed (gap or emerging issue)\n"
        "- Sentiment differences between KOLs and public social discourse\n"
        "- What Roche should prioritize given both signals together\n\n"
        "Each point max 30 words. Mention specific drugs, topics, or KOL names.\n\n"
        f"KOL INSIGHTS ({len(insights)}):\n{kol_text}\n\n"
        f"SOCIAL TRENDS ({len(social_posts)} posts):\n{social_text}\n\n"
        "Return ONLY a JSON array of 5 strings:\n"
        '["point 1", "point 2", "point 3", "point 4", "point 5"]'
    )

    llm_error = None
    points = []
    try:
        raw = call_pro([{"role": "user", "content": prompt}], max_tokens=2048)
        _log.info("comparison_brief.llm_raw", raw=raw[:400])
        strings = _re.findall(r'"((?:[^"\\]|\\.)+[.!?])"', raw)
        if not strings:
            strings = [s for s in _re.findall(r'"((?:[^"\\]|\\.){20,})"', raw) if not s.startswith("http")]
        points = [{"text": s, "source": "both", "priority": "high"} for s in strings[:7]]
        if not points:
            llm_error = f"No strings extracted: {raw[:200]}"
    except Exception as exc:
        llm_error = str(exc)[:300]
        _log.warning("comparison_brief.llm_failed", exc=llm_error)

    result = {
        "points": points,
        "generated_at": now.isoformat(),
        "cached": False,
        "kol_count": len(insights),
        "social_count": len(social_posts),
        "error": llm_error,
    }
    try:
        if r and points:
            r.set(_KEY, _json.dumps(result), ex=21600)
    except Exception:
        pass
    return result


class SocialDetailRequest(BaseModel):
    point: str


@app.post("/api/stats/social-detail")
async def social_detail(body: SocialDetailRequest):
    """Deep-dive on a social trend point — engagement stats, platform breakdown, pharma so-what."""
    import json as _json, re as _re
    from collections import defaultdict

    point_text = body.point.strip()
    keywords = [w.lower() for w in _re.findall(r'\b[a-zA-Z]{4,}\b', point_text)][:6]

    from app.database import AsyncSessionLocal
    from app.models import SocialPost
    from sqlalchemy import select, desc, or_, func as _func

    async with AsyncSessionLocal() as sess:
        rows = await sess.execute(
            select(SocialPost)
            .where(or_(
                *[_func.lower(SocialPost.text).contains(kw) for kw in keywords[:4]],
                *[_func.lower(SocialPost.topic).contains(kw) for kw in keywords[:3]],
            ))
            .order_by(desc(SocialPost.likes + SocialPost.comments * 2))
            .limit(20)
        )
        posts = rows.scalars().all()

    platform_stats: dict = defaultdict(lambda: {"count": 0, "likes": 0, "comments": 0})
    for p in posts:
        platform_stats[p.platform]["count"] += 1
        platform_stats[p.platform]["likes"] += p.likes or 0
        platform_stats[p.platform]["comments"] += p.comments or 0

    total_likes = sum(p.likes or 0 for p in posts)
    total_comments = sum(p.comments or 0 for p in posts)

    posts_text = "\n".join(
        f"- [{p.platform},{p.likes}♥,{p.comments}💬] \"{(p.text or '')[:220]}\" url:{p.post_url}"
        for p in posts[:12]
    ) or "No matching posts found."

    from app.services.llm_router import call_pro

    def _extract_section(text: str, marker: str) -> str:
        """Extract content between ##MARKER## and next ## or end."""
        m = _re.search(rf'##{marker}##\s*(.*?)(?=##[A-Z_]+##|$)', text, _re.DOTALL | _re.IGNORECASE)
        return m.group(1).strip() if m else ""

    prompt = (
        f"You are a senior pharma intelligence analyst for Roche.\n\n"
        f"SOCIAL TREND: {point_text}\n\n"
        f"MATCHING POSTS ({len(posts)} posts, {total_likes} total likes, {total_comments} comments):\n{posts_text}\n\n"
        "Write a detailed pharma intelligence briefing using EXACTLY these section markers:\n\n"
        "##SUMMARY##\n"
        "Write 5-15 sentences covering: what this trend is, who is posting about it, which drugs/hashtags/platforms are involved, engagement patterns, sentiment, and any competitive signals from the posts.\n\n"
        "##SO_WHAT##\n"
        "Write 3-5 sentences: specific implications for Roche — which pipeline products are affected, competitive threats, patient demand signals, partnership opportunities, or areas to monitor.\n\n"
        "##ACTION##\n"
        "Write 2-3 concrete actions Roche should take, with suggested timelines.\n\n"
        "##URGENCY##\n"
        "Write one word only: high, medium, or low\n\n"
        "##HASHTAGS##\n"
        "List the top 3-5 hashtags from the posts, comma separated."
    )

    detail: dict = {}
    try:
        raw = call_pro([{"role": "user", "content": prompt}], max_tokens=3000)
        detail = {
            "summary":  _extract_section(raw, "SUMMARY") or point_text,
            "so_what":  _extract_section(raw, "SO_WHAT"),
            "action":   _extract_section(raw, "ACTION"),
            "urgency":  _extract_section(raw, "URGENCY").lower().strip().split()[0] if _extract_section(raw, "URGENCY") else "medium",
            "hashtags": [h.strip().lstrip("#") for h in _extract_section(raw, "HASHTAGS").split(",") if h.strip()],
        }
    except Exception as exc:
        detail = {"summary": point_text, "so_what": "", "action": "", "urgency": "medium", "hashtags": []}

    return {
        "point": point_text,
        "summary": detail.get("summary", point_text),
        "so_what": detail.get("so_what", ""),
        "action": detail.get("action", ""),
        "urgency": detail.get("urgency", "medium"),
        "hashtags": detail.get("hashtags", []),
        "total_likes": total_likes,
        "total_comments": total_comments,
        "platform_stats": dict(platform_stats),
        "posts": [
            {"platform": p.platform, "text": (p.text or "")[:250], "likes": p.likes or 0,
             "comments": p.comments or 0, "shares": p.shares or 0, "url": p.post_url,
             "topic": p.topic or p.query, "posted_at": p.posted_at.isoformat() if p.posted_at else None}
            for p in posts[:10]
        ],
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
