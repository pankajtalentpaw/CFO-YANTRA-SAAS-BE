"""
Tally endpoints.
Matches src/controllers/tallyController.js.
"""

from fastapi import APIRouter
from app.services.tally.tally_client import tally_client

router = APIRouter(prefix="/tally", tags=["Tally"])

@router.get("/health")
async def get_health():
    probe = await tally_client.probe_connection()
    return {
        "success": probe["connected"],
        "status": probe["status"],
        "responseTimeMs": probe["responseTimeMs"]
    }

@router.get("/status")
async def get_status():
    probe = await tally_client.probe_connection()
    return {
        "success": True,
        "data": probe
    }

@router.get("/capabilities")
async def get_capabilities():
    return {
        "success": True,
        "data": {
            "httpServer": True,
            "xmlExport": True,
            "jsonExport": False,
            "readOnlyEnforced": True,
            "maxSockets": 1,
            "alterIdTracking": True
        }
    }

@router.get("/company")
async def get_active_company():
    probe = await tally_client.probe_connection()
    companies = probe.get("activeCompanies", [])
    return {
        "success": True,
        "companyCount": len(companies),
        "companies": companies,
        "data": {
            "activeCompany": companies[0] if companies else None,
            "allCompanies": companies
        }
    }

@router.get("/masters")
async def get_masters():
    return {
        "success": True,
        "data": {
            "supportedMasters": [
                "Ledger", "Group", "StockItem", "StockGroup",
                "StockCategory", "Unit", "Godown", "CostCentre",
                "CostCategory", "VoucherType", "Currency"
            ]
        }
    }

@router.get("/transport")
async def get_transport():
    return {
        "success": True,
        "data": {
            "mode": "HTTP_LOOPBACK",
            "host": tally_client.host,
            "port": tally_client.port,
            "singleSocketSerialized": True
        }
    }

@router.get("/factsales")
async def get_fact_sales():
    return {
        "success": True,
        "data": []
    }
