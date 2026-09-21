"""
Master Entity Models (Ledgers, Groups, Inventory, Cost Centres, etc.).
Generated using the standard mirror model schema matching mirrorModel.factory.js.
"""

from datetime import datetime
from typing import Optional
from sqlalchemy import Boolean, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base, CompatibleDateTime

class MirrorMasterBase:
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    companyId: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    sourceObjectId: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    parent: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    checksum: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    contentHash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    isDeleted: Mapped[bool] = mapped_column(Boolean, default=False)
    deletedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, nullable=True)
    syncedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    lastRunId: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    createdAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow)
    updatedAt: Mapped[Optional[datetime]] = mapped_column(CompatibleDateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Ledger(Base, MirrorMasterBase):
    __tablename__ = "ledgers"
    objectType: Mapped[str] = mapped_column(String(255), default="Ledger")

class Group(Base, MirrorMasterBase):
    __tablename__ = "groups"
    objectType: Mapped[str] = mapped_column(String(255), default="Group")

class StockItem(Base, MirrorMasterBase):
    __tablename__ = "stockitems"
    objectType: Mapped[str] = mapped_column(String(255), default="StockItem")

class StockGroup(Base, MirrorMasterBase):
    __tablename__ = "stockgroups"
    objectType: Mapped[str] = mapped_column(String(255), default="StockGroup")

class StockCategory(Base, MirrorMasterBase):
    __tablename__ = "stockcategories"
    objectType: Mapped[str] = mapped_column(String(255), default="StockCategory")

class Unit(Base, MirrorMasterBase):
    __tablename__ = "units"
    objectType: Mapped[str] = mapped_column(String(255), default="Unit")

class Godown(Base, MirrorMasterBase):
    __tablename__ = "godowns"
    objectType: Mapped[str] = mapped_column(String(255), default="Godown")

class CostCentre(Base, MirrorMasterBase):
    __tablename__ = "costcentres"
    objectType: Mapped[str] = mapped_column(String(255), default="CostCentre")

class CostCategory(Base, MirrorMasterBase):
    __tablename__ = "costcategories"
    objectType: Mapped[str] = mapped_column(String(255), default="CostCategory")

class VoucherType(Base, MirrorMasterBase):
    __tablename__ = "vouchertypes"
    objectType: Mapped[str] = mapped_column(String(255), default="VoucherType")

class Currency(Base, MirrorMasterBase):
    __tablename__ = "currencies"
    objectType: Mapped[str] = mapped_column(String(255), default="Currency")
