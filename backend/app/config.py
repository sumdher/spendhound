"""Application configuration for the SpendHound backend."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration for the SpendHound backend."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = Field(
        default="postgresql+asyncpg://spendhound:localdev@db:5432/spendhound",
        description="Async PostgreSQL connection string",
    )

    google_client_id: str = Field(default="", description="Google OAuth client ID")
    google_client_secret: str = Field(default="", description="Google OAuth client secret")
    jwt_secret: str = Field(default="change-me-in-production", description="JWT signing secret")
    jwt_algorithm: str = Field(default="HS256", description="JWT algorithm")
    jwt_expiry_days: int = Field(default=7, description="JWT expiry in days")

    llm_provider: str = Field(
        default="ollama",
        description="LLM provider: ollama | openai | anthropic | nebius",
    )
    ollama_url: str = Field(default="http://host.docker.internal:11434", description="Ollama base URL")
    ollama_model: str = Field(default="gemma4:e4b", description="Ollama model name")
    openai_api_key: str = Field(default="", description="OpenAI API key")
    openai_model: str = Field(default="gpt-4o-mini", description="OpenAI model name")
    anthropic_api_key: str = Field(default="", description="Anthropic API key")
    anthropic_model: str = Field(default="claude-sonnet-4-20250514", description="Anthropic model name")
    nebius_api_key: str = Field(default="", description="Nebius API key")
    nebius_model: str = Field(default="", description="Nebius model name")
    nebius_base_url: str = Field(default="", description="Nebius base URL")

    admin_email: str = Field(
        default="srsudhir31@gmail.com",
        description="Admin email used for admin authorization and access approval",
    )
    app_url: str = Field(default="http://localhost:3000", description="Public frontend URL")
    resend_api_key: str = Field(default="", description="Resend API key")
    resend_from_email: str = Field(default="", description="Approval email sender")
    monthly_reports_enabled: bool = Field(default=False, description="Enable monthly report delivery job")
    monthly_reports_timezone: str = Field(default="UTC", description="IANA timezone used to compute the reporting month")
    monthly_reports_frontend_pdf_url: str = Field(default="", description="Internal frontend endpoint used to render monthly report PDFs")
    monthly_reports_frontend_token: str = Field(default="", description="Shared secret token sent to the internal frontend PDF endpoint")
    monthly_reports_frontend_token_header: str = Field(default="X-SpendHound-Internal-Token", description="Header name used for monthly report frontend authentication")
    monthly_reports_frontend_timeout_seconds: int = Field(default=60, description="Timeout for internal frontend monthly report PDF requests")
    recurring_generation_enabled: bool = Field(default=False, description="Enable automatic generation of recurring expenses")
    recurring_generation_timezone: str = Field(default="UTC", description="IANA timezone used to compute recurring expense generation months")

    debug: bool = Field(default=False, description="Enable debug mode")
    cors_origins: list[str] = Field(
        default=["http://localhost:3000", "http://127.0.0.1:3000"],
        description="Allowed CORS origins",
    )
    default_currency: str = Field(default="EUR", description="Default expense currency")
    receipt_storage_dir: str = Field(
        default="storage/receipts",
        description="Relative directory where uploaded receipt files are stored",
    )
    receipt_review_confidence_threshold: float = Field(
        default=0.75,
        description="Confidence threshold below which extracted receipts require review",
    )
    receipt_multimodal_max_bytes: int = Field(
        default=7_500_000,
        description="Maximum image size in bytes sent directly to multimodal receipt extraction",
    )


settings = Settings()
