/**
 * Master Data Reconciliation Engine
 * Verifies count parity, hierarchy integrity, and orphan detection.
 */

function reconcileMasters(rawCounts, canonicalMasters) {
  const masterTypes = [
    { key: "groups", label: "Groups" },
    { key: "ledgers", label: "Ledgers" },
    { key: "voucherTypes", label: "Voucher Types" },
    { key: "costCategories", label: "Cost Categories" },
    { key: "costCentres", label: "Cost Centres" },
    { key: "currencies", label: "Currencies" },
    { key: "units", label: "Units" },
    { key: "stockGroups", label: "Stock Groups" },
    { key: "stockCategories", label: "Stock Categories" },
    { key: "stockItems", label: "Stock Items" },
    { key: "godowns", label: "Godowns" }
  ];

  const countsReconciliation = {};
  let allCountsMatched = true;

  for (const { key, label } of masterTypes) {
    const rawCount = rawCounts[key] !== undefined ? rawCounts[key] : (canonicalMasters[key] ? canonicalMasters[key].length : 0);
    const extractedCount = canonicalMasters[key] ? canonicalMasters[key].length : 0;
    const variance = extractedCount - rawCount;
    const status = variance === 0 ? "PASS" : "MISMATCH";

    if (status === "MISMATCH") {
      allCountsMatched = false;
    }

    countsReconciliation[key] = {
      label,
      tallyRawCount: rawCount,
      extractedCount,
      variance,
      status
    };
  }

  // 1. Group Hierarchy Validation
  const groupNames = new Set((canonicalMasters.groups || []).map((g) => g.name.toLowerCase()));
  const missingGroupParents = [];
  (canonicalMasters.groups || []).forEach((g) => {
    if (g.parent && g.parent !== "Primary" && !groupNames.has(g.parent.toLowerCase())) {
      missingGroupParents.push({ group: g.name, missingParent: g.parent });
    }
  });

  // 2. Ledger Parent Validation
  const missingLedgerParents = [];
  (canonicalMasters.ledgers || []).forEach((l) => {
    if (l.parent && l.parent !== "Primary" && !groupNames.has(l.parent.toLowerCase())) {
      missingLedgerParents.push({ ledger: l.name, missingParent: l.parent });
    }
  });

  // 3. ID Uniqueness Validation
  const idCollisions = {};
  for (const { key } of masterTypes) {
    const items = canonicalMasters[key] || [];
    const seenIds = new Map();
    items.forEach((item) => {
      if (seenIds.has(item.sourceObjectId)) {
        if (!idCollisions[key]) idCollisions[key] = [];
        idCollisions[key].push({ id: item.sourceObjectId, name: item.name });
      } else {
        seenIds.set(item.sourceObjectId, true);
      }
    });
  }

  const hierarchyStatus = missingGroupParents.length === 0 && missingLedgerParents.length === 0 ? "PASS" : "WARNING";
  const idStatus = Object.keys(idCollisions).length === 0 ? "PASS" : "FAIL";

  const overallStatus = (allCountsMatched && idStatus === "PASS") ? "PASS" : (allCountsMatched ? "CONDITIONAL_PASS" : "FAIL");

  return {
    status: overallStatus,
    masterCounts: countsReconciliation,
    hierarchy: {
      status: hierarchyStatus,
      missingGroupParents,
      missingLedgerParents
    },
    identityUniqueness: {
      status: idStatus,
      collisions: idCollisions
    },
    reconciledAt: new Date().toISOString()
  };
}

/**
 * Compare multi-run extractions for determinism
 */
function evaluateDeterminism(runs) {
  if (!runs || runs.length < 2) {
    return {
      status: "PASS",
      totalRuns: runs ? runs.length : 0,
      deterministic: true,
      varianceDetected: false
    };
  }

  const baseRun = runs[0];
  const differences = [];

  for (let i = 1; i < runs.length; i++) {
    const currentRun = runs[i];

    if (baseRun.checksum !== currentRun.checksum) {
      differences.push({
        runIndex: i,
        baseChecksum: baseRun.checksum,
        currentChecksum: currentRun.checksum,
        masterCountMatch: JSON.stringify(baseRun.counts) === JSON.stringify(currentRun.counts)
      });
    }
  }

  return {
    status: differences.length === 0 ? "PASS" : "FAIL",
    totalRuns: runs.length,
    deterministic: differences.length === 0,
    varianceDetected: differences.length > 0,
    differences
  };
}

module.exports = {
  reconcileMasters,
  evaluateDeterminism
};
