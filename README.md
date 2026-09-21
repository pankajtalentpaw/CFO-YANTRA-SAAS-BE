# CFO Yantra Python Backend

High-performance Financial Intelligence & Tally Integration Engine built with FastAPI, SQLAlchemy (Async), and Python 3.12+.

---

## 📁 Directory & File Structure

```text
python_backend/
├── .env.example               # Environment variable templates
├── .gitignore                  # Git ignore rules for Python artifacts & local data
├── pyproject.toml              # Project metadata, build configuration & dependencies
├── requirements.txt            # Pinned requirements for pip
├── run.py                      # Application entry point script
├── README.md                   # Project documentation
│
├── app/                        # Application source code
│   ├── __init__.py
│   ├── main.py                 # FastAPI application factory & lifespan
│   │
│   ├── api/                    # API Routing Layer
│   │   ├── __init__.py
│   │   └── v1/
│   │       ├── __init__.py
│   │       ├── router.py       # Aggregated v1 API router
│   │       └── endpoints/      # Resource route controllers
│   │           ├── auth.py         # Authentication & token endpoints
│   │           ├── cloud.py        # Cloud synchronization endpoints
│   │           ├── companies.py    # Company data, financial summaries, & metrics
│   │           ├── diagnostics.py  # Diagnostic & system health endpoints
│   │           ├── health.py       # Liveness and readiness probes
│   │           ├── settings.py     # Application & integration configuration
│   │           ├── storage.py      # Company folder and file storage management
│   │           ├── sync.py         # Tally sync execution & job control
│   │           └── tally.py        # Tally gateway ping & discovery
│   │
│   ├── core/                   # Core Infrastructure & Configuration
│   │   ├── __init__.py
│   │   ├── config.py           # Pydantic Settings & environment loader
│   │   ├── database.py         # Async SQLite engine & session factories
│   │   ├── decimal_util.py     # High-precision financial decimal utilities
│   │   ├── exceptions.py       # Custom domain exceptions & global handlers
│   │   └── security.py         # JWT tokens, password hashing & auth guards
│   │
│   ├── models/                 # SQLAlchemy Async ORM Models
│   │   ├── __init__.py
│   │   ├── base.py             # Declarative Base & common model mixins
│   │   ├── company.py          # Company, group & financial schema models
│   │   ├── master.py           # Ledgers, stock items & cost centers
│   │   ├── outstanding.py      # Bills, receivables & payables models
│   │   ├── system.py           # Audit trails, sync logs & system state
│   │   └── voucher.py          # Sales, purchases, receipts & payment vouchers
│   │
│   ├── schemas/                # Pydantic DTO & Request/Response Schemas
│   │   ├── __init__.py
│   │   ├── base.py             # Common base schemas & pagination models
│   │   ├── common.py           # Shared enums, filters & range parameters
│   │   ├── company.py          # Company creation, update & response schemas
│   │   ├── tally.py            # Tally XML/JSON payload parsing schemas
│   │   └── voucher.py          # Voucher data validation schemas
│   │
│   └── services/               # Business Logic & Integrations
│       ├── __init__.py
│       ├── analytics/          # Financial cubes & analytical catalog
│       │   ├── catalog.py
│       │   └── cube.py
│       ├── storage/            # Company folder & database file management
│       │   └── company_folder_service.py
│       ├── sync/               # Tally Sync Engine & automated extraction
│       │   ├── sync_engine.py
│       │   └── sync_queries.py
│       └── tally/              # Tally HTTP Client & XML communication
│           └── tally_client.py
│
└── SysSetUp/                   # 1-Click System Setup & Diagnostics Hub
    ├── 01_Tally_Setup/         # TallyPrime loopback configuration & probe scripts
    ├── 02_CFO_Setup/           # Automated DB & storage initializer, server launchers
    └── 03_Diagnostics/         # Multi-service system health checkers
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Python 3.12+**
- Virtual environment tool (`venv`)

### 2. Environment Setup
```powershell
# Create virtual environment
python -m venv .venv

# Activate virtual environment (Windows PowerShell)
.venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

### 3. Environment Variables
Copy the example environment file:
```powershell
Copy-Item .env.example .env
```

Key environment variables:
- `PORT`: Port for the API server (default: `5000`)
- `HOST`: Host bind address (default: `127.0.0.1`)
- `DATABASE_URL`: SQLite async database connection string
- `TALLY_URL`: Tally XML HTTP gateway address (default: `http://localhost:9000`)

### 4. Running the Server

Using the entry point script:
```powershell
python run.py
```

Or using Uvicorn directly:
```powershell
uvicorn app.main:app --host 127.0.0.1 --port 5000 --reload
```

---

## 🧪 Testing

Run the test suite with `pytest`:
```powershell
pytest
```

---

## 📚 API Documentation

Once the server is running, interactive API docs are available at:
- **Swagger UI**: [http://127.0.0.1:5000/docs](http://127.0.0.1:5000/docs)
- **ReDoc**: [http://127.0.0.1:5000/redoc](http://127.0.0.1:5000/redoc)
