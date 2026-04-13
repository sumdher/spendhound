"""User model for authenticated SpendHound users."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

USER_STATUSES = ("pending", "approved", "rejected")


class User(Base):
    """Authenticated user created or updated on Google OAuth login."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    categories: Mapped[list["Category"]] = relationship("Category", back_populates="user", cascade="all, delete-orphan")
    merchant_rules: Mapped[list["MerchantRule"]] = relationship("MerchantRule", back_populates="user", cascade="all, delete-orphan")
    budgets: Mapped[list["Budget"]] = relationship("Budget", back_populates="user", cascade="all, delete-orphan")
    receipts: Mapped[list["Receipt"]] = relationship("Receipt", back_populates="user", cascade="all, delete-orphan")
    expenses: Mapped[list["Expense"]] = relationship("Expense", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<User {self.email}>"
