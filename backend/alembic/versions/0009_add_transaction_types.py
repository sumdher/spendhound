"""Add transaction type support for expenses and categories.

Revision ID: 0009
Revises: 0008
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa


revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    category_columns = {column["name"] for column in inspector.get_columns("categories")}
    category_indexes = {index["name"] for index in inspector.get_indexes("categories")}
    if "transaction_type" not in category_columns:
        op.add_column("categories", sa.Column("transaction_type", sa.String(length=20), nullable=False, server_default="debit"))
    if "ix_categories_transaction_type" not in category_indexes:
        op.create_index("ix_categories_transaction_type", "categories", ["transaction_type"])

    expense_columns = {column["name"] for column in inspector.get_columns("expenses")}
    expense_indexes = {index["name"] for index in inspector.get_indexes("expenses")}
    if "transaction_type" not in expense_columns:
        op.add_column("expenses", sa.Column("transaction_type", sa.String(length=20), nullable=False, server_default="debit"))
    if "ix_expenses_transaction_type" not in expense_indexes:
        op.create_index("ix_expenses_transaction_type", "expenses", ["transaction_type"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    expense_columns = {column["name"] for column in inspector.get_columns("expenses")}
    expense_indexes = {index["name"] for index in inspector.get_indexes("expenses")}
    if "ix_expenses_transaction_type" in expense_indexes:
        op.drop_index("ix_expenses_transaction_type", table_name="expenses")
    if "transaction_type" in expense_columns:
        op.drop_column("expenses", "transaction_type")

    category_columns = {column["name"] for column in inspector.get_columns("categories")}
    category_indexes = {index["name"] for index in inspector.get_indexes("categories")}
    if "ix_categories_transaction_type" in category_indexes:
        op.drop_index("ix_categories_transaction_type", table_name="categories")
    if "transaction_type" in category_columns:
        op.drop_column("categories", "transaction_type")
