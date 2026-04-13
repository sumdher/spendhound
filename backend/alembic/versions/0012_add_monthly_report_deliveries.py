"""Add monthly report delivery tracking.

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monthly_report_deliveries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("report_month", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resend_email_id", sa.String(length=255), nullable=True),
        sa.Column("pdf_source_url", sa.String(length=1000), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "report_month", name="uq_monthly_report_deliveries_user_month"),
    )
    op.create_index("ix_monthly_report_deliveries_user_id", "monthly_report_deliveries", ["user_id"])
    op.create_index("ix_monthly_report_deliveries_report_month", "monthly_report_deliveries", ["report_month"])
    op.create_index("ix_monthly_report_deliveries_status", "monthly_report_deliveries", ["status"])


def downgrade() -> None:
    op.drop_index("ix_monthly_report_deliveries_status", table_name="monthly_report_deliveries")
    op.drop_index("ix_monthly_report_deliveries_report_month", table_name="monthly_report_deliveries")
    op.drop_index("ix_monthly_report_deliveries_user_id", table_name="monthly_report_deliveries")
    op.drop_table("monthly_report_deliveries")
