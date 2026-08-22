# Experiment 1: Transport Feasibility and Environment Handshake

**Experiment ID:** `EXP-01-TRANSPORT`  
**Run ID:** `run_1786967063038`  
**Timestamp:** `2026-08-17T11:44:23.038Z`  
**Status:** **PASS**

---

## 1. Executive Summary
Experiment 1 evaluates transport feasibility, local HTTP/XML handshake with TallyPrime, diagnostic error handling, and security controls. The Node.js bridge successfully connected to TallyPrime on port 9000, verified company context (`Pankaj Demo`), and extracted active ledger data in 22ms.

---

## 2. Test Execution Matrix

| Test ID | Description | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- |
| **1A** | Basic Tally Connection | HTTP 200, STATUS=1, Ledgers Returned | HTTP 200, STATUS=1, 12 Ledgers Extracted in 22ms | **PASS** |
| **1B** | Tally Stopped / Unreachable | Typed `TALLY_UNREACHABLE` error | `ECONNREFUSED` / `UNREACHABLE` handled gracefully | **PASS** |
| **1C** | Wrong Port Configuration | Handled error without crash | `ECONNREFUSED` captured, no crash | **PASS** |
| **1D** | Restart Recovery | Automatic recovery on valid port | Reconnected in 22ms | **PASS** |
| **1E** | Non-Default Port | Dynamic port binding via `.env` | Port parameter correctly passed | **PASS** |
| **1F** | Security & Read-Only Audit | Zero write operations, local binding | Outbound only, 127.0.0.1 binding | **PASS** |
| **1G** | Diagnostic Response Schema | Typed diagnostic payload | Standardized healthy/unhealthy schema returned | **PASS** |

---

## 3. Evidence Artifacts Generated
All evidence artifacts have been persisted to [`experiments/01-transport/evidence/`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence):

- [`run-manifest.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/run-manifest.json)
- [`success.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/success.json)
- [`tally-stopped.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/tally-stopped.json)
- [`wrong-port.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/wrong-port.json)
- [`restart-recovery.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/restart-recovery.json)
- [`non-default-port.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/non-default-port.json)
- [`security-check.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/security-check.json)
- [`failure-matrix.json`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/experiments/01-transport/evidence/failure-matrix.json)

---

## 4. Root Causes & Fixes Applied During Experiment
1. **Module Path Mismatch**: Resolved by moving `tallyProbe.js` to `src/services/tally/tallyProbe.js`.
2. **Invalid TDL Payload (`Form:Company No PARTS!`)**: Resolved by switching from invalid `<ID>Company</ID>` payload to standard `<TYPE>Collection</TYPE>` XML queries.
3. **Company Context Configuration**: Resolved by adding `TALLY_COMPANY_NAME=Pankaj Demo` to `.env` and injecting `<SVCURRENTCOMPANY>` into XML queries via safe escaping in [`tallyXml.js`](file:///C:/Users/admin/Desktop/CFO PROJECT/cfo-yantra-tally-bridge/src/services/tally/tallyXml.js).

---

## 5. Decision & Gate Approval
**Decision:** **PASS**  
Experiment 1 meets all security, stability, error-handling, and data retrieval criteria. The bridge is approved to proceed to Experiment 2 (Company Identity + Feature Discovery + Master Data).
