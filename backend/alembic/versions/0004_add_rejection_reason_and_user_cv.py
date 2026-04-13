"""add rejection_reason to applications and cv_text to users

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("applications", sa.Column("rejection_reason", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("cv_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("applications", "rejection_reason")
    op.drop_column("users", "cv_text")
