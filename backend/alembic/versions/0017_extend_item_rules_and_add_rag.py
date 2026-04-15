"""Add is_global to item_keyword_rules; enable pgvector and create item_embeddings table.

Revision ID: 0017
Revises: 0016
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa


revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Extend item_keyword_rules with is_global ──────────────────────────
    op.add_column(
        "item_keyword_rules",
        sa.Column("is_global", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_item_keyword_rules_is_global", "item_keyword_rules", ["is_global"])

    # ── 2. Enable pgvector extension ─────────────────────────────────────────
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── 3. Create item_embeddings table ──────────────────────────────────────
    # The embedding column uses the pgvector `vector` type (dimension 768).
    # If you change EMBEDDING_DIMENSIONS in config.py, create a new migration.
    op.execute("""
        CREATE TABLE item_embeddings (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES users(id) ON DELETE CASCADE,
            is_global BOOLEAN NOT NULL DEFAULT FALSE,
            description_text VARCHAR(300) NOT NULL,
            embedding vector(768) NOT NULL,
            subcategory_label VARCHAR(120) NOT NULL,
            source VARCHAR(50) NOT NULL DEFAULT 'document',
            notes TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX ix_item_embeddings_user_id ON item_embeddings(user_id)")
    op.execute("CREATE INDEX ix_item_embeddings_is_global ON item_embeddings(is_global)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS item_embeddings")
    op.drop_index("ix_item_keyword_rules_is_global", table_name="item_keyword_rules")
    op.drop_column("item_keyword_rules", "is_global")
