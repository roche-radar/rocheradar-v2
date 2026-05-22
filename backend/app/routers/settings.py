from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppSettings
from app.models.app_settings import PROVIDERS

router = APIRouter(prefix="/api/settings", tags=["settings"])

_SINGLETON_ID = 1


async def _get_or_create(db: AsyncSession) -> AppSettings:
    s = await db.get(AppSettings, _SINGLETON_ID)
    if not s:
        s = AppSettings(id=_SINGLETON_ID)
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return s


# ── Schemas ───────────────────────────────────────────────

class SettingsOut(BaseModel):
    llm_provider: str
    llm_pro_model: str
    llm_flash_model: str
    api_key_set: bool           # never expose the actual key
    ollama_base_url: str
    nvidia_base_url: str
    custom_base_url: str | None
    cron_hour: int
    cron_minute: int
    cron_enabled: bool
    agent_budget_per_run: int
    llm_budget_hard_stop: int
    available_providers: dict[str, str]


class SettingsUpdate(BaseModel):
    llm_provider: str | None = None
    llm_pro_model: str | None = None
    llm_flash_model: str | None = None
    api_key: str | None = None          # empty string = clear key
    ollama_base_url: str | None = None
    nvidia_base_url: str | None = None
    custom_base_url: str | None = None
    cron_hour: int | None = None
    cron_minute: int | None = None
    cron_enabled: bool | None = None
    agent_budget_per_run: int | None = None
    llm_budget_hard_stop: int | None = None


class TestConnectionRequest(BaseModel):
    provider: str | None = None    # if None, use current DB provider
    api_key: str | None = None
    model: str | None = None


def _to_out(s: AppSettings) -> SettingsOut:
    return SettingsOut(
        llm_provider=s.llm_provider,
        llm_pro_model=s.llm_pro_model,
        llm_flash_model=s.llm_flash_model,
        api_key_set=bool(s.api_key),
        ollama_base_url=s.ollama_base_url or "http://localhost:11434",
        nvidia_base_url=s.nvidia_base_url or "https://integrate.api.nvidia.com/v1",
        custom_base_url=s.custom_base_url,
        cron_hour=s.cron_hour,
        cron_minute=s.cron_minute,
        cron_enabled=s.cron_enabled,
        agent_budget_per_run=s.agent_budget_per_run,
        llm_budget_hard_stop=s.llm_budget_hard_stop,
        available_providers=PROVIDERS,
    )


# ── Endpoints ─────────────────────────────────────────────

@router.get("/", response_model=SettingsOut)
async def get_settings(db: AsyncSession = Depends(get_db)):
    s = await _get_or_create(db)
    return _to_out(s)


@router.post("/", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    s = await _get_or_create(db)
    data = body.model_dump(exclude_none=True)

    # Special-case api_key: empty string clears it
    if "api_key" in data:
        s.api_key = data.pop("api_key") or None
    for field, value in data.items():
        setattr(s, field, value)

    await db.commit()
    await db.refresh(s)
    return _to_out(s)


@router.get("/providers")
async def list_providers():
    return {"providers": PROVIDERS}


@router.post("/models")
async def fetch_models(body: TestConnectionRequest, db: AsyncSession = Depends(get_db)):
    """Return available model IDs for the given (or current) provider."""
    from app.services.llm_router import list_models

    s = await _get_or_create(db)
    provider = body.provider or s.llm_provider
    api_key = body.api_key or s.api_key
    models = list_models(provider=provider, api_key=api_key, settings_row=s)
    return {"provider": provider, "models": models}


@router.post("/test-connection")
async def test_connection(body: TestConnectionRequest, db: AsyncSession = Depends(get_db)):
    """Ping the LLM provider to verify credentials."""
    from app.services.llm_router import test_connection as _test

    s = await _get_or_create(db)
    provider = body.provider or s.llm_provider
    api_key = body.api_key or s.api_key
    model = body.model or s.llm_pro_model
    result = _test(provider=provider, api_key=api_key, model=model, settings_row=s)
    if not result["ok"]:
        raise HTTPException(status_code=502, detail=result.get("error", "Connection failed"))
    return {"ok": True, "provider": provider, "model": model}
