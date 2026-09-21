"""
Voucher and Ledger schemas.
"""

from typing import Any, Dict, List, Optional
from app.schemas.base import BaseCamelModel

class VoucherDto(BaseCamelModel):
    id: int
    company_id: str
    source_object_id: str
    object_type: str = "Voucher"
    voucher_date: Optional[str] = None
    source_voucher_number: Optional[str] = None
    name: Optional[str] = None
    parent: Optional[str] = None
    header: Optional[Dict[str, Any]] = None
    entries: Optional[List[Any]] = None
    is_deleted: bool = False

class LedgerDto(BaseCamelModel):
    id: int
    company_id: str
    source_object_id: str
    name: Optional[str] = None
    parent: Optional[str] = None
    is_deleted: bool = False
