# CFO Yantra Backend System Setup

This directory contains automated tools to initialize and launch the CFO Yantra Python Backend, its SQLite database, and company storage structures.

---

## 🚀 Quick Setup (One-Click)

1. Double-click **`init_cfo_system.bat`**:
   - Validates Python 3.11+ environment
   - Prepares `.env` configuration
   - Creates SQLite database with WAL mode and foreign key constraints
   - Sets up `backend/data/companies/` directory with `companies_index.json`
2. Double-click **`start_cfo_backend.bat`**:
   - Launches the FastAPI async backend on `http://127.0.0.1:5000`
   - Real-time Swagger API docs available at `http://127.0.0.1:5000/docs`

---

## ⚙️ Manual Command Line Execution

From the `backend/python_backend` directory:
```powershell
# Activate your environment
.venv\Scripts\Activate.ps1

# Run the system setup script
python ../../SysSetUp/02_CFO_Setup/init_cfo_system.py

# Launch the server
python run.py
```
