# CFO YANTRA — API PARITY & CONTRACT COMPATIBILITY MATRIX

## Executive Summary
This document establishes the API contract verification matrix comparing the Node.js/Express implementation against the FastAPI target. It details the response envelope standards, camelCase JSON attribute mappings, HTTP status codes, and error formats required to ensure zero frontend regression.

---

## 1. Response Envelope Standards

### Success Envelope (HTTP 200 / 201)
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

### Error Envelope (HTTP 400 / 401 / 403 / 404 / 500)
```json
{
  "success": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Field 'email' must be a valid email address",
    "details": [ ... ]
  }
}
```

---

## 2. Pydantic v2 CamelCase Model Serialization

The React frontend components expect camelCase keys (`companyId`, `voucherNumber`, `voucherDate`, `alterId`), while Python idioms use snake_case (`company_id`, `voucher_number`, `voucher_date`, `alter_id`).
To guarantee 100% contract parity without modifying frontend components, all Pydantic v2 models inherit from `BaseCamelModel`:

```python
from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

class BaseCamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True
    )
```

---

## 3. Endpoints Contract Mapping (Sample of Critical Routes)

| Path | Node Express Handler | FastAPI Handler | Input Schema | Output Schema | Parity Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `GET /health` | `server.js` | `api.v1.health.get_health` | None | `{ status: "ok", timestamp: str }` | **VERIFIED** |
| `POST /auth/login` | `authController.login` | `api.v1.auth.login` | `LoginRequest` | `{ token: str, user: UserDto }` | **VERIFIED** |
| `GET /companies` | `companyController.list` | `api.v1.companies.list_companies` | `PaginationParams` | `List[CompanyDto]` | **VERIFIED** |
| `GET /companies/:id` | `companyController.getById` | `api.v1.companies.get_company` | `company_id: int` | `CompanyDetailDto` | **VERIFIED** |
| `GET /companies/:id/vouchers` | `voucherController.list` | `api.v1.vouchers.list_vouchers` | `VoucherFilterParams` | `VoucherListResponse` | **VERIFIED** |
| `GET /companies/:id/reports/balance-sheet` | `reportController.balanceSheet` | `api.v1.reports.balance_sheet` | `DateRangeParams` | `BalanceSheetDto` | **VERIFIED** |
| `GET /companies/:id/reports/cross-verification` | `reportController.crossVerification` | `api.v1.reports.cross_verification` | `None` | `CrossVerificationResultDto` | **VERIFIED** |
