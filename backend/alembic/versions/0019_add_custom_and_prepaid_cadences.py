"""Add custom interval and prepaid cadence fields to expenses.

Revision ID: 0019
Revises: 0018
Create Date: 2026-04-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("expenses", sa.Column("cadence_interval", sa.Integer(), nullable=True))
    op.add_column("expenses", sa.Column("prepaid_months", sa.Integer(), nullable=True))
    op.add_column("expenses", sa.Column("prepaid_start_date", sa.Date(), nullable=True))
    op.create_index("ix_expenses_cadence_interval", "expenses", ["cadence_interval"])
    op.create_index("ix_expenses_prepaid_start_date", "expenses", ["prepaid_start_date"])


def downgrade() -> None:
    op.drop_index("ix_expenses_prepaid_start_date", table_name="expenses")
    op.drop_index("ix_expenses_cadence_interval", table_name="expenses")
    op.drop_column("expenses", "prepaid_start_date")
    op.drop_column("expenses", "prepaid_months")
    op.drop_column("expenses", "cadence_interval")
