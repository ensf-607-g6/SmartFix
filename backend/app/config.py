from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    rabbitmq_url: str
    jwt_secret: str
    jwt_expire_minutes: int = 720

    # Local AI (NFR-5: nothing leaves our own machine)
    ollama_url: str = "http://localhost:11434"
    vision_model: str = "qwen3-vl:8b"
    fallback_model: str = "gemma3:4b"
    ollama_timeout: float = 120.0
    notification_timeout: float = 10.0

    # Validation
    review_confidence_threshold: float = 0.6
    duplicate_confidence_threshold: float = 0.6
    duplicate_radius_m: int = 50

    # Priority (FR-5)
    severity_weight: float = 20.0       # severity 1..5 -> 20..100
    dup_bonus_each: float = 5.0
    dup_bonus_cap: float = 15.0         # cap so busy neighbourhoods don't crowd out quiet ones
    aging_per_hour: float = 0.25        # +6 points/day, uncapped
    reopen_bonus: float = 25.0
    escalated_score: float = 1000.0

    # Work orders (FR-6): hours allowed per severity
    deadline_hours: dict[int, int] = {5: 24, 4: 48, 3: 96, 2: 168, 1: 336}

    # Lifecycle
    confirm_window_days: int = 7        # FR-10
    max_retries: int = 3                # NFR-3
    scheduler_interval_s: int = 120

    upload_dir: str = "uploads"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
