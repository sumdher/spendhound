"""Add SpendHound expense chat tables.

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-13
"""

import logging

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


logger = logging.getLogger("alembic.runtime.migration")

revision = "0011"
down_revision = "0010"
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
        for constraint_name in session_fk_names:
            logger.info("Dropping existing chat_messages foreign key %s", constraint_name)
            op.drop_constraint(constraint_name, "chat_messages", type_="foreignkey")
        logger.info("Dropping existing chat_messages table before recreation")
        op.drop_table("chat_messages")

    if inspector.has_table("chat_sessions"):
        logger.info("Dropping existing chat_sessions table before recreation")
        op.drop_table("chat_sessions")

    op.create_table(
        "chat_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False, server_default="New Chat"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("max_tokens", sa.Integer(), nullable=False, server_default="4096"),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_chat_sessions_user_id", "chat_sessions", ["user_id"])
    op.create_index("ix_chat_sessions_last_message_at", "chat_sessions", ["last_message_at"])

    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("client_id", sa.String(length=120), nullable=False),
        sa.Column("parent_client_id", sa.String(length=120), nullable=True),
        sa.Column("provider", sa.String(length=50), nullable=True),
        sa.Column("model", sa.String(length=255), nullable=True),
        sa.Column("token_count", sa.Integer(), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"])
    op.create_index("ix_chat_messages_role", "chat_messages", ["role"])
    op.create_index("ix_chat_messages_client_id", "chat_messages", ["client_id"])
    op.create_index("ix_chat_messages_parent_client_id", "chat_messages", ["parent_client_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    message_indexes = {index["name"] for index in inspector.get_indexes("chat_messages")} if inspector.has_table("chat_messages") else set()
    session_indexes = {index["name"] for index in inspector.get_indexes("chat_sessions")} if inspector.has_table("chat_sessions") else set()

    for index_name in [
        "ix_chat_messages_parent_client_id",
        "ix_chat_messages_client_id",
        "ix_chat_messages_role",
        "ix_chat_messages_session_id",
        "ix_chat_messages_user_id",
    ]:
        if index_name in message_indexes:
            op.drop_index(index_name, table_name="chat_messages")
    if inspector.has_table("chat_messages"):
        op.drop_table("chat_messages")

    for index_name in ["ix_chat_sessions_last_message_at", "ix_chat_sessions_user_id"]:
        if index_name in session_indexes:
            op.drop_index(index_name, table_name="chat_sessions")
    if inspector.has_table("chat_sessions"):
        op.drop_table("chat_sessions")
