# CFO YANTRA — TARGET PYTHON BACKEND ARCHITECTURE

## Executive Summary
This document establishes the target Python architecture for CFO Yantra. The design leverages Python 3.12+ with FastAPI, Pydantic v2, SQLAlchemy 2.0 Async, and `aiosqlite`. It guarantees 100% contract compatibility with the Electron/React desktop frontend, preserves existing SQLite and PostgreSQL database schemas without destructive DDL changes, and strictly enforces 28-digit arbitrary financial precision (`ROUND_HALF_UP`).

---

## 1. Core Architectural Principles

1. **Contract Immutability**: The Python backend is a drop-in replacement for the Node.js backend. Response envelopes (`{ success: true, data: ..., message: ... }`), HTTP status codes, query parameter naming, and error payloads strictly mirror the Node implementation.
2. **28-Digit Decimal Arithmetic**: Floating-point types (`float`) are prohibited for monetary amounts, ledger balances, tax calculations, and percentages. All financial models and services utilize `decimal.Decimal` with global context set to `ROUND_HALF_UP`.
3. **Database Schema Continuity**: The target connects directly to `./data/cfo_yantra.sqlite` (or production PostgreSQL) with zero schema rewrites. All 16 existing tables are mapped via SQLAlchemy 2.0 declarative tables, preserving JSON column storage with `unwrap_row` compatibility.
4. **Single-Worker Concurrency Safety**: To eliminate Tally loopback socket starvation and SQLite write-lock contention, background sync jobs and CDC polling are owned by a single worker thread/process.
5. **Clean Layered Separation**:
   - `app/api/v1/`: HTTP routers and request parameter validation.
   - `app/schemas/`: Pydantic v2 serialization/deserialization with camelCase aliases.
   - `app/services/`: Pure business logic, financial formulas, Tally drivers, and cross-verification.
   - `app/models/`: Declarative SQLAlchemy 2.0 models reflecting the database.
   - `app/core/`: Application settings, decimal configuration, database engine, security/JWT.

---

## 2. Directory Layout (`python_backend/`)

```
python_backend/
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI entrypoint, lifespan, CORS, Socket.io mount
│   ├── core/
│   │   ├── __init__.py
│   │   ├── config.py               # Pydantic BaseSettings (.env loading)
│   │   ├── database.py             # SQLAlchemy 2.0 async engine & sessionmaker
│   │   ├── decimal_util.py         # 28-precision Decimal helpers (ROUND_HALF_UP)
│   │   ├── security.py             # JWT encode/decode, bcrypt password hashing
│   │   └── exceptions.py           # Custom AppExceptions & global exception handlers
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py                 # Base declarative model with unwrap_row utility
│   │   ├── company.py              # Company & CompanySettings models
│   │   ├── voucher.py              # Voucher & VoucherEntry models
│   │   ├── ledger.py               # Ledger & LedgerGroup models
│   │   ├── tally.py                # TallyConfig & SyncCheckpoint models
│   │   └── user.py                 # User & AuditLog models
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── base.py                 # BaseCamelModel (camelCase aliases)
│   │   ├── auth.py                 # Login, Register, Token schemas
│   │   ├── company.py              # Company schemas
│   │   ├── voucher.py              # Voucher schemas
│   │   ├── ledger.py               # Ledger schemas
│   │   ├── tally.py                # Tally config & sync schemas
│   │   ├── reports.py              # Financial statements & ratios schemas
│   │   └── analytics.py            # Analytics cube & block schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py         # Authentication & token management
│   │   ├── company_service.py      # Company profile & tenant logic
│   │   ├── voucher_service.py      # Voucher mutations & balance updates
│   │   ├── ledger_service.py       # Ledger aggregation & balance lookups
│   │   ├── tally_client.py         # HTTP loopback client, mutex, XML builder
│   │   ├── sync_service.py         # Full/incremental sync & CDC runner
│   │   ├── financial_engine.py     # P&L, Balance Sheet, Cash Flow, Ratios
│   │   ├── verification_engine.py  # Cross-Verification CV01–CV16
│   │   └── analytics_cube.py       # 3D sparse cube (Time x Dim x Metric)
│   └── api/
│       ├── __init__.py
│       └── v1/
│           ├── __init__.py
│           ├── router.py           # Central APIRouter mounting all 52 routes
│           ├── endpoints/
│           │   ├── health.py       # GET /health
│           │   ├── auth.py         # /auth/* (5 routes)
│           │   ├── companies.py    # /companies/* (5 routes)
│           │   ├── tally.py        # /companies/:id/tally/* (8 routes)
│           │   ├── ledgers.py      # /companies/:id/ledgers/* (3 routes)
│           │   ├── vouchers.py     # /companies/:id/vouchers/* (5 routes)
│           │   ├── reports.py      # /companies/:id/reports/* (7 routes)
│           │   ├── analytics.py    # /companies/:id/analytics/* (4 routes)
│           │   ├── audit.py        # /companies/:id/audit/* (2 routes)
│           │   ├── users.py        # /companies/:id/users/* (3 routes)
│           │   ├── settings.py     # /companies/:id/settings (2 routes)
│           │   ├── exports.py      # /companies/:id/export/* (3 routes)
│           │   └── system.py       # /system/* (4 routes)
├── tests/
│   ├── __init__.py
│   ├── conftest.py                 # Pytest async database & client fixtures
│   ├── test_financial_decimal.py   # Golden tests for Decimal precision & rounding
│   ├── test_database_models.py     # Schema compatibility & unwrap_row tests
│   ├── test_api_contracts.py       # Endpoints parity & response envelope tests
│   └── test_tally_integration.py   # XML generation & serialization mutex tests
├── requirements.txt                # Pinned production dependencies
└── run.py                          # Server launcher for development & Electron
```

---

## 3. Technology Stack & Key Libraries

| Component | Library / Framework | Version | Justification |
| :--- | :--- | :--- | :--- |
| **Runtime** | Python | 3.12+ (tested on 3.14) | Modern asyncio, performance, typing features |
| **Web Framework** | FastAPI | >= 0.111.0 | High performance, auto OpenAPI, dependency injection |
| **Data Validation** | Pydantic | >= 2.7.0 | High-speed Rust core, strict schema validation |
| **ORM / Query Engine** | SQLAlchemy | >= 2.0.38 | Type-safe async queries, multi-DB support (SQLite/PG) |
| **Async SQLite Driver** | aiosqlite | >= 0.20.0 | True non-blocking SQLite database access |
| **Async HTTP Client** | httpx | >= 0.27.0 | Async loopback HTTP client for Tally (:9000) |
| **Real-Time WebSockets** | python-socketio | >= 5.11.0 | 100% protocol parity with frontend `socket.io-client` |
| **XML Processing** | defusedxml | >= 0.7.1 | Secure XML parsing protected against XXE / billion laughs |
| **Password Hashing** | passlib[bcrypt] | >= 1.7.4 | Backward compatible password hashing |
| **JWT Tokens** | PyJWT | >= 2.8.0 | Standard RFC 7519 HMAC-SHA256 JWT tokens |

---

## 4. Key Subsystem Designs

### 4.1. Financial Precision Subsystem (`app/core/decimal_util.py`)
```python
import decimal
from decimal import Decimal, ROUND_HALF_UP

# Initialize global precision context
FINANCIAL_CONTEXT = decimal.Context(prec=28, rounding=ROUND_HALF_UP)
decimal.setcontext(FINANCIAL_CONTEXT)

def to_decimal(value) -> Decimal:
    """Converts any numeric/string value to 28-precision Decimal safely."""
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, float):
        # Convert through str representation to avoid binary float artifacts
        return Decimal(str(value))
    return Decimal(str(value))

def round_financial(value: Decimal, places: int = 2) -> Decimal:
    """Rounds using strictly ROUND_HALF_UP to specified decimal places."""
    q = Decimal("10") ** -places
    return value.quantize(q, rounding=ROUND_HALF_UP)
```

### 4.2. Tally Single-Socket Serializer Subsystem (`app/services/tally_client.py`)
```python
import asyncio
import httpx

class TallyClient:
    """Thread-safe and async-safe serialized client for Tally loopback HTTP server."""
    def __init__(self, host: str = "http://127.0.0.1:9000"):
        self.host = host
        self._lock = asyncio.Lock()
        self._client = httpx.AsyncClient(timeout=30.0)

    async def send_xml(self, xml_payload: str) -> str:
        # Enforce exclusive access to prevent Tally socket crashes
        async with self._lock:
            response = await self._client.post(
                self.host,
                content=xml_payload.encode("utf-8"),
                headers={"Content-Type": "text/xml; charset=utf-8"}
            )
            response.raise_for_status()
            return response.text
```

### 4.3. Standard Response Envelope Filter (`app/core/responses.py`)
All API responses return the canonical Node format:
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```
Errors return:
```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Company with ID 1 does not exist"
  }
}
```
