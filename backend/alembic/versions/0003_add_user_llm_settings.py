"""Add llm_settings JSONB column to users table.

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-10 00:00:00.000000

Stores per-user LLM provider preferences (provider, model).
API keys are NEVER stored — they stay browser-local only.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("llm_settings", JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "llm_settings")
