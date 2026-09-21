"""
CFO Yantra — Company Database Manager.
Manages dedicated, physically isolated SQLite databases (database.sqlite)
for each registered company under data/companies/{company_folder}/.
Features:
- Bounded LRU AsyncEngine connection pooling per company (max 10 active engines)
- SQLite WAL mode, foreign keys, busy timeout, and normal synchronous enforcement
- Automatic schema creation for new company databases
- Transaction context manager for atomic unit-of-work
- Idempotent partitioning & migration from central cfo_yantra.sqlite into per-company databases
- Integrity check and record reconciliation reporting
"""

import asyncio
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator, Dict, Optional, Any, List
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession, AsyncEngine
from sqlalchemy import event, select, text
from app.models.base import Base
from app.services.storage.company_folder_service import company_folder_service


class CompanyDatabaseManager:
    MAX_ACTIVE_ENGINES: int = 10

    def __init__(self, max_engines: int = 10):
        self.MAX_ACTIVE_ENGINES = max_engines
        self._engines: Dict[str, AsyncEngine] = {}
        self._engine_last_used: Dict[str, float] = {}
        self._session_makers: Dict[str, async_sessionmaker[AsyncSession]] = {}
        self._lock = asyncio.Lock()

    def get_database_path(self, company_id: str) -> Path:
        """Returns the absolute Path to the company's dedicated database.sqlite."""
        folder = company_folder_service.get_company_folder(company_id)
        if not folder:
            meta = company_folder_service.ensure_company_structure(company_id)
            folder = Path(meta["folderPath"])
        return folder / "database.sqlite"

    async def get_engine(self, company_id: str, company_name: Optional[str] = None) -> AsyncEngine:
        """
        Retrieves or creates an AsyncEngine for the specified company with LRU eviction.
        Enforces a maximum of MAX_ACTIVE_ENGINES in memory.
        """
        cid = str(company_id).strip()
        if cid in self._engines:
            self._engine_last_used[cid] = time.time()
            return self._engines[cid]

        async with self._lock:
            if cid in self._engines:
                self._engine_last_used[cid] = time.time()
                return self._engines[cid]

            # Enforce LRU engine eviction if at capacity
            if len(self._engines) >= self.MAX_ACTIVE_ENGINES:
                candidates = [c for c in self._engines if c != cid]
                if candidates:
                    oldest_cid = min(candidates, key=lambda k: self._engine_last_used.get(k, 0))
                    old_engine = self._engines.pop(oldest_cid, None)
                    self._session_makers.pop(oldest_cid, None)
                    self._engine_last_used.pop(oldest_cid, None)
                    if old_engine:
                        try:
                            await old_engine.dispose()
                        except Exception:
                            pass

            # Ensure company folder and structure exists
            meta = company_folder_service.ensure_company_structure(cid, company_name)
            folder = Path(meta["folderPath"])
            db_path = folder / "database.sqlite"

            # Normalize posix path for SQLite URL
            posix_path = db_path.resolve().as_posix()
            async_url = f"sqlite+aiosqlite:///{posix_path}"

            engine = create_async_engine(
                async_url,
                echo=False,
                connect_args={"check_same_thread": False}
            )

            # Enforce SQLite PRAGMAs for high-concurrency WAL mode & integrity
            @event.listens_for(engine.sync_engine, "connect")
            def set_company_sqlite_pragma(dbapi_connection, connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

            # Ensure tables are created in the company database
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            self._engines[cid] = engine
            self._engine_last_used[cid] = time.time()
            self._session_makers[cid] = async_sessionmaker(
                bind=engine,
                autocommit=False,
                autoflush=False,
                expire_on_commit=False,
                class_=AsyncSession
            )
            return engine

    async def get_session(self, company_id: str, company_name: Optional[str] = None) -> AsyncGenerator[AsyncSession, None]:
        """Dependency generator yielding an AsyncSession for the company's dedicated database."""
        await self.get_engine(company_id, company_name)
        cid = str(company_id).strip()
        session_maker = self._session_makers[cid]
        self._engine_last_used[cid] = time.time()

        async with session_maker() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()

    async def get_session_direct(self, company_id: str, company_name: Optional[str] = None) -> AsyncSession:
        """Returns an active AsyncSession context for internal service calls."""
        await self.get_engine(company_id, company_name)
        cid = str(company_id).strip()
        self._engine_last_used[cid] = time.time()
        session_maker = self._session_makers[cid]
        return session_maker()

    @asynccontextmanager
    async def transaction(self, company_id: str, company_name: Optional[str] = None) -> AsyncGenerator[AsyncSession, None]:
        """Context manager providing an atomic transaction on the company's database."""
        session = await self.get_session_direct(company_id, company_name)
        try:
            async with session.begin():
                yield session
        finally:
            await session.close()

    async def close_engine(self, company_id: str):
        """Disposes and removes an active engine for a specific company."""
        cid = str(company_id).strip()
        async with self._lock:
            if cid in self._engines:
                engine = self._engines.pop(cid)
                self._session_makers.pop(cid, None)
                self._engine_last_used.pop(cid, None)
                await engine.dispose()

    async def close_all(self):
        """Disposes all active company database engines."""
        async with self._lock:
            for engine in self._engines.values():
                try:
                    await engine.dispose()
                except Exception:
                    pass
            self._engines.clear()
            self._session_makers.clear()
            self._engine_last_used.clear()

    async def migrate_records_from_central_db(self, central_db_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Partitions all existing records from central cfo_yantra.sqlite into each
        company's dedicated database.sqlite idempotently and with full reconciliation.
        """
        import sqlite3
        from app.core.config import settings, DEFAULT_SQLITE_PATH

        if not central_db_path:
            central_db_path = DEFAULT_SQLITE_PATH
            if not Path(central_db_path).exists():
                candidate = Path(__file__).resolve().parent.parent.parent.parent / "data" / "cfo_yantra.sqlite"
                if candidate.exists():
                    central_db_path = str(candidate)

        p = Path(central_db_path)
        if not p.exists():
            return {
                "success": False,
                "message": f"Central database not found at {central_db_path}",
                "companiesMigrated": 0
            }

        con = sqlite3.connect(str(p))
        con.row_factory = sqlite3.Row
        cur = con.cursor()

        # Check existing central table counts
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        existing_tables = [r[0] for r in cur.fetchall()]

        central_totals = {}
        for t in existing_tables:
            try:
                cur.execute(f'SELECT COUNT(*) FROM "{t}"')
                central_totals[t] = cur.fetchone()[0]
            except Exception:
                pass

        # Identify all distinct company IDs across source database
        company_records_map = {}
        if "companies" in existing_tables:
            for r in cur.execute("SELECT * FROM companies").fetchall():
                d = dict(r)
                company_records_map[d["companyId"]] = d

        # Check other tables for any company IDs not yet in companies table
        for t in ["vouchers", "ledgers", "groups", "stockitems", "stockgroups", "bill_outstandings", "sync_states"]:
            if t in existing_tables:
                try:
                    cur.execute(f'PRAGMA table_info("{t}")')
                    cols = [row[1] for row in cur.fetchall()]
                    if "companyId" in cols:
                        cur.execute(f'SELECT DISTINCT "companyId" FROM "{t}" WHERE "companyId" IS NOT NULL')
                        for cid_row in cur.fetchall():
                            cid = cid_row[0]
                            if cid and cid not in company_records_map:
                                company_records_map[cid] = {
                                    "companyId": cid,
                                    "name": cid,
                                    "legalName": cid
                                }
                except Exception:
                    pass

        tables_to_migrate = [
            ("companies", "companyId"),
            ("groups", "companyId"),
            ("ledgers", "companyId"),
            ("stockgroups", "companyId"),
            ("stockcategories", "companyId"),
            ("stockitems", "companyId"),
            ("vouchertypes", "companyId"),
            ("costcategories", "companyId"),
            ("costcentres", "companyId"),
            ("godowns", "companyId"),
            ("currencies", "companyId"),
            ("units", "companyId"),
            ("vouchers", "companyId"),
            ("bill_outstandings", "companyId"),
            ("sync_states", "companyId"),
        ]

        summary = {}
        reconciled_dest_totals = {t[0]: 0 for t in tables_to_migrate}

        for cid, comp in company_records_map.items():
            name = comp.get("name") or cid
            # Ensure folder and engine exists
            await self.get_engine(cid, name)
            comp_db_path = self.get_database_path(cid)

            dest_con = sqlite3.connect(str(comp_db_path))
            dest_cur = dest_con.cursor()

            comp_stats = {}
            for table_name, cid_col in tables_to_migrate:
                try:
                    if table_name not in existing_tables:
                        continue

                    # Select rows belonging to this company
                    rows = cur.execute(f'SELECT * FROM "{table_name}" WHERE "{cid_col}" = ?', (cid,)).fetchall()
                    if not rows:
                        comp_stats[table_name] = 0
                        continue

                    cols = [d[0] for d in cur.description]
                    col_names = ", ".join([f'"{c}"' for c in cols])
                    placeholders = ", ".join(["?"] * len(cols))
                    insert_sql = f'INSERT OR REPLACE INTO "{table_name}" ({col_names}) VALUES ({placeholders})'

                    row_tuples = [tuple(r) for r in rows]
                    dest_cur.executemany(insert_sql, row_tuples)
                    dest_con.commit()
                    comp_stats[table_name] = len(rows)
                    reconciled_dest_totals[table_name] += len(rows)
                except Exception as e:
                    comp_stats[f"{table_name}_error"] = str(e)

            # Check destination integrity
            dest_integrity = "unknown"
            try:
                res = dest_cur.execute("PRAGMA integrity_check").fetchone()
                dest_integrity = res[0] if res else "unknown"
            except Exception:
                pass

            dest_con.close()

            # Ensure sync_state.json and company.json are written
            comp_folder = comp_db_path.parent
            company_folder_service.save_company_profile(cid, comp)

            # Load sync state if present in sync_states table
            state_row = cur.execute("SELECT * FROM sync_states WHERE companyId = ?", (cid,)).fetchone()
            if state_row:
                s_dict = dict(state_row)
                company_folder_service.save_sync_state(cid, {
                    "companyId": cid,
                    "companyName": name,
                    "status": s_dict.get("status") or "COMPLETED",
                    "lastRunId": s_dict.get("lastRunId"),
                    "totalRecords": comp_stats.get("vouchers", 0) + comp_stats.get("ledgers", 0),
                    "lastFinishedAt": str(s_dict.get("lastFinishedAt") or s_dict.get("lastSuccessAt") or ""),
                    "lastSuccessAt": str(s_dict.get("lastSuccessAt") or "")
                })

            summary[cid] = {
                "name": name,
                "databasePath": str(comp_db_path.resolve()),
                "databaseIntegrity": dest_integrity,
                "migrated": comp_stats
            }

        con.close()

        # Build reconciliation status
        is_fully_reconciled = True
        reconciliation_discrepancies = []
        for t, src_count in central_totals.items():
            dest_count = reconciled_dest_totals.get(t, 0)
            if t in [item[0] for item in tables_to_migrate]:
                if src_count != dest_count:
                    is_fully_reconciled = False
                    reconciliation_discrepancies.append({
                        "table": t,
                        "sourceCount": src_count,
                        "destCount": dest_count,
                        "difference": src_count - dest_count
                    })

        return {
            "success": True,
            "message": f"Successfully partitioned and verified data for {len(summary)} companies into dedicated databases.",
            "companiesMigrated": len(summary),
            "reconciliation": {
                "sourceTotals": central_totals,
                "destinationTotals": reconciled_dest_totals,
                "isFullyReconciled": is_fully_reconciled,
                "discrepancies": reconciliation_discrepancies
            },
            "summary": summary
        }


company_db_manager = CompanyDatabaseManager()
