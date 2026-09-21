"""
Voucher SQLAlchemy 2.0 Model.
Matches existing SQLite schema for `vouchers`.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, CompatibleDateTime

class Voucher(Base):
    __tablename__ = "vouchers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    companyId: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sourceObjectId: Mapped[str] = mapped_column(String(255), nullable=False)
    objectType: Mapped[str] = mapped_column(String(255), default="Voucher")

    voucherDate: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    sourceVoucherNumber: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    parent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contentHash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    isDeleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deletedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    syncedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    lastRunId: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    header: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    entries: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
