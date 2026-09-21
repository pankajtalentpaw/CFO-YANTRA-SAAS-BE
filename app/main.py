"""
FastAPI Application Entrypoint & Socket.io ASGI Integration.
Preserves 100% contracts with Electron desktop app and React frontend.
"""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import socketio

from app.core.config import settings
from app.core.exceptions import (
    ApiError,
    AppErrorCodes,
    create_error_payload,
    api_error_handler,
    http_exception_handler,
    validation_exception_handler,
    unhandled_exception_handler
)
from app.api.v1.router import api_router

# Initialize Socket.io AsyncServer (shared instance)
from app.core.socket import sio

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure storage and data directories exist
    from pathlib import Path
    try:
        Path(settings.DATA_ROOT_DIR).mkdir(parents=True, exist_ok=True)
        Path(settings.COMPANIES_DATA_DIR).mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    # Startup: Ensure all database tables exist
    from app.core.database import engine
    from app.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    if settings.ENABLE_BACKGROUND_JOBS:
        pass
    yield
    # Shutdown: Clean up connections
    pass

app = FastAPI(
    title="CFO Yantra Backend API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Configure CORS matching src/server.js
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Centralized Error Handlers
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

# Mount API v1 Router
app.include_router(api_router)

# Direct Health Check for Electron Readiness Probe
@app.get("/health")
async def root_health():
    return {
        "status": "HEALTHY",
        "service": "cfo-yantra-backend",
        "version": "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# Root endpoint matching src/server.js:26-33
@app.get("/")
async def root():
    return {
        "name": "CFO Yantra Backend API",
        "version": "1.0.0",
        "docs": "/api/v1/health",
        "tallyEndpoint": f"http://{settings.TALLY_HOST}:{settings.TALLY_PORT}"
    }

# Real-time Socket.io event listeners
@sio.event
async def connect(sid, environ, auth=None):
    pass

@sio.event
async def disconnect(sid):
    pass

# Combine FastAPI and Socket.io into unified ASGI application
application = socketio.ASGIApp(
    socketio_server=sio,
    other_asgi_app=app
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:application", host=settings.HOST, port=settings.PORT, reload=True)

