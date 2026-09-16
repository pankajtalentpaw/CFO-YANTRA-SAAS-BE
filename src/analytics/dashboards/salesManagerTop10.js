/**
 * Sales Manager Top 10 Tactical Actions Dashboard.
 *
 * Evaluates all computed analysis blocks across all 16 lenses and ranks the
 * top 10 tactical actions for territory and product sales management using the
 * workbook formula:
 *
 *   SM Priority Score = (revenueImpact / 1000) * recency * persistence * actionability
 */

const { SEVERITY } = require("../models/analysisBlock");
const { runAll } = require("../engine/runner");

/**
 * Score and rank top 10 tactical actions for the Sales Manager.
 *
 * @param {Array<object>|object} cubeOrBlocks AnalyticsCube or computed AnalysisBlocks
 * @returns {Array<object>} Top 10 ranked tactical actions with scoring metadata
 */
function evaluateSalesManagerTop10(cubeOrBlocks = []) {
  const blocks = Array.isArray(cubeOrBlocks) ? cubeOrBlocks : (cubeOrBlocks ? runAll(cubeOrBlocks) : []);
  const candidates = [];

  for (const b of blocks) {
    if (!b || b.status === "IDLE") continue;

    const coiAmount = b.costOfInaction && typeof b.costOfInaction.amount === "number"
      ? b.costOfInaction.amount
      : (b.headline?.value && typeof b.headline.value === "number" ? Math.abs(b.headline.value) : 1000);

    const revenueImpact = Math.max(100, coiAmount);
    let recency = 4;
    let persistence = 3;
    let actionability = 4;

    // Territory or Product specific lenses have highest actionability
    if ([1, 3, 4, 6, 7, 8, 10, 11, 13, 14, 15].includes(b.lensId)) {
      actionability = 5;
    }

    if (b.trigger && b.trigger.evaluated) {
      const match = String(b.trigger.evaluated).match(/(\d+)\s*month/i);
      if (match) persistence = Math.min(5, Math.max(1, parseInt(match[1], 10)));
    }

    if (b.severity === SEVERITY.CRITICAL) {
      recency = 5;
      persistence = Math.max(persistence, 4);
    } else if (b.severity === SEVERITY.HIGH) {
      recency = Math.max(recency, 4);
    }

    const smPriorityScore = (revenueImpact / 1000) * recency * persistence * actionability;

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
      revenueImpact,
      recencyScore: recency,
      persistenceScore: persistence,
      actionabilityScore: actionability,
      score: smPriorityScore,
      smPriorityScore,
      headline: b.headline,
      redFlag: b.redFlag,
      narrative: b.narrative,
      tacticalAction: (b.actions?.salesManager?.[0]?.text) || b.recommendedAction || null,
      tacticalActions: b.actions?.salesManager || [],
      costOfInaction: b.costOfInaction
    });
  }

  // Sort descending by smPriorityScore, tiebreaker: revenueImpact, then analysis ID
  candidates.sort((a, b) => {
    if (b.smPriorityScore !== a.smPriorityScore) return b.smPriorityScore - a.smPriorityScore;
    if (b.revenueImpact !== a.revenueImpact) return b.revenueImpact - a.revenueImpact;
    return a.analysisId.localeCompare(b.analysisId);
  });

  return candidates.slice(0, 10).map((item, idx) => ({
    rank: idx + 1,
    ...item
  }));
}

module.exports = {
  evaluateSalesManagerTop10
};
