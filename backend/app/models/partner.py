"""PartnerRequest model for expense partner invitations."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

PARTNER_STATUS_PENDING = "pending"
PARTNER_STATUS_ACCEPTED = "accepted"
PARTNER_STATUS_REJECTED = "rejected"


class PartnerRequest(Base):
    __tablename__ = "partner_requests"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    requester_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    recipient_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default=PARTNER_STATUS_PENDING)
    token: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    requester: Mapped["User"] = relationship("User", foreign_keys=[requester_id], back_populates="sent_partner_requests")
    recipient: Mapped["User | None"] = relationship("User", foreign_keys=[recipient_id], back_populates="received_partner_requests")
