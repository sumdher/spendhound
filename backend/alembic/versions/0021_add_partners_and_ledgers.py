"""Add expense partners, ledgers, ledger memberships, and ledger audit logs.

Revision ID: 0021_add_partners_and_ledgers
Revises: 0020_add_user_llm_api_keys
Create Date: 2026-04-17

"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_add_partners_and_ledgers"
down_revision = "0020_add_user_llm_api_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ledgers",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="personal"),
        sa.Column("created_by", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ledgers_created_by", "ledgers", ["created_by"])

    op.create_table(
        "ledger_memberships",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("ledger_id", sa.Uuid(as_uuid=True), sa.ForeignKey("ledgers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False, server_default="owner"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("ledger_id", "user_id", name="uq_ledger_membership"),
    )
    op.create_index("ix_ledger_memberships_ledger_id", "ledger_memberships", ["ledger_id"])
    op.create_index("ix_ledger_memberships_user_id", "ledger_memberships", ["user_id"])

    op.add_column("expenses", sa.Column("ledger_id", sa.Uuid(as_uuid=True), sa.ForeignKey("ledgers.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_expenses_ledger_id", "expenses", ["ledger_id"])

    op.create_table(
        "partner_requests",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("requester_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_email", sa.String(255), nullable=False),
        sa.Column("recipient_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("token", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_partner_requests_requester_id", "partner_requests", ["requester_id"])
    op.create_index("ix_partner_requests_recipient_email", "partner_requests", ["recipient_email"])
    op.create_index("ix_partner_requests_recipient_id", "partner_requests", ["recipient_id"])

    op.create_table(
        "ledger_audit_logs",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column("ledger_id", sa.Uuid(as_uuid=True), sa.ForeignKey("ledgers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("expense_id", sa.Uuid(as_uuid=True), sa.ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True),
        sa.Column("user_id", sa.Uuid(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("changes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_ledger_audit_logs_ledger_id", "ledger_audit_logs", ["ledger_id"])
    op.create_index("ix_ledger_audit_logs_expense_id", "ledger_audit_logs", ["expense_id"])


def downgrade() -> None:
    op.drop_table("ledger_audit_logs")
    op.drop_index("ix_partner_requests_recipient_id", "partner_requests")
    op.drop_index("ix_partner_requests_recipient_email", "partner_requests")
    op.drop_index("ix_partner_requests_requester_id", "partner_requests")
    op.drop_table("partner_requests")
    op.drop_index("ix_expenses_ledger_id", "expenses")
    op.drop_column("expenses", "ledger_id")
    op.drop_index("ix_ledger_memberships_user_id", "ledger_memberships")
    op.drop_index("ix_ledger_memberships_ledger_id", "ledger_memberships")
    op.drop_table("ledger_memberships")
    op.drop_index("ix_ledgers_created_by", "ledgers")
    op.drop_table("ledgers")
