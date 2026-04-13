"""Add per-user automatic monthly reports preference.

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("automatic_monthly_reports", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("users", "automatic_monthly_reports")
