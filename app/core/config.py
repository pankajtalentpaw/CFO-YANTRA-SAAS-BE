"""
Application Configuration Settings.
Loads from environment variables or .env file with defaults.
"""

from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_SQLITE_PATH = (BASE_DIR / "data" / "cfo_yantra.sqlite").as_posix()

class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 5000
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "INFO"

    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{DEFAULT_SQLITE_PATH}"

    # Tally-Style Storage Directories
    DATA_ROOT_DIR: str = (BASE_DIR / "data").as_posix()
    COMPANIES_DATA_DIR: str = (BASE_DIR / "data" / "companies").as_posix()

    @property
    def async_database_url(self) -> str:
        """Normalizes Sequelize or standard DB URLs for async SQLAlchemy drivers."""
        url = self.DATABASE_URL
        if url.startswith("sqlite+aiosqlite://"):
            return url
        if url.startswith("sqlite://"):
            return url.replace("sqlite://", "sqlite+aiosqlite://", 1)
        if url.startswith("sqlite:"):
            # Handles Sequelize format: sqlite:./data/cfo_yantra.sqlite
            rest = url[len("sqlite:"):]
            return f"sqlite+aiosqlite:///{rest}"
        if url.startswith("postgres://"):
            return url.replace("postgres://", "postgresql+asyncpg://", 1)
        if url.startswith("postgresql://"):
            return url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url

    # JWT Authentication
    JWT_SECRET: str = "cfoyantra-insecure-dev-secret-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # TallyPrime Loopback Settings
    TALLY_HOST: str = "127.0.0.1"
    TALLY_PORT: int = 9000
    TALLY_TIMEOUT_MS: int = 120000
    TALLY_PROBE_TIMEOUT_MS: int = 8000

    # Background Concurrency & Synchronization
    ENABLE_BACKGROUND_JOBS: bool = True
    WORKERS: int = 1

    # Automatic Tally Background Scheduler Settings
    TALLY_AUTO_SYNC_ENABLED: bool = True
    TALLY_AUTO_SYNC_INTERVAL_MINUTES: int = 15
    TALLY_AUTO_SYNC_MAX_RETRIES: int = 3
    TALLY_AUTO_SYNC_BACKOFF_SECONDS: int = 30
    TALLY_EXECUTABLE_PATH: Optional[str] = r"C:\Program Files\TallyPrimeEditLog (1)\tally.exe"
    TALLY_ALLOW_HEADLESS_SPAWN: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
