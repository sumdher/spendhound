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

    llm_key_encryption_secret: str = Field(
        default="",
        description=(
            "Fernet encryption key for user LLM API keys stored in the database. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        ),
    )

    ollama_embedding_model: str = Field(default="embeddinggemma:latest", description="Ollama model for item embeddings (RAG)")
    embedding_dimensions: int = Field(default=768, description="Vector dimensions produced by the embedding model")
    rag_similarity_threshold: float = Field(default=0.22, description="Cosine distance threshold for RAG match (lower = stricter; 0.0=identical, 2.0=opposite)")

    # ── LLM concurrency ──────────────────────────────────────────────────────────
    ollama_max_concurrent: int = Field(
        default=1,
        description="Max concurrent Ollama calls. 1 = single GPU; increase only for CPU or multi-GPU.",
    )
    llm_semaphore_wait_timeout: float = Field(
        default=5.0,
        description="Seconds to wait for the LLM semaphore before returning 503. Fail fast rather than queue.",
    )
    llm_timeout_seconds: int = Field(
        default=120,
        description="Total timeout in seconds for any LLM provider call (connect + read).",
    )

    # ── Receipt extraction queue ──────────────────────────────────────────────
    receipt_queue_maxsize: int = Field(
        default=10,
        description="Max pending receipt extraction jobs. Uploads beyond this return a queued_full status.",
    )

    # ── Rate limiting ─────────────────────────────────────────────────────────
    rate_limit_chat_per_minute: int = Field(default=20, description="Chat stream requests per user per minute")
    rate_limit_upload_per_minute: int = Field(default=3, description="Receipt uploads per user per minute")
    rate_limit_auth_per_minute: int = Field(default=10, description="Auth requests per IP per minute")

    # ── Database connection pool ──────────────────────────────────────────────
    db_pool_size: int = Field(default=20, description="SQLAlchemy async connection pool base size")
    db_max_overflow: int = Field(default=40, description="Max extra connections beyond db_pool_size")

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
