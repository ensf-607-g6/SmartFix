"""Settings, read from backend/.env"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Database (PostgreSQL + PostGIS, local or Supabase)
    database_url: str = "postgresql://localhost:5433/smartfix"

    # RabbitMQ. Empty = in-process bus with the same queue/retry/dead-letter behaviour.
    rabbitmq_url: str = ""
    rabbitmq_exchange: str = "smartfix.events"
    max_attempts: int = 3                     # NFR-3

    # Ollama (NFR-5: photos only ever go to this local runtime)
    ollama_url: str = "http://localhost:11434"
    vision_model: str = "qwen3-vl:8b"
    fallback_model: str = "gemma3:4b"
    ollama_timeout_s: float = 120.0
    confidence_threshold: float = 0.6         # below this, FR-4 operator review

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_expiry_hours: int = 12

    # Files and scheduling
    storage_dir: Path = BACKEND_DIR / "storage"
    scheduler_interval_s: int = 60            # deadline + auto-close checks
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Staff-only shortcuts to expire a deadline or the 7-day window, for demos and testing.
    enable_dev_tools: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
