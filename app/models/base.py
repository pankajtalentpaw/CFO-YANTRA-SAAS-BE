"""
Declarative Base and unwrap_row helper matching sqlModelCompat.js.
"""

import json
import datetime
from typing import Any, Dict, Optional
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import inspect, TypeDecorator, DateTime, String

class CompatibleDateTime(TypeDecorator):
    """Safely handles SQLite/Sequelize datetime strings like '2026-09-16 13:50:34.832 +00:00'."""
    impl = String
    cache_ok = True

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, datetime.datetime):
            return value
        if isinstance(value, str):
            clean = value.strip().replace(" +", "+").replace(" -", "-")
            try:
                return datetime.datetime.fromisoformat(clean)
            except Exception:
                return value
        return value

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, datetime.datetime):
            return value.isoformat()
        return str(value)

class Base(DeclarativeBase):
    pass

def unwrap_row(obj: Any) -> Optional[Dict[str, Any]]:
    """
    Unpacks model instance or dict, hoisting the JSON `data` column into root attributes,
    strictly replicating sqlModelCompat.js:41-54.
    """
    if obj is None:
        return None

    if isinstance(obj, dict):
        raw = dict(obj)
    else:
        mapper = inspect(obj)
        raw = {c.key: getattr(obj, c.key) for c in mapper.mapper.column_attrs}

    base = {}
    if "data" in raw and raw["data"]:
        data_val = raw["data"]
        if isinstance(data_val, str):
            try:
                base = json.loads(data_val)
            except Exception:
                base = {}
        elif isinstance(data_val, dict):
            base = dict(data_val)

    out = {**base, **raw}
    if "data" in out:
        del out["data"]

    # Normalize boolean flags matching sqlModelCompat.js
    if "isDeleted" in out and out["isDeleted"] is not None:
        out["isDeleted"] = bool(out["isDeleted"])
    if "isOpen" in out and out["isOpen"] is not None:
        out["isOpen"] = bool(out["isOpen"])
    if "isVerified" in out and out["isVerified"] is not None:
        out["isVerified"] = bool(out["isVerified"])

    return out
