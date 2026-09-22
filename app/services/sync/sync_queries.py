"""
TallyPrime XML Queries & Templates.
Mirrors Magenta BI's extraction requests for:
- CM: Customer Master / Debtors
- CMGRP: Customer Master Groups
- IM: Item Master / Stock Items
- IMGRP: Item Master Groups
- SPCD: Sales, Purchase, Credit Note, Debit Note (with AlterID & Date chunking)
- BPBR: Bank Payment, Bank Receipt
- LEDGER: General Ledgers / Chart of Accounts
- COA / VOA: Customer & Vendor Bill-Wise Outstandings
"""

from typing import List, Optional
import defusedxml.ElementTree as ET
import re

def sanitize_tally_xml(raw_xml: str) -> str:
    """Strips illegal XML 1.0 control character entities (e.g. &#4;) emitted by Tally."""
    if not raw_xml:
        return ""
    return re.sub(r'&#(?:[0-8]|1[1-2]|1[4-9]|2[0-9]|3[0-1]);', '', raw_xml)




def escape_xml_value(val: Optional[str]) -> str:
    """Escapes special XML characters."""
    if not val:
        return ""
    return str(val).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")


def build_collection_ledgers_xml(company_name: Optional[str] = None, group_name: Optional[str] = None) -> str:
    """
    Builds a lightweight native TDL collection query for Ledgers.
    Bypasses UI display report engine and avoids TDL hook memory crashes.
    """
    company_block = f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY><SVCURRENTCOMPANY>{escape_xml_value(company_name)}</SVCURRENTCOMPANY>' if company_name else ""
    filter_block = ""
    formula_block = ""
    if group_name:
        escaped_grp = escape_xml_value(group_name)
        filter_block = "<FILTER>GroupFilter</FILTER>"
        formula_block = f'<SYSTEM TYPE="Formulae" NAME="GroupFilter">$$IsBelongsToGroup:"{escaped_grp}"</SYSTEM>'

    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CustomLedgers</ID></HEADER>'
        f'<BODY><DESC>'
        f'<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>{company_block}</STATICVARIABLES>'
        f'<TDL><TDLMESSAGE>'
        f'<COLLECTION NAME="CustomLedgers" ISMODIFY="No">'
        f'<TYPE>Ledger</TYPE>'
        f'{filter_block}'
        f'<FETCH>Name, Parent, OpeningBalance, ClosingBalance, AlterId, Guid, MasterId</FETCH>'
        f'</COLLECTION>'
        f'{formula_block}'
        f'</TDLMESSAGE></TDL>'
        f'</DESC></BODY>'
        f'</ENVELOPE>'
    )


def build_collection_groups_xml(company_name: Optional[str] = None) -> str:
    """
    Builds a lightweight native TDL collection query for Account Groups.
    """
    company_block = f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY><SVCURRENTCOMPANY>{escape_xml_value(company_name)}</SVCURRENTCOMPANY>' if company_name else ""
    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CustomGroups</ID></HEADER>'
        f'<BODY><DESC>'
        f'<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>{company_block}</STATICVARIABLES>'
        f'<TDL><TDLMESSAGE>'
        f'<COLLECTION NAME="CustomGroups" ISMODIFY="No">'
        f'<TYPE>Group</TYPE>'
        f'<FETCH>Name, Parent, AlterId, Guid, MasterId</FETCH>'
        f'</COLLECTION>'
        f'</TDLMESSAGE></TDL>'
        f'</DESC></BODY>'
        f'</ENVELOPE>'
    )


def build_collection_stock_items_xml(company_name: Optional[str] = None) -> str:
    """
    Builds a lightweight native TDL collection query for Stock Items.
    Bypasses UI report layout and does not trigger third-party TDL display functions.
    """
    company_block = f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY><SVCURRENTCOMPANY>{escape_xml_value(company_name)}</SVCURRENTCOMPANY>' if company_name else ""
    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CustomStockItems</ID></HEADER>'
        f'<BODY><DESC>'
        f'<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>{company_block}</STATICVARIABLES>'
        f'<TDL><TDLMESSAGE>'
        f'<COLLECTION NAME="CustomStockItems" ISMODIFY="No">'
        f'<TYPE>StockItem</TYPE>'
        f'<FETCH>Name, Parent, OpeningBalance, ClosingBalance, AlterId, Guid, MasterId, BaseUnits</FETCH>'
        f'</COLLECTION>'
        f'</TDLMESSAGE></TDL>'
        f'</DESC></BODY>'
        f'</ENVELOPE>'
    )


def build_collection_stock_groups_xml(company_name: Optional[str] = None) -> str:
    """
    Builds a lightweight native TDL collection query for Stock Groups.
    """
    company_block = f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY><SVCURRENTCOMPANY>{escape_xml_value(company_name)}</SVCURRENTCOMPANY>' if company_name else ""
    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CustomStockGroups</ID></HEADER>'
        f'<BODY><DESC>'
        f'<STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>{company_block}</STATICVARIABLES>'
        f'<TDL><TDLMESSAGE>'
        f'<COLLECTION NAME="CustomStockGroups" ISMODIFY="No">'
        f'<TYPE>StockGroup</TYPE>'
        f'<FETCH>Name, Parent, AlterId, Guid, MasterId</FETCH>'
        f'</COLLECTION>'
        f'</TDLMESSAGE></TDL>'
        f'</DESC></BODY>'
        f'</ENVELOPE>'
    )


def build_export_xml(
    report_name: str,
    company_name: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    min_alter_id: Optional[int] = None,
    max_alter_id: Optional[int] = None,
    custom_filters: Optional[dict] = None
) -> str:
    """Builds standard TallyPrime export XML envelope."""
    static_vars = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>']

    if company_name:
        static_vars.append(f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY>')
    if from_date:
        static_vars.append(f'<SVFROMDATE TYPE="Date">{escape_xml_value(from_date)}</SVFROMDATE>')
    if to_date:
        static_vars.append(f'<SVTODATE TYPE="Date">{escape_xml_value(to_date)}</SVTODATE>')

    if min_alter_id is not None:
        static_vars.append(f'<MINALTERID>{min_alter_id}</MINALTERID>')
    if max_alter_id is not None:
        static_vars.append(f'<MAXALTERID>{max_alter_id}</MAXALTERID>')

    if custom_filters:
        for k, v in custom_filters.items():
            static_vars.append(f'<{k}>{escape_xml_value(str(v))}</{k}>')

    static_block = "".join(static_vars)
    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>{escape_xml_value(report_name)}</ID></HEADER>'
        f'<BODY><DESC><STATICVARIABLES>{static_block}</STATICVARIABLES></DESC></BODY>'
        f'</ENVELOPE>'
    )


import calendar
from datetime import datetime, date


def generate_monthly_chunks(from_date: str, to_date: str) -> List[tuple]:
    """
    Splits a date range (accepting YYYYMMDD or YYYY-MM-DD) into safe monthly slices.
    Returns list of (start_date_str, end_date_str) in YYYYMMDD format.
    Example: 20240401 to 20240615 -> [('20240401', '20240430'), ('20240501', '20240531'), ('20240601', '20240615')]
    """
    def parse_dt(d_str: str) -> date:
        cleaned = d_str.replace("-", "").strip()
        return datetime.strptime(cleaned, "%Y%m%d").date()

    try:
        start_d = parse_dt(from_date)
        end_d = parse_dt(to_date)
    except Exception:
        return [(from_date.replace("-", ""), to_date.replace("-", ""))]

    if start_d > end_d:
        start_d, end_d = end_d, start_d

    chunks = []
    curr = start_d
    while curr <= end_d:
        last_day = calendar.monthrange(curr.year, curr.month)[1]
        chunk_end = date(curr.year, curr.month, last_day)
        if chunk_end > end_d:
            chunk_end = end_d

        chunks.append((curr.strftime("%Y%m%d"), chunk_end.strftime("%Y%m%d")))

        if curr.month == 12:
            curr = date(curr.year + 1, 1, 1)
        else:
            curr = date(curr.year, curr.month + 1, 1)

    return chunks


def build_collection_vouchers_xml(
    company_name: str,
    from_date: str,
    to_date: str,
    voucher_types: Optional[List[str]] = None,
    min_alter_id: Optional[int] = None
) -> str:
    """
    Builds a targeted Tally Collection XML for Vouchers.
    Supports date range filtering, voucher types (with native TDL classification), and AlterID incremental sync.
    """
    company_block = f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY><SVCURRENTCOMPANY>{escape_xml_value(company_name)}</SVCURRENTCOMPANY>' if company_name else ""
    alter_var = f'<MINALTERID>{min_alter_id}</MINALTERID>' if min_alter_id is not None else ""

    filters = []
    formulas = []

    if voucher_types:
        conditions = []
        has_sales = any("sale" in vt.lower() for vt in voucher_types)
        has_pur = any("purchase" in vt.lower() for vt in voucher_types)
        has_cr = any("credit" in vt.lower() for vt in voucher_types)
        has_dr = any("debit" in vt.lower() for vt in voucher_types)
        has_pay = any("payment" in vt.lower() for vt in voucher_types)
        has_rec = any("receipt" in vt.lower() for vt in voucher_types)

        if has_sales:
            conditions.append("$$IsSales:$VoucherTypeName")
        if has_pur:
            conditions.append("$$IsPurchase:$VoucherTypeName")
        if has_cr:
            conditions.append("$$IsCreditNote:$VoucherTypeName")
        if has_dr:
            conditions.append("$$IsDebitNote:$VoucherTypeName")
        if has_pay:
            conditions.append("$$IsPayment:$VoucherTypeName")
        if has_rec:
            conditions.append("$$IsReceipt:$VoucherTypeName")

        if not conditions:
            for vt in voucher_types:
                conditions.append(f'($VoucherTypeName = "{escape_xml_value(vt)}")')

        condition_str = " OR ".join(conditions)
        filters.append("VoucherFilter")
        formulas.append(f'<SYSTEM TYPE="Formulae" NAME="VoucherFilter">{condition_str}</SYSTEM>')

    if min_alter_id is not None and min_alter_id > 0:
        filters.append("AlterIdFilter")
        formulas.append(f'<SYSTEM TYPE="Formulae" NAME="AlterIdFilter">$$Number:$AlterId &gt; {min_alter_id}</SYSTEM>')

    filter_elem = "".join([f'<FILTER>{f}</FILTER>' for f in filters]) if filters else ""
    formula_elem = "".join(formulas) if formulas else ""

    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CustomVouchers</ID></HEADER>'
        f'<BODY>'
        f'<DESC>'
        f'<STATICVARIABLES>'
        f'<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'
        f'{company_block}'
        f'<SVFROMDATE TYPE="Date">{escape_xml_value(from_date)}</SVFROMDATE>'
        f'<SVTODATE TYPE="Date">{escape_xml_value(to_date)}</SVTODATE>'
        f'{alter_var}'
        f'</STATICVARIABLES>'
        f'<TDL>'
        f'<TDLMESSAGE>'
        f'<COLLECTION NAME="CustomVouchers" ISMODIFY="No">'
        f'<TYPE>Voucher</TYPE>'
        f'<FETCH>Date, Guid, MasterId, AlterId, VoucherTypeName, VoucherNumber, PartyLedgerName, Amount, IsCancelled, IsOptional, AllInventoryEntries.*, AllLedgerEntries.*</FETCH>'
        f'{filter_elem}'
        f'</COLLECTION>'
        f'{formula_elem}'
        f'</TDLMESSAGE>'
        f'</TDL>'
        f'</DESC>'
        f'</BODY>'
        f'</ENVELOPE>'
    )


def build_outstandings_xml(company_name: str, group_type: str = "Sundry Debtors") -> str:
    """
    Queries bill-wise outstanding receivables/payables from Tally.
    """
    company_block = f'<SVCOMPANY>{escape_xml_value(company_name)}</SVCOMPANY><SVCURRENTCOMPANY>{escape_xml_value(company_name)}</SVCURRENTCOMPANY>' if company_name else ""
    return (
        f'<ENVELOPE>'
        f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Bills Outstanding</ID></HEADER>'
        f'<BODY>'
        f'<DESC>'
        f'<STATICVARIABLES>'
        f'<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'
        f'{company_block}'
        f'<EXPLODEFLAG>Yes</EXPLODEFLAG>'
        f'<GROUPNAME>{escape_xml_value(group_type)}</GROUPNAME>'
        f'</STATICVARIABLES>'
        f'</DESC>'
        f'</BODY>'
        f'</ENVELOPE>'
    )


def parse_tally_vouchers_xml(xml_content: str) -> List[dict]:
    """Parses Tally Vouchers XML into normalized dictionaries with inventory and ledger lines."""
    vouchers = []
    clean_xml = sanitize_tally_xml(xml_content)
    try:
        root = ET.fromstring(clean_xml)
        for v in root.iter("VOUCHER"):
            v_dict = {
                "inventoryEntries": [],
                "ledgerEntries": []
            }
            for child in v:
                tag = child.tag.upper()
                text = (child.text or "").strip()
                if tag == "DATE":
                    v_dict["voucherDate"] = text
                elif tag == "VOUCHERNUMBER":
                    v_dict["voucherNumber"] = text
                    v_dict["sourceVoucherNumber"] = text
                elif tag == "VOUCHERTYPENAME":
                    v_dict["voucherType"] = text
                    v_dict["voucherTypeName"] = text
                elif tag == "PARTYLEDGERNAME":
                    v_dict["partyLedgerName"] = text
                elif tag == "AMOUNT":
                    try:
                        v_dict["amount"] = float(text)
                    except ValueError:
                        v_dict["amount"] = 0.0
                elif tag == "ALTERID":
                    try:
                        v_dict["alterId"] = int(text)
                    except ValueError:
                        v_dict["alterId"] = 0
                elif tag == "GUID":
                    v_dict["guid"] = text
                    v_dict["sourceObjectId"] = text
                elif tag == "MASTERID":
                    try:
                        v_dict["masterId"] = int(text)
                    except ValueError:
                        v_dict["masterId"] = 0
                elif tag == "ISCANCELLED":
                    v_dict["isCancelled"] = text.lower() in ("yes", "true", "1")
                elif tag == "ISOPTIONAL":
                    v_dict["isOptional"] = text.lower() in ("yes", "true", "1")
                elif tag == "ALLINVENTORYENTRIES.LIST":
                    item_name = (child.findtext("STOCKITEMNAME") or child.findtext("NAME") or "").strip()
                    raw_qty = (child.findtext("ACTUALQTY") or child.findtext("BILLEDQTY") or "").strip()
                    raw_rate = (child.findtext("RATE") or "").strip()
                    raw_amt = (child.findtext("AMOUNT") or "").strip()
                    qty_match = re.search(r"[-+]?\d*\.?\d+", raw_qty)
                    qty_val = float(qty_match.group(0)) if qty_match else 0.0
                    unit_match = re.search(r"[A-Za-z%][\w%.\-\s]*$", raw_qty)
                    unit_val = unit_match.group(0).strip() if unit_match else None
                    if not unit_val and "/" in raw_rate:
                        unit_val = raw_rate.split("/")[-1].strip()
                    try:
                        line_amt = float(re.sub(r"[^\d.-]", "", raw_amt)) if raw_amt else 0.0
                    except Exception:
                        line_amt = 0.0
                    v_dict["inventoryEntries"].append({
                        "stockItemName": item_name,
                        "quantity": qty_val,
                        "unit": unit_val,
                        "rate": raw_rate or None,
                        "amount": abs(line_amt)
                    })
                elif tag == "ALLLEDGERENTRIES.LIST":
                    lname = (child.findtext("LEDGERNAME") or "").strip()
                    lamt_str = (child.findtext("AMOUNT") or "").strip()
                    try:
                        lamt = float(re.sub(r"[^\d.-]", "", lamt_str)) if lamt_str else 0.0
                    except Exception:
                        lamt = 0.0
                    is_pos = (child.findtext("ISDEEMEDPOSITIVE") or "").strip().lower()
                    v_dict["ledgerEntries"].append({
                        "ledgerName": lname,
                        "amount": abs(lamt),
                        "isCredit": is_pos == "no" or lamt < 0
                    })

            if v_dict.get("guid") or v_dict.get("voucherNumber"):
                vouchers.append(v_dict)
    except Exception:
        pass
    return vouchers


def parse_tally_masters_xml(xml_content: str, item_tag: str = "LEDGER") -> List[dict]:
    """
    Generic, robust parser for Tally master collections (LEDGER, GROUP, STOCKITEM, STOCKGROUP).
    Safely reads both XML attributes and child elements.
    """
    results = []
    item_tag_upper = item_tag.upper()
    clean_xml = sanitize_tally_xml(xml_content)
    try:
        root = ET.fromstring(clean_xml)
        for elem in root.iter():
            if elem.tag.upper() != item_tag_upper:
                continue

            name = elem.get("NAME") or ""
            m_dict = {
                "name": name,
                "parent": "",
                "openingBalance": 0.0,
                "closingBalance": 0.0,
                "alterId": 0,
                "masterId": 0,
                "guid": "",
                "baseUnits": ""
            }

            for child in elem:
                tag = child.tag.upper()
                text = (child.text or "").strip()
                if tag == "NAME" and not m_dict["name"]:
                    m_dict["name"] = text
                elif tag == "PARENT":
                    m_dict["parent"] = text
                elif tag == "OPENINGBALANCE":
                    try:
                        m_dict["openingBalance"] = float(text)
                    except ValueError:
                        m_dict["openingBalance"] = 0.0
                elif tag == "CLOSINGBALANCE":
                    try:
                        m_dict["closingBalance"] = float(text)
                    except ValueError:
                        m_dict["closingBalance"] = 0.0
                elif tag == "ALTERID":
                    try:
                        m_dict["alterId"] = int(text)
                    except ValueError:
                        m_dict["alterId"] = 0
                elif tag == "MASTERID":
                    try:
                        m_dict["masterId"] = int(text)
                    except ValueError:
                        m_dict["masterId"] = 0
                elif tag == "GUID":
                    m_dict["guid"] = text
                elif tag == "BASEUNITS":
                    m_dict["baseUnits"] = text

            if m_dict.get("name"):
                results.append(m_dict)
    except Exception:
        pass
    return results


def parse_tally_ledgers_xml(xml_content: str) -> List[dict]:
    """Parses Tally Ledgers XML into normalized dictionaries (backwards compatibility)."""
    return parse_tally_masters_xml(xml_content, item_tag="LEDGER")

