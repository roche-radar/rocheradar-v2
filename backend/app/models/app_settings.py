from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    """Singleton row (id=1). DB is source of truth for pipeline settings."""
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    # LLM routing
    llm_provider: Mapped[str] = mapped_column(String(64), default="vertex")
    llm_pro_model: Mapped[str] = mapped_column(String(128), default="gemini-2.5-pro")
    llm_flash_model: Mapped[str] = mapped_column(String(128), default="gemini-2.5-flash")

    # Cron
    cron_hour: Mapped[int] = mapped_column(Integer, default=8)
    cron_minute: Mapped[int] = mapped_column(Integer, default=0)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    # Budget limits (overrides env)
    agent_budget_per_run: Mapped[int] = mapped_column(Integer, default=250)
    llm_budget_hard_stop: Mapped[int] = mapped_column(Integer, default=500)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
