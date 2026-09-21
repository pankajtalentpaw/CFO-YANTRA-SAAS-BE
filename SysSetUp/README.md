# ⚙️ CFO Yantra & TallyPrime System Setup Hub (`SysSetUp`)

This dedicated directory is exclusively designed for **TallyPrime & CFO Yantra System Setup, Configuration, Initialization, and Health Diagnostics**.

---

## 📁 Structure

```text
SysSetUp/
├── 01_Tally_Setup/                  # TallyPrime F12 config & gateway verification
│   ├── README.md                    # Detailed F12 configuration guide
│   ├── check_tally.py               # Standalone Tally port 9000 connectivity probe
│   ├── check_tally.bat              # One-click Windows runner
│   └── tally_export_envelope.xml    # Canonical read-only XML export template
│
├── 02_CFO_Setup/                    # CFO Python Backend & Database initialization
│   ├── README.md                    # Backend setup instructions
│   ├── init_cfo_system.py           # Automated DB creation, .env setup & storage init
│   ├── init_cfo_system.bat          # One-click setup launcher
│   └── start_cfo_backend.bat        # One-click server launcher (Port 5000)
│
└── 03_Diagnostics/                  # Full End-to-End System Health Checks
    ├── check_system_health.py       # Multi-service health probe (Tally, DB, API, Storage)
    └── check_system_health.bat      # One-click diagnostic runner
```

---

## ⚡ Quick Start Checklist

| Step | Action | Tool to Run |
| :--- | :--- | :--- |
| **1. Tally Config** | Open TallyPrime -> Press **F12** -> Advanced Config -> Enable ODBC: **Yes**, Port: **9000** | `01_Tally_Setup\check_tally.bat` |
| **2. CFO Init** | Initialize SQLite database tables (`WAL`, Foreign Keys) & company storage | `02_CFO_Setup\init_cfo_system.bat` |
| **3. Start CFO** | Launch the FastAPI async backend on `http://localhost:5000` | `02_CFO_Setup\start_cfo_backend.bat` |
| **4. Diagnose** | Verify all components (Tally + Database + Storage + API) in 1 click | `03_Diagnostics\check_system_health.bat` |

---

## 🔒 Security & Reliability Guarantee
- **Read-Only Gate**: Zero write/mutation operations toward TallyPrime.
- **ACID Compliant**: SQLite database operates under `WAL` (Write-Ahead Logging) and enforced `PRAGMA foreign_keys=ON`.
- **Tally Company Isolation**: Multi-company data is segregated into individual directories (`10000_<CompanyName>`) with atomic snapshot preservation.
