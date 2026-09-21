"""
Dashboard Aggregation Service.
Computes complete financial KPIs, monthly trends, voucher mix, and breakdown stats
from SQLite vouchers table with arbitrary Decimal precision.
Parity with src/services/dashboard.service.js.
"""

from datetime import datetime, date, timedelta
from decimal import Decimal
import json
from typing import Any, Dict, List, Optional, Set
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.voucher import Voucher
from app.models.company import Company
from app.models.master import Ledger, VoucherType
from app.core.decimal_util import (
    to_decimal,
    add,
    subtract,
    multiply,
    divide,
    format_financial,
    round_decimal
)

FLOW_SALES = "sales"
FLOW_SALES_RETURN = "salesReturns"
FLOW_PURCHASE = "purchases"
FLOW_PURCHASE_RETURN = "purchaseReturns"
FLOW_RECEIPT = "receipts"
FLOW_PAYMENT = "payments"
FLOW_CONTRA = "contra"
FLOW_ORDER = "orders"
FLOW_INVENTORY = "inventory"
FLOW_OTHER = "other"

ALL_FLOWS = [
    FLOW_SALES,
    FLOW_SALES_RETURN,
    FLOW_PURCHASE,
    FLOW_PURCHASE_RETURN,
    FLOW_RECEIPT,
    FLOW_PAYMENT,
    FLOW_CONTRA,
    FLOW_ORDER,
    FLOW_INVENTORY,
    FLOW_OTHER
]

MONEY_FLOWS = {FLOW_SALES, FLOW_PURCHASE, FLOW_RECEIPT, FLOW_PAYMENT}
MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NO_PARTY_LABEL = "(no party)"
NO_STATE_LABEL = "(no state)"


def to_iso_bound(compact: Optional[str]) -> Optional[str]:
    """Converts YYYYMMDD to YYYY-MM-DD."""
    if not compact:
        return None
    compact = str(compact).strip()
    if len(compact) == 8 and compact.isdigit():
        return f"{compact[:4]}-{compact[4:6]}-{compact[6:]}"
    if len(compact) == 10 and compact[4] == "-" and compact[7] == "-":
        return compact
    return None


def month_key_of(iso_date: Optional[str]) -> Optional[str]:
    """Returns YYYY-MM from YYYY-MM-DD."""
    if not iso_date:
        return None
    s = str(iso_date).strip()
    if len(s) >= 7 and s[4] == "-":
        return s[:7]
    return None


def month_label_of(month_key: Optional[str]) -> str:
    """Returns 'Mmm YYYY' from 'YYYY-MM'."""
    if not month_key or len(month_key) < 7:
        return ""
    try:
        parts = month_key.split("-")
        year = parts[0]
        month = int(parts[1])
        if 1 <= month <= 12:
            return f"{MONTH_LABELS[month - 1]} {year}"
    except Exception:
        pass
    return month_key


def month_range(from_key: Optional[str], to_key: Optional[str]) -> List[str]:
    """Returns all YYYY-MM strings from from_key to to_key inclusive."""
    keys: List[str] = []
    if not from_key or not to_key:
        return keys
    try:
        start_y, start_m = map(int, from_key.split("-"))
        end_y, end_m = map(int, to_key.split("-"))
        y, m = start_y, start_m
        while y < end_y or (y == end_y and m <= end_m):
            keys.append(f"{y:04d}-{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1
    except Exception:
        pass
    return keys


def classify_voucher_type(name: str, parent: Optional[str] = None) -> str:
    """Standardizes voucher type classification into core canonical flows."""
    n = (name or "").lower().strip()
    p = (parent or "").lower().strip()
    combined = f"{n} {p}"

    # 1. Orders
    if any(k in combined for k in ["purchase order", "sales order", "job work order", "indent", "proforma", "quotation", "estimate"]):
        return FLOW_ORDER

    # 2. Inventory movements
    if any(k in combined for k in [
        "delivery note", "delivery challan", "receipt note", "goods receipt note",
        "material in", "material out", "rejections in", "rejections out",
        "stock journal", "physical stock", "stock transfer"
    ]):
        return FLOW_INVENTORY

    # 3. Credit Note (Sales Return)
    if any(k in combined for k in ["credit note", "cr note", "sales return", "sale return"]):
        return FLOW_SALES_RETURN

    # 4. Debit Note (Purchase Return)
    if any(k in combined for k in ["debit note", "dr note", "purchase return"]):
        return FLOW_PURCHASE_RETURN

    # 5. Purchase
    if any(k in combined for k in ["purchase", "inward", "grn invoice"]):
        return FLOW_PURCHASE

    # 6. Sales
    if any(k in combined for k in ["sales", "sale", "tax invoice", "export sales", "domestic sales", "retail sale", "bill of supply", "invoice", "bill"]):
        return FLOW_SALES

    # 7. Cash/Bank flows
    if "receipt" in combined:
        return FLOW_RECEIPT
    if "payment" in combined:
        return FLOW_PAYMENT
    if "contra" in combined:
        return FLOW_CONTRA

    return FLOW_OTHER


def change_pct(current_val: Any, prev_val: Any) -> Optional[float]:
    """Calculates percentage change between current and previous values."""
    cur = float(to_decimal(current_val))
    prev = float(to_decimal(prev_val))
    if prev == 0:
        return None
    return round(((cur - prev) / abs(prev)) * 100.0, 1)


def kpi_payload(curr_amount: Decimal, curr_count: int, prev_amount: Decimal, prev_count: int) -> Dict[str, Any]:
    return {
        "amount": format_financial(curr_amount),
        "count": curr_count,
        "previousAmount": format_financial(prev_amount),
        "previousCount": prev_count,
        "changePct": change_pct(curr_amount, prev_amount)
    }


def rank_list(entries: List[Dict[str, Any]], limit: int = 7) -> Dict[str, Any]:
    """Sorts entries by amount descending and returns top N with tail stats."""
    sorted_entries = sorted(entries, key=lambda x: to_decimal(x.get("amount", 0)), reverse=True)
    top = sorted_entries[:limit]
    tail = sorted_entries[limit:]
    other_amount = sum((to_decimal(x.get("amount", 0)) for x in tail), Decimal("0"))
    return {
        "top": top,
        "otherCount": len(tail),
        "otherAmount": format_financial(other_amount)
    }


async def compute_dashboard_data(
    db: AsyncSession,
    company_id: str,
    from_date_raw: Optional[str] = None,
    to_date_raw: Optional[str] = None,
    top_n: int = 7,
    recent_limit: int = 20
) -> Dict[str, Any]:
    """Main aggregation pipeline for company dashboard."""
    # 1. Fetch company record
    comp_res = await db.execute(select(Company).where(Company.companyId == company_id))
    company = comp_res.scalar_one_or_none()
    company_name = company.name if company else "Unknown Company"
    starting_at = getattr(company, "startingAt", None)

    # 2. Fetch all vouchers for company
    v_res = await db.execute(
        select(Voucher).where(Voucher.companyId == company_id, Voucher.isDeleted == False)
    )
    vouchers = v_res.scalars().all()

    # 3. Fetch ledgers for party state/city resolution
    l_res = await db.execute(
        select(Ledger).where(Ledger.companyId == company_id, Ledger.isDeleted == False)
    )
    ledgers = l_res.scalars().all()
    party_map: Dict[str, Dict[str, str]] = {}
    for l in ledgers:
        p_name = l.name or ""
        p_data = l.data if isinstance(l.data, dict) else {}
        if not p_data and isinstance(l.data, str):
            try:
                p_data = json.loads(l.data)
            except Exception:
                p_data = {}
        party_map[p_name.lower().strip()] = {
            "name": p_name,
            "state": p_data.get("state") or p_data.get("stateName") or None,
            "city": p_data.get("city") or None
        }

    # 4. Fetch voucher types for hierarchy resolution
    vt_res = await db.execute(
        select(VoucherType).where(VoucherType.companyId == company_id, VoucherType.isDeleted == False)
    )
    vtypes = vt_res.scalars().all()
    vt_parent_map: Dict[str, str] = {}
    for vt in vtypes:
        if vt.name:
            vt_parent_map[vt.name.lower().strip()] = (vt.parent or vt.name).lower().strip()

    def resolve_flow(v_type_name: str) -> str:
        current_name = (v_type_name or "").lower().strip()
        parent_name = vt_parent_map.get(current_name, "")
        return classify_voucher_type(v_type_name, parent_name)

    # 5. Determine register span
    dated_vouchers = [v for v in vouchers if v.voucherDate]
    all_dates = sorted([v.voucherDate for v in dated_vouchers])
    register_span = {
        "from": all_dates[0] if all_dates else None,
        "to": all_dates[-1] if all_dates else None
    }

    # 6. Parse and resolve target period
    period_from = to_iso_bound(from_date_raw)
    period_to = to_iso_bound(to_date_raw)

    today_str = date.today().isoformat()
    period_auto_adjusted = False

    if not period_from or not period_to:
        # Default to register bounds or last 12 months
        if register_span["from"] and register_span["to"]:
            period_from = register_span["from"]
            period_to = register_span["to"]
            period_auto_adjusted = True
        else:
            # 12 months window up to today
            one_year_ago = date.today() - timedelta(days=365)
            period_from = one_year_ago.isoformat()
            period_to = today_str

    try:
        d_from = datetime.strptime(period_from, "%Y-%m-%d").date()
        d_to = datetime.strptime(period_to, "%Y-%m-%d").date()
        if d_from > d_to:
            d_from, d_to = d_to, d_from
            period_from, period_to = d_from.isoformat(), d_to.isoformat()
        period_days = (d_to - d_from).days + 1
    except Exception:
        period_days = 365
        d_to = date.today()
        d_from = d_to - timedelta(days=364)
        period_from = d_from.isoformat()
        period_to = d_to.isoformat()

    prev_d_to = d_from - timedelta(days=1)
    prev_d_from = prev_d_to - timedelta(days=period_days - 1)
    previous_from = prev_d_from.isoformat()
    previous_to = prev_d_to.isoformat()

    # 7. Accumulators
    current_totals = {flow: {"amount": Decimal("0"), "count": 0} for flow in ALL_FLOWS}
    previous_totals = {flow: {"amount": Decimal("0"), "count": 0} for flow in ALL_FLOWS}

    by_month: Dict[str, Dict[str, Any]] = {}
    by_customer: Dict[str, Dict[str, Any]] = {}
    by_item: Dict[str, Dict[str, Any]] = {}
    by_state: Dict[str, Dict[str, Any]] = {}
    customers_billed: Set[str] = set()
    prev_customers_billed: Set[str] = set()

    cancelled_in_period = 0
    sales_item_value = Decimal("0")
    sales_item_quantity = 0.0
    recent_list: List[Dict[str, Any]] = []

    for v in vouchers:
        v_date = v.voucherDate
        if not v_date:
            continue

        in_current = period_from <= v_date <= period_to
        in_previous = previous_from <= v_date <= previous_to
        if not in_current and not in_previous:
            continue

        v_data = v.data if isinstance(v.data, dict) else {}
        if not v_data and isinstance(v.data, str):
            try:
                v_data = json.loads(v.data)
            except Exception:
                v_data = {}

        is_cancelled = v_data.get("isCancelled", False)
        if is_cancelled:
            if in_current:
                cancelled_in_period += 1
            continue

        v_type_name = v_data.get("voucherType") or v.name or "Journal"
        flow = resolve_flow(v_type_name)
        raw_amt = v_data.get("amount") or 0
        amount = to_decimal(raw_amt)

        party_name = v_data.get("partyLedgerName") or v.parent or ""

        if in_previous:
            target = previous_totals[flow]
            target["amount"] += amount
            target["count"] += 1
            if flow == FLOW_SALES and party_name:
                prev_customers_billed.add(party_name)
            continue

        # In Current Period
        target = current_totals[flow]
        target["amount"] += amount
        target["count"] += 1

        month_key = month_key_of(v_date)
        if month_key and flow in MONEY_FLOWS:
            if month_key not in by_month:
                by_month[month_key] = {
                    "monthKey": month_key,
                    "label": month_label_of(month_key),
                    "sales": "0.00",
                    "purchases": "0.00",
                    "receipts": "0.00",
                    "payments": "0.00",
                    "salesCount": 0
                }
            bm = by_month[month_key]
            bm[flow] = format_financial(to_decimal(bm[flow]) + amount)
            if flow == FLOW_SALES:
                bm["salesCount"] += 1

        # Track recent vouchers
        inv_entries = v_data.get("inventoryEntries") or []
        recent_list.append({
            "date": v_date,
            "voucherNumber": v.sourceVoucherNumber or v_data.get("sourceVoucherNumber") or "",
            "voucherType": v_type_name,
            "category": flow,
            "party": party_name,
            "amount": format_financial(amount),
            "itemCount": len(inv_entries)
        })

        if flow == FLOW_SALES:
            party_info = party_map.get(party_name.lower().strip(), {})
            c_name = party_name or NO_PARTY_LABEL
            if party_name:
                customers_billed.add(party_name)

            if c_name not in by_customer:
                by_customer[c_name] = {
                    "name": c_name,
                    "state": party_info.get("state"),
                    "city": party_info.get("city"),
                    "amount": Decimal("0"),
                    "invoices": 0
                }
            by_customer[c_name]["amount"] += amount
            by_customer[c_name]["invoices"] += 1

            s_name = party_info.get("state") or NO_STATE_LABEL
            if s_name not in by_state:
                by_state[s_name] = {
                    "name": s_name,
                    "amount": Decimal("0"),
                    "invoices": 0
                }
            by_state[s_name]["amount"] += amount
            by_state[s_name]["invoices"] += 1

            for line in inv_entries:
                item_name = line.get("stockItemName")
                if not item_name:
                    continue
                line_amt = to_decimal(line.get("amount", 0))
                sales_item_value += line_amt
                qty = float(line.get("quantity") or 0.0)
                sales_item_quantity += qty
                unit = line.get("unit") or None

                if item_name not in by_item:
                    by_item[item_name] = {
                        "name": item_name,
                        "unit": unit,
                        "amount": Decimal("0"),
                        "quantity": 0.0,
                        "invoices": 0
                    }
                it = by_item[item_name]
                it["amount"] += line_amt
                it["quantity"] += qty
                it["invoices"] += 1
                if it["unit"] and unit and it["unit"] != unit:
                    it["unit"] = None

    # Continuous monthly axis
    axis_from = max(register_span["from"], period_from) if register_span["from"] else period_from
    axis_to = min(register_span["to"], period_to) if register_span["to"] else period_to
    all_months = month_range(month_key_of(axis_from), month_key_of(axis_to))
    monthly_series = []
    for mk in all_months:
        if mk in by_month:
            monthly_series.append(by_month[mk])
        else:
            monthly_series.append({
                "monthKey": mk,
                "label": month_label_of(mk),
                "sales": "0.00",
                "purchases": "0.00",
                "receipts": "0.00",
                "payments": "0.00",
                "salesCount": 0
            })

    # Sort recent
    recent_list.sort(key=lambda x: (x["date"], x["voucherNumber"]), reverse=True)

    # Net cash & avg invoice
    curr_sales = current_totals[FLOW_SALES]
    prev_sales = previous_totals[FLOW_SALES]
    curr_purchases = current_totals[FLOW_PURCHASE]
    prev_purchases = previous_totals[FLOW_PURCHASE]
    curr_receipts = current_totals[FLOW_RECEIPT]
    prev_receipts = previous_totals[FLOW_RECEIPT]
    curr_payments = current_totals[FLOW_PAYMENT]
    prev_payments = previous_totals[FLOW_PAYMENT]

    net_cash_curr = curr_receipts["amount"] - curr_payments["amount"]
    net_cash_prev = prev_receipts["amount"] - prev_payments["amount"]

    avg_inv_curr = (curr_sales["amount"] / curr_sales["count"]) if curr_sales["count"] > 0 else Decimal("0")
    avg_inv_prev = (prev_sales["amount"] / prev_sales["count"]) if prev_sales["count"] > 0 else Decimal("0")

    # Format customer, item, state entries for ranking
    customer_rows = [
        {"name": v["name"], "state": v["state"], "city": v["city"], "amount": format_financial(v["amount"]), "invoices": v["invoices"]}
        for v in by_customer.values()
    ]
    item_rows = [
        {"name": v["name"], "unit": v["unit"], "amount": format_financial(v["amount"]), "quantity": round(v["quantity"], 3), "invoices": v["invoices"]}
        for v in by_item.values()
    ]
    state_rows = [
        {"name": v["name"], "amount": format_financial(v["amount"]), "invoices": v["invoices"]}
        for v in by_state.values()
    ]

    # Voucher mix
    mix_labels = {
        FLOW_SALES: "Sales",
        FLOW_PURCHASE: "Purchases",
        FLOW_RECEIPT: "Receipts",
        FLOW_PAYMENT: "Payments",
        FLOW_ORDER: "Orders",
        FLOW_OTHER: "Journals"
    }
    voucher_mix = []
    for flow in [FLOW_SALES, FLOW_PURCHASE, FLOW_RECEIPT, FLOW_PAYMENT, FLOW_ORDER, FLOW_OTHER]:
        tot = current_totals[flow]
        if tot["count"] > 0 or flow in MONEY_FLOWS:
            voucher_mix.append({
                "category": flow,
                "label": mix_labels.get(flow, flow.capitalize()),
                "count": tot["count"],
                "amount": format_financial(tot["amount"])
            })

    # Coverage
    period_count = sum(t["count"] for t in current_totals.values())

    payload = {
        "success": True,
        "available": True,
        "companyId": company_id,
        "company": {
            "companyId": company_id,
            "companyName": company_name,
            "startingAt": starting_at
        },
        "period": {
            "from": period_from,
            "to": period_to,
            "days": period_days
        },
        "periodAutoAdjusted": period_auto_adjusted,
        "previousPeriod": {
            "from": previous_from,
            "to": previous_to
        },
        "registerSpan": register_span,
        "kpis": {
            "sales": kpi_payload(curr_sales["amount"], curr_sales["count"], prev_sales["amount"], prev_sales["count"]),
            "purchases": kpi_payload(curr_purchases["amount"], curr_purchases["count"], prev_purchases["amount"], prev_purchases["count"]),
            "receipts": kpi_payload(curr_receipts["amount"], curr_receipts["count"], prev_receipts["amount"], prev_receipts["count"]),
            "payments": kpi_payload(curr_payments["amount"], curr_payments["count"], prev_payments["amount"], prev_payments["count"]),
            "netCash": {
                "amount": format_financial(net_cash_curr),
                "previousAmount": format_financial(net_cash_prev),
                "changePct": change_pct(net_cash_curr, net_cash_prev)
            },
            "avgInvoice": {
                "amount": format_financial(avg_inv_curr),
                "previousAmount": format_financial(avg_inv_prev),
                "changePct": change_pct(avg_inv_curr, avg_inv_prev)
            },
            "customersBilled": {
                "count": len(customers_billed),
                "previousCount": len(prev_customers_billed),
                "changePct": change_pct(len(customers_billed), len(prev_customers_billed))
            },
            "salesReturns": kpi_payload(
                current_totals[FLOW_SALES_RETURN]["amount"], current_totals[FLOW_SALES_RETURN]["count"],
                previous_totals[FLOW_SALES_RETURN]["amount"], previous_totals[FLOW_SALES_RETURN]["count"]
            ),
            "purchaseReturns": kpi_payload(
                current_totals[FLOW_PURCHASE_RETURN]["amount"], current_totals[FLOW_PURCHASE_RETURN]["count"],
                previous_totals[FLOW_PURCHASE_RETURN]["amount"], previous_totals[FLOW_PURCHASE_RETURN]["count"]
            ),
            "salesItemValue": format_financial(sales_item_value),
            "salesItemQuantity": round(sales_item_quantity, 3)
        },
        "monthly": monthly_series,
        "topCustomers": rank_list(customer_rows, top_n),
        "topItems": rank_list(item_rows, top_n),
        "topStates": rank_list(state_rows, top_n),
        "voucherMix": voucher_mix,
        "recentVouchers": recent_list[:recent_limit],
        "coverage": {
            "registerCount": len(vouchers),
            "periodCount": period_count,
            "cancelledInPeriod": cancelled_in_period,
            "orderCount": current_totals[FLOW_ORDER]["count"],
            "orderAmount": format_financial(current_totals[FLOW_ORDER]["amount"]),
            "voucherTypesResolved": len(vtypes) > 0
        },
        "source": {
            "system": "mirror",
            "sourceType": "Voucher Register",
            "fetchedAt": datetime.now().isoformat()
        }
    }

    return payload
