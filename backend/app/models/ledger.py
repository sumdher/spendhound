"""Ledger and LedgerMembership models."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Ledger(Base):
    __tablename__ = "ledgers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="personal")
    created_by: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    creator: Mapped["User"] = relationship("User", foreign_keys=[created_by], back_populates="created_ledgers")
    memberships: Mapped[list["LedgerMembership"]] = relationship("LedgerMembership", back_populates="ledger", cascade="all, delete-orphan")
    expenses: Mapped[list["Expense"]] = relationship("Expense", back_populates="ledger")
    audit_logs: Mapped[list["LedgerAuditLog"]] = relationship("LedgerAuditLog", back_populates="ledger", cascade="all, delete-orphan")


class LedgerMembership(Base):
    __tablename__ = "ledger_memberships"
    __table_args__ = (UniqueConstraint("ledger_id", "user_id", name="uq_ledger_membership"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ledgers.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default="owner")
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ledger: Mapped["Ledger"] = relationship("Ledger", back_populates="memberships")
    user: Mapped["User"] = relationship("User", back_populates="ledger_memberships")


class LedgerAuditLog(Base):
    __tablename__ = "ledger_audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ledger_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("ledgers.id", ondelete="CASCADE"), nullable=False, index=True)
    expense_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    changes: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    ledger: Mapped["Ledger"] = relationship("Ledger", back_populates="audit_logs")
    user: Mapped["User"] = relationship("User")
