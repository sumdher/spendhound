"""Encryption utilities for user LLM API keys stored in the database."""

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _get_fernet() -> Fernet:
    secret = settings.llm_key_encryption_secret
    if not secret:
        raise ValueError(
            "LLM_KEY_ENCRYPTION_SECRET is not configured. "
            "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        )
    return Fernet(secret.encode() if isinstance(secret, str) else secret)


def encrypt_api_key(api_key: str) -> str:
    """Encrypt an API key for storage in the database."""
    return _get_fernet().encrypt(api_key.encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    """Decrypt an API key retrieved from the database."""
    try:
        return _get_fernet().decrypt(encrypted_key.encode()).decode()
    except InvalidToken as e:
        raise ValueError("Failed to decrypt API key — the encryption secret may have changed.") from e
