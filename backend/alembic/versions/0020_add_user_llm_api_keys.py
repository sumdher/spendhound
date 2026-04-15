"""Add per-user LLM provider settings and encrypted API key columns.

Revision ID: 0020_add_user_llm_api_keys
Revises: 0019
Create Date: 2026-04-15

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_add_user_llm_api_keys"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("llm_provider", sa.String(50), nullable=True))
    op.add_column("users", sa.Column("llm_model", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("llm_api_key", sa.Text, nullable=True))
    op.add_column("users", sa.Column("llm_base_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "llm_base_url")
    op.drop_column("users", "llm_api_key")
    op.drop_column("users", "llm_model")
    op.drop_column("users", "llm_provider")
