"""Add expense item storage and statement-import document metadata.

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    receipt_columns = {column["name"] for column in inspector.get_columns("receipts")}
    if "document_kind" not in receipt_columns:
        op.add_column("receipts", sa.Column("document_kind", sa.String(length=20), nullable=False, server_default="receipt"))

    if not inspector.has_table("expense_items"):
        op.create_table(
            "expense_items",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("expense_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False),
            sa.Column("description", sa.String(length=300), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=True),
            sa.Column("unit_price", sa.Numeric(12, 2), nullable=True),
            sa.Column("total_price", sa.Numeric(12, 2), nullable=True),
            sa.Column("subcategory", sa.String(length=120), nullable=True),
            sa.Column("subcategory_confidence", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_expense_items_expense_id", "expense_items", ["expense_id"])
        op.create_index("ix_expense_items_subcategory", "expense_items", ["subcategory"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("expense_items"):
        op.drop_table("expense_items")

    receipt_columns = {column["name"] for column in inspector.get_columns("receipts")}
    if "document_kind" in receipt_columns:
        op.drop_column("receipts", "document_kind")
