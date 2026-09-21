"""
Company schemas.
"""

from typing import Any, Dict, List, Optional
from datetime import datetime
from app.schemas.base import BaseCamelModel

class CompanyDto(BaseCamelModel):
    company_id: str
    name: Optional[str] = None
    legal_name: Optional[str] = None
    formal_name: Optional[str] = None
    guid: Optional[str] = None
    master_id: Optional[int] = None
    alter_id: Optional[int] = None
    starting_from: Optional[str] = None
    starting_at: Optional[str] = None
    books_from: Optional[str] = None
    financial_year_beginning: Optional[str] = None
    base_currency: str = "INR"
    country: str = "India"
    country_name: str = "India"
    state: Optional[str] = None
    state_name: Optional[str] = None
    pin_code: Optional[str] = None
    address: Optional[Dict[str, Any]] = None
    gstin: Optional[str] = None
    pan: Optional[str] = None
    cin: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    features: Optional[Dict[str, Any]] = None
    is_open: bool = True
    synced_at: Optional[datetime] = None

class CompanyOverviewDto(BaseCamelModel):
    company: CompanyDto
    counts: Dict[str, int]
    last_sync: Optional[datetime] = None
