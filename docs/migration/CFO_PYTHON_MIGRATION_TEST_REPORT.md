# CFO YANTRA — COMPREHENSIVE TEST EXECUTION REPORT

## Executive Summary
This document provides empirical records of all automated test suites executed across the Python/FastAPI backend and the baseline Node.js backend. Every suite was run in the actual local environment with full logging.

---

## 1. Test Suite Summary Table

| Test Suite | Framework / Tool | Command | Tests Discovered | Passed | Failed | Skipped | Blocked | Execution Duration |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Financial Decimal Parity** | Pytest 9.0.3 | `python -m pytest python_backend/tests/test_financial_decimal.py -v` | 6 | **6** | 0 | 0 | 0 | 0.07s |
| **Database Parity & unwrap_row** | Pytest 9.0.3 | `python -m pytest python_backend/tests/test_database_models.py -v` | 3 | **3** | 0 | 0 | 0 | 0.60s |
| **API Contract & Envelope Parity** | Pytest 9.0.3 | `python -m pytest python_backend/tests/test_api_contracts.py -v` | 10 | **10** | 0 | 0 | 0 | 1.38s |
| **Full Python Test Suite** | Pytest 9.0.3 | `python -m pytest python_backend/tests/ -v` | 19 | **19** | 0 | 0 | 0 | 1.41s |
| **Node.js Baseline Regression** | Jest 29.7.0 | `npm test` | 1,113 | **1,113** | 0 | 0 | 0 | 3.743s |
| **Manual Live Probe (Port 5001)** | HTTPX / Uvicorn | Live GET to `/health` and `/api/v1/companies/` | 2 | **2** | 0 | 0 | 0 | Verified |

---

## 2. Detailed Test Results & Outputs

### 2.1. Full Python Backend Test Suite (`python -m pytest python_backend/tests/ -v`)
```text
============================= test session starts =============================
platform win32 -- Python 3.14.4, pytest-9.0.3, pluggy-1.6.0 -- C:\Python314\python.exe
cachedir: .pytest_cache
rootdir: C:\Users\admin\Desktop\CFO PROJECT\backend\python_backend
configfile: pyproject.toml
plugins: anyio-4.13.0, asyncio-1.4.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collecting ... collected 19 items

python_backend\tests\test_api_contracts.py::test_root_endpoint PASSED    [  5%]
python_backend\tests\test_api_contracts.py::test_health_endpoints PASSED [ 10%]
python_backend\tests\test_api_contracts.py::test_static_analytics_catalog_route_shadowing PASSED [ 15%]
python_backend\tests\test_api_contracts.py::test_companies_list PASSED   [ 21%]
python_backend\tests\test_api_contracts.py::test_company_details_and_overview PASSED [ 26%]
python_backend\tests\test_api_contracts.py::test_company_vouchers_and_ledgers PASSED [ 31%]
python_backend\tests\test_api_contracts.py::test_cross_verification_endpoint PASSED [ 36%]
python_backend\tests\test_api_contracts.py::test_error_envelope_format_on_404 PASSED [ 42%]
python_backend\tests\test_api_contracts.py::test_auth_workflow PASSED    [ 47%]
python_backend\tests\test_api_contracts.py::test_settings_and_tally_endpoints PASSED [ 52%]
python_backend\tests\test_database_models.py::test_read_existing_companies PASSED [ 57%]
python_backend\tests\test_database_models.py::test_unwrap_row_behavior PASSED [ 63%]
python_backend\tests\test_database_models.py::test_vouchers_and_ledgers_counts PASSED [ 68%]
python_backend\tests\test_financial_decimal.py::test_vec01_symmetric_half_up_rounding PASSED [ 73%]
python_backend\tests\test_financial_decimal.py::test_vec02_gst_tax_calculations PASSED [ 78%]
python_backend\tests\test_financial_decimal.py::test_vec03_arbitrary_28_digit_precision PASSED [ 84%]
python_backend\tests\test_financial_decimal.py::test_vec04_division_by_zero_and_null_tolerance PASSED [ 89%]
python_backend\tests\test_financial_decimal.py::test_vec05_cumulative_summation_drift_immunity PASSED [ 94%]
python_backend\tests\test_financial_decimal.py::test_vec06_cross_verification_invariants PASSED [100%]

============================= 19 passed in 1.41s ==============================
```

### 2.2. Node.js Baseline Suite (`npm test`)
```text
Test Suites: 35 passed, 35 total
Tests:       1113 passed, 1113 total
Snapshots:   0 total
Time:        3.743 s
Ran all test suites.
```

### 2.3. Manual Verification Output on Port 5001
```text
INFO:     Started server process [23816]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:5001 (Press CTRL+C to quit)
INFO:     127.0.0.1:54198 - "GET /health HTTP/1.1" 200 OK
INFO:     127.0.0.1:54199 - "GET /api/v1/companies/ HTTP/1.1" 200 OK
Output:
HEALTH: 200 {'status': 'HEALTHY', 'service': 'cfo-yantra-backend', 'version': '1.0.0', 'timestamp': '2026-09-19T13:40:42.293413+00:00'}
COMPANIES: 200 4
```
