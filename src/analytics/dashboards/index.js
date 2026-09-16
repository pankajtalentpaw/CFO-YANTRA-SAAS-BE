const { evaluateOwnerTop5 } = require("./ownerTop5");
const { evaluateSalesManagerTop10 } = require("./salesManagerTop10");
const { runAll } = require("../engine/runner");

function getDashboards(cubeOrBlocks, role = "all") {
  const blocks = Array.isArray(cubeOrBlocks) ? cubeOrBlocks : (cubeOrBlocks ? runAll(cubeOrBlocks) : []);
  if (role === "owner") {
    return { ownerTop5: evaluateOwnerTop5(blocks) };
  }
  if (role === "sm" || role === "salesManager" || role === "sales-manager") {
    return { salesManagerTop10: evaluateSalesManagerTop10(blocks) };
  }
  return {
    ownerTop5: evaluateOwnerTop5(blocks),
    salesManagerTop10: evaluateSalesManagerTop10(blocks)
  };
}

module.exports = {
  evaluateOwnerTop5,
  evaluateSalesManagerTop10,
  getDashboards
};
