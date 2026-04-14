"""Add recurring generation settings to expenses.

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column("recurring_variable", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "expenses",
        sa.Column("recurring_auto_add", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "expenses",
        sa.Column("recurring_source_expense_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "expenses",
        sa.Column("auto_generated", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "expenses",
        sa.Column("generated_for_month", sa.Date(), nullable=True),
    )
    op.create_index(op.f("ix_expenses_generated_for_month"), "expenses", ["generated_for_month"], unique=False)
    op.create_index(op.f("ix_expenses_recurring_source_expense_id"), "expenses", ["recurring_source_expense_id"], unique=False)
    op.create_foreign_key(
        "fk_expenses_recurring_source_expense_id_expenses",
        "expenses",
        "expenses",
        ["recurring_source_expense_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_expenses_recurring_source_expense_id_expenses", "expenses", type_="foreignkey")
    op.drop_index(op.f("ix_expenses_recurring_source_expense_id"), table_name="expenses")
    op.drop_index(op.f("ix_expenses_generated_for_month"), table_name="expenses")
    op.drop_column("expenses", "generated_for_month")
    op.drop_column("expenses", "auto_generated")
    op.drop_column("expenses", "recurring_source_expense_id")
    op.drop_column("expenses", "recurring_auto_add")
    op.drop_column("expenses", "recurring_variable")
