"""
Common response envelopes and pagination schemas.
"""

from typing import Any, Generic, List, Optional, TypeVar
from app.schemas.base import BaseCamelModel

T = TypeVar("T")

class ApiResponse(BaseCamelModel, Generic[T]):
    success: bool = True
    data: Optional[T] = None
    message: Optional[str] = None

class PaginatedData(BaseCamelModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    limit: int
    has_more: bool

class HealthResponse(BaseCamelModel):
    status: str = "HEALTHY"
    service: str = "cfo-yantra-backend"
    version: str = "1.0.0"
    timestamp: str
