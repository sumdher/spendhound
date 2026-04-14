"""Add item keyword rules for receipt guidance.

Revision ID: 0015
Revises: 0014
Create Date: 2026-04-14
"""

from alembic import op
import sqlalchemy as sa


revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "item_keyword_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("keyword", sa.String(length=255), nullable=False),
        sa.Column("subcategory_label", sa.String(length=120), nullable=False),
        sa.Column("pattern_type", sa.String(length=20), nullable=False, server_default="fuzzy"),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_item_keyword_rules_user_id"), "item_keyword_rules", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_item_keyword_rules_user_id"), table_name="item_keyword_rules")
    op.drop_table("item_keyword_rules")
