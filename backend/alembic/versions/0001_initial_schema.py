"""Initial schema - creates all tables with pgvector extension.

Revision ID: 0001
Revises:
Create Date: 2026-04-07 00:00:00.000000

Creates: users, applications, skills, application_skills,
         status_history, job_description_embeddings, chat_messages.
Adds IVFFlat index on embedding column for fast approximate nearest-neighbor search.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Enable pgvector extension
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # ── users ─────────────────────────────────────────────────────────────────
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("email", sa.String(255), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("avatar_url", sa.String(500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # ── skills ────────────────────────────────────────────────────────────────
    op.create_table(
        "skills",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("category", sa.String(50), nullable=True),
    )
    op.create_index("ix_skills_name", "skills", ["name"], unique=True)

    # ── applications ──────────────────────────────────────────────────────────
    op.create_table(
        "applications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("company", sa.String(255), nullable=False),
        sa.Column("job_title", sa.String(255), nullable=False),
        sa.Column("date_applied", sa.Date, nullable=False, server_default=sa.func.current_date()),
        sa.Column("source", sa.String(100), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="applied"),
        sa.Column("status_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("work_mode", sa.String(20), nullable=True),
        sa.Column("whats_in_it_for_me", sa.Text, nullable=True),
        sa.Column("salary_min", sa.Integer, nullable=True),
        sa.Column("salary_max", sa.Integer, nullable=True),
        sa.Column("salary_currency", sa.String(3), nullable=False, server_default="EUR"),
        sa.Column("salary_period", sa.String(20), nullable=False, server_default="yearly"),
        sa.Column("cv_link", sa.Text, nullable=True),
        sa.Column("cl_link", sa.Text, nullable=True),
        sa.Column("job_url", sa.Text, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("raw_input", sa.Text, nullable=True),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_applications_user_id", "applications", ["user_id"])
    op.create_index("ix_applications_company", "applications", ["company"])
    op.create_index("ix_applications_status", "applications", ["status"])
    op.create_index("ix_applications_is_deleted", "applications", ["is_deleted"])

    # ── application_skills ────────────────────────────────────────────────────
    op.create_table(
        "application_skills",
        sa.Column(
            "application_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "skill_id",
            sa.Integer,
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.UniqueConstraint("application_id", "skill_id", name="uq_application_skill"),
    )

    # ── status_history ────────────────────────────────────────────────────────
    op.create_table(
        "status_history",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "application_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(50), nullable=True),
        sa.Column("to_status", sa.String(50), nullable=False),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("notes", sa.Text, nullable=True),
    )
    op.create_index("ix_status_history_application_id", "status_history", ["application_id"])

    # ── job_description_embeddings ────────────────────────────────────────────
    op.create_table(
        "job_description_embeddings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "application_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("applications.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chunk_index", sa.Integer, nullable=False),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("embedding", sa.Text, nullable=False),  # stored as text, cast via pgvector
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # Use vector type via raw SQL for pgvector
    op.execute(
        "ALTER TABLE job_description_embeddings "
        "ALTER COLUMN embedding TYPE vector(1536) USING embedding::vector"
    )
    op.create_index(
        "ix_jde_application_id", "job_description_embeddings", ["application_id"]
    )
    # IVFFlat index for approximate nearest-neighbor search
    op.execute(
        "CREATE INDEX ix_jde_embedding_ivfflat "
        "ON job_description_embeddings "
        "USING ivfflat (embedding vector_cosine_ops) "
        "WITH (lists = 100)"
    )

    # ── chat_messages ─────────────────────────────────────────────────────────
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("metadata", postgresql.JSONB, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("job_description_embeddings")
    op.drop_table("status_history")
    op.drop_table("application_skills")
    op.drop_table("applications")
    op.drop_table("skills")
    op.drop_table("users")
    op.execute("DROP EXTENSION IF EXISTS vector")
