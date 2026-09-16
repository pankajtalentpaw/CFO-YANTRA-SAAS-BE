/**
 * Decision Intelligence Layer (160 Analyses) — Public API Barrel.
 *
 * Provides entry points for:
 * - Cube building: buildAnalyticsCube
 * - Analysis execution: runLens, runAll, runOne, catalogIndex, coverage
 * - Dashboards: getDashboards, evaluateOwnerTop5, evaluateSalesManagerTop10
 * - Audit & Verification: verifyCube (CV01–CV16)
 * - Block schema constants: STATUS, SEVERITY, FAMILY, FORMAT
 */

const { buildAnalyticsCube } = require("./compute/shared/analyticsCube.builder");
const {
  runLens,
  runAll,
  runOne,
  catalogIndex,
  lensIds,
  lensEntries,
  coverage,
  ANALYSIS_CATALOG
} = require("./engine/runner");
const {
  getDashboards,
  evaluateOwnerTop5,
  evaluateSalesManagerTop10
} = require("./dashboards");
const { verifyCube } = require("./compute/shared/crossVerification");
const {
  STATUS,
  SEVERITY,
  FAMILY,
  FORMAT,
  validateBlock
} = require("./models/analysisBlock");

module.exports = {
  buildAnalyticsCube,
  runLens,
  runAll,
  runOne,
  catalogIndex,
  lensIds,
  lensEntries,
  coverage,
  ANALYSIS_CATALOG,
  getDashboards,
  evaluateOwnerTop5,
  evaluateSalesManagerTop10,
  verifyCube,
  STATUS,
  SEVERITY,
  FAMILY,
  FORMAT,
  validateBlock
};
