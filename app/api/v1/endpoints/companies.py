"""
Companies endpoints.
Matches src/routes/companiesRoutes.js and src/controllers/companiesController.js.
Ensures static catalog routes are registered BEFORE parameterized /{companyId} routes.
All company-scoped endpoints read directly from the dedicated local SQLite database
(data/companies/{company-folder}/database.sqlite), providing offline-first capabilities.
"""

from typing import Any, Dict, List, Optional, AsyncGenerator
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.core.company_db import company_db_manager
from app.core.exceptions import ApiError, AppErrorCodes
from app.models import (
    Company, SyncState, Voucher, Ledger, Group,
    StockItem, StockGroup, Unit, Godown, CostCentre,
    VoucherType, BillOutstanding, unwrap_row
)
from app.services.analytics.catalog import get_catalog_summary, LENSES
from app.services.analytics.cube import AnalyticsCube, verify_cube
from app.services.analytics.dashboard_service import compute_dashboard_data
from app.services.analytics.accounting_analysis import run_accounting_analysis
from app.services.analytics.mis_report5_bridge import call_mis_report5_engine

from datetime import datetime, timezone
from pathlib import Path
from app.services.storage import company_folder_service
from app.services.tally.tally_client import tally_client
from app.services.sync.scheduler import background_scheduler

router = APIRouter(prefix="/companies", tags=["Companies"])


# --------------------------------------------------------------------------
# DEPENDENCIES FOR COMPANY-ISOLATED LOCAL STORAGE
# --------------------------------------------------------------------------

async def get_comp_db(companyId: str) -> AsyncGenerator[AsyncSession, None]:
    """Dependency providing an AsyncSession connected to the company's dedicated database.sqlite."""
    async for session in company_db_manager.get_session(companyId):
        yield session


def _enrich_company_storage_metadata(cid: str, company_obj: Optional[Any] = None) -> Dict[str, Any]:
    """Computes storage telemetry, file sizes, sync freshness, and auto-sync settings."""
    meta = company_folder_service.ensure_company_structure(cid)
    db_path = company_folder_service.get_company_db_path(cid)
    sync_state = company_folder_service.load_sync_state(cid)
    has_local = db_path.exists() and db_path.stat().st_size > 0
    db_size = db_path.stat().st_size if has_local else 0

    last_sync = sync_state.get("lastSyncTime") or sync_state.get("lastSuccessAt")
    if not last_sync and company_obj and getattr(company_obj, "lastSeenAt", None):
        last_sync = company_obj.lastSeenAt.isoformat()

    status = sync_state.get("status")
    if not status:
        status = "COMPLETED" if has_local else "PENDING"

    c_sched = background_scheduler.get_company_config(cid)

    return {
        "tallyFolder": meta.get("folderName"),
        "tallyCompanyNumber": meta.get("companyNumber"),
        "isLocalAvailable": has_local,
        "localDatabaseSize": db_size,
        "lastSyncTime": last_sync,
        "isStale": sync_state.get("isStale", not has_local),
        "syncStatus": status,
        "autoSync": {
            "enabled": c_sched.get("enabled", True),
            "intervalMinutes": c_sched.get("intervalMinutes", 15)
        }
    }


# --------------------------------------------------------------------------
# STATIC ROUTES (Registered FIRST to avoid /{companyId} shadowing)
# --------------------------------------------------------------------------

@router.get("/reports/report5/analytics/catalog")
async def get_analytics_catalog_global():
    return {
        "success": True,
        "data": get_catalog_summary()
    }


@router.post("/register")
async def register_company(
    payload: Dict[str, Any] = Body(...),
    central_db: AsyncSession = Depends(get_db)
):
    """
    Registers a new company in CFO Yantra:
    - Derives or assigns stable internal company ID
    - Sets up dedicated Tally-style directory (data/companies/{comp_num}_{name}/)
    - Initializes dedicated SQLite database schema
    - Writes company.json profile and initial sync state
    - Registers in companies_index.json and central catalog mirror
    """
    name = payload.get("name") or payload.get("companyName")
    if not name or not str(name).strip():
        raise ApiError.bad_request("Company name is required for registration", AppErrorCodes.VALIDATION_ERROR)

    name = str(name).strip()
    guid = payload.get("guid") or payload.get("companyGuid")
    master_id = payload.get("masterId")
    company_id = payload.get("companyId") or company_folder_service.derive_stable_company_id(guid, master_id, name)

    # Ensure physical folder structure
    meta = company_folder_service.ensure_company_structure(company_id, name)

    # Initialize company database schema
    await company_db_manager.get_engine(company_id, name)

    # Save initial profile
    profile_data = {
        "companyId": company_id,
        "name": name,
        "legalName": payload.get("legalName") or name,
        "guid": guid,
        "masterId": master_id,
        "registeredAt": datetime.now(timezone.utc).isoformat(),
        **payload
    }
    company_folder_service.save_company_profile(company_id, profile_data)

    # Save initial sync state
    company_folder_service.save_sync_state(company_id, {
        "companyId": company_id,
        "companyName": name,
        "status": "INITIALIZED",
        "lastSyncTime": None,
        "isStale": True
    })

    # Register in central db catalog if not exists
    res = await central_db.execute(select(Company).where(Company.companyId == company_id))
    existing = res.scalar_one_or_none()
    now_utc = datetime.now(timezone.utc)
    if not existing:
        new_c = Company(
            companyId=company_id,
            name=name,
            legalName=payload.get("legalName") or name,
            guid=guid,
            masterId=master_id,
            isOpen=True,
            lastSeenAt=now_utc,
            createdAt=now_utc,
            updatedAt=now_utc
        )
        central_db.add(new_c)
        await central_db.commit()

    db_path = company_folder_service.get_company_db_path(company_id)
    return {
        "success": True,
        "message": f"Company '{name}' registered successfully with dedicated local storage",
        "data": {
            "companyId": company_id,
            "companyName": name,
            "folderName": meta.get("folderName"),
            "folderPath": meta.get("folderPath"),
            "databasePath": str(db_path),
            "isLocalAvailable": db_path.exists()
        }
    }


# --------------------------------------------------------------------------
# COMPANY LIST & CRUD
# --------------------------------------------------------------------------

@router.get("", include_in_schema=False)
@router.get("/")
async def get_companies(
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    is_stale = False
    try:
        loaded_tally = await tally_client.fetch_loaded_companies()
        active_company_names = {c["name"] for c in loaded_tally}

        for tc in loaded_tally:
            if not tc.get("gstin"):
                tax_info = await tally_client.extract_company_tax_registration(tc["name"])
                if tax_info.get("gstin"):
                    tc["gstin"] = tax_info["gstin"]
                    tc["gstRegNo"] = tax_info["gstin"]
                    if tax_info.get("pan"):
                        tc["pan"] = tax_info["pan"]
                        tc["panCardNo"] = tax_info["pan"]
                    tc["features"]["gstApplicable"] = True

        existing_result = await db.execute(select(Company))
        existing_companies = {c.companyId: c for c in existing_result.scalars().all()}
        existing_by_name = {c.name: c for c in existing_companies.values()}

        now_utc = datetime.now(timezone.utc)
        for tc in loaded_tally:
            cid = tc["companyId"]
            db_comp = existing_companies.get(cid) or existing_by_name.get(tc["name"])
            if db_comp:
                db_comp.name = tc["name"]
                db_comp.legalName = tc["legalName"]
                db_comp.formalName = tc["formalName"]
                db_comp.guid = tc["guid"]
                db_comp.masterId = tc["masterId"]
                db_comp.alterId = tc["alterId"]
                db_comp.startingFrom = tc["startingFrom"]
                db_comp.startingAt = tc["startingAt"]
                db_comp.booksFrom = tc["booksFrom"]
                db_comp.country = tc["country"]
                db_comp.countryName = tc["countryName"]
                db_comp.state = tc["state"]
                db_comp.stateName = tc["stateName"]
                db_comp.pinCode = tc["pinCode"]
                db_comp.email = tc["email"]
                db_comp.phone = tc["phone"]
                db_comp.mobile = tc["mobile"]
                db_comp.gstin = tc["gstin"]
                db_comp.gstRegNo = tc["gstRegNo"]
                db_comp.pan = tc["pan"]
                db_comp.panCardNo = tc["panCardNo"]
                db_comp.cin = tc["cin"]
                db_comp.cinNo = tc["cinNo"]
                db_comp.features = tc["features"]
                db_comp.isOpen = True
                db_comp.lastSeenAt = now_utc
            else:
                new_comp = Company(
                    companyId=cid,
                    name=tc["name"],
                    legalName=tc["legalName"],
                    formalName=tc["formalName"],
                    guid=tc["guid"],
                    masterId=tc["masterId"],
                    alterId=tc["alterId"],
                    startingFrom=tc["startingFrom"],
                    startingAt=tc["startingAt"],
                    booksFrom=tc["booksFrom"],
                    country=tc["country"],
                    countryName=tc["countryName"],
                    state=tc["state"],
                    stateName=tc["stateName"],
                    pinCode=tc["pinCode"],
                    email=tc["email"],
                    phone=tc["phone"],
                    mobile=tc["mobile"],
                    gstin=tc["gstin"],
                    gstRegNo=tc["gstRegNo"],
                    pan=tc["pan"],
                    panCardNo=tc["panCardNo"],
                    cin=tc["cin"],
                    cinNo=tc["cinNo"],
                    features=tc["features"],
                    isOpen=True,
                    lastSeenAt=now_utc,
                    createdAt=now_utc,
                    updatedAt=now_utc
                )
                db.add(new_comp)

        for c in existing_companies.values():
            if c.name not in active_company_names:
                c.isOpen = False

        await db.commit()
    except Exception:
        is_stale = True

    result = await db.execute(select(Company).order_by(Company.isOpen.desc(), Company.name))
    companies = result.scalars().all()
    output = []
    existing_cids = set()
    for c in companies:
        unwrapped = unwrap_row(c)
        meta_storage = _enrich_company_storage_metadata(c.companyId, c)
        unwrapped.update(meta_storage)
        unwrapped["companyName"] = c.name or unwrapped.get("name")
        unwrapped["companyGuid"] = c.guid or unwrapped.get("guid") or c.companyId
        unwrapped["legalName"] = c.legalName or c.name or unwrapped.get("name")
        unwrapped["startingAt"] = c.startingAt or c.startingFrom or unwrapped.get("startingFrom")
        unwrapped["booksFrom"] = c.booksFrom or unwrapped.get("booksFrom")
        unwrapped["isOpen"] = bool(c.isOpen)
        output.append(unwrapped)
        existing_cids.add(c.companyId)

    # Merge any registered companies from companies_index.json not already in central db
    indexed_companies = company_folder_service._load_index()
    for cid, meta in indexed_companies.items():
        if cid not in existing_cids:
            storage_meta = _enrich_company_storage_metadata(cid)
            entry = {
                "companyId": cid,
                "companyName": meta.get("companyName", cid),
                "name": meta.get("companyName", cid),
                "legalName": meta.get("companyName", cid),
                "companyGuid": meta.get("guid") or cid,
                "masterId": meta.get("masterId") or meta.get("companyNumber"),
                "isOpen": True,
                **storage_meta
            }
            output.append(entry)
            existing_cids.add(cid)

    return {
        "success": True,
        "companies": output,
        "data": output,
        "companyCount": len(output),
        "stale": is_stale
    }


# --------------------------------------------------------------------------
# COMPANY PARAMETERIZED ROUTES (LOCAL-FIRST VIA COMPANY DATABASE)
# --------------------------------------------------------------------------

@router.post("/{companyId}/register")
async def register_company_by_id(
    companyId: str,
    payload: Optional[Dict[str, Any]] = Body(default=None),
    db: AsyncSession = Depends(get_db)
):
    body = payload or {}
    body["companyId"] = companyId
    return await register_company(body, db)


@router.get("/{companyId}/reports/report5/analytics/catalog")
async def get_company_analytics_catalog(companyId: str):
    return {
        "success": True,
        "companyId": companyId,
        "data": get_catalog_summary()
    }


@router.get("/{companyId}/reports/report5/analytics/dashboards")
async def get_company_analytics_dashboards(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    measure: Optional[str] = Query("withCharges")
):
    """Returns Owner Top-5 Strategic Decisions & Sales Manager Top-10 Tactical Actions."""
    return call_mis_report5_engine(
        company_id=companyId,
        action="dashboards",
        options={"fromDate": fromDate, "toDate": toDate, "measure": measure}
    )


@router.get("/{companyId}/reports/report5/analytics/verification")
async def get_company_analytics_verification(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    measure: Optional[str] = Query("withCharges")
):
    """Executes CV01-CV16 mathematical cross-verification suite on company cube."""
    return call_mis_report5_engine(
        company_id=companyId,
        action="verification",
        options={"fromDate": fromDate, "toDate": toDate, "measure": measure}
    )


@router.get("/{companyId}/reports/report5/analytics")
async def get_company_analytics(
    companyId: str,
    lensId: Optional[int] = Query(None),
    analysisId: Optional[str] = Query(None),
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    measure: Optional[str] = Query("withCharges")
):
    """Executes 160-Analysis Decision Intelligence suite for specific lens or across all lenses."""
    return call_mis_report5_engine(
        company_id=companyId,
        action="analytics",
        options={"lensId": lensId, "analysisId": analysisId, "fromDate": fromDate, "toDate": toDate, "measure": measure}
    )


@router.get("/{companyId}/reports/report5")
@router.get("/{companyId}/mis-report-5")
async def get_mis_report_5(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    measure: Optional[str] = Query("withCharges"),
    filterId: Optional[int] = Query(None)
):
    """Executes 18-Filter Owner-POV Analytics Suite (Product x City x Month Cube)."""
    return call_mis_report5_engine(
        company_id=companyId,
        action="report5",
        options={"fromDate": fromDate, "toDate": toDate, "measure": measure, "filterId": filterId}
    )


@router.get("/{companyId}/overview")
async def get_overview(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    """Local-first company overview reading directly from the company's dedicated database."""
    company_res = await db.execute(select(Company).where(Company.companyId == companyId))
    company = company_res.scalar_one_or_none()

    if company:
        comp_dict = unwrap_row(company)
    else:
        meta = company_folder_service.ensure_company_structure(companyId)
        comp_dict = {
            "companyId": companyId,
            "name": meta.get("companyName", companyId),
            "isOpen": True
        }

    v_count = await db.scalar(select(func.count(Voucher.id)).where(Voucher.companyId == companyId))
    l_count = await db.scalar(select(func.count(Ledger.id)).where(Ledger.companyId == companyId))
    g_count = await db.scalar(select(func.count(Group.id)).where(Group.companyId == companyId))
    s_count = await db.scalar(select(func.count(StockItem.id)).where(StockItem.companyId == companyId))

    storage_meta = _enrich_company_storage_metadata(companyId, company)

    return {
        "success": True,
        "data": {
            "company": comp_dict,
            "counts": {
                "vouchers": v_count or 0,
                "ledgers": l_count or 0,
                "groups": g_count or 0,
                "stockItems": s_count or 0
            },
            "storage": storage_meta
        },
        **storage_meta
    }


@router.get("/{companyId}/readiness")
async def get_readiness(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    v_count = await db.scalar(select(func.count(Voucher.id)).where(Voucher.companyId == companyId))
    storage_meta = _enrich_company_storage_metadata(companyId)
    return {
        "success": True,
        "data": {
            "companyId": companyId,
            "hasVouchers": (v_count or 0) > 0,
            "voucherCount": v_count or 0,
            "isReady": (v_count or 0) > 0,
            "isLocalAvailable": storage_meta["isLocalAvailable"],
            "lastSyncTime": storage_meta["lastSyncTime"]
        }
    }


@router.get("/{companyId}/ledgers")
async def get_ledgers(
    companyId: str,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_comp_db)
):
    offset = (page - 1) * limit
    result = await db.execute(
        select(Ledger).where(Ledger.companyId == companyId).offset(offset).limit(limit)
    )
    ledgers = result.scalars().all()
    total = await db.scalar(select(func.count(Ledger.id)).where(Ledger.companyId == companyId))
    return {
        "success": True,
        "data": [unwrap_row(l) for l in ledgers],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total or 0
        }
    }


@router.get("/{companyId}/ledgers/{ledgerId}")
async def get_ledger(companyId: str, ledgerId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(
        select(Ledger).where(Ledger.companyId == companyId, (Ledger.sourceObjectId == ledgerId) | (Ledger.id == ledgerId if ledgerId.isdigit() else False))
    )
    ledger = result.scalar_one_or_none()
    if not ledger:
        raise ApiError.not_found(f"Ledger {ledgerId} not found in local database", AppErrorCodes.RESOURCE_NOT_FOUND)
    return {
        "success": True,
        "data": unwrap_row(ledger)
    }


@router.get("/{companyId}/groups")
async def get_groups(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(Group).where(Group.companyId == companyId))
    groups = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(g) for g in groups]
    }


@router.get("/{companyId}/stock-items")
async def get_stock_items(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(StockItem).where(StockItem.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }


@router.get("/{companyId}/stock-items/{stockItemId}")
async def get_stock_item(companyId: str, stockItemId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(
        select(StockItem).where(StockItem.companyId == companyId, (StockItem.sourceObjectId == stockItemId) | (StockItem.id == stockItemId if stockItemId.isdigit() else False))
    )
    item = result.scalar_one_or_none()
    if not item:
        raise ApiError.not_found(f"Stock item {stockItemId} not found in local database", AppErrorCodes.RESOURCE_NOT_FOUND)
    return {
        "success": True,
        "data": unwrap_row(item)
    }


@router.get("/{companyId}/stock-groups")
async def get_stock_groups(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(StockGroup).where(StockGroup.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }


@router.get("/{companyId}/cost-centres")
async def get_cost_centres(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(CostCentre).where(CostCentre.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }


@router.get("/{companyId}/godowns")
async def get_godowns(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(Godown).where(Godown.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }


@router.get("/{companyId}/units")
async def get_units(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(Unit).where(Unit.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }


@router.get("/{companyId}/voucher-types")
async def get_voucher_types(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(VoucherType).where(VoucherType.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }


@router.get("/{companyId}/customers")
@router.get("/{companyId}/suppliers")
async def get_parties(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(Ledger).where(Ledger.companyId == companyId).limit(100))
    ledgers = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(l) for l in ledgers]
    }


@router.get("/{companyId}/vouchers")
async def get_vouchers(
    companyId: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=1000),
    db: AsyncSession = Depends(get_comp_db)
):
    offset = (page - 1) * limit
    result = await db.execute(
        select(Voucher).where(Voucher.companyId == companyId).order_by(Voucher.voucherDate.desc()).offset(offset).limit(limit)
    )
    vouchers = result.scalars().all()
    total = await db.scalar(select(func.count(Voucher.id)).where(Voucher.companyId == companyId))
    return {
        "success": True,
        "data": [unwrap_row(v) for v in vouchers],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total or 0
        }
    }


@router.get("/{companyId}/vouchers/{voucherId}")
async def get_voucher(companyId: str, voucherId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(
        select(Voucher).where(Voucher.companyId == companyId, (Voucher.sourceObjectId == voucherId) | (Voucher.id == voucherId if voucherId.isdigit() else False))
    )
    voucher = result.scalar_one_or_none()
    if not voucher:
        raise ApiError.not_found(f"Voucher {voucherId} not found in local database", AppErrorCodes.RESOURCE_NOT_FOUND)
    return {
        "success": True,
        "data": unwrap_row(voucher)
    }


@router.get("/{companyId}/sales-analysis")
async def get_sales_analysis(
    companyId: str,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=1000),
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    product: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_comp_db)
):
    comp_res = await db.execute(select(Company).where(Company.companyId == companyId))
    company = comp_res.scalar_one_or_none()
    company_dict = unwrap_row(company) if company else {"companyId": companyId, "name": companyId}

    v_res = await db.execute(
        select(Voucher).where(Voucher.companyId == companyId, Voucher.isDeleted == False)
    )
    vouchers = [unwrap_row(v) for v in v_res.scalars().all()]

    l_res = await db.execute(
        select(Ledger).where(Ledger.companyId == companyId, Ledger.isDeleted == False)
    )
    party_map = {}
    for l in l_res.scalars().all():
        p_name = (l.name or "").lower().strip()
        p_data = l.data if isinstance(l.data, dict) else {}
        if not p_data and isinstance(l.data, str):
            try:
                p_data = json.loads(l.data)
            except Exception:
                p_data = {}
        party_map[p_name] = {
            "name": l.name,
            "state": p_data.get("state") or p_data.get("stateName") or None,
            "city": p_data.get("city") or None,
            "country": p_data.get("country") or p_data.get("countryName") or None
        }

    vt_res = await db.execute(
        select(VoucherType).where(VoucherType.companyId == companyId, VoucherType.isDeleted == False)
    )
    vt_map = {vt.name.lower().strip(): (vt.parent or vt.name).lower().strip() for vt in vt_res.scalars().all() if vt.name}

    options = {
        "fromDate": fromDate,
        "toDate": toDate,
        "customer": customer,
        "product": product,
        "country": country,
        "state": state,
        "city": city,
        "search": search,
        "page": page,
        "limit": limit
    }
    analysis = run_accounting_analysis(
        vouchers=vouchers,
        company=company_dict,
        direction="SALES",
        options=options,
        party_map=party_map,
        voucher_types_map=vt_map
    )

    all_rows = analysis.pop("rows", [])
    total_rows = len(all_rows)
    total_pages = (total_rows + limit - 1) // limit if limit > 0 else 1
    start_idx = (page - 1) * limit
    paged_rows = all_rows[start_idx:start_idx + limit]

    row_pagination = {
        "page": page,
        "limit": limit,
        "total": total_rows,
        "totalPages": max(1, total_pages)
    }

    return {
        "success": True,
        "companyId": companyId,
        "available": True,
        **analysis,
        "rows": paged_rows,
        "rowPagination": row_pagination
    }


@router.get("/{companyId}/purchase-analysis")
async def get_purchase_analysis(
    companyId: str,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=1000),
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    supplier: Optional[str] = Query(None),
    product: Optional[str] = Query(None),
    country: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    city: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_comp_db)
):
    comp_res = await db.execute(select(Company).where(Company.companyId == companyId))
    company = comp_res.scalar_one_or_none()
    company_dict = unwrap_row(company) if company else {"companyId": companyId, "name": companyId}

    v_res = await db.execute(
        select(Voucher).where(Voucher.companyId == companyId, Voucher.isDeleted == False)
    )
    vouchers = [unwrap_row(v) for v in v_res.scalars().all()]

    l_res = await db.execute(
        select(Ledger).where(Ledger.companyId == companyId, Ledger.isDeleted == False)
    )
    party_map = {}
    for l in l_res.scalars().all():
        p_name = (l.name or "").lower().strip()
        p_data = l.data if isinstance(l.data, dict) else {}
        if not p_data and isinstance(l.data, str):
            try:
                p_data = json.loads(l.data)
            except Exception:
                p_data = {}
        party_map[p_name] = {
            "name": l.name,
            "state": p_data.get("state") or p_data.get("stateName") or None,
            "city": p_data.get("city") or None,
            "country": p_data.get("country") or p_data.get("countryName") or None
        }

    vt_res = await db.execute(
        select(VoucherType).where(VoucherType.companyId == companyId, VoucherType.isDeleted == False)
    )
    vt_map = {vt.name.lower().strip(): (vt.parent or vt.name).lower().strip() for vt in vt_res.scalars().all() if vt.name}

    options = {
        "fromDate": fromDate,
        "toDate": toDate,
        "supplier": supplier,
        "product": product,
        "country": country,
        "state": state,
        "city": city,
        "search": search,
        "page": page,
        "limit": limit
    }
    analysis = run_accounting_analysis(
        vouchers=vouchers,
        company=company_dict,
        direction="PURCHASE",
        options=options,
        party_map=party_map,
        voucher_types_map=vt_map
    )

    all_rows = analysis.pop("rows", [])
    total_rows = len(all_rows)
    total_pages = (total_rows + limit - 1) // limit if limit > 0 else 1
    start_idx = (page - 1) * limit
    paged_rows = all_rows[start_idx:start_idx + limit]

    row_pagination = {
        "page": page,
        "limit": limit,
        "total": total_rows,
        "totalPages": max(1, total_pages)
    }

    return {
        "success": True,
        "companyId": companyId,
        "available": True,
        **analysis,
        "rows": paged_rows,
        "rowPagination": row_pagination
    }


@router.get("/{companyId}/dashboard")
async def get_dashboard(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    topN: int = Query(7),
    db: AsyncSession = Depends(get_comp_db)
):
    """
    Computes real-time dashboard KPIs, monthly charts, and cash/revenue metrics
    directly from the company's dedicated local SQLite database without requiring
    an active Tally connection.
    """
    payload = await compute_dashboard_data(
        db=db,
        company_id=companyId,
        from_date_raw=fromDate,
        to_date_raw=toDate,
        top_n=topN
    )
    storage_meta = _enrich_company_storage_metadata(companyId)
    payload["data"] = {
        "kpis": payload.get("kpis", {}),
        "trends": payload.get("monthly", []),
        "monthly": payload.get("monthly", []),
        "voucherMix": payload.get("voucherMix", []),
        "storage": storage_meta
    }
    payload.update(storage_meta)
    return payload


@router.get("/{companyId}/reconciliation-report")
async def get_reconciliation_report(companyId: str):
    cube = AnalyticsCube()
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "verification": verify_cube(cube)
        }
    }


@router.get("/{companyId}")
async def get_company(companyId: str, db: AsyncSession = Depends(get_comp_db)):
    result = await db.execute(select(Company).where(Company.companyId == companyId))
    company = result.scalar_one_or_none()
    meta = company_folder_service.ensure_company_structure(companyId)
    if not company:
        data = {
            "companyId": companyId,
            "name": meta.get("companyName", companyId),
            "isOpen": True
        }
    else:
        data = unwrap_row(company)

    storage_meta = _enrich_company_storage_metadata(companyId, company)
    data.update(storage_meta)
    return {
        "success": True,
        "data": data,
        **storage_meta
    }


# --------------------------------------------------------------------------
# TALLY-STYLE FOLDER STORAGE, BACKUPS & RESTORE PER COMPANY
# --------------------------------------------------------------------------

@router.get("/{companyId}/storage")
async def get_company_storage(companyId: str):
    """Retrieves Tally folder location, disk usage, and storage telemetry."""
    stats = company_folder_service.get_storage_stats(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "data": stats
    }


@router.post("/{companyId}/backup")
async def trigger_company_backup(
    companyId: str,
    payload: Optional[Dict[str, Any]] = Body(default=None)
):
    """Creates a compressed standalone .zip backup in the company's backups/ folder."""
    note = (payload or {}).get("note", "Manual backup via Company API")
    try:
        backup = company_folder_service.create_backup(companyId, note=note)
        return {
            "success": True,
            "message": f"Backup created successfully: {backup['filename']}",
            "data": backup
        }
    except Exception as e:
        raise ApiError(500, f"Failed to create backup: {str(e)}", AppErrorCodes.INTERNAL_ERROR)


@router.post("/{companyId}/restore")
async def restore_company_backup(
    companyId: str,
    payload: Dict[str, Any] = Body(...)
):
    """
    Safely restores a company's data and database from a designated .zip backup.
    Guarantees isolation: rejects restore if backup manifest companyId doesn't match!
    """
    backup_filename = payload.get("backupFilename") or payload.get("filename")
    if not backup_filename:
        raise ApiError.bad_request("backupFilename is required", AppErrorCodes.VALIDATION_ERROR)

    # First release any open database engine handles for this company
    await company_db_manager.close_engine(companyId)

    try:
        result = company_folder_service.restore_backup(companyId, backup_filename)
        return {
            "success": True,
            "message": f"Company '{companyId}' successfully restored from {backup_filename}",
            "data": result
        }
    except ValueError as ve:
        raise ApiError.bad_request(str(ve), AppErrorCodes.VALIDATION_ERROR)
    except FileNotFoundError as fe:
        raise ApiError.not_found(str(fe), AppErrorCodes.RESOURCE_NOT_FOUND)
    except Exception as e:
        raise ApiError(500, f"Restore failed: {str(e)}", AppErrorCodes.INTERNAL_ERROR)


@router.get("/{companyId}/backups")
async def get_company_backups(companyId: str):
    """Lists all available .zip backups inside the company folder."""
    backups = company_folder_service.list_backups(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "count": len(backups),
        "data": backups
    }


@router.get("/{companyId}/sync-state")
async def get_company_sync_state(companyId: str):
    """Returns local sync state and checkpoints from sync/sync-state.json."""
    state = company_folder_service.load_sync_state(companyId)
    return {
        "success": True,
        "companyId": companyId,
        "data": state
    }


@router.get("/{companyId}/sync-errors")
async def get_company_sync_errors(companyId: str, limit: int = Query(50)):
    """Returns recent error logs from sync/sync-errors.log."""
    sync_dir = company_folder_service.get_company_sync_dir(companyId)
    err_file = sync_dir / "sync-errors.log"
    lines = []
    if err_file.exists():
        with open(err_file, "r", encoding="utf-8") as f:
            lines = [l.strip() for l in f.readlines() if l.strip()]
    return {
        "success": True,
        "companyId": companyId,
        "count": len(lines),
        "data": lines[-limit:]
    }


@router.post("/{companyId}/open-folder")
async def open_company_folder(companyId: str):
    """Desktop helper to open the company folder directly in Windows Explorer."""
    folder = company_folder_service.get_company_folder(companyId)
    if not folder or not folder.exists():
        raise ApiError.not_found(f"Company folder for {companyId} not found", AppErrorCodes.RESOURCE_NOT_FOUND)

    import platform, os, subprocess
    path_str = str(folder.resolve())
    try:
        if platform.system() == "Windows":
            os.startfile(path_str)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", path_str])
        else:
            subprocess.Popen(["xdg-open", path_str])
        return {
            "success": True,
            "message": f"Opened company folder: {path_str}",
            "data": {"folderPath": path_str}
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Could not open file manager: {str(e)}",
            "data": {"folderPath": path_str}
        }


@router.get("/{companyId}/outstandings")
async def get_company_outstandings(
    companyId: str,
    partyType: Optional[str] = Query(None, description="CUSTOMER or VENDOR"),
    isOverdue: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_comp_db)
):
    """
    Returns bill-wise receivables/payables (COA / VOA) with 4 aging buckets:
    0-30 days, 31-60 days, 61-90 days, 90+ days directly from the company database.
    """
    query = select(BillOutstanding).where(BillOutstanding.companyId == companyId)
    if partyType:
        query = query.where(BillOutstanding.partyType == partyType.upper())
    if isOverdue is not None:
        query = query.where(BillOutstanding.isOverdue == isOverdue)

    result = await db.execute(query.order_by(BillOutstanding.overdueDays.desc()))
    bills = result.scalars().all()

    total_receivable = sum(b.pendingAmount for b in bills if b.partyType == "CUSTOMER")
    total_payable = sum(b.pendingAmount for b in bills if b.partyType == "VENDOR")
    total_overdue = sum(b.pendingAmount for b in bills if b.isOverdue)

    aging = {"0_30": 0.0, "31_60": 0.0, "61_90": 0.0, "90_plus": 0.0}
    for b in bills:
        days = b.overdueDays
        if days <= 30:
            aging["0_30"] += b.pendingAmount
        elif days <= 60:
            aging["31_60"] += b.pendingAmount
        elif days <= 90:
            aging["61_90"] += b.pendingAmount
        else:
            aging["90_plus"] += b.pendingAmount

    return {
        "success": True,
        "companyId": companyId,
        "summary": {
            "totalBills": len(bills),
            "totalReceivable": round(total_receivable, 2),
            "totalPayable": round(total_payable, 2),
            "totalOverdue": round(total_overdue, 2),
            "agingBuckets": {k: round(v, 2) for k, v in aging.items()}
        },
        "data": [unwrap_row(b) for b in bills]
    }
