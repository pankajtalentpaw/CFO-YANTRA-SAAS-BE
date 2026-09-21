"""
System Models: User and SystemSetting.
Matches existing SQLite schema for `users` and `system_settings`.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, CompatibleDateTime

class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mobile: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    fullName: Mapped[Optional[str]] = mapped_column(String(255), default="")
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(255), default="admin")
    isVerified: Mapped[bool] = mapped_column(Boolean, default=True)
    lastLoginAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    tallyHost: Mapped[str] = mapped_column(String(255), default="127.0.0.1")
    tallyPort: Mapped[int] = mapped_column(Integer, default=9000)
    protocol: Mapped[str] = mapped_column(String(255), default="http")
    connectionMode: Mapped[str] = mapped_column(String(255), default="DIRECT")
    targetCompany: Mapped[str] = mapped_column(String(255), default="")
    timeoutMs: Mapped[int] = mapped_column(Integer, default=120000)
    probeTimeoutMs: Mapped[int] = mapped_column(Integer, default=8000)
    autoSyncEnabled: Mapped[bool] = mapped_column(Boolean, default=True)
    syncIntervalMs: Mapped[int] = mapped_column(Integer, default=300000)
    lastKnownStatus: Mapped[str] = mapped_column(String(255), default="UNKNOWN")
    lastConnectedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    lastResponseTimeMs: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    activeCompanies: Mapped[Optional[list]] = mapped_column(JSON, default=list)
    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
