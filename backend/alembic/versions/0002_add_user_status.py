"""Add status column to users table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-09 00:00:00.000000

Adds users.status (varchar 20).
Existing users are migrated to 'approved' (they were already active).
New users default to 'pending' — awaiting admin approval.
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add column: existing rows get 'approved' (backward-compatible)
    op.add_column(
        "users",
        sa.Column("status", sa.String(20), nullable=False, server_default="approved"),
    )
    # Change default to 'pending' for all new users going forward
    op.execute("ALTER TABLE users ALTER COLUMN status SET DEFAULT 'pending'")
    op.create_index("ix_users_status", "users", ["status"])


def downgrade() -> None:
    op.drop_index("ix_users_status", table_name="users")
    op.drop_column("users", "status")
