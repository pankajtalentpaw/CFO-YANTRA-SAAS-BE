"""
CFO Yantra System Initializer.
Automates environment checks, database creation, and Tally-style company storage directories.
"""

import sys
import os
import shutil
import asyncio
from pathlib import Path

# Paths
# Flexible Paths (supports running from python_backend/SysSetUp or root SysSetUp)
SETUP_DIR = Path(__file__).resolve().parent
if (SETUP_DIR.parent.parent / "run.py").exists():
    PYTHON_BE_DIR = SETUP_DIR.parent.parent
    ROOT_DIR = PYTHON_BE_DIR.parent.parent
    DATA_DIR = PYTHON_BE_DIR.parent / "data"
elif (SETUP_DIR.parent.parent / "backend" / "python_backend" / "run.py").exists():
    ROOT_DIR = SETUP_DIR.parent.parent
    PYTHON_BE_DIR = ROOT_DIR / "backend" / "python_backend"
    DATA_DIR = ROOT_DIR / "backend" / "data"
else:
    PYTHON_BE_DIR = SETUP_DIR.parent.parent
    DATA_DIR = PYTHON_BE_DIR / "data"

COMPANIES_DIR = DATA_DIR / "companies"

def check_python_version():
    print("[1/5] Checking Python Runtime...")
    major, minor = sys.version_info.major, sys.version_info.minor
    print(f"      Detected Python: {major}.{minor}.{sys.version_info.micro}")
    if major < 3 or (major == 3 and minor < 11):
        print("      [ERROR] CFO Yantra requires Python 3.11 or higher (recommended: 3.12+).")
        return False
    print("      [OK] Python version compatible.")
    return True

def ensure_env_file():
    print("[2/5] Checking Environment Configuration...")
    env_file = PYTHON_BE_DIR / ".env"
    example_file = PYTHON_BE_DIR / ".env.example"

    if not env_file.exists():
        if example_file.exists():
            shutil.copyfile(example_file, env_file)
            print(f"      [CREATED] Created {env_file.name} from .env.example")
        else:
            print("      [WARN] .env.example not found. Using internal system defaults.")
    else:
        print("      [OK] .env configuration present.")
    return True

def ensure_storage_directories():
    print("[3/5] Setting Up Tally-Style Storage Directories...")
    COMPANIES_DIR.mkdir(parents=True, exist_ok=True)
    index_file = COMPANIES_DIR / "companies_index.json"
    if not index_file.exists():
        with open(index_file, "w", encoding="utf-8") as f:
            f.write("{\n}\n")
        print("      [CREATED] Initialized companies_index.json")
    print(f"      [OK] Storage directory ready at: {COMPANIES_DIR}")
    return True

async def initialize_database():
    print("[4/5] Initializing SQLite Database & Tables...")
    sys.path.insert(0, str(PYTHON_BE_DIR))
    try:
        from app.core.database import engine
        from app.models import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print("      [OK] Database schema initialized with WAL mode & Foreign Keys enabled.")
        return True
    except Exception as e:
        print(f"      [ERROR] Database initialization failed: {e}")
        return False

def verify_app_factory():
    print("[5/5] Verifying FastAPI Application Lifespan...")
    try:
        from app.main import app
        print(f"      [OK] FastAPI app loaded successfully: '{app.title}' (v{app.version})")
        return True
    except Exception as e:
        print(f"      [ERROR] App import failed: {e}")
        return False

async def main():
    print("=" * 65)
    print("   CFO Yantra System & Storage Initialization")
    print("=" * 65)

    if not check_python_version():
        sys.exit(1)
    if not ensure_env_file():
        sys.exit(1)
    if not ensure_storage_directories():
        sys.exit(1)
    if not await initialize_database():
        sys.exit(1)
    if not verify_app_factory():
        sys.exit(1)

    print("=" * 65)
    print("   [SUCCESS] CFO Yantra Setup Complete & Ready to Run!")
    print("   To start backend: Double-click 'start_cfo_backend.bat'")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(main())
