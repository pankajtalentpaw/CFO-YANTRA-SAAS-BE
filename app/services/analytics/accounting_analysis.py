"""
Unified Accounting Analysis Engine for CFO Yantra (Python 3.12+).
Provides 100% Decimal precision calculations, multi-dimensional slicing,
and full parity with the canonical accountingAnalysis.engine.js.
Supports both SALES and PURCHASE directions.
"""

from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple

MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NO_STATE_LABEL = "(no state)"
NO_CITY_LABEL = "(no city)"
NO_COUNTRY_LABEL = "(no country)"
RANKED_LIST_CAP = 500


def to_decimal(val: Any) -> Decimal:
    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    if isinstance(val, (int, float)):
        return Decimal(str(val))
    s = str(val).strip()
    if not s:
        return Decimal("0")
    # Handle multi-currency text (e.g. "-$700.00 @ ₹91.73/$ = -₹64211.00")
    if "=" in s:
        s = s.split("=")[-1].strip()
    # Strip currency symbols and whitespace
    clean = re.sub(r"[^\d.-]", "", s)
    if not clean or clean in ("-", "."):
        return Decimal("0")
    try:
        return Decimal(clean)
    except Exception:
        return Decimal("0")


def to_decimal_string(val: Any, places: int = 2) -> str:
    d = to_decimal(val)
    q = Decimal(10) ** -places
    return str(d.quantize(q, rounding=ROUND_HALF_UP))


def to_iso_date(raw_date: Optional[str]) -> Optional[str]:
    if not raw_date:
        return None
    s = str(raw_date).strip()
    if len(s) == 8 and s.isdigit():
        return f"{s[:4]}-{s[4:6]}-{s[6:]}"
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return s


def to_compact_date(iso_date: Optional[str]) -> Optional[str]:
    if not iso_date:
        return None
    s = str(iso_date).strip().replace("-", "")
    return s if len(s) == 8 and s.isdigit() else None


def month_key_of(raw_date: Optional[str]) -> Optional[str]:
    iso = to_iso_date(raw_date)
    if not iso or len(iso) < 7:
        return None
    return iso[:7]


def month_label_of(month_key: Optional[str]) -> str:
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


def classify_voucher_type(name: str, parent: Optional[str] = None) -> str:
    n = (name or "").lower().strip()
    p = (parent or "").lower().strip()
    combined = f"{n} {p}"

    # 1. Orders & Indents (Non-financial - MUST EXCLUDE)
    if any(k in combined for k in [
        "purchase order", "sales order", "job work order", "indent",
        "proforma", "quotation", "estimate"
    ]):
        return "ORDER"

    # 2. Inventory Movements (Non-financial - MUST EXCLUDE)
    if any(k in combined for k in [
        "delivery note", "delivery challan", "receipt note", "goods receipt note",
        "material in", "material out", "rejections in", "rejections out",
        "stock journal", "physical stock", "stock transfer"
    ]):
        return "INVENTORY_MOVEMENT"

    # 3. Sales Returns (Credit Notes)
    if any(k in combined for k in ["credit note", "cr note", "sales return", "sale return"]):
        return "CREDIT_NOTE"

    # 4. Purchase Returns (Debit Notes)
    if any(k in combined for k in ["debit note", "dr note", "purchase return"]):
        return "DEBIT_NOTE"

    # 5. Purchases
    if any(k in combined for k in ["purchase", "inward", "grn invoice"]):
        return "PURCHASE"

    # 6. Sales
    if any(k in combined for k in ["sales", "sale", "tax invoice", "export sales", "domestic sales", "retail sale", "bill of supply", "invoice", "bill"]):
        return "SALES"

    if "receipt" in combined:
        return "RECEIPT"
    if "payment" in combined:
        return "PAYMENT"
    if "contra" in combined:
        return "CONTRA"

    return "OTHER"


def classify_ledger_role(ledger_name: str, party_ledger_name: str = "") -> str:
    name = (ledger_name or "").lower().strip()
    party = (party_ledger_name or "").lower().strip()

    if party and name == party:
        return "PARTY"

    # 1. Taxes
    if re.search(r"\b(cgst|central\s*tax|central\s*goods)\b", name):
        return "TAX_CGST"
    if re.search(r"\b(sgst|state\s*tax|state\s*goods|utgst|union\s*territory)\b", name):
        return "TAX_SGST"
    if re.search(r"\b(igst|integrated\s*tax|integrated\s*goods)\b", name):
        return "TAX_IGST"
    if re.search(r"\b(cess|compensation\s*cess)\b", name):
        return "TAX_CESS"
    if re.search(r"\b(duties\s*&\s*taxes|tax|gst|vat|tds|tcs)\b", name):
        return "TAX_OTHER"

    # 2. Round off
    if re.search(r"\b(round\s*off|rounding|roundoff|round\s*adjustment)\b", name):
        return "ROUND_OFF"

    # 3. Discounts
    if re.search(r"\b(discount|rebate|trade\s*disc|cash\s*disc|disc\s*allowed|disc\s*received)\b", name):
        return "DISCOUNT"

    # 4. Additional Charges / Overheads
    if re.search(r"\b(freight|transport|cartage|shipping|courier|insurance|packing|loading|handling|forwarding|delivery\s*charges)\b", name):
        return "ADDITIONAL_CHARGES"

    return "BASE_AMOUNT"


def calculate_voucher_ledger_breakdown(voucher: Dict[str, Any]) -> Dict[str, Any]:
    party_ledger = voucher.get("partyLedgerName") or ""
    entries = voucher.get("ledgerEntries") or []
    if not isinstance(entries, list):
        entries = []

    cgst = Decimal("0")
    sgst = Decimal("0")
    igst = Decimal("0")
    utgst = Decimal("0")
    cess = Decimal("0")
    other_tax = Decimal("0")
    round_off = Decimal("0")
    discount = Decimal("0")
    additional_charges = Decimal("0")
    base_ledger_amount = Decimal("0")

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        lname = entry.get("ledgerName") or ""
        amt = abs(to_decimal(entry.get("amount") or 0))
        role = classify_ledger_role(lname, party_ledger)

        if role == "TAX_CGST":
            cgst += amt
        elif role == "TAX_SGST":
            sgst += amt
        elif role == "TAX_IGST":
            igst += amt
        elif role == "TAX_CESS":
            cess += amt
        elif role == "TAX_OTHER":
            other_tax += amt
        elif role == "ROUND_OFF":
            is_deduction = entry.get("isCredit") is False and str(entry.get("amount", "")).startswith("-")
            round_off = round_off - amt if is_deduction else round_off + amt
        elif role == "DISCOUNT":
            discount += amt
        elif role == "ADDITIONAL_CHARGES":
            additional_charges += amt
        elif role == "BASE_AMOUNT":
            base_ledger_amount += amt

    total_tax = cgst + sgst + igst + utgst + cess + other_tax

    return {
        "cgst": cgst,
        "sgst": sgst,
        "igst": igst,
        "utgst": utgst,
        "cess": cess,
        "otherTax": other_tax,
        "totalTax": total_tax,
        "roundOff": round_off,
        "discount": discount,
        "additionalCharges": additional_charges,
        "baseLedgerAmount": base_ledger_amount
    }


def normalize_voucher_analysis(
    voucher: Dict[str, Any],
    direction: str = "SALES",
    voucher_types_map: Optional[Dict[str, str]] = None,
    party_map: Optional[Dict[str, Dict[str, Any]]] = None
) -> Dict[str, Any]:
    v_type_name = voucher.get("voucherType") or voucher.get("voucherTypeName") or voucher.get("name") or ""
    parent = (voucher_types_map or {}).get(v_type_name.lower().strip())
    core_type = classify_voucher_type(v_type_name, parent)

    is_sales_return = core_type == "CREDIT_NOTE"
    is_purchase_return = core_type == "DEBIT_NOTE"
    is_return = is_sales_return if direction == "SALES" else is_purchase_return

    sign = Decimal("-1") if is_return else Decimal("1")
    raw_voucher_amt = abs(to_decimal(voucher.get("amount") or 0))
    invoiced_value = sign * raw_voucher_amt

    party_name = voucher.get("partyLedgerName") or voucher.get("parent") or ""
    party_info = (party_map or {}).get(party_name.lower().strip(), {})
    party_profile = {
        "country": party_info.get("country") or NO_COUNTRY_LABEL,
        "state": party_info.get("state") or party_info.get("stateName") or NO_STATE_LABEL,
        "city": party_info.get("city") or NO_CITY_LABEL,
        "cityConfidence": party_info.get("cityConfidence") or ("confident" if party_info.get("city") else "none")
    }

    ledger_breakdown = calculate_voucher_ledger_breakdown(voucher)

    inv_lines = voucher.get("inventoryEntries") or []
    if not isinstance(inv_lines, list):
        inv_lines = []
    has_inventory = len(inv_lines) > 0

    item_value = Decimal("0")
    item_quantity = 0.0
    detail_rows = []

    v_date = to_iso_date(voucher.get("voucherDate"))
    v_number = voucher.get("voucherNumber") or voucher.get("sourceVoucherNumber") or ""

    if has_inventory:
        total_lines_amt = sum((abs(to_decimal(l.get("amount") or 0)) for l in inv_lines if isinstance(l, dict)), Decimal("0"))
        for l in inv_lines:
            if not isinstance(l, dict):
                continue
            raw_line_amt = abs(to_decimal(l.get("amount") or 0))
            line_amount = sign * raw_line_amt
            item_value += line_amount

            qty_raw = l.get("quantity") or 0.0
            try:
                qty = float(qty_raw)
            except Exception:
                qty = 0.0
            signed_qty = -abs(qty) if is_return else abs(qty)
            item_quantity += signed_qty

            line_ratio = (
                Decimal(1) / Decimal(len(inv_lines) or 1)
                if total_lines_amt.is_zero()
                else raw_line_amt / total_lines_amt
            )

            line_gst = sign * (ledger_breakdown["totalTax"] * line_ratio)
            line_charges = sign * (
                (ledger_breakdown["additionalCharges"] + ledger_breakdown["roundOff"] - ledger_breakdown["discount"]) * line_ratio
            )
            line_total = line_amount + line_gst + line_charges

            detail_rows.append({
                "date": v_date,
                "voucherNumber": v_number,
                "voucherType": v_type_name,
                "voucherName": v_type_name,
                "voucherTypeName": v_type_name,
                "coreType": core_type,
                "party": party_name or "(no party)",
                "customer": party_name or "(no party)",
                "supplier": party_name or "(no party)",
                "product": l.get("stockItemName") or "(no item)",
                "quantity": signed_qty,
                "unit": l.get("unit") or None,
                "rate": l.get("rate") or None,
                "country": party_profile["country"] if party_profile["country"] != NO_COUNTRY_LABEL else None,
                "state": party_profile["state"] if party_profile["state"] != NO_STATE_LABEL else None,
                "city": party_profile["city"] if party_profile["city"] != NO_CITY_LABEL else None,
                "cityConfidence": party_profile["cityConfidence"],
                "amount": to_decimal_string(line_amount),
                "gst": to_decimal_string(line_gst),
                "charges": to_decimal_string(line_charges),
                "totalAmount": to_decimal_string(line_total),
                "salesAmount": to_decimal_string(line_amount),
                "isAccountingInvoice": False,
                "isReturn": is_return
            })
        net_value = item_value
    else:
        # Accounting invoice without inventory items
        base_ledger_name = None
        for entry in voucher.get("ledgerEntries", []):
            if isinstance(entry, dict):
                lname = entry.get("ledgerName") or ""
                if classify_ledger_role(lname, party_name) == "BASE_AMOUNT":
                    base_ledger_name = lname
                    break

        item_name = base_ledger_name or "(Service / Accounting Invoice)"
        line_amount = sign * ledger_breakdown["baseLedgerAmount"]
        if line_amount.is_zero() and not raw_voucher_amt.is_zero():
            line_amount = invoiced_value - (sign * ledger_breakdown["totalTax"])

        item_value = Decimal("0")
        net_value = line_amount
        line_gst = sign * ledger_breakdown["totalTax"]
        line_charges = sign * (
            ledger_breakdown["additionalCharges"] + ledger_breakdown["roundOff"] - ledger_breakdown["discount"]
        )
        line_total = line_amount + line_gst + line_charges

        detail_rows.append({
            "date": v_date,
            "voucherNumber": v_number,
            "voucherType": v_type_name,
            "voucherName": v_type_name,
            "voucherTypeName": v_type_name,
            "coreType": core_type,
            "party": party_name or "(no party)",
            "customer": party_name or "(no party)",
            "supplier": party_name or "(no party)",
            "product": item_name,
            "quantity": 0,
            "unit": None,
            "rate": None,
            "country": party_profile["country"] if party_profile["country"] != NO_COUNTRY_LABEL else None,
            "state": party_profile["state"] if party_profile["state"] != NO_STATE_LABEL else None,
            "city": party_profile["city"] if party_profile["city"] != NO_CITY_LABEL else None,
            "cityConfidence": party_profile["cityConfidence"],
            "amount": to_decimal_string(line_amount),
            "gst": to_decimal_string(line_gst),
            "charges": to_decimal_string(line_charges),
            "totalAmount": to_decimal_string(line_total),
            "salesAmount": to_decimal_string(line_amount),
            "isAccountingInvoice": True,
            "isReturn": is_return
        })

    return {
        "coreType": core_type,
        "isReturn": is_return,
        "rawVoucherAmount": raw_voucher_amt,
        "invoicedValue": invoiced_value,
        "itemValue": item_value,
        "netValue": net_value,
        "itemQuantity": item_quantity,
        "partyProfile": party_profile,
        "taxBreakdown": ledger_breakdown,
        "hasInventory": has_inventory,
        "detailRows": detail_rows
    }


def rank(entries: List[Dict[str, Any]], top_n: int = 8) -> Dict[str, Any]:
    entries_sorted = sorted(entries, key=lambda x: to_decimal(x.get("amount", 0)), reverse=True)
    return {
        "all": entries_sorted,
        "top": entries_sorted[:top_n],
        "totalCount": len(entries_sorted),
        "listTruncated": len(entries_sorted) > RANKED_LIST_CAP
    }


def run_accounting_analysis(
    vouchers: List[Dict[str, Any]],
    company: Optional[Dict[str, Any]] = None,
    direction: str = "SALES",
    options: Optional[Dict[str, Any]] = None,
    party_map: Optional[Dict[str, Dict[str, Any]]] = None,
    voucher_types_map: Optional[Dict[str, str]] = None,
    fetched_at: Optional[str] = None,
    synced_at: Optional[str] = None
) -> Dict[str, Any]:
    options = options or {}
    from_date = to_iso_date(options.get("fromDate"))
    to_date = to_iso_date(options.get("toDate"))
    target_party = options.get("customer") or options.get("supplier") or options.get("party")
    product_filter = options.get("product")
    country_filter = options.get("country")
    state_filter = options.get("state")
    city_filter = options.get("city")
    search_query = (options.get("search") or "").strip().lower()

    def to_set(val: Any) -> Optional[Set[str]]:
        if not val:
            return None
        if isinstance(val, (list, tuple, set)):
            return {str(x).strip().lower() for x in val if str(x).strip()}
        if isinstance(val, str):
            parts = [p.strip().lower() for p in val.split(",") if p.strip()]
            return set(parts) if parts else None
        return {str(val).strip().lower()}

    party_set = to_set(target_party)
    product_set = to_set(product_filter)
    country_set = to_set(country_filter)
    state_set = to_set(state_filter)
    city_set = to_set(city_filter)

    is_sales = direction == "SALES"
    valid_core_types = {"SALES", "CREDIT_NOTE"} if is_sales else {"PURCHASE", "DEBIT_NOTE"}

    # 1. Filter vouchers by validity, core type, and dates
    valid_vouchers = []
    distinct_customers = set()
    distinct_products = set()
    distinct_countries = set()
    distinct_states = set()
    distinct_cities = set()

    for v in vouchers:
        if not isinstance(v, dict):
            continue
        if v.get("isCancelled") or v.get("isOptional") or v.get("isDeleted"):
            continue

        v_type = v.get("voucherType") or v.get("voucherTypeName") or v.get("name") or ""
        parent = (voucher_types_map or {}).get(v_type.lower().strip())
        core_type = classify_voucher_type(v_type, parent)
        if core_type not in valid_core_types:
            continue

        v_iso_date = to_iso_date(v.get("voucherDate"))
        if from_date and v_iso_date and v_iso_date < from_date:
            continue
        if to_date and v_iso_date and v_iso_date > to_date:
            continue

        valid_vouchers.append(v)

        # Collect filter options
        p_name = v.get("partyLedgerName") or v.get("parent") or ""
        if p_name:
            distinct_customers.add(p_name)
        p_info = (party_map or {}).get(p_name.lower().strip(), {})
        c = p_info.get("country")
        s = p_info.get("state") or p_info.get("stateName")
        ci = p_info.get("city")
        if c:
            distinct_countries.add(c)
        if s:
            distinct_states.add(s)
        if ci:
            distinct_cities.add(ci)

        for line in v.get("inventoryEntries") or []:
            if isinstance(line, dict):
                item = line.get("stockItemName")
                if item:
                    distinct_products.add(item)

    filter_options = {
        "customers": sorted(list(distinct_customers)),
        "suppliers": sorted(list(distinct_customers)),
        "products": sorted(list(distinct_products)),
        "countries": sorted(list(distinct_countries)),
        "states": sorted(list(distinct_states)),
        "cities": sorted(list(distinct_cities))
    }

    # 2. Multi-grain Filtering
    filtered_vouchers = []
    wants_line_filter = bool(product_set or search_query)

    for v in valid_vouchers:
        p_name = (v.get("partyLedgerName") or v.get("parent") or "").lower().strip()
        p_info = (party_map or {}).get(p_name, {})
        v_country = (p_info.get("country") or NO_COUNTRY_LABEL).lower().strip()
        v_state = (p_info.get("state") or p_info.get("stateName") or NO_STATE_LABEL).lower().strip()
        v_city = (p_info.get("city") or NO_CITY_LABEL).lower().strip()

        if party_set and p_name not in party_set:
            continue
        if country_set and v_country not in country_set:
            continue
        if state_set and v_state not in state_set:
            continue
        if city_set and v_city not in city_set:
            continue

        if not wants_line_filter:
            filtered_vouchers.append(v)
            continue

        inv_lines = v.get("inventoryEntries") or []
        matching_lines = []
        for line in inv_lines:
            if not isinstance(line, dict):
                continue
            item_name = (line.get("stockItemName") or "").lower().strip()
            if product_set and item_name not in product_set:
                continue
            if search_query:
                haystack = " ".join([
                    v.get("voucherNumber") or "",
                    v.get("sourceVoucherNumber") or "",
                    p_name,
                    item_name,
                    v_country,
                    v_state,
                    v_city
                ]).lower()
                if search_query not in haystack:
                    continue
            matching_lines.append(line)

        if matching_lines:
            v_copy = dict(v)
            v_copy["inventoryEntries"] = matching_lines
            filtered_vouchers.append(v_copy)
        elif search_query and not inv_lines:
            haystack = " ".join([
                v.get("voucherNumber") or "",
                v.get("sourceVoucherNumber") or "",
                p_name,
                v_country,
                v_state,
                v_city
            ]).lower()
            if search_query in haystack:
                filtered_vouchers.append(v)

    # 3. Aggregations
    by_month: Dict[str, Dict[str, Any]] = {}
    by_party: Dict[str, Dict[str, Any]] = {}
    by_item: Dict[str, Dict[str, Any]] = {}
    by_state: Dict[str, Dict[str, Any]] = {}
    by_city: Dict[str, Dict[str, Any]] = {}
    by_country: Dict[str, Dict[str, Any]] = {}

    invoiced_value = Decimal("0")
    gross_value = Decimal("0")
    returns_value = Decimal("0")
    item_value = Decimal("0")
    net_value = Decimal("0")
    item_gross_value = Decimal("0")
    item_net_value = Decimal("0")

    total_cgst = Decimal("0")
    total_sgst = Decimal("0")
    total_igst = Decimal("0")
    total_utgst = Decimal("0")
    total_cess = Decimal("0")
    total_tax = Decimal("0")
    total_discount = Decimal("0")
    total_charges = Decimal("0")
    total_round_off = Decimal("0")
    total_quantity = 0.0
    gross_invoice_count = 0
    return_count = 0
    vouchers_without_items = 0
    all_rows = []

    for v in filtered_vouchers:
        norm = normalize_voucher_analysis(
            v,
            direction=direction,
            voucher_types_map=voucher_types_map,
            party_map=party_map
        )

        invoiced_value += norm["invoicedValue"]
        if norm["isReturn"]:
            returns_value += norm["rawVoucherAmount"]
            return_count += 1
        else:
            gross_value += norm["rawVoucherAmount"]
            gross_invoice_count += 1

        item_value += norm["itemValue"]
        net_value += norm["netValue"]
        total_quantity += norm["itemQuantity"]

        tb = norm["taxBreakdown"]
        total_cgst += tb["cgst"]
        total_sgst += tb["sgst"]
        total_igst += tb["igst"]
        total_utgst += tb["utgst"]
        total_cess += tb["cess"]
        total_tax += tb["totalTax"]
        total_discount += tb["discount"]
        total_charges += tb["additionalCharges"]
        total_round_off += tb["roundOff"]

        if not norm["hasInventory"]:
            vouchers_without_items += 1

        # Month Bucket
        m_key = month_key_of(v.get("voucherDate"))
        if m_key:
            if m_key not in by_month:
                by_month[m_key] = {
                    "monthKey": m_key,
                    "label": month_label_of(m_key),
                    "amount": Decimal("0"),
                    "netAmount": Decimal("0"),
                    "grossAmount": Decimal("0"),
                    "returnsAmount": Decimal("0"),
                    "invoices": 0,
                    "returns": 0,
                    "tax": Decimal("0"),
                    "quantity": 0.0
                }
            bm = by_month[m_key]
            bm["amount"] += norm["invoicedValue"]
            bm["netAmount"] += norm["netValue"]
            if norm["isReturn"]:
                bm["returnsAmount"] += norm["rawVoucherAmount"]
                bm["returns"] += 1
            else:
                bm["grossAmount"] += norm["rawVoucherAmount"]
                bm["invoices"] += 1
            bm["tax"] += tb["totalTax"]
            bm["quantity"] += norm["itemQuantity"]

        # Party Bucket
        party_name = v.get("partyLedgerName") or v.get("parent") or "(no party)"
        if party_name not in by_party:
            by_party[party_name] = {
                "name": party_name,
                "label": party_name,
                "key": party_name,
                "state": norm["partyProfile"]["state"],
                "city": norm["partyProfile"]["city"],
                "country": norm["partyProfile"]["country"],
                "amount": Decimal("0"),
                "netAmount": Decimal("0"),
                "grossAmount": Decimal("0"),
                "taxableAmount": Decimal("0"),
                "gst": Decimal("0"),
                "charges": Decimal("0"),
                "invoices": 0,
                "returns": 0,
                "quantity": 0.0,
                "productsMap": {}
            }
        bp = by_party[party_name]
        bp["amount"] += norm["invoicedValue"]
        bp["netAmount"] += norm["netValue"]
        bp["taxableAmount"] += norm["itemValue"]
        bp["gst"] += tb["totalTax"]
        bp["charges"] += tb["additionalCharges"] + tb["roundOff"] - tb["discount"]
        bp["quantity"] += norm["itemQuantity"]
        if norm["isReturn"]:
            bp["returns"] += 1
        else:
            bp["grossAmount"] += norm["rawVoucherAmount"]
            bp["invoices"] += 1

        for line in norm["detailRows"]:
            prod = line.get("product")
            if prod and prod not in ("(no item)", "(Service / Accounting Invoice)"):
                prev = bp["productsMap"].get(prod, {"count": 0, "amount": Decimal("0")})
                prev["count"] += 1
                prev["amount"] += to_decimal(line.get("amount") or 0)
                bp["productsMap"][prod] = prev

        # State Bucket
        st_name = norm["partyProfile"]["state"] or NO_STATE_LABEL
        if st_name not in by_state:
            by_state[st_name] = {
                "name": st_name,
                "label": st_name,
                "key": st_name,
                "amount": Decimal("0"),
                "netAmount": Decimal("0"),
                "invoices": 0
            }
        bs = by_state[st_name]
        bs["amount"] += norm["invoicedValue"]
        bs["netAmount"] += norm["netValue"]
        bs["invoices"] += 1

        # City Bucket
        ct_name = norm["partyProfile"]["city"] or NO_CITY_LABEL
        if ct_name not in by_city:
            by_city[ct_name] = {
                "name": ct_name,
                "label": ct_name,
                "key": ct_name,
                "state": norm["partyProfile"]["state"],
                "confidence": norm["partyProfile"]["cityConfidence"],
                "amount": Decimal("0"),
                "netAmount": Decimal("0"),
                "invoices": 0
            }
        bc = by_city[ct_name]
        bc["amount"] += norm["invoicedValue"]
        bc["netAmount"] += norm["netValue"]
        bc["invoices"] += 1

        # Country Bucket
        co_name = norm["partyProfile"]["country"] or NO_COUNTRY_LABEL
        if co_name not in by_country:
            by_country[co_name] = {
                "name": co_name,
                "label": co_name,
                "key": co_name,
                "amount": Decimal("0"),
                "netAmount": Decimal("0"),
                "invoices": 0
            }
        bco = by_country[co_name]
        bco["amount"] += norm["invoicedValue"]
        bco["netAmount"] += norm["netValue"]
        bco["invoices"] += 1

        # Detail Rows & Item Bucket
        for row in norm["detailRows"]:
            all_rows.append(row)
            prod = row.get("product")
            if prod and prod != "(Service / Accounting Invoice)":
                if prod not in by_item:
                    by_item[prod] = {
                        "name": prod,
                        "label": prod,
                        "key": prod,
                        "unit": row.get("unit"),
                        "amount": Decimal("0"),
                        "grossAmount": Decimal("0"),
                        "quantity": 0.0,
                        "invoices": 0
                    }
                bi = by_item[prod]
                bi["amount"] += to_decimal(row.get("amount") or 0)
                bi["grossAmount"] += to_decimal(row.get("totalAmount") or 0)
                item_gross_value += to_decimal(row.get("totalAmount") or 0)
                item_net_value += to_decimal(row.get("amount") or 0)
                bi["quantity"] += row.get("quantity") or 0.0
                bi["invoices"] += 1

    # Format months
    months_list = []
    for m_key in sorted(by_month.keys()):
        m = by_month[m_key]
        m_amt = m["amount"]
        m_net = m["netAmount"]
        months_list.append({
            "monthKey": m["monthKey"],
            "label": m["label"],
            "amount": to_decimal_string(m_amt),
            "netAmount": to_decimal_string(m_net),
            "amountWithCharges": to_decimal_string(m_amt),
            "amountWithoutCharges": to_decimal_string(m_net),
            "grossAmount": to_decimal_string(m["grossAmount"]),
            "returnsAmount": to_decimal_string(m["returnsAmount"]),
            "invoices": m["invoices"],
            "returns": m["returns"],
            "tax": to_decimal_string(m["tax"]),
            "quantity": round(m["quantity"], 3)
        })

    # Format party rankings
    total_sales_decimal = invoiced_value if not invoiced_value.is_zero() else Decimal("1")
    party_list = []
    for p in by_party.values():
        p_amt = p["amount"]
        p_net = p["netAmount"]
        share = float(round((p_amt / total_sales_decimal) * Decimal(100), 1))
        avg_inv = (p["grossAmount"] / Decimal(p["invoices"])) if p["invoices"] > 0 else Decimal("0")

        best_prod = "—"
        max_p_amt = Decimal("-Infinity")
        for prod_name, stat in p["productsMap"].items():
            if stat["amount"] > max_p_amt:
                max_p_amt = stat["amount"]
                best_prod = prod_name

        party_list.append({
            "name": p["name"],
            "label": p["label"],
            "key": p["key"],
            "state": p["state"],
            "city": p["city"],
            "country": p["country"],
            "amount": to_decimal_string(p_amt),
            "netAmount": to_decimal_string(p_net),
            "amountWithCharges": to_decimal_string(p_amt),
            "amountWithoutCharges": to_decimal_string(p_net),
            "taxableAmount": to_decimal_string(p["taxableAmount"]),
            "gst": to_decimal_string(p["gst"]),
            "charges": to_decimal_string(p["charges"]),
            "invoices": p["invoices"],
            "returns": p["returns"],
            "quantity": round(p["quantity"], 3),
            "share": share,
            "averageInvoiceValue": to_decimal_string(avg_inv),
            "topProduct": best_prod
        })

    # Format item rankings
    item_list = []
    for it in by_item.values():
        it_gross = it["grossAmount"]
        it_net = it["amount"]
        item_list.append({
            "name": it["name"],
            "label": it["label"],
            "key": it["key"],
            "unit": it["unit"],
            "amount": to_decimal_string(it_net),
            "grossAmount": to_decimal_string(it_gross),
            "netAmount": to_decimal_string(it_net),
            "amountWithCharges": to_decimal_string(it_gross),
            "amountWithoutCharges": to_decimal_string(it_net),
            "quantity": round(it["quantity"], 3),
            "invoices": it["invoices"]
        })

    def format_geo_list(geo_dict: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for g in geo_dict.values():
            g_amt = g["amount"]
            g_net = g["netAmount"]
            item = {
                "name": g["name"],
                "label": g["label"],
                "key": g["key"],
                "amount": to_decimal_string(g_amt),
                "netAmount": to_decimal_string(g_net),
                "amountWithCharges": to_decimal_string(g_amt),
                "amountWithoutCharges": to_decimal_string(g_net),
                "invoices": g["invoices"]
            }
            if "state" in g:
                item["state"] = g["state"]
            if "confidence" in g:
                item["confidence"] = g["confidence"]
            out.append(item)
        return out

    state_list = format_geo_list(by_state)
    city_list = format_geo_list(by_city)
    country_list = format_geo_list(by_country)

    top_n = int(options.get("topN") or 8)
    party_rankings = rank(party_list, top_n)
    item_rankings = rank(item_list, top_n)
    state_rankings = rank(state_list, top_n)
    city_rankings = rank(city_list, top_n)
    country_rankings = rank(country_list, top_n)

    all_rows.sort(
        key=lambda r: (r.get("date") or "", r.get("voucherNumber") or ""),
        reverse=True
    )

    invoice_count = gross_invoice_count
    avg_invoice_val = (
        to_decimal_string(invoiced_value / Decimal(invoice_count))
        if invoice_count > 0
        else "0.00"
    )

    totals = {
        "invoicedValue": to_decimal_string(invoiced_value),
        "grossValue": to_decimal_string(gross_value),
        "grossSalesValue": to_decimal_string(gross_value) if is_sales else None,
        "grossPurchasesValue": to_decimal_string(gross_value) if not is_sales else None,
        "returnsValue": to_decimal_string(returns_value),
        "salesReturnsValue": to_decimal_string(returns_value) if is_sales else None,
        "purchaseReturnsValue": to_decimal_string(returns_value) if not is_sales else None,
        "itemValue": to_decimal_string(item_value),
        "taxableAmount": to_decimal_string(item_value),
        "netValue": to_decimal_string(net_value),
        "itemValueWithCharges": to_decimal_string(item_gross_value),
        "itemValueWithoutCharges": to_decimal_string(item_net_value),
        "taxAndCharges": to_decimal_string(total_tax + total_charges),
        "itcApprox": to_decimal_string(total_tax + total_charges) if not is_sales else None,
        "taxBreakdown": {
            "cgst": to_decimal_string(total_cgst),
            "sgst": to_decimal_string(total_sgst),
            "igst": to_decimal_string(total_igst),
            "utgst": to_decimal_string(total_utgst),
            "cess": to_decimal_string(total_cess),
            "totalTax": to_decimal_string(total_tax)
        },
        "discount": to_decimal_string(total_discount),
        "additionalCharges": to_decimal_string(total_charges),
        "roundOff": to_decimal_string(total_round_off),
        "invoiceCount": invoice_count,
        "grossInvoiceCount": gross_invoice_count,
        "returnCount": return_count,
        "creditNoteCount": return_count if is_sales else None,
        "debitNoteCount": return_count if not is_sales else None,
        "itemQuantity": round(total_quantity, 3),
        "averageInvoiceValue": avg_invoice_val,
        "customerCount": len(party_list) if is_sales else None,
        "supplierCount": len(party_list) if not is_sales else None,
        "partyCount": len(party_list),
        "itemCount": len(item_list),
        "vouchersWithoutItems": vouchers_without_items
    }

    period_span = {
        "from": months_list[0]["monthKey"] if months_list else None,
        "to": months_list[-1]["monthKey"] if months_list else None
    }

    return {
        "available": True,
        "fetchedAt": fetched_at or datetime.utcnow().isoformat(),
        "syncedAt": synced_at,
        "filterOptions": filter_options,
        "appliedFilters": {
            "party": target_party or None,
            "customer": target_party if is_sales else None,
            "supplier": target_party if not is_sales else None,
            "product": product_filter or None,
            "country": country_filter or None,
            "state": state_filter or None,
            "city": city_filter or None,
            "search": search_query or None
        },
        "invoiceTotalsSpanWholeInvoice": wants_line_filter,
        "totals": totals,
        "months": months_list,
        "rows": all_rows,
        "customers": party_rankings if is_sales else None,
        "suppliers": party_rankings if not is_sales else None,
        "customerPerformance": party_rankings["all"] if is_sales else None,
        "supplierPerformance": party_rankings["all"] if not is_sales else None,
        "parties": party_rankings,
        "items": item_rankings,
        "states": state_rankings,
        "cities": city_rankings,
        "countries": country_rankings,
        "period": period_span
    }
