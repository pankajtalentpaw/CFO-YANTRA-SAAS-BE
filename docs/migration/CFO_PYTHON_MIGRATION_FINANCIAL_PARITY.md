# CFO YANTRA — FINANCIAL CALCULATION PARITY & PRECISION SPECIFICATION

## Executive Summary
Financial accuracy is the release-critical core of CFO Yantra. Any discrepancy between the Node.js implementation and the Python implementation—even by a single fractional cent ($0.01)—will corrupt trial balance equality, balance sheet reconciliation, tax reporting, and audit verification. This document formalizes the precision rules, rounding algorithms, and verification vectors (VEC-01 through VEC-06).

---

## 1. The Core Precision Discrepancy & Root Cause

### Node.js Baseline Implementation (`src/utils/financialDecimal.js:6`)
```javascript
const Decimal = require('decimal.js');
Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP, // Mode 4: Round half away from zero
  toExpNeg: -7,
  toExpPos: 21,
});
```

### Python Default Hazard
Python's standard library `decimal` module defaults to `ROUND_HALF_EVEN` (Banker's rounding / IEEE 754 standard). Under `ROUND_HALF_EVEN`, `2.5` rounds to `2` (nearest even number), whereas under `ROUND_HALF_UP`, `2.5` rounds to `3`.
In financial invoices with multiple 18% GST line items, Banker's rounding generates systematic penny errors against the standard Indian tax authority rounding requirements.

### Target Python Specification (`python_backend/app/core/decimal_util.py`)
```python
import decimal
from decimal import Decimal, ROUND_HALF_UP

# Initialize global precision context
FINANCIAL_CONTEXT = decimal.Context(prec=28, rounding=ROUND_HALF_UP)
decimal.setcontext(FINANCIAL_CONTEXT)
```

---

## 2. Test Vectors & Golden Test Cases (VEC-01 to VEC-06)

### Vector VEC-01: Symmetric Half-Up Rounding
- **Test Objective**: Verify half-way values round away from zero.
- **Inputs & Expected Outputs (2 decimal places)**:
  - `Decimal('1.005')` -> `Decimal('1.01')`
  - `Decimal('1.015')` -> `Decimal('1.02')`
  - `Decimal('2.5')` (0 places) -> `Decimal('3')`
  - `Decimal('-2.5')` (0 places) -> `Decimal('-3')`
  - `Decimal('0.005')` -> `Decimal('0.01')`

### Vector VEC-02: GST 18% Tax Calculation on Fractional Invoices
- **Test Objective**: Verify line item tax and total aggregation parity.
- **Scenario**: 3 line items of 133.33 each with 18% GST (9% CGST, 9% SGST).
  - Item Base: `133.33`
  - CGST rate: `0.09` -> `133.33 * 0.09 = 11.9997`
  - CGST rounded (2 places): `12.00`
  - SGST rate: `0.09` -> `133.33 * 0.09 = 11.9997`
  - SGST rounded (2 places): `12.00`
  - Item Total: `133.33 + 12.00 + 12.00 = 157.33`
  - Aggregate 3 items: `471.99`

### Vector VEC-03: Arbitrary 28-Digit Precision Under Multi-Step Division
- **Test Objective**: Verify no loss of precision during weighted average cost of capital (WACC) and DCF discounting.
- **Operation**: `(Decimal('1000000000.123456789012345678') / Decimal('7.0')) * Decimal('7.0')`
- **Expected Precision**: Exact restoration of `1000000000.123456789012345678` with 28 digits preserved.

### Vector VEC-04: Division by Zero & Extreme Boundary Protection
- **Test Objective**: Financial ratios when denominator is zero or missing.
- **Scenarios**:
  - `Operating Income / 0` -> Returns `Decimal('0')` (Safe financial fallback, never `ZeroDivisionError` or `NaN`)
  - `Current Assets / Current Liabilities` when liabilities = 0 -> Returns `Decimal('0')` with ratio flag `undefined`
  - `None` or `""` inputs -> Automatically coerced to `Decimal('0')`

### Vector VEC-05: Cumulative Summation & Floating-Point Drift Immunity
- **Test Objective**: Prevent binary floating-point drift (`0.1 + 0.2 = 0.30000000000000004`).
- **Operation**: Sum `Decimal('0.10')` repeated 10,000 times.
- **Expected Output**: Exactly `Decimal('1000.00')`.

### Vector VEC-06: Cross-Verification Rules (CV01 - CV16)
- **CV01**: `abs(Total Assets - (Total Liabilities + Equity)) < Decimal('0.01')`
- **CV02**: `abs(Total Debits - Total Credits) == Decimal('0')`
- **CV15**: `abs(Voucher Amount - sum(Entry Amounts)) == Decimal('0')`

---

## 3. Database Persistence & JSON Serialization

1. **Storage Type**:
   - In SQLite: Stored as `TEXT` to preserve exact 28-character decimal representations without IEEE 754 truncation.
   - In PostgreSQL: Stored as `NUMERIC(28, 4)` or `NUMERIC(28, 6)`.
2. **JSON Serialization**:
   - For UI display and reports: Serialized as strings or formatted numbers with 2 decimal places (e.g. `"12500.50"`).
   - For raw API responses: Number fields preserve full precision as strings or decimal numbers depending on the specific endpoint contract.
