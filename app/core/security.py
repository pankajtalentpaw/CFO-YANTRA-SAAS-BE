"""
Authentication, Password Hashing, and JWT Token Management.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import bcrypt
import jwt
from fastapi import Header, status
from app.core.config import settings
from app.core.exceptions import ApiError, AppErrorCodes

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8")[:72], hashed_password.encode("utf-8"))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    """Generates a bcrypt hash for a plain password."""
    pwd_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generates an RFC 7519 HMAC-SHA256 JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Dict[str, Any]:
    """Decodes and validates a JWT token."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "Access token has expired", AppErrorCodes.UNAUTHORIZED_ACCESS)
    except jwt.InvalidTokenError:
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "Invalid authentication token", AppErrorCodes.UNAUTHORIZED_ACCESS)

async def get_current_user(authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """FastAPI dependency for validating Bearer token in requests."""
    if not authorization:
        # For development or non-strict routes, return default admin or None
        return {"id": 1, "role": "admin", "fullName": "Administrator"}
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise ApiError(status.HTTP_401_UNAUTHORIZED, "Invalid authorization header format", AppErrorCodes.UNAUTHORIZED_ACCESS)
    return decode_access_token(parts[1])
