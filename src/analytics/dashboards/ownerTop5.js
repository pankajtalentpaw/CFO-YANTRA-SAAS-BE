/**
 * Owner Top 5 Strategic Issues Dashboard.
 *
 * Evaluates all computed analysis blocks across all 16 lenses and ranks the
 * top 5 strategic decisions for the business owner using the workbook formula:
 *
 *   Owner Priority Score = severity * persistence * weight
 *   weight = 3 if (severity >= 4 AND persistence >= 4) else 2
 */

const { SEVERITY } = require("../models/analysisBlock");
const { runAll } = require("../engine/runner");

const SEVERITY_WEIGHT = {
  [SEVERITY.CRITICAL]: 4,
  [SEVERITY.HIGH]: 3,
  [SEVERITY.MEDIUM]: 2,
  [SEVERITY.LOW]: 1
};

/**
 * Score and rank top 5 strategic issues for the Owner.
 *
 * @param {Array<object>|object} cubeOrBlocks AnalyticsCube or computed AnalysisBlocks
 * @returns {Array<object>} Top 5 ranked strategic issues with scoring metadata
 */
function evaluateOwnerTop5(cubeOrBlocks = []) {
  const blocks = Array.isArray(cubeOrBlocks) ? cubeOrBlocks : (cubeOrBlocks ? runAll(cubeOrBlocks) : []);
  const candidates = [];

  for (const b of blocks) {
    if (!b || b.status === "IDLE") continue;

    const sevNum = SEVERITY_WEIGHT[b.severity] || 1;
    let persistence = 3;

    // Infer persistence from streak / trigger / headline
    if (b.trigger && b.trigger.evaluated) {
      const match = String(b.trigger.evaluated).match(/(\d+)\s*month/i);
      if (match) persistence = Math.min(5, Math.max(1, parseInt(match[1], 10)));
    }
    if (b.severity === SEVERITY.CRITICAL) persistence = Math.max(persistence, 4);

    const weight = (sevNum >= 4 && persistence >= 4) ? 3 : 2;
    const score = sevNum * persistence * weight;

    const coiAmount = b.costOfInaction && typeof b.costOfInaction.amount === "number"
      ? b.costOfInaction.amount
      : 0;

    candidates.push({
      id: b.id,
      analysisId: b.id,
      lensId: b.lensId,
      slot: b.slot,
      title: b.title,
      question: b.question,
      status: b.status,
      severity: b.severity,
      priority: b.priority,
      severityScore: sevNum,
      persistenceScore: persistence,
      weightMultiplier: weight,
      score,
      ownerPriorityScore: score,
      headline: b.headline,
      redFlag: b.redFlag,
      narrative: b.narrative,
      recommendedAction: b.recommendedAction || (b.actions?.owner?.[0]?.text) || null,
      ownerActions: b.actions?.owner || [],
      costOfInaction: b.costOfInaction,
      financialImpact: coiAmount * 6
    });
  }

  // Sort descending by ownerPriorityScore, tiebreaker: costOfInaction amount, then analysis ID
  candidates.sort((a, b) => {
    if (b.ownerPriorityScore !== a.ownerPriorityScore) return b.ownerPriorityScore - a.ownerPriorityScore;
    const coiB = b.costOfInaction?.amount || 0;
    const coiA = a.costOfInaction?.amount || 0;
    if (coiB !== coiA) return coiB - coiA;
    return a.analysisId.localeCompare(b.analysisId);
  });

  return candidates.slice(0, 5).map((item, idx) => ({
    rank: idx + 1,
    ...item
  }));
}

module.exports = {
  evaluateOwnerTop5
};
