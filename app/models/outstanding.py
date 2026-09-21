"""
Bill-Wise Outstanding (COA / VOA) SQLAlchemy 2.0 Model.
Mirrors Magenta BI's Table_6 (Customer Outstanding) and Table_8 (Vendor Outstanding),
storing Bill Number, Bill Date, Due Date, Pending Amount, and Overdue Aging.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, CompatibleDateTime


class BillOutstanding(Base):
    __tablename__ = "bill_outstandings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    companyId: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    partyName: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    partyType: Mapped[str] = mapped_column(String(50), default="CUSTOMER")  # CUSTOMER / VENDOR

    billNumber: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    billDate: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    dueDate: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    billAmount: Mapped[float] = mapped_column(Float, default=0.0)
    pendingAmount: Mapped[float] = mapped_column(Float, default=0.0)
    overdueDays: Mapped[int] = mapped_column(Integer, default=0)
    isOverdue: Mapped[bool] = mapped_column(Boolean, default=False)

    alterId: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    syncedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
