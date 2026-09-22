"""
TallyPrime Loopback Client.
Features:
- Thread-safe & async-safe request serialization using asyncio.Lock()
- Mandatory TYPE="Date" on XML static date variables
- Strict read-only XML firewall (rejects mutation elements)
- Native TDL CompanyCollection query for loaded company discovery
- Defused XML parsing protected against XXE / Billion laughs
"""

import asyncio
import time
import re
from typing import Any, Dict, List, Optional
import httpx
import defusedxml.ElementTree as ET
from app.core.config import settings
from app.core.exceptions import ApiError, AppErrorCodes

FORBIDDEN_XML_MUTATIONS = [
    "<ACTION>CREATE</ACTION>",
    "<ACTION>ALTER</ACTION>",
    "<ACTION>DELETE</ACTION>",
    'ACTION="CREATE"',
    'ACTION="ALTER"',
    'ACTION="DELETE"'
]

GSTIN_REGEX = re.compile(r"\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})\b", re.IGNORECASE)

class TallyClient:
    def __init__(self, host: Optional[str] = None, port: Optional[int] = None):
        self.host = host or settings.TALLY_HOST
        self.port = port or settings.TALLY_PORT
        self.base_url = f"http://{self.host}:{self.port}"
        self._lock = asyncio.Lock()
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=float(settings.TALLY_TIMEOUT_MS) / 1000.0)
        return self._client

    def _validate_read_only(self, xml_payload: str):
        """Strict firewall preventing any outgoing mutation XML from being sent to Tally."""
        upper = xml_payload.upper()
        for forbidden in FORBIDDEN_XML_MUTATIONS:
            if forbidden in upper:
                raise ApiError.bad_request(
                    f"Write mutation detected in Tally XML request: {forbidden}. CFO Yantra is read-only toward TallyPrime.",
                    AppErrorCodes.INVALID_PAYLOAD
                )

    async def execute_request(self, xml_payload: str, timeout: Optional[float] = None) -> str:
        """Executes a serialized, read-only request to TallyPrime loopback server."""
        self._validate_read_only(xml_payload)
        client = self._get_client()
        req_timeout = timeout if timeout is not None else (float(settings.TALLY_TIMEOUT_MS) / 1000.0)

        # Enforce single-socket serialization to protect Tally's single-threaded server
        async with self._lock:
            try:
                response = await client.post(
                    self.base_url,
                    content=xml_payload.encode("utf-8"),
                    headers={"Content-Type": "text/xml; charset=utf-8"},
                    timeout=req_timeout
                )
                response.raise_for_status()
                return response.text
            except httpx.ConnectError:
                raise ApiError.bad_gateway(
                    f"Connection refused to TallyPrime at {self.base_url}. Ensure TallyPrime is running with HTTP server enabled.",
                    AppErrorCodes.TALLY_CONNECTION_FAILED
                )
            except httpx.TimeoutException:
                raise ApiError(
                    504,
                    f"TallyPrime request timed out after {req_timeout}s.",
                    AppErrorCodes.TALLY_TIMEOUT
                )

    @staticmethod
    def build_company_collection_xml() -> str:
        """Constructs safe native TDL CompanyCollection export request."""
        return """<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>CompanyCollection</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="CompanyCollection" ISMODIFY="No">
            <TYPE>Company</TYPE>
            <FETCH>Name</FETCH>
            <FETCH>FormalName</FETCH>
            <FETCH>Guid</FETCH>
            <FETCH>StartingFrom</FETCH>
            <FETCH>BooksFrom</FETCH>
            <FETCH>MasterId</FETCH>
            <FETCH>AlterId</FETCH>
            <FETCH>CountryName</FETCH>
            <FETCH>StateName</FETCH>
            <FETCH>PinCode</FETCH>
            <FETCH>EMail</FETCH>
            <FETCH>PhoneNumber</FETCH>
            <FETCH>MobileNo</FETCH>
            <FETCH>GstRegNo</FETCH>
            <FETCH>PanCardNo</FETCH>
            <FETCH>CinNo</FETCH>
            <FETCH>BaseCurrency</FETCH>
            <FETCH>IsBillWiseOn</FETCH>
            <FETCH>IsCostCentresOn</FETCH>
            <FETCH>IsInventoryOn</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>"""

    async def fetch_loaded_companies(self, timeout: Optional[float] = None) -> List[Dict[str, Any]]:
        """Queries TallyPrime live and parses all currently loaded companies."""
        xml = self.build_company_collection_xml()
        raw = await self.execute_request(xml, timeout=timeout)
        root = ET.fromstring(raw)
        companies = []
        for comp in root.findall(".//COMPANY"):
            def get_val(tag: str) -> Optional[str]:
                el = comp.find(tag)
                return el.text.strip() if el is not None and el.text else None

            name = get_val("NAME") or comp.get("NAME")
            if not name:
                continue

            guid = get_val("GUID")
            starting_raw = get_val("STARTINGFROM")
            books_raw = get_val("BOOKSFROM")

            def format_date(d_str: Optional[str]) -> Optional[str]:
                if not d_str:
                    return None
                cleaned = d_str.strip()
                if len(cleaned) == 8 and cleaned.isdigit():
                    return f"{cleaned[0:4]}-{cleaned[4:6]}-{cleaned[6:8]}"
                return cleaned

            master_id = None
            m_val = get_val("MASTERID")
            if m_val and m_val.strip().isdigit():
                master_id = int(m_val.strip())

            alter_id = None
            a_val = get_val("ALTERID")
            if a_val and a_val.strip().isdigit():
                alter_id = int(a_val.strip())

            def parse_bool(tag: str, default: bool = False) -> bool:
                v = get_val(tag)
                if not v:
                    return default
                return v.strip().lower() in ("yes", "true", "1")

            gstin = get_val("GSTREGNO")
            pan = get_val("PANCARDNO")
            if not pan and gstin and len(gstin) == 15:
                pan = gstin[2:12].upper()

            c_dict = {
                "name": name,
                "companyName": name,
                "formalName": get_val("FORMALNAME"),
                "legalName": get_val("FORMALNAME") or name,
                "guid": guid,
                "companyGuid": guid,
                "companyId": guid or name,
                "startingFrom": format_date(starting_raw),
                "startingAt": format_date(starting_raw),
                "booksFrom": format_date(books_raw),
                "masterId": master_id,
                "alterId": alter_id,
                "country": get_val("COUNTRYNAME") or "India",
                "countryName": get_val("COUNTRYNAME") or "India",
                "state": get_val("STATENAME"),
                "stateName": get_val("STATENAME"),
                "pinCode": get_val("PINCODE"),
                "email": get_val("EMAIL"),
                "phone": get_val("PHONENUMBER"),
                "phoneNumber": get_val("PHONENUMBER"),
                "mobile": get_val("MOBILENO"),
                "mobileNo": get_val("MOBILENO"),
                "gstin": gstin,
                "gstRegNo": gstin,
                "pan": pan,
                "panCardNo": pan,
                "cin": get_val("CINNO"),
                "cinNo": get_val("CINNO"),
                "baseCurrency": get_val("BASECURRENCY") or "INR",
                "features": {
                    "billWise": parse_bool("ISBILLWISEON"),
                    "costCentres": parse_bool("ISCOSTCENTRESON"),
                    "inventory": parse_bool("ISINVENTORYON", default=True),
                    "gstApplicable": bool(gstin)
                },
                "isOpen": True
            }
            companies.append(c_dict)
        return companies

    async def extract_company_tax_registration(self, company_name: str) -> Dict[str, Optional[str]]:
        """Queries TaxUnitColl for the specific company to obtain active GSTIN and PAN."""
        if not company_name:
            return {"gstin": None, "pan": None}
        escaped_name = company_name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        xml = f"""<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>TaxUnitColl</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <SVCURRENTCOMPANY>{escaped_name}</SVCURRENTCOMPANY>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="TaxUnitColl" ISMODIFY="No">
            <TYPE>TaxUnit</TYPE>
            <FETCH>Name</FETCH>
            <FETCH>GSTREGNUMBER</FETCH>
            <FETCH>TAXREGISTRATION</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>"""
        try:
            raw = await self.execute_request(xml)
            match = GSTIN_REGEX.search(raw)
            gstin = match.group(1).upper() if match else None
            pan = gstin[2:12].upper() if gstin and len(gstin) == 15 else None
            return {"gstin": gstin, "pan": pan}
        except Exception:
            return {"gstin": None, "pan": None}

    def is_tally_process_running(self) -> bool:
        """Checks if tally.exe process is currently active on the host OS."""
        import subprocess
        try:
            res = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq tally.exe", "/NH"],
                capture_output=True,
                text=True,
                timeout=2
            )
            return "tally.exe" in res.stdout.lower()
        except Exception:
            return False

    def is_port_listening(self) -> bool:
        """Fast low-level socket probe to check if Tally HTTP port is accepting TCP connections."""
        import socket
        try:
            with socket.create_connection((self.host, self.port), timeout=1.0):
                return True
        except OSError:
            return False

    async def probe_connection(self) -> Dict[str, Any]:
        """
        Probes TallyPrime loopback connectivity, process state, and active loaded companies.
        Accurately distinguishes:
        - CONNECTED (Online and company loaded)
        - NO_COMPANY_LOADED (Tally port open, but 0 companies open)
        - PORT_CLOSED (Process running, but port 9000 refused/unresponsive)
        - OFFLINE (Tally process not running)
        """
        start = time.perf_counter()
        port_open = self.is_port_listening()
        proc_running = self.is_tally_process_running()

        if not port_open:
            duration_ms = int((time.perf_counter() - start) * 1000)
            if proc_running:
                return {
                    "connected": False,
                    "status": "PORT_CLOSED",
                    "operatingMode": "PROCESS_RUNNING_PORT_BLOCKED",
                    "isAvailable": False,
                    "responseTimeMs": duration_ms,
                    "message": f"TallyPrime process is active, but HTTP port {self.port} is not responding. Enable ODBC/HTTP in Tally F12 config.",
                    "activeCompanies": []
                }
            return {
                "connected": False,
                "status": "OFFLINE",
                "operatingMode": "STOPPED",
                "isAvailable": False,
                "responseTimeMs": duration_ms,
                "message": f"TallyPrime is closed / not running on host machine.",
                "activeCompanies": []
            }

        try:
            probe_timeout = float(settings.TALLY_PROBE_TIMEOUT_MS) / 1000.0
            loaded = await self.fetch_loaded_companies(timeout=probe_timeout)
            duration_ms = int((time.perf_counter() - start) * 1000)
            names = [c["name"] for c in loaded]
            if names:
                return {
                    "connected": True,
                    "status": "ONLINE",
                    "operatingMode": "CONNECTED",
                    "isAvailable": True,
                    "responseTimeMs": duration_ms,
                    "message": "Connected to TallyPrime successfully",
                    "activeCompanies": names
                }
            else:
                return {
                    "connected": True,
                    "status": "NO_COMPANY_LOADED",
                    "operatingMode": "CONNECTED_NO_COMPANY",
                    "isAvailable": False,
                    "responseTimeMs": duration_ms,
                    "message": "TallyPrime HTTP server is online, but no company is currently open.",
                    "activeCompanies": []
                }
        except ApiError as e:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return {
                "connected": False,
                "status": "OFFLINE",
                "operatingMode": "ERROR",
                "isAvailable": False,
                "responseTimeMs": duration_ms,
                "message": e.message,
                "activeCompanies": []
            }
        except Exception as e:
            duration_ms = int((time.perf_counter() - start) * 1000)
            return {
                "connected": False,
                "status": "OFFLINE",
                "operatingMode": "ERROR",
                "isAvailable": False,
                "responseTimeMs": duration_ms,
                "message": str(e),
                "activeCompanies": []
            }

    @staticmethod
    def build_export_envelope(
        report_name: str,
        company_name: Optional[str] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None
    ) -> str:
        """
        Builds export XML envelope with mandatory TYPE="Date" on date variables.
        """
        static_vars = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>']
        if company_name:
            static_vars.append(f'<SVCOMPANY>{company_name}</SVCOMPANY>')
        if from_date:
            static_vars.append(f'<SVFROMDATE TYPE="Date">{from_date}</SVFROMDATE>')
        if to_date:
            static_vars.append(f'<SVTODATE TYPE="Date">{to_date}</SVTODATE>')

        static_block = "".join(static_vars)
        return (
            f'<ENVELOPE>'
            f'<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>{report_name}</ID></HEADER>'
            f'<BODY><DESC><STATICVARIABLES>{static_block}</STATICVARIABLES></DESC></BODY>'
            f'</ENVELOPE>'
        )

# Global singleton client
tally_client = TallyClient()
