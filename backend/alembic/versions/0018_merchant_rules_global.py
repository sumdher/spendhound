"""Add is_global to merchant_rules.

Revision ID: 0018
Revises: 0017
Create Date: 2026-04-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "merchant_rules",
        sa.Column("is_global", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_merchant_rules_is_global", "merchant_rules", ["is_global"])


def downgrade() -> None:
    op.drop_index("ix_merchant_rules_is_global", table_name="merchant_rules")
    op.drop_column("merchant_rules", "is_global")
