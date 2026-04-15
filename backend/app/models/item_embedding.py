"""Item embedding model for RAG-based grocery subcategory classification."""

from __future__ import annotations

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import settings
from app.database import Base


class ItemEmbedding(Base):
    """Vector embedding of a receipt item description for RAG-based subcategory lookup.

    is_global=False, user_id=X  → private to user X (auto-created from corrections)
    is_global=True,  user_id=X  → visible to all users (admin knowledge-base upload)
    """

    __tablename__ = "item_embeddings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    is_global: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", index=True)
    description_text: Mapped[str] = mapped_column(String(300), nullable=False)
    # Vector dimension must match settings.embedding_dimensions (default 768).
    # If you change the dimension, create a new migration to alter the column.
    embedding: Mapped[list[float]] = mapped_column(Vector(settings.embedding_dimensions), nullable=False)
    subcategory_label: Mapped[str] = mapped_column(String(120), nullable=False)
    # source: "document" (admin upload) | "correction" (user-confirmed fix)
    source: Mapped[str] = mapped_column(String(50), nullable=False, server_default="document")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    user: Mapped["User | None"] = relationship("User", back_populates="item_embeddings")
