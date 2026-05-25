# RocheRadar v2 — Session Context

## What this project is
Pharma intelligence platform for Amaury Coumau (Roche, France). Monitors 15 KOLs for Roche mentions → extracts insights via LLM → generates PDFs. Commission: $2,500 build + ~$700-900/month maintenance.

## Stack
| Layer | Tech |
|-------|------|
| Frontend | React + Vite, deployed on Vercel (`rocheradar-prod-v2.vercel.app`) |
| Backend | FastAPI + SQLAlchemy async + Alembic, Railway service `backend` |
| Worker | Celery 5.4 (same codebase, different start cmd), Railway service `worker` |
| DB | Postgres, Railway managed |
| Queue/Cache | Redis, Railway managed |
| PDF storage | Vercel Blob store `rocheradar-pdfs` (`store_LlJX92BMITl4kBOA`), **PUBLIC** access |
| Scraping | TinyFish CLI via subprocess — NEVER use requests/BeautifulSoup |
| Vector DB | ChromaDB, Railway Docker service — currently used for semantic dedup (may be removed) |

## Key URLs
- Frontend: `https://rocheradar-prod-v2.vercel.app`
- Backend: `https://backend-production-384eb.up.railway.app`
- GitHub: `https://github.com/roche-radar/rocheradar-v2` (push as `roche-radar` account, NOT primary)
- Railway project id: `4d97aaaa-fb2e-4f3c-bf6f-a5c842570625`
- Vercel team: `roche-s-projects-radar` (id `team_f1buZfHK54pgzycmqCmp0Scz`)

## Architecture decisions
- **No Celery beat** — runs triggered manually once a week from UI. Don't add scheduled beat.
- **Vercel Blob is PUBLIC** — PDF URLs are directly browser-fetchable, no auth needed.
- **SHA256 content hash** dedup on `scraped_posts.content_hash` (unique constraint = natural dedup).
- **ChromaDB semantic dedup** is in the code but may be removed — it's overkill for 15 KOLs weekly.
- **`acks_late=True`** on all Celery tasks — terminated tasks get requeued, be careful with stop logic.
- **`railway.json`** wraps startCommand in `sh -c "..."` so `$PORT` expands (Railway uses exec, not shell).
- **Alembic** reads DB URL via `get_settings().async_database_url` in `migrations/env.py` (not alembic.ini).

## File layout
```
backend/
  app/
    routers/       # FastAPI endpoints: runs, reports, targets, settings, agent
    services/      # scraper, embedder, deduplicator, pdf_generator, vercel_blob_storage
    tasks/         # Celery tasks: scrape, llm, pdf, embed, scheduler, maintenance
    models/        # SQLAlchemy models: Target, ScrapedPost, ExtractedInsight, PersonSummary, RunLog
    config.py      # Settings via pydantic-settings (reads env vars)
    database.py    # AsyncSession + CelerySessionLocal
  migrations/      # Alembic
  pyproject.toml
frontend/
  src/
    pages/         # Dashboard, Targets, Reports, RunHistory, Agent, Settings
    lib/api.ts     # All API calls
  vercel.json      # SPA rewrite rule (required for React Router)
railway.json       # Per-service start commands
```

## What was built/fixed (sessions up to 2026-05-23)

### Deployment fixes (committed to main)
- `railway.json` — `sh -c` wrapper so `$PORT` expands
- `migrations/env.py` — reads `get_settings().async_database_url` (was connecting to localhost)
- `scraper.py` — `_run_in_thread()` replaces nested `asyncio.run()` calls (fixed event loop crash)
- `frontend/vercel.json` — SPA rewrites rule (was 404 on hard-refresh of any route)
- `agent.py` — `max_tokens` 1024 → 4096 (responses were truncating mid-word)
- `Agent.tsx` — clear chat uses `setQueryData` not `invalidateQueries` (was reverting from cache)
- `vercel_blob_storage.py` — rewritten using `vercel_blob` Python SDK (old code POSTed to wrong API)
- `reports.py` — lists/downloads from Vercel Blob, not local filesystem (backend/worker don't share `/tmp`)

### Features added this session
- `POST /api/runs/reset-all` — clears all operational data (DB tables + Vercel Blob + Chroma)
- Reports page redesign — daily summaries as expandable accordions at top, per-target PDFs below
- Reports page bug fix — eye/download now use direct `pdf.url` (public blob URL), not backend proxy
- Settings page — pipeline status bar at top, polls every 3s when running, shows Stop button

## Open issues
- **NVIDIA NIM 403** — free-tier credits likely exhausted at https://build.nvidia.com/account/credits
- **Chroma `KeyError('_type')`** — Python `chromadb` package version mismatch with server `0.5.23`. Consider removing Chroma entirely (SHA256 dedup is sufficient).
- **Extractor returning empty insights** — possibly Gemini safety filter on pharma content
- **Per-target PDFs unverified** — only `generate_daily_summary_pdf` confirmed working end-to-end
- **Stop Run is soft** — only sets DB flag; Celery tasks keep running until they check `should_stop`

## How to run locally
```bash
# Backend (port 8000)
cd backend && uvicorn app.main:app --reload --port 8000

# Worker
cd backend && celery -A app.tasks.celery_app.celery_app worker --loglevel=info

# Frontend (port 3000 or 5173)
cd frontend && npm install && npm run dev
```

## Aniket's preferences
- Push to prod fast, iterate from Railway/Vercel logs — don't gate on local testing
- Surgical one-concern commits (separate commits for unrelated fixes)
- Terse responses — no end-of-response summaries
- Scraping ALWAYS via TinyFish CLI subprocess, never requests/BeautifulSoup
- He gives credentials in chat — accept, use once, remind to revoke, don't lecture repeatedly
