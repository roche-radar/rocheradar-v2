from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # DB
    database_url: str = "postgresql+asyncpg://roche:roche@localhost:5432/rocheradar"

    # Redis / Celery
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/2"

    # Vertex AI
    google_cloud_project: str = ""
    google_cloud_location: str = "europe-west4"
    vertex_ai_pro_model: str = "gemini-2.5-pro"
    vertex_ai_flash_model: str = "gemini-2.5-flash"
    google_application_credentials: str = ""

    # Provider API keys (env-var fallbacks; DB takes precedence at runtime)
    openrouter_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    nvidia_api_key: str = ""
    gemini_api_key: str = ""

    # TinyFish
    tinyfish_api_key: str = ""
    tinyfish_api_keys: str = ""  # comma-separated

    # ChromaDB
    chroma_host: str = "localhost"
    chroma_port: int = 8000
    chroma_collection: str = "rocheradar_posts"

    # Sentry
    sentry_dsn: str = ""

    # App
    secret_key: str = "changeme-at-least-32-chars-long!!"
    environment: str = "development"
    log_level: str = "INFO"
    reports_dir: str = "/app/reports"

    # Pipeline tunables
    daily_run_hour: int = 8
    daily_run_minute: int = 0
    agent_budget_per_run: int = 250
    llm_budget_hard_stop: int = 500
    dedup_cosine_threshold: float = 0.95

    @property
    def tinyfish_keys_list(self) -> list[str]:
        if self.tinyfish_api_keys:
            return [k.strip() for k in self.tinyfish_api_keys.split(",") if k.strip()]
        if self.tinyfish_api_key:
            return [self.tinyfish_api_key]
        return []

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
