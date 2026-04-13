"""Add job_description to cv_analyses.

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("cv_analyses")}
    if "job_description" not in columns:
        op.add_column("cv_analyses", sa.Column("job_description", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("cv_analyses")}
    if "job_description" in columns:
        op.drop_column("cv_analyses", "job_description")
