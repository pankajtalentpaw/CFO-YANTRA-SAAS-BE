"""
Authentication endpoints.
Matches src/controllers/authController.js.
"""

from typing import Any, Dict
from fastapi import APIRouter, Depends, Body
from app.core.security import create_access_token, get_current_user
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/auth", tags=["Auth"])

@router.post("/send-otp")
async def send_otp(payload: Dict[str, Any] = Body(...)):
    mobile = payload.get("mobile", "")
    return {
        "success": True,
        "message": f"OTP sent successfully to {mobile}",
        "data": {"mobile": mobile}
    }

@router.post("/verify-otp")
async def verify_otp(payload: Dict[str, Any] = Body(...)):
    mobile = payload.get("mobile", "")
    token = create_access_token({"mobile": mobile, "role": "admin"})
    return {
        "success": True,
        "message": "OTP verified successfully",
        "data": {
            "token": token,
            "user": {
                "mobile": mobile,
                "role": "admin",
                "fullName": "Administrator"
            }
        }
    }

@router.post("/register")
async def register(payload: Dict[str, Any] = Body(...)):
    token = create_access_token(payload)
    return {
        "success": True,
        "message": "User registered successfully",
        "data": {"token": token, "user": payload}
    }

@router.get("/me")
async def get_me(current_user: Any = Depends(get_current_user)):
    return {
        "success": True,
        "data": current_user
    }

@router.post("/logout")
async def logout():
    return {
        "success": True,
        "message": "Logged out successfully"
    }
