"""Add expense cadence and major purchase tracking.

Revision ID: 0010
Revises: 0009
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    expense_columns = {column["name"] for column in inspector.get_columns("expenses")}
    expense_indexes = {index["name"] for index in inspector.get_indexes("expenses")}

    if "cadence" not in expense_columns:
        op.add_column("expenses", sa.Column("cadence", sa.String(length=20), nullable=False, server_default="one_time"))
    if "cadence_override" not in expense_columns:
        op.add_column("expenses", sa.Column("cadence_override", sa.String(length=20), nullable=True))
    if "is_major_purchase" not in expense_columns:
        op.add_column("expenses", sa.Column("is_major_purchase", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "ix_expenses_cadence" not in expense_indexes:
        op.create_index("ix_expenses_cadence", "expenses", ["cadence"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    expense_columns = {column["name"] for column in inspector.get_columns("expenses")}
    expense_indexes = {index["name"] for index in inspector.get_indexes("expenses")}

    if "ix_expenses_cadence" in expense_indexes:
        op.drop_index("ix_expenses_cadence", table_name="expenses")
    if "is_major_purchase" in expense_columns:
        op.drop_column("expenses", "is_major_purchase")
    if "cadence_override" in expense_columns:
        op.drop_column("expenses", "cadence_override")
    if "cadence" in expense_columns:
        op.drop_column("expenses", "cadence")
