"""Application configuration, loaded from environment variables (and an optional .env file)."""

from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_INSECURE_DEFAULT_SECRET = "dev-only-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "InvoiceFlow"
    environment: str = Field(default="development", description="development | test | production")

    secret_key: str = _INSECURE_DEFAULT_SECRET
    access_token_minutes: int = 60
    refresh_token_days: int = 30

    database_url: str = "sqlite:///./invoiceflow.db"

    # Comma separated list of allowed browser origins for CORS.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Public URL of the web app, used to build shareable invoice links.
    public_app_url: str = "http://localhost:5173"

    timezone: str = "Africa/Nairobi"

    # Logo uploads
    max_logo_bytes: int = 2 * 1024 * 1024
    max_logo_dimension: int = 800

    # Rate limiting (per client IP, per process)
    auth_rate_limit: int = 10
    auth_rate_window_seconds: int = 60

    # Optional SMTP integration for emailing invoices. Leave SMTP_HOST empty to disable.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_from_email: str = ""
    smtp_from_name: str = "InvoiceFlow"

    max_backup_bytes: int = 20 * 1024 * 1024

    @field_validator("environment")
    @classmethod
    def _env(cls, v: str) -> str:
        v = v.lower().strip()
        if v not in {"development", "test", "production"}:
            raise ValueError("ENVIRONMENT must be development, test or production")
        return v

    @model_validator(mode="after")
    def _production_secret(self) -> "Settings":
        if self.environment == "production" and (
            self.secret_key == _INSECURE_DEFAULT_SECRET or len(self.secret_key) < 32
        ):
            raise ValueError("SECRET_KEY must be set to a random value of at least 32 characters in production")
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def email_enabled(self) -> bool:
        return bool(self.smtp_host and self.smtp_from_email)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
