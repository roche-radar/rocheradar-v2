import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override alembic.ini's hardcoded sqlalchemy.url with DATABASE_URL env var
# (CI uses rocheradar_test, prod/staging Railway uses their own URLs).
# Normalises postgres:// → postgresql+asyncpg:// the way the app does.
_env_url = os.getenv("DATABASE_URL", "").strip()
if _env_url:
    if _env_url.startswith("postgres://") and "+asyncpg" not in _env_url:
        _env_url = _env_url.replace("postgres://", "postgresql+asyncpg://", 1)
    elif _env_url.startswith("postgresql://") and "+asyncpg" not in _env_url:
        _env_url = _env_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    config.set_main_option("sqlalchemy.url", _env_url)

from app.database import Base  # noqa: E402
import app.models  # noqa: F401 — ensure all models are imported

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
