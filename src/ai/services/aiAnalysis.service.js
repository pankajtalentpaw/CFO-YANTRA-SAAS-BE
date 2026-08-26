"use strict";

const { openaiClient } = require("../openai.client");
const { EXECUTIVE_CFO_SYSTEM_PROMPT, buildExecutiveAuditUserPrompt } = require("../prompts/executiveCfo.prompt");
const { MIS_REPORT5_AI_SYSTEM_PROMPT, buildChatUserPrompt } = require("../prompts/misReport5Ai.prompt");
const { buildFinancialContext } = require("../formatters/financialContext.builder");
const { resolveCompany } = require("../../services/companyScope.service");
const companyDataService = require("../../services/companyData.service");

/**
 * Status check of AI Engine
 */
function getStatus() {
  return {
    configured: openaiClient.isConfigured(),
    model: openaiClient.model,
    provider: "OpenAI",
    experienceLevel: "50+ Years Enterprise Veteran CFO",
    fallbackMode: !openaiClient.isConfigured() ? "Simulated Offline CFO Intelligence" : "Live GPT-4o Enterprise Engine"
  };
}

/**
 * Calculate quantitative CFO Scorecard
 */
function calculateExecutiveScorecard(context) {
  const decliningCities = context.report5MIS?.cityStreaks?.filter((c) => c.streak >= 3) || [];
  const totalCostOfInaction = decliningCities.reduce((sum, c) => sum + (Number(c.costOfInaction) || 0), 0);
  const topComboShare = Number(context.report5MIS?.topCombos?.[0]?.sharePercent) || 0;

  let healthGrade = "B+";
  let gradeScore = 82;
  if (decliningCities.length >= 3 || topComboShare > 40) {
    healthGrade = "B";
    gradeScore = 74;
  } else if (decliningCities.length === 0 && topComboShare < 20) {
    healthGrade = "A";
    gradeScore = 91;
  }

  return {
    healthGrade,
    gradeScore,
    costOfInaction: totalCostOfInaction.toFixed(2),
    decliningMarketsCount: decliningCities.length,
    topComboConcentration: topComboShare.toFixed(1),
    strategicPriority: decliningCities.length > 0 ? "Recover City Decline Streaks" : "Scale High-Margin Products"
  };
}

/**
 * Deterministic high-precision offline CFO analytical generator
 */
function generateSimulatedAudit(company, context, customFocus) {
  const totalRev = context.report5MIS?.totalRevenue || context.salesMetrics?.invoicedSales || "0.00";
  const cities = context.report5MIS?.distinctCities || 0;
  const products = context.report5MIS?.distinctProducts || 0;
  const decliningCities = context.report5MIS?.cityStreaks?.filter((c) => c.streak >= 3) || [];
  const topCombo = context.report5MIS?.topCombos?.[0];
  const totalCostOfInaction = decliningCities.reduce((sum, c) => sum + (Number(c.costOfInaction) || 0), 0);

  const markdown = `# 🏛️ Executive Boardroom Audit: ${company.companyName}
**Role:** 50+ Year Veteran Chief Financial Officer (CFO) Strategic Advisory

## 1. 📊 Executive Diagnosis & Financial Health Grade: **B+**
**Total Invoiced Sales Volume:** ₹${Number(totalRev).toLocaleString("en-IN")} across **${products} Products** in **${cities} Regional Markets**.

> **CFO Executive Verdict:**
> The enterprise commands healthy transactional throughput, but is operating with significant capital concentration and unaddressed multi-month regional decline streaks. Addressing these vulnerabilities will immediately unlock significant recoverable cash flow.

---

## 2. 🚨 Critical Red Flags & Quantified Cost of Inaction (COI)
- **Total Immediate Cash at Risk:** **₹${Number(totalCostOfInaction).toLocaleString("en-IN")}** across **${decliningCities.length} declining markets**.
${decliningCities.length > 0 ? decliningCities.map((c) => `  - **${c.city} (${c.streak}-Month Consecutive Decline Streak):** Linear slope is negative (${c.slope}). Recoverable cash leakage: **₹${Number(c.costOfInaction).toLocaleString("en-IN")}**. Immediate intervention with distributor accounts required.`).join("\n") : "  - **Regional Momentum:** No markets currently exceed the 3-month decline threshold."}
- **Concentration Risk:** ${context.report5MIS?.hhiRiskCount || "Elevated single-month seasonality observed."}
${topCombo ? `- **Pareto Vulnerability:** Top combo **${topCombo.combo}** alone drives **${topCombo.sharePercent}%** of total enterprise turnover.` : ""}

---

## 3. 💎 High-ROI Growth Levers (Pareto 80/20 & Margin Defense)
1. **Capital Reallocation to Top-Quartile Lines:** Reallocate 25% of working capital from slow-moving bottom products into top-volume drivers.
2. **Dynamic Price Elasticity Review:** Institute strict 2% discount floors on key accounts to plug gross margin erosion.
3. **Geographic Playbook Cloning:** Replicate top market sales playbook in underperforming regional hubs.

---

## 4. 📋 90-Day Tactical Capital & Cash Roadmap
### 🗓️ Weeks 1–4 (Immediate Cash Containment & Account Stabilization)
- Audit distributor receivables and enforce 45-day payment limits.
- Freeze volume rebates on products suffering negative margin drag.
- Deploy direct sales intervention in ${decliningCities[0]?.city || "top declining market"}.

### 🗓️ Weeks 5–8 (Commercial Renegotiation & Margin Expansion)
- Renegotiate bulk input costs with key suppliers leveraging annual volume.
- Prune negative-margin and dead-stock SKUs.
- Implement structured quarterly minimum commitments with primary buyers.

### 🗓️ Weeks 9–12 (Structural Diversification & Governance Scaling)
- Cap single-product turnover per market below 60% to eliminate single-point failure traps.
- Establish automated weekly CFO cashflow variance tracking.
- Launch targeted product cross-selling campaigns across regional hubs.

---

## ⚡ Veteran CFO's Bottom Line (The Boardroom Mandate)
Stop funding unprofitable volume and immediately arrest the **₹${Number(totalCostOfInaction).toLocaleString("en-IN")}** recoverable revenue bleeding in declining regional markets. Focusing capital discipline on your top 20% highest-margin SubCategories will strengthen operating cash flow within 60 days.
`;

  return {
    success: true,
    mode: "simulated",
    companyId: company.companyId,
    companyName: company.companyName,
    analysis: markdown,
    contextSummary: {
      totalRevenue: totalRev,
      distinctProducts: products,
      distinctCities: cities
    },
    generatedAt: new Date().toISOString()
  };
}

function generateSimulatedAnswer(question, context) {
  const q = (question || "").toLowerCase();
  const totalRev = context.report5MIS?.totalRevenue || "0.00";

  if (q.includes("risk") || q.includes("hhi") || q.includes("danger") || q.includes("threat")) {
    return `**50+ Year Veteran CFO Risk Assessment:**
Your primary structural vulnerability is **geographic and single-product concentration**.
- Several SubCategories exhibit an HHI Index $\\ge 0.80$, meaning you are dangerously dependent on isolated peak billing cycles.
- A sudden demand shift from a single key buyer or city would severely stress operating cash flow.
- **Mandate:** Establish 60-day advance orders and diversify customer base across tier-2 cities.`;
  }

  if (q.includes("streak") || q.includes("declin") || q.includes("city") || q.includes("cities") || q.includes("drop")) {
    const declining = context.report5MIS?.cityStreaks?.filter((c) => c.streak >= 3) || [];
    if (declining.length > 0) {
      return `**City Decline & Cost of Inaction (COI) Audit:**
We have identified **${declining.length} regional markets** in consecutive decline streaks:
${declining.map((c) => `• **${c.city}**: ${c.streak}-month sustained drop | Recoverable Cash at Risk: **₹${Number(c.costOfInaction).toLocaleString("en-IN")}**`).join("\n")}
**CFO Recommendation:** Do not wait for organic recovery. Restructure dealer terms and pricing incentives immediately.`;
    }
    return `**City Trend Assessment:** No markets currently exceed the 3-month consecutive decline threshold. Regional revenue momentum is stable.`;
  }

  return `**Veteran CFO Strategic Mandate:**
Based on your enterprise turnover of **₹${Number(totalRev).toLocaleString("en-IN")}**:
1. Protect your top 3 revenue combinations while diversifying tail products.
2. Intervene in multi-month regional decline streaks to recover cash before it becomes permanent loss.
3. Maintain a 60-day liquid working capital reserve to absorb peak-to-trough seasonality swings.`;
}

/**
 * Run comprehensive 50+ Year Veteran CFO analysis for a company
 */
async function generateExecutiveAudit(companyId, { customFocus = null, forceOffline = false } = {}) {
  // 1. Gather all analytical context
  const resolution = await resolveCompany(companyId);
  if (!resolution || resolution.ok === false) {
    throw new Error(`Company not found for id: ${companyId}`);
  }
  const company = resolution.company || resolution;

  const [salesAnalysis, misReport5] = await Promise.all([
    companyDataService.getSalesAnalysis(company).catch(() => null),
    companyDataService.getMisReport5(company).catch(() => null)
  ]);

  const context = buildFinancialContext({ company, salesAnalysis, misReport5 });
  const scorecard = calculateExecutiveScorecard(context);

  // 2. If OpenAI is configured and not forced offline, run live LLM
  if (openaiClient.isConfigured() && !forceOffline) {
    try {
      const userPrompt = buildExecutiveAuditUserPrompt({
        companyName: company.companyName,
        summaryData: context.salesMetrics || {},
        report5Data: context.report5MIS || {},
        customFocus
      });

      const completion = await openaiClient.createChatCompletion({
        messages: [
          { role: "system", content: EXECUTIVE_CFO_SYSTEM_PROMPT },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.25,
        maxTokens: 3000
      });

      return {
        success: true,
        mode: "live",
        model: completion.model,
        companyId,
        companyName: company.companyName,
        scorecard,
        analysis: completion.content,
        contextSummary: {
          totalRevenue: misReport5?.metadata?.totalRevenue || salesAnalysis?.totals?.invoicedValue,
          distinctProducts: misReport5?.metadata?.distinctSubCategories,
          distinctCities: misReport5?.metadata?.distinctCities
        },
        generatedAt: new Date().toISOString()
      };
    } catch (err) {
      const sim = generateSimulatedAudit(company, context, customFocus);
      sim.scorecard = scorecard;
      sim.notice = `Note: Generated via 50+ Year Veteran CFO Rule Engine due to API notice: ${err.message}`;
      return sim;
    }
  }

  // 3. Fallback: High-conviction deterministic CFO simulation
  const sim = generateSimulatedAudit(company, context, customFocus);
  sim.scorecard = scorecard;
  return sim;
}

/**
 * Interactive Financial Q&A with Virtual CFO
 */
async function chatWithCfo(companyId, question, { conversationHistory = [] } = {}) {
  const resolution = await resolveCompany(companyId);
  if (!resolution || resolution.ok === false) {
    throw new Error(`Company not found for id: ${companyId}`);
  }
  const company = resolution.company || resolution;

  const [salesAnalysis, misReport5] = await Promise.all([
    companyDataService.getSalesAnalysis(company).catch(() => null),
    companyDataService.getMisReport5(company).catch(() => null)
  ]);

  const context = buildFinancialContext({ company, salesAnalysis, misReport5 });

  if (openaiClient.isConfigured()) {
    try {
      const messages = [
        { role: "system", content: MIS_REPORT5_AI_SYSTEM_PROMPT },
        ...conversationHistory.slice(-6),
        {
          role: "user",
          content: buildChatUserPrompt({ companyName: company.companyName, question, context })
        }
      ];

      const completion = await openaiClient.createChatCompletion({
        messages,
        temperature: 0.2,
        maxTokens: 1500
      });

      return {
        success: true,
        mode: "live",
        answer: completion.content,
        model: completion.model,
        generatedAt: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: true,
        mode: "simulated",
        answer: generateSimulatedAnswer(question, context),
        notice: `API notice: ${err.message}`,
        generatedAt: new Date().toISOString()
      };
    }
  }

  return {
    success: true,
    mode: "simulated",
    answer: generateSimulatedAnswer(question, context),
    generatedAt: new Date().toISOString()
  };
}

function createAiAnalysisService() {
  return {
    getStatus,
    generateExecutiveAudit,
    chatWithCfo,
    _calculateExecutiveScorecard: calculateExecutiveScorecard,
    _generateSimulatedAudit: generateSimulatedAudit,
    _generateSimulatedAnswer: generateSimulatedAnswer
  };
}

const aiAnalysisService = createAiAnalysisService();

module.exports = {
  getStatus,
  generateExecutiveAudit,
  chatWithCfo,
  createAiAnalysisService,
  AiAnalysisService: createAiAnalysisService,
  aiAnalysisService
};
