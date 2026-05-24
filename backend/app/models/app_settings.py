from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

PROVIDERS = {
    "vertex":     "Vertex AI (Gemini)",
    "openrouter": "OpenRouter",
    "ollama":     "Ollama (Local)",
    "nvidia":     "NVIDIA NIM",
    "anthropic":  "Anthropic (Claude)",
    "openai":     "OpenAI",
    "gemini":     "Google AI Studio",
}


class AppSettings(Base):
    """Singleton row (id=1). DB is source of truth for pipeline settings."""
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)

    # LLM routing
    llm_provider: Mapped[str] = mapped_column(String(64), default="gemini")
    llm_model: Mapped[str] = mapped_column(String(128), default="gemini-2.5-flash")

    # Provider API key (stored in DB; env var is fallback if empty)
    api_key: Mapped[str | None] = mapped_column(String(512))

    # Provider-specific endpoints
    ollama_base_url: Mapped[str] = mapped_column(String(256), default="http://localhost:11434")
    nvidia_base_url: Mapped[str] = mapped_column(String(256), default="https://integrate.api.nvidia.com/v1")
    custom_base_url: Mapped[str | None] = mapped_column(String(256))

    # Cron — schedule (weekly or daily)
    cron_hour: Mapped[int] = mapped_column(Integer, default=8)
    cron_minute: Mapped[int] = mapped_column(Integer, default=0)
    cron_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    cron_frequency: Mapped[str] = mapped_column(String(16), default="weekly")   # "daily" | "weekly"
    cron_day_of_week: Mapped[int] = mapped_column(Integer, default=1)           # 0=Mon … 6=Sun

    # Budget limits
    agent_budget_per_run: Mapped[int] = mapped_column(Integer, default=250)
    llm_budget_hard_stop: Mapped[int] = mapped_column(Integer, default=500)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
