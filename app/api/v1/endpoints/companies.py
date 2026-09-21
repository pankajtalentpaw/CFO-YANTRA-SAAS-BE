"""
Companies endpoints.
Matches src/routes/companiesRoutes.js and src/controllers/companiesController.js.
Ensures static catalog routes are registered BEFORE parameterized /{companyId} routes.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.core.database import get_db
from app.core.exceptions import ApiError, AppErrorCodes
from app.models import (
    Company, SyncState, Voucher, Ledger, Group,
    StockItem, StockGroup, Unit, Godown, CostCentre,
    VoucherType, BillOutstanding, unwrap_row
)
from app.services.analytics.catalog import get_catalog_summary, LENSES
from app.services.analytics.cube import AnalyticsCube, verify_cube
from app.services.analytics.dashboard_service import compute_dashboard_data

from datetime import datetime, timezone
from app.services.storage import company_folder_service
from app.services.tally.tally_client import tally_client

router = APIRouter(prefix="/companies", tags=["Companies"])

# --------------------------------------------------------------------------
# STATIC ROUTES (Registered FIRST to avoid /{companyId} shadowing)
# --------------------------------------------------------------------------

@router.get("/reports/report5/analytics/catalog")
async def get_analytics_catalog_global():
    return {
        "success": True,
        "data": get_catalog_summary()
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
    for c in companies:
        unwrapped = unwrap_row(c)
        meta = company_folder_service.ensure_company_structure(c.companyId, c.name)
        unwrapped["tallyFolder"] = meta.get("folderName")
        unwrapped["tallyCompanyNumber"] = meta.get("companyNumber")
        unwrapped["companyName"] = c.name or unwrapped.get("name")
        unwrapped["companyGuid"] = c.guid or unwrapped.get("guid") or c.companyId
        unwrapped["legalName"] = c.legalName or c.name or unwrapped.get("name")
        unwrapped["startingAt"] = c.startingAt or c.startingFrom or unwrapped.get("startingFrom")
        unwrapped["booksFrom"] = c.booksFrom or unwrapped.get("booksFrom")
        unwrapped["isOpen"] = bool(c.isOpen)
        output.append(unwrapped)

    return {
        "success": True,
        "companies": output,
        "data": output,
        "companyCount": len(output),
        "stale": is_stale
    }

# --------------------------------------------------------------------------
# COMPANY PARAMETERIZED ROUTES
# --------------------------------------------------------------------------

@router.get("/{companyId}/reports/report5/analytics/catalog")
async def get_company_analytics_catalog(companyId: str):
    return {
        "success": True,
        "companyId": companyId,
        "data": get_catalog_summary()
    }

@router.get("/{companyId}/reports/report5/analytics/dashboards")
async def get_company_analytics_dashboards(companyId: str):
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "ownerTop5": [],
            "salesManagerTop10": []
        }
    }

@router.get("/{companyId}/reports/report5/analytics/verification")
async def get_company_analytics_verification(companyId: str):
    cube = AnalyticsCube()
    results = verify_cube(cube)
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "checks": results,
            "allPassed": all(r["status"] == "PASS" for r in results)
        }
    }

@router.get("/{companyId}/reports/report5/analytics")
async def get_company_analytics(companyId: str):
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "analyses": [],
            "catalog": get_catalog_summary()
        }
    }

@router.get("/{companyId}/reports/report5")
@router.get("/{companyId}/mis-report-5")
async def get_mis_report_5(companyId: str):
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "reportId": "MIS05",
            "title": "Decision Intelligence MIS Report 5",
            "lenses": LENSES
        }
    }

@router.get("/{companyId}/overview")
async def get_overview(companyId: str, db: AsyncSession = Depends(get_db)):
    company_res = await db.execute(select(Company).where(Company.companyId == companyId))
    company = company_res.scalar_one_or_none()
    if not company:
        raise ApiError.not_found(f"Company {companyId} not found", AppErrorCodes.COMPANY_NOT_FOUND)

    v_count = await db.scalar(select(func.count(Voucher.id)).where(Voucher.companyId == companyId))
    l_count = await db.scalar(select(func.count(Ledger.id)).where(Ledger.companyId == companyId))
    g_count = await db.scalar(select(func.count(Group.id)).where(Group.companyId == companyId))
    s_count = await db.scalar(select(func.count(StockItem.id)).where(StockItem.companyId == companyId))

    return {
        "success": True,
        "data": {
            "company": unwrap_row(company),
            "counts": {
                "vouchers": v_count or 0,
                "ledgers": l_count or 0,
                "groups": g_count or 0,
                "stockItems": s_count or 0
            }
        }
    }

@router.get("/{companyId}/readiness")
async def get_readiness(companyId: str, db: AsyncSession = Depends(get_db)):
    company_res = await db.execute(select(Company).where(Company.companyId == companyId))
    company = company_res.scalar_one_or_none()
    if not company:
        raise ApiError.not_found(f"Company {companyId} not found", AppErrorCodes.COMPANY_NOT_FOUND)

    v_count = await db.scalar(select(func.count(Voucher.id)).where(Voucher.companyId == companyId))
    return {
        "success": True,
        "data": {
            "companyId": companyId,
            "hasVouchers": (v_count or 0) > 0,
            "voucherCount": v_count or 0,
            "isReady": (v_count or 0) > 0
        }
    }

@router.get("/{companyId}/ledgers")
async def get_ledgers(
    companyId: str,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
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
async def get_ledger(companyId: str, ledgerId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Ledger).where(Ledger.companyId == companyId, (Ledger.sourceObjectId == ledgerId) | (Ledger.id == ledgerId if ledgerId.isdigit() else False))
    )
    ledger = result.scalar_one_or_none()
    if not ledger:
        raise ApiError.not_found(f"Ledger {ledgerId} not found", AppErrorCodes.RESOURCE_NOT_FOUND)
    return {
        "success": True,
        "data": unwrap_row(ledger)
    }

@router.get("/{companyId}/groups")
async def get_groups(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Group).where(Group.companyId == companyId))
    groups = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(g) for g in groups]
    }

@router.get("/{companyId}/stock-items")
async def get_stock_items(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StockItem).where(StockItem.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }

@router.get("/{companyId}/stock-items/{stockItemId}")
async def get_stock_item(companyId: str, stockItemId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(StockItem).where(StockItem.companyId == companyId, (StockItem.sourceObjectId == stockItemId) | (StockItem.id == stockItemId if stockItemId.isdigit() else False))
    )
    item = result.scalar_one_or_none()
    if not item:
        raise ApiError.not_found(f"Stock item {stockItemId} not found", AppErrorCodes.RESOURCE_NOT_FOUND)
    return {
        "success": True,
        "data": unwrap_row(item)
    }

@router.get("/{companyId}/stock-groups")
async def get_stock_groups(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StockGroup).where(StockGroup.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }

@router.get("/{companyId}/cost-centres")
async def get_cost_centres(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CostCentre).where(CostCentre.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }

@router.get("/{companyId}/godowns")
async def get_godowns(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Godown).where(Godown.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }

@router.get("/{companyId}/units")
async def get_units(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Unit).where(Unit.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }

@router.get("/{companyId}/voucher-types")
async def get_voucher_types(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(VoucherType).where(VoucherType.companyId == companyId))
    items = result.scalars().all()
    return {
        "success": True,
        "data": [unwrap_row(i) for i in items]
    }

@router.get("/{companyId}/customers")
@router.get("/{companyId}/suppliers")
async def get_parties(companyId: str, db: AsyncSession = Depends(get_db)):
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
    db: AsyncSession = Depends(get_db)
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
async def get_voucher(companyId: str, voucherId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Voucher).where(Voucher.companyId == companyId, (Voucher.sourceObjectId == voucherId) | (Voucher.id == voucherId if voucherId.isdigit() else False))
    )
    voucher = result.scalar_one_or_none()
    if not voucher:
        raise ApiError.not_found(f"Voucher {voucherId} not found", AppErrorCodes.RESOURCE_NOT_FOUND)
    return {
        "success": True,
        "data": unwrap_row(voucher)
    }

@router.get("/{companyId}/sales-analysis")
async def get_sales_analysis(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    dash = await compute_dashboard_data(db, companyId, fromDate, toDate)
    kpi_sales = dash.get("kpis", {}).get("sales", {})
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "totalRevenue": kpi_sales.get("amount", "0.00"),
            "invoicesCount": kpi_sales.get("count", 0),
            "monthlyRevenue": [
                {"month": m["label"], "amount": m["sales"], "invoices": m.get("salesCount", 0)}
                for m in dash.get("monthly", [])
            ],
            "topCustomers": dash.get("topCustomers", {}),
            "topItems": dash.get("topItems", {})
        }
    }

@router.get("/{companyId}/purchase-analysis")
async def get_purchase_analysis(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    dash = await compute_dashboard_data(db, companyId, fromDate, toDate)
    kpi_pur = dash.get("kpis", {}).get("purchases", {})
    return {
        "success": True,
        "companyId": companyId,
        "data": {
            "totalPurchases": kpi_pur.get("amount", "0.00"),
            "billsCount": kpi_pur.get("count", 0),
            "monthlyPurchases": [
                {"month": m["label"], "amount": m["purchases"]}
                for m in dash.get("monthly", [])
            ]
        }
    }

@router.get("/{companyId}/dashboard")
async def get_dashboard(
    companyId: str,
    fromDate: Optional[str] = Query(None),
    toDate: Optional[str] = Query(None),
    topN: int = Query(7),
    db: AsyncSession = Depends(get_db)
):
    payload = await compute_dashboard_data(
        db=db,
        company_id=companyId,
        from_date_raw=fromDate,
        to_date_raw=toDate,
        top_n=topN
    )
    # Dual-mount so both top-level and .data match whatever frontend client expects
    payload["data"] = {
        "kpis": payload.get("kpis", {}),
        "trends": payload.get("monthly", []),
        "monthly": payload.get("monthly", []),
        "voucherMix": payload.get("voucherMix", [])
    }
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
async def get_company(companyId: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Company).where(Company.companyId == companyId))
    company = result.scalar_one_or_none()
    if not company:
        raise ApiError.not_found(f"Company {companyId} not found", AppErrorCodes.COMPANY_NOT_FOUND)
    data = unwrap_row(company)
    meta = company_folder_service.ensure_company_structure(company.companyId, company.name)
    data["tallyFolder"] = meta.get("folderName")
    data["tallyCompanyNumber"] = meta.get("companyNumber")
    return {
        "success": True,
        "data": data
    }

# --------------------------------------------------------------------------
# TALLY-STYLE FOLDER STORAGE & BACKUPS PER COMPANY
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
    db: AsyncSession = Depends(get_db)
):
    """
    Returns bill-wise receivables/payables (COA / VOA) with 4 aging buckets:
    0-30 days, 31-60 days, 61-90 days, 90+ days.
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

    # Aging calculation
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
