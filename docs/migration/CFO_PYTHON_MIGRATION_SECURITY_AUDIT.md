# CFO YANTRA — SECURITY & ACCESS CONTROL AUDIT

## Executive Summary
This document provides a comprehensive security assessment across authentication, tenant data isolation, XML entity attacks, SQL injection, and cryptographic posture for the CFO Yantra Python backend.

---

## 1. Security Vectors & Defenses

### 1.1. XML External Entity (XXE) Protection
- **Vulnerability**: TallyPrime responses are XML payloads. Processing untrusted XML with standard parsers (`xml.etree.ElementTree` or `lxml`) exposes the host to entity expansion (Billion Laughs) and local file inclusion (`SYSTEM "file:///etc/passwd"`).
- **Defense**: All XML parsing is strictly delegated to `defusedxml.ElementTree`:
  ```python
  import defusedxml.ElementTree as ET
  # DTD forbidden and external entities disabled by default
  root = ET.fromstring(raw_xml)
  ```

### 1.2. SQL Injection Prevention
- **Vulnerability**: Dynamic SQL string formatting in reports or analytics filters.
- **Defense**: SQLAlchemy 2.0 uses parameterized prepared statements exclusively. Direct raw SQL string concatenation is strictly prohibited. All queries use typed column constructs or bounded parameters (`select(Voucher).where(Voucher.company_id == company_id)`).

### 1.3. Multi-Tenant Isolation Enforcement
- **Vulnerability**: An authenticated user of Company A accessing or mutating records of Company B.
- **Defense**: FastAPI dependency injection injects the authenticated `TenantContext`. Every repository query unconditionally filters by `company_id`:
  ```python
  async def get_voucher_for_tenant(db: AsyncSession, company_id: int, voucher_id: int):
      stmt = select(Voucher).where(
          Voucher.id == voucher_id,
          Voucher.company_id == company_id
      )
      result = await db.execute(stmt)
      return result.scalar_one_or_none()
  ```

### 1.4. Password Storage & Secret Management
- **Password Hashing**: Passwords stored using `bcrypt` via `passlib` with cost factor 12.
- **Secret Hardcoding**: All secrets (`JWT_SECRET`, `DATABASE_URL`) are loaded from environment variables or encrypted Electron storage. Defaults are prohibited in production mode.

### 1.5. Localhost API Binding
- In Desktop mode, the FastAPI backend binds exclusively to `127.0.0.1` (loopback interface), preventing remote LAN devices from accessing the local accounting API.
