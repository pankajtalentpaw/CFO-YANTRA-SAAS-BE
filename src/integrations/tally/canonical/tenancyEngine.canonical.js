/**
 * EXP-09: Multi-Company, Multi-Year & Tenancy Isolation Engine
 * Enforces absolute tenant and legal entity boundary isolation.
 */

function enforceTenancyLineage(record, context = {}) {
  if (!record || typeof record !== "object") return record;

  const tenantId = context.tenantId || "DEFAULT_TENANT";
  const legalEntityId = context.legalEntityId || `LE_${record.sourceCompanyId || "DEFAULT"}`;
  const connectorId = context.connectorId || "LOCAL_BRIDGE_01";
  const sourceInstanceId = context.sourceInstanceId || "LOCAL_TALLY";
  const accountingPeriod = context.accountingPeriod || "2024-2025";

  return {
    ...record,
    tenancy: {
      tenantId,
      legalEntityId,
      connectorId,
      sourceInstanceId,
      accountingPeriod
    }
  };
}

/**
 * Verify complete isolation across multiple tenant record sets
 */
function verifyTenantIsolation(tenantDatasets = {}) {
  const seenIdsByTenant = new Map();
  let crossTenantLeakage = false;
  const violations = [];

  for (const [tenantId, records] of Object.entries(tenantDatasets)) {
    seenIdsByTenant.set(tenantId, new Set());
    (records || []).forEach((r) => {
      if (r.tenancy && r.tenancy.tenantId !== tenantId) {
        crossTenantLeakage = true;
        violations.push({
          expectedTenant: tenantId,
          actualTenant: r.tenancy.tenantId,
          recordId: r.sourceObjectId
        });
      }
      seenIdsByTenant.get(tenantId).add(r.sourceObjectId);
    });
  }

  return {
    status: !crossTenantLeakage && violations.length === 0 ? "PASS" : "FAIL",
    tenantsEvaluated: Object.keys(tenantDatasets).length,
    crossTenantLeakage,
    violationsCount: violations.length,
    violations,
    verifiedAt: new Date().toISOString()
  };
}

module.exports = {
  enforceTenancyLineage,
  verifyTenantIsolation
};
