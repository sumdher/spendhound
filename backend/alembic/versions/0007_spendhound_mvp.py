"""Replace legacy job-tracking domain tables with SpendHound MVP tables.

Revision ID: 0007
Revises: 0006
Create Date: 2026-04-12
"""

import logging

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


logger = logging.getLogger("alembic.runtime.migration")

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("chat_messages"):
        foreign_keys = inspector.get_foreign_keys("chat_messages")
        session_fk_names = [
            foreign_key["name"]
            for foreign_key in foreign_keys
            if foreign_key.get("referred_table") == "chat_sessions"
            and "session_id" in foreign_key.get("constrained_columns", [])
            and foreign_key.get("name")
        ]

        if session_fk_names:
            logger.info(
                "Dropping legacy chat_messages -> chat_sessions foreign keys: %s",
                ", ".join(session_fk_names),
            )
            for constraint_name in session_fk_names:
                op.drop_constraint(constraint_name, "chat_messages", type_="foreignkey")

        chat_message_columns = {column["name"] for column in inspector.get_columns("chat_messages")}
        if "session_id" in chat_message_columns:
            chat_message_indexes = {index["name"] for index in inspector.get_indexes("chat_messages")}
            if "ix_chat_messages_session_id" in chat_message_indexes:
                logger.info("Dropping legacy index ix_chat_messages_session_id")
                op.drop_index("ix_chat_messages_session_id", table_name="chat_messages")

            logger.info("Dropping legacy chat_messages.session_id column")
            op.drop_column("chat_messages", "session_id")

    legacy_tables = [
        "cv_analyses",
        "chat_messages",
        "job_description_embeddings",
        "status_history",
        "application_skills",
        "applications",
        "chat_sessions",
        "skills",
    ]
    for table_name in legacy_tables:
        if inspector.has_table(table_name):
            logger.info("Dropping legacy table %s", table_name)
            op.drop_table(table_name)

    user_columns = {column["name"] for column in inspector.get_columns("users")}
    for column_name in ["cv_text", "cv_filename", "cv_uploaded_at", "llm_settings"]:
        if column_name in user_columns:
            op.drop_column("users", column_name)

    if not inspector.has_table("categories"):
        op.create_table(
            "categories",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(80), nullable=False),
            sa.Column("color", sa.String(20), nullable=False, server_default="#60a5fa"),
            sa.Column("icon", sa.String(32), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_system", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.UniqueConstraint("user_id", "name", name="uq_categories_user_name"),
        )
        op.create_index("ix_categories_user_id", "categories", ["user_id"])

    if not inspector.has_table("merchant_rules"):
        op.create_table(
            "merchant_rules",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
            sa.Column("merchant_pattern", sa.String(255), nullable=False),
            sa.Column("pattern_type", sa.String(20), nullable=False, server_default="contains"),
            sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_merchant_rules_user_id", "merchant_rules", ["user_id"])
        op.create_index("ix_merchant_rules_category_id", "merchant_rules", ["category_id"])

    if not inspector.has_table("receipts"):
        op.create_table(
            "receipts",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("original_filename", sa.String(255), nullable=False),
            sa.Column("stored_filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(120), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("storage_path", sa.String(500), nullable=False),
            sa.Column("ocr_text", sa.Text(), nullable=True),
            sa.Column("preview_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
            sa.Column("extraction_confidence", sa.Float(), nullable=True),
            sa.Column("extraction_status", sa.String(30), nullable=False, server_default="uploaded"),
            sa.Column("needs_review", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("review_notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_receipts_user_id", "receipts", ["user_id"])

    if not inspector.has_table("expenses"):
        op.create_table(
            "expenses",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
            sa.Column("receipt_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True),
            sa.Column("merchant", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
            sa.Column("expense_date", sa.Date(), nullable=False),
            sa.Column("source", sa.String(30), nullable=False, server_default="manual"),
            sa.Column("confidence", sa.Float(), nullable=False, server_default="1"),
            sa.Column("needs_review", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("recurring_group", sa.String(255), nullable=True),
            sa.Column("is_recurring", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_expenses_user_id", "expenses", ["user_id"])
        op.create_index("ix_expenses_category_id", "expenses", ["category_id"])
        op.create_index("ix_expenses_receipt_id", "expenses", ["receipt_id"])
        op.create_index("ix_expenses_expense_date", "expenses", ["expense_date"])
        op.create_index("ix_expenses_merchant", "expenses", ["merchant"])
        op.create_index("ix_expenses_recurring_group", "expenses", ["recurring_group"])

    if not inspector.has_table("budgets"):
        op.create_table(
            "budgets",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id", ondelete="SET NULL"), nullable=True),
            sa.Column("name", sa.String(120), nullable=False),
            sa.Column("amount", sa.Numeric(12, 2), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
            sa.Column("period", sa.String(20), nullable=False, server_default="monthly"),
            sa.Column("month_start", sa.Date(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        )
        op.create_index("ix_budgets_user_id", "budgets", ["user_id"])
        op.create_index("ix_budgets_category_id", "budgets", ["category_id"])
        op.create_index("ix_budgets_month_start", "budgets", ["month_start"])


def downgrade() -> None:
    for table_name in ["budgets", "expenses", "receipts", "merchant_rules", "categories"]:
        op.drop_table(table_name)
