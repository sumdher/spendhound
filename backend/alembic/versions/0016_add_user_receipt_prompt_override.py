"""Add per-user receipt prompt override.

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("receipt_prompt_override", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "receipt_prompt_override")
