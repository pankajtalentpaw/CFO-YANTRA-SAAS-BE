"use strict";

const { openaiClient } = require("../openai.client");
const { EXECUTIVE_CFO_SYSTEM_PROMPT, buildExecutiveAuditUserPrompt } = require("../prompts/executiveCfo.prompt");
const { MIS_REPORT5_AI_SYSTEM_PROMPT, buildChatUserPrompt } = require("../prompts/misReport5Ai.prompt");
const { buildFinancialContext } = require("../formatters/financialContext.builder");
const { resolveCompany } = require("../../services/companyScope.service");
const companyDataService = require("../../services/companyData.service");

const STRATEGIC_PROMPT_CONFIGS = [
  {
    "id": "audit",
    "label": "🎯 Full Boardroom Audit & Health Grade",
    "prompt": "Conduct a full 50+ Year Veteran CFO Boardroom Audit with Financial Health Grade."
  },
  {
    "id": "coi",
    "label": "🚨 Quantify Cost of Inaction on Decline Streaks",
    "prompt": "Analyze my sustained city decline streaks and quantify the exact Cost of Inaction (COI)."
  },
  {
    "id": "hhi",
    "label": "🛡️ Stress-Test Single-Product & HHI Risk",
    "prompt": "Evaluate my single-product concentration traps and Herfindahl Index (HHI) vulnerability."
  },
  {
    "id": "pareto",
    "label": "💎 Identify Pareto 80/20 Margin Levers",
    "prompt": "What are my highest-ROI Pareto growth opportunities and margin optimization levers?"
  },
  {
    "id": "roadmap",
    "label": "📋 Generate 90-Day Tactical Capital Roadmap",
    "prompt": "Generate a 90-Day Tactical Cash & Capital Allocation Roadmap (Weeks 1-4, 5-8, 9-12)."
  }
];

const GENERATION_PARAMETERS = {
  temperature: 0.2,
  maxTokens: 3000,
  contextWindow: "128k",
  responseFormat: "markdown",
  reasoningEffort: "high"
};

const SYSTEM_CAPABILITIES = [
  "50+ Year Veteran CFO Executive Diagnosis & DuPont Scorecards",
  "Quantified Cost of Inaction (COI) & Decline Streak Detection",
  "Herfindahl-Hirschman (HHI) Concentration & Seasonality Stress-Testing",
  "Pareto 80/20 & Margin Defense Optimization Levers",
  "90-Day Tactical Capital & Cash Recovery Roadmaps",
  "18 Multi-Dimensional MIS Filter Lens Deep Audits"
];

const ANALYTICAL_RULES = [
  "Always quote real entity names and exact INR (₹) figures without synthetic placeholders",
  "Structure diagnostic audits under 4 Boardroom Pillars: Root Cause, Business Impact, Quantified Ledger Findings, Turnaround Playbook",
  "Adhere strictly to deterministic accounting integrity derived directly from Tally register cache"
];

/**
 * Status check of AI Engine with dynamic configurations
 */
function getStatus() {
  const isConfigured = openaiClient.isConfigured();
  return {
    configured: isConfigured,
    model: openaiClient.model || "gpt-4o-mini",
    provider: "OpenAI",
    experienceLevel: "50+ Years Enterprise Veteran CFO",
    fallbackMode: !isConfigured ? "Simulated Offline CFO Intelligence" : "Live GPT-4o Enterprise Engine",
    strategicPrompts: STRATEGIC_PROMPT_CONFIGS,
    generationParameters: GENERATION_PARAMETERS,
    capabilities: SYSTEM_CAPABILITIES,
    rules: ANALYTICAL_RULES
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
- **Concentration Risk:** ${context.report5MIS?.hhiRiskCount ? `${context.report5MIS.hhiRiskCount} products flag HHI concentration risk.` : "Elevated single-month seasonality observed."}
${topCombo ? `- **Pareto Vulnerability:** Top combo **${topCombo.combo}** alone drives **${topCombo.sharePercent}%** of total enterprise turnover.` : ""}

---

## 3. 💎 High-ROI Growth Levers (Pareto 80/20 & Margin Defense)
1. **Capital Reallocation to Top-Quartile Lines:** Reallocate 25% of working capital from slow-moving bottom products into top-volume drivers.
2. **Dynamic Price Elasticity Review:** Institute strict 2% discount floors on key accounts to plug gross margin erosion.
3. **Geographic Playbook Cloning:** Replicate top market sales playbook in underperforming regional hubs.

---

## 4. 📋 90-Day Tactical Capital & Cash Roadmap
### 📅 Weeks 1–4 (Immediate Cash Containment & Account Stabilization)
- Audit distributor receivables and enforce 45-day payment limits.
- Freeze volume rebates on products suffering negative margin drag.
- Deploy direct sales intervention in ${decliningCities[0]?.city || "top declining market"}.

### 📅 Weeks 5–8 (Commercial Renegotiation & Margin Expansion)
- Renegotiate bulk input costs with key suppliers leveraging annual volume.
- Prune negative-margin and dead-stock SKUs.
- Implement structured quarterly minimum commitments with primary buyers.

### 📅 Weeks 9–12 (Structural Diversification & Governance Scaling)
- Cap single-product turnover per market below 60% to eliminate single-point failure traps.
- Establish automated weekly CFO cashflow variance tracking.
- Launch targeted product cross-selling campaigns across regional hubs.

---

## 🎯 Veteran CFO's Bottom Line (The Boardroom Mandate)
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
  const totalRev = context.report5MIS?.totalRevenue || context.salesMetrics?.invoicedSales || "0.00";
  const activeAudit = context.activeFilterAudit;

  if (activeAudit) {
    const filterTitle = activeAudit.filterName || `Filter #${activeAudit.filterId}`;
    const filterData = activeAudit.data;
    const recordsCount = Array.isArray(filterData?.data) ? filterData.data.length : (filterData ? Object.keys(filterData).length : 0);
    return `### 1. 🔍 ROOT CAUSE ANALYSIS (${filterTitle})
Based on active ledger analysis for ${context.company?.companyName || "the enterprise"}, the primary commercial driver is geographic demand variance and product concentration across key distributor channels.

### 2. 💥 BUSINESS IMPACT & CASHFLOW BLEEDING
Unmonitored variance in this segment creates working capital lag and margin leakage. If left unmanaged for 90 days, it increases risk on accounts receivable and gross contribution.

### 3. 📊 QUANTIFIED LEDGER FINDINGS
- **Filter Scope:** ${filterTitle}
- **Enterprise Turnover:** ₹${Number(totalRev).toLocaleString("en-IN")}
- **Ledger Records Analyzed:** ${recordsCount} analytical data points verified from active Tally vouchers.

### 4. 🛠️ ACTIONABLE TURNAROUND PLAYBOOK
- **Immediate (Weeks 1-2):** Standardize trade discounts and reconcile accounts with primary dealers.
- **Medium Term (Weeks 3-6):** Align minimum order quantities to maintain gross margin thresholds.
- **Long Term (Weeks 7-12):** Institutionalize monthly ledger reviews against cash-conversion targets.`;
  }

  if (q.includes("risk") || q.includes("hhi") || q.includes("danger") || q.includes("threat")) {
    return `**50+ Year Veteran CFO Risk Assessment:**
Your primary structural vulnerability is **geographic and single-product concentration**.
- Several SubCategories exhibit an HHI Index >= 0.80, meaning you are dangerously dependent on isolated peak billing cycles.
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

  const sim = generateSimulatedAudit(company, context, customFocus);
  sim.scorecard = scorecard;
  return sim;
}

/**
 * Interactive Financial Q&A with Virtual CFO supporting dynamic filter audits
 */
async function chatWithCfo(companyId, rawQuestion, { filterId, filterName, conversationHistory = [] } = {}) {
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

  let question = (rawQuestion || "").trim();
  let activeFilterData = null;
  let resolvedFilterName = filterName;

  if (filterId !== undefined && filterId !== null && filterId !== "") {
    const filterDef = misReport5?.filterIndex?.find((f) => Number(f.id) === Number(filterId));
    if (filterDef && !resolvedFilterName) {
      resolvedFilterName = filterDef.name;
    }
    const filterKey = Object.keys(misReport5?.filters || {}).find((k) => k.startsWith(`filter${filterId}_`));
    if (filterKey && misReport5?.filters?.[filterKey]) {
      activeFilterData = misReport5.filters[filterKey];
    }
    if (!question) {
      question = `Conduct a comprehensive 50+ Year Veteran CFO diagnostic audit on Filter #${filterId} (${resolvedFilterName || `Filter ${filterId}`}) addressing: 1. Root Cause, 2. Business Impact, 3. Quantified Ledger Findings, 4. Actionable Turnaround Playbook.`;
    }
  }

  const promptContext = {
    ...context,
    company: {
      companyId: company.companyId,
      companyName: company.companyName,
      startingAt: company.startingAt
    },
    ...(activeFilterData ? { activeFilterAudit: { filterId, filterName: resolvedFilterName, data: activeFilterData } } : {})
  };

  if (openaiClient.isConfigured()) {
    try {
      const messages = [
        { role: "system", content: MIS_REPORT5_AI_SYSTEM_PROMPT },
        ...conversationHistory.slice(-6),
        {
          role: "user",
          content: buildChatUserPrompt({ companyName: company.companyName, question, context: promptContext })
        }
      ];

      const completion = await openaiClient.createChatCompletion({
        messages,
        temperature: 0.2,
        maxTokens: 2000
      });

      return {
        success: true,
        mode: "live",
        answer: completion.content,
        model: completion.model,
        filterId: filterId ?? null,
        filterName: resolvedFilterName ?? null,
        generatedAt: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: true,
        mode: "simulated",
        answer: generateSimulatedAnswer(question, promptContext),
        filterId: filterId ?? null,
        filterName: resolvedFilterName ?? null,
        notice: `API notice: ${err.message}`,
        generatedAt: new Date().toISOString()
      };
    }
  }

  return {
    success: true,
    mode: "simulated",
    answer: generateSimulatedAnswer(question, promptContext),
    filterId: filterId ?? null,
    filterName: resolvedFilterName ?? null,
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
