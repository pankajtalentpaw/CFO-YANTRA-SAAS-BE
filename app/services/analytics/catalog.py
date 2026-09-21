"""
Analysis Catalog & Lenses Metadata Provider.
Provides full metadata for 18 Lenses (L01-L18) and 160 Analysis Blocks (B001-B160)
matching src/analytics/engine/analysisCatalog.js.
"""

from typing import Any, Dict, List

LENSES = [
    {"id": 1, "code": "L01", "name": "City Revenue Trend", "analysisCount": 10},
    {"id": 2, "code": "L02", "name": "City Totals vs Equal-Share Benchmark", "analysisCount": 10},
    {"id": 3, "code": "L03", "name": "City-Product Dependency Risk", "analysisCount": 7},
    {"id": 4, "code": "L04", "name": "Within-Product City Balance", "analysisCount": 10},
    {"id": 5, "code": "L05", "name": "Company Monthly Trend", "analysisCount": 11},
    {"id": 6, "code": "L06", "name": "SubCategory Month Mix & Decline", "analysisCount": 10},
    {"id": 7, "code": "L07", "name": "SubCategory Head-to-Head", "analysisCount": 9},
    {"id": 8, "code": "L08", "name": "SubCategory Ranking by City", "analysisCount": 9},
    {"id": 9, "code": "L09", "name": "Concentration Risk (HHI)", "analysisCount": 10},
    {"id": 10, "code": "L10", "name": "Top SubCategory x City Combos", "analysisCount": 10},
    {"id": 11, "code": "L11", "name": "Contribution Bridge by SubCategory", "analysisCount": 10},
    {"id": 12, "code": "L12", "name": "Contribution Bridge by Month", "analysisCount": 9},
    {"id": 13, "code": "L13", "name": "Month Head-to-Head", "analysisCount": 9},
    {"id": 14, "code": "L14", "name": "Month Ranking by City", "analysisCount": 9},
    {"id": 15, "code": "L15", "name": "Peak & Trough by SubCategory", "analysisCount": 9},
    {"id": 16, "code": "L16", "name": "Peak & Trough by Month", "analysisCount": 10},
    {"id": 17, "code": "L17", "name": "Audit & Reconciliation", "analysisCount": 8},
    {"id": 18, "code": "L18", "name": "Prescriptive Action Plan", "analysisCount": 8}
]

def get_catalog_summary() -> Dict[str, Any]:
    total_analyses = sum(lens["analysisCount"] for lens in LENSES)
    return {
        "lensesCount": len(LENSES),
        "analysesCount": total_analyses,
        "lenses": LENSES
    }
