/**
 * Service for Decision Intelligence Layer (160 Analyses) for MIS Report 5.
 *
 * Exposes:
 * - getAnalyticsIndex: lightweight catalog and coverage metadata
 * - getAnalyticsForLens: run one analysis, a whole lens, or all 160 analyses on demand
 * - getAnalyticsDashboards: evaluate Owner Top-5 and Sales Manager Top-10
 * - getAnalyticsVerification: run CV01-CV16 cross-verification checks on the cube
 */

const companyDataService = require("./companyData.service");
const {
  buildAnalyticsCube,
  runLens,
  runAll,
  runOne,
  catalogIndex,
  lensIds,
  lensEntries,
  coverage,
  getDashboards,
  verifyCube,
  ANALYSIS_CATALOG
} = require("../analytics");

/**
 * Return static catalog index and current binding coverage.
 * Does not require company or cube data.
 */
function getAnalyticsIndex() {
  return {
    available: true,
    totalAnalyses: ANALYSIS_CATALOG.length,
    lenses: lensSummary(),
    catalog: catalogIndex(),
    coverage: coverage()
  };
}

/**
 * The 16 lenses as the UI needs them: id, name, how many analyses each holds,
 * and which workbook sheet it came from.
 *
 * Derived from the catalog rather than written out again, so a lens can never
 * be renamed here and left stale on the client — which is exactly what happened
 * while this endpoint returned no lens list at all and the frontend fell back to
 * its own hard-coded copy.
 */
function lensSummary() {
  return lensIds().map((id) => {
    const entries = lensEntries(id);
    const first = entries[0] || {};
    return {
      id,
      name: first.lensName || `Lens ${id}`,
      count: entries.length,
      sheet: (first.provenance && first.provenance.sheet) || null,
      // Each workbook sheet documents two filters: the odd-numbered lens is its
      // Table 1, the even-numbered one its Table 2.
      table: id % 2 === 1 ? 1 : 2,
      analysisIds: entries.map((e) => e.id)
    };
  });
}

/**
 * Compute analyses for a given company and date range.
 * Supports running a single analysis (analysisId), a lens (lensId), or all lenses.
 */
async function getAnalyticsForLens(company, options = {}) {
  const context = await companyDataService.getFactSalesContext(company, options);
  if (!context.available) {
    return { available: false, reason: context.reason };
  }

  const cube = buildAnalyticsCube(context.factResult.rows || [], {
    fromDate: options.fromDate,
    toDate: options.toDate
  });

  const { lensId, analysisId } = options;

  if (analysisId) {
    const block = runOne(cube, analysisId);
    return {
      available: true,
      companyId: company.companyId,
      companyName: company.name,
      analysisId,
      block
    };
  }

  if (lensId !== undefined && lensId !== null) {
    const blocks = runLens(cube, Number(lensId));
    return {
      available: true,
      companyId: company.companyId,
      companyName: company.name,
      lensId: Number(lensId),
      blocks,
      count: blocks.length
    };
  }

  const allBlocks = runAll(cube);
  return {
    available: true,
    companyId: company.companyId,
    companyName: company.name,
    blocks: allBlocks,
    count: allBlocks.length
  };
}

/**
 * Compute executive decision dashboards (Owner Top-5 & Sales Manager Top-10).
 */
async function getAnalyticsDashboards(company, options = {}) {
  const context = await companyDataService.getFactSalesContext(company, options);
  if (!context.available) {
    return { available: false, reason: context.reason };
  }

  const cube = buildAnalyticsCube(context.factResult.rows || [], {
    fromDate: options.fromDate,
    toDate: options.toDate
  });

  const dashboards = getDashboards(cube);

  return {
    available: true,
    companyId: company.companyId,
    companyName: company.name,
    generatedAt: new Date().toISOString(),
    // The UI states how many analyses the ranking was synthesised from; send
    // the real figure so it cannot drift into a stale hard-coded "160".
    totalAnalyses: ANALYSIS_CATALOG.length,
    dashboards
  };
}

/**
 * Run mathematical cross-verification checks (CV01–CV16).
 */
async function getAnalyticsVerification(company, options = {}) {
  const context = await companyDataService.getFactSalesContext(company, options);
  if (!context.available) {
    return { available: false, reason: context.reason };
  }

  const cube = buildAnalyticsCube(context.factResult.rows || [], {
    fromDate: options.fromDate,
    toDate: options.toDate
  });

  const verification = verifyCube(cube);

  return {
    available: true,
    companyId: company.companyId,
    companyName: company.name,
    ...verification
  };
}

module.exports = {
  getAnalyticsIndex,
  lensSummary,
  getAnalyticsForLens,
  getAnalyticsDashboards,
  getAnalyticsVerification
};
