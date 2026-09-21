"""
SQLAlchemy 2.0 Async Database Connection & Session Management.
Supports both SQLite (via aiosqlite) and PostgreSQL (via asyncpg).
Enables WAL mode and busy_timeout on SQLite for safe non-blocking concurrency.
"""

from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import event
from pathlib import Path
from app.core.config import settings

# Auto-create directory for SQLite file if it does not exist
if "sqlite" in settings.async_database_url:
    raw_url = settings.async_database_url
    prefix = "sqlite+aiosqlite:///"
    if raw_url.startswith(prefix):
        db_file_str = raw_url[len(prefix):]
        if db_file_str and db_file_str != ":memory:":
            try:
                Path(db_file_str).parent.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass

# Configure SQLite WAL pragmas for safe concurrent access
engine = create_async_engine(
    settings.async_database_url,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in settings.async_database_url else {}
)

if "sqlite" in settings.async_database_url:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    class_=AsyncSession
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for injecting database session into FastAPI route handlers."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
