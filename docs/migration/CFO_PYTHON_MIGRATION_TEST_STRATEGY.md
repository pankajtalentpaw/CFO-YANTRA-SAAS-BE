# CFO YANTRA — TEST STRATEGY & QUALITY ASSURANCE FRAMEWORK

## Executive Summary
This document establishes the multi-tiered testing framework for the CFO Yantra Python migration. It ensures that business logic, 28-digit financial rounding, database queries, TallyPrime XML transactions, and API contracts are exhaustively verified before production release.

---

## 1. Test Hierarchy & Coverage Targets

```
             ┌──────────────────────┐
             │  End-to-End Tests    │ (Electron + FastAPI runtime smoke)
             ├──────────────────────┤
             │  API Contract Tests  │ (52 endpoints response envelope matching)
             ├──────────────────────┤
             │  Integration Tests   │ (SQLAlchemy Async + SQLite queries)
             ├──────────────────────┤
             │  Unit & Parity Tests │ (Financial Decimal, Rounding, Tally XML)
             └──────────────────────┘
```

### Coverage Targets:
- **Financial Calculations (`app/core/decimal_util.py`, `financial_engine.py`)**: 100% statement and branch coverage.
- **Cross-Verification Rules (CV01–CV16)**: 100% test coverage with affirmative and violation fixtures.
- **Tally XML Parsing & Serialization**: 95%+ coverage with malformed, empty, and large XML fixtures.
- **REST Endpoints (52 routes)**: 100% route coverage testing status codes and envelope formatting.

---

## 2. Test Execution Commands & Environment

### Running Tests in Python:
```bash
# Run all unit and parity tests
pytest python_backend/tests/ -v

# Run financial precision golden vectors only
pytest python_backend/tests/test_financial_decimal.py -v

# Run with test coverage report
pytest --cov=python_backend/app --cov-report=term-missing python_backend/tests/
```

### Existing Node.js Baseline Verification:
```bash
# Verify the baseline Node codebase remains unbroken
npm test
```
Baseline confirmed passing: **35 test suites passed, 1,113 tests passed, 0 failures**.
