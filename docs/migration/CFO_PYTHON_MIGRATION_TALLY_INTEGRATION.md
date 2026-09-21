# CFO YANTRA — TALLYPRIME INTEGRATION SPECIFICATION

## Executive Summary
TallyPrime is the external accounting system of record for CFO Yantra. Integration occurs via an HTTP XML loopback interface (default port `9000`). Because TallyPrime's embedded web server is single-threaded and sensitive to malformed XML or connection flooding, this document specifies the Python driver architecture, request serialization mutex, read-only XML firewall, date attribute requirements, and CDC AlterID synchronization protocol.

---

## 1. TallyPrime HTTP Protocol Requirements

### 1.1. Single-Socket Mutex Serialization
TallyPrime's embedded server cannot handle concurrent HTTP pipelining. In Node.js, this was safeguarded by `maxSockets: 1` and `circuitBreaker.runExclusive()`.
In Python, this is strictly enforced via an `asyncio.Lock()` per target host:
```python
class SerializedTallyClient:
    def __init__(self, base_url: str = "http://127.0.0.1:9000"):
        self.base_url = base_url
        self._lock = asyncio.Lock()
        self._client = httpx.AsyncClient(timeout=60.0)

    async def execute_request(self, xml_payload: str) -> str:
        async with self._lock:
            # Serialized execution: only one HTTP transaction in flight at a time
            resp = await self._client.post(
                self.base_url,
                content=xml_payload.encode("utf-8"),
                headers={"Content-Type": "text/xml; charset=utf-8"}
            )
            return resp.text
```

### 1.2. Crucial XML Date Attribute (`TYPE="Date"`)
As verified in `src/integrations/tally/tally.requests.js:27-31`:
```xml
<STATICVARIABLES>
  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  <SVCOMPANY>##TargetCompany</SVCOMPANY>
  <SVFROMDATE TYPE="Date">20230401</SVFROMDATE>
  <SVTODATE TYPE="Date">20240331</SVTODATE>
</STATICVARIABLES>
```
> [!WARNING]
> If `TYPE="Date"` is omitted from `<SVFROMDATE>` or `<SVTODATE>`, TallyPrime silently ignores the date range and exports all historical vouchers from inception, leading to extreme memory exhaustion and timeout errors.

### 1.3. Strict Read-Only XML Firewall
To protect the client's accounting data from accidental corruption, the Python client intercepts every outgoing XML payload and verifies that no mutation elements are present:
- Prohibited elements: `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER ACTION="Create">`, `<LEDGER ACTION="Create">`, `<ACTION>Alter</ACTION>`, `<ACTION>Delete</ACTION>`.
- Only data retrieval queries (`<EXPORTDATA>`, `<REQUESTDESC>`) are permitted.

---

## 2. Synchronization & CDC AlterID Protocol

1. **AlterID Incremental Tracking**:
   Tally assigns a strictly monotonic integer `ALTERID` to every ledger and voucher edit.
2. **Incremental Fetch Query**:
   ```xml
   <ENVELOPE>
     <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>VoucherRegister</ID></HEADER>
     <BODY>
       <DESC>
         <STATICVARIABLES>
           <SVCOMPANY>Acme Corp</SVCOMPANY>
         </STATICVARIABLES>
         <TDL>
           <TDLMESSAGE>
             <REPORT NAME="VoucherRegister">
               <FORMS>VoucherRegisterForm</FORMS>
             </REPORT>
             <COLLECTION NAME="IncrementalVouchers">
               <TYPE>Voucher</TYPE>
               <FILTER>AlterIDFilter</FILTER>
             </COLLECTION>
             <SYSTEM TYPE="Formulae" NAME="AlterIDFilter">
               $AlterID > 10542
             </SYSTEM>
           </TDLMESSAGE>
         </TDL>
       </DESC>
     </BODY>
   </ENVELOPE>
   ```
3. **Checkpoint Commit**:
   Upon parsing and storing the batch of vouchers in the database inside a transaction, the maximum `AlterID` is saved to `sync_checkpoints`.
