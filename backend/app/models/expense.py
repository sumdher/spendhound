"""Expense model for SpendHound."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Expense(Base):
    """Expense row created manually or from a reviewed receipt."""

    __tablename__ = "expenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, index=True)
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("receipts.id", ondelete="SET NULL"), nullable=True, index=True)
    merchant: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    transaction_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="debit", index=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="EUR")
    expense_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(30), nullable=False, server_default="manual")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, server_default="1")
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    recurring_group: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    cadence: Mapped[str] = mapped_column(String(20), nullable=False, server_default="one_time", index=True)
    cadence_override: Mapped[str | None] = mapped_column(String(20), nullable=True)
    cadence_interval: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    prepaid_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    prepaid_start_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    recurring_variable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    recurring_auto_add: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    recurring_source_expense_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("expenses.id", ondelete="SET NULL"), nullable=True, index=True)
    auto_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    generated_for_month: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    is_major_purchase: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    ledger_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("ledgers.id", ondelete="SET NULL"), nullable=True, index=True)

    user: Mapped["User"] = relationship("User", back_populates="expenses")
    category: Mapped["Category | None"] = relationship("Category", back_populates="expenses")
    receipt: Mapped["Receipt | None"] = relationship("Receipt", back_populates="expenses")
    items: Mapped[list["ExpenseItem"]] = relationship("ExpenseItem", back_populates="expense", cascade="all, delete-orphan")
    ledger: Mapped["Ledger | None"] = relationship("Ledger", back_populates="expenses")
