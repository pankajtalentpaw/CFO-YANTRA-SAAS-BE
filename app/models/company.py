"""
Company and SyncState SQLAlchemy 2.0 Models.
Matches existing SQLite schema for `companies` and `sync_states`.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import BigInteger, Boolean, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, CompatibleDateTime

class Company(Base):
    __tablename__ = "companies"

    companyId: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    legalName: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    formalName: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    guid: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    masterId: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    alterId: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Financial periods
    startingFrom: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    startingAt: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    booksFrom: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    financialYearBeginning: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Currency & Jurisdiction
    baseCurrency: Mapped[str] = mapped_column(String(255), default="INR")
    country: Mapped[str] = mapped_column(String(255), default="India")
    countryName: Mapped[str] = mapped_column(String(255), default="India")
    state: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stateName: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    pinCode: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # Statutory & Tax Registrations
    gstin: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    gstRegNo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    pan: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    panCardNo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cin: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    cinNo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Contacts
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phoneNumber: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    mobile: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    mobileNo: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    features: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    isOpen: Mapped[bool] = mapped_column(Boolean, default=True)
    lastSeenAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    closedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    syncedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    lastRunId: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    metadata_: Mapped[Optional[dict]] = mapped_column("metadata", JSON, nullable=True)

    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SyncState(Base):
    __tablename__ = "sync_states"

    companyId: Mapped[str] = mapped_column(String(255), primary_key=True)
    companyName: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(255), default="IDLE")
    lastRunId: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    lastStartedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    lastFinishedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    lastDurationMs: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    lastSuccessAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    lastError: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    totalRecords: Mapped[int] = mapped_column(Integer, default=0)
    changedRecords: Mapped[int] = mapped_column(Integer, default=0)
    runCount: Mapped[int] = mapped_column(Integer, default=0)
    domains: Mapped[Optional[dict]] = mapped_column(JSON, default=dict)
    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
