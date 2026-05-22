from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AppSettings

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


class SettingsOut(BaseModel):
    llm_provider: str
    llm_pro_model: str
    llm_flash_model: str
    cron_hour: int
    cron_minute: int
    cron_enabled: bool
    agent_budget_per_run: int
    llm_budget_hard_stop: int


class SettingsUpdate(BaseModel):
    llm_provider: str | None = None
    llm_pro_model: str | None = None
    llm_flash_model: str | None = None
    cron_hour: int | None = None
    cron_minute: int | None = None
    cron_enabled: bool | None = None
    agent_budget_per_run: int | None = None
    llm_budget_hard_stop: int | None = None


@router.get("/", response_model=SettingsOut)
async def get_settings_endpoint(db: AsyncSession = Depends(get_db)):
    s = await _get_or_create(db)
    return SettingsOut(
        llm_provider=s.llm_provider,
        llm_pro_model=s.llm_pro_model,
        llm_flash_model=s.llm_flash_model,
        cron_hour=s.cron_hour,
        cron_minute=s.cron_minute,
        cron_enabled=s.cron_enabled,
        agent_budget_per_run=s.agent_budget_per_run,
        llm_budget_hard_stop=s.llm_budget_hard_stop,
    )


@router.post("/", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    s = await _get_or_create(db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(s, field, value)
    await db.commit()
    await db.refresh(s)
    return SettingsOut(
        llm_provider=s.llm_provider,
        llm_pro_model=s.llm_pro_model,
        llm_flash_model=s.llm_flash_model,
        cron_hour=s.cron_hour,
        cron_minute=s.cron_minute,
        cron_enabled=s.cron_enabled,
        agent_budget_per_run=s.agent_budget_per_run,
        llm_budget_hard_stop=s.llm_budget_hard_stop,
    )
