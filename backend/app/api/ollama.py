"""Ollama utility endpoints."""

from typing import List

import httpx
from fastapi import APIRouter, Depends

from app.config import settings
from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/ollama", tags=["ollama"])


# Models to exclude from the dropdown (embedding models, not chat models)
EXCLUDED_MODELS = {
    "embeddinggemma:latest",
    "nomic-embed-text:latest",
    "mxbai-embed-large:latest",
    "all-minilm:latest",
}


@router.get("/models", response_model=List[str])
async def list_ollama_models(
    current_user: User = Depends(get_current_user),
) -> List[str]:
    """
    Return available Ollama chat models by querying the Ollama API.
    Filters out known embedding models.
    Returns empty list if Ollama is not reachable.
    """
    ollama_base = (current_user.llm_base_url or settings.ollama_url or "http://localhost:11434").rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{ollama_base}/api/tags")
            resp.raise_for_status()
            data = resp.json()
    except Exception:
        return []

    models = []
    for m in data.get("models", []):
        name = m.get("name", "")
        if name and name not in EXCLUDED_MODELS:
            # Also skip models whose name contains "embed"
            if "embed" not in name.lower():
                models.append(name)

    return sorted(models)
