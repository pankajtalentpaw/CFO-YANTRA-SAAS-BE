/**
 * Every RED/AMBER threshold in the 160-analysis spec, in one place.
 *
 * Transcribed from the workbook's own "Trigger Point" cells. Sheets 07-08 state
 * the rule outright ("Gap from peak > 20% = AMBER; > 40% = RED; > 60% =
 * CRITICAL"); sheets 09-14 state only the already-evaluated outcome, so their
 * rules were read off the underlying formulas instead.
 *
 * NORMALISATION: every threshold is expressed so that a HIGHER metric is WORSE,
 * and bands are listed ascending. A builder measuring something where lower is
 * worse — a growth rate, say — negates it into a "decline" metric first. That
 * one convention removes direction handling from the evaluator entirely and
 * makes every band table read the same way.
 *
 * `rule` is the human-readable sentence shown on the card, and is the wording
 * the workbook uses wherever the workbook states one.
 */

const { STATUS, SEVERITY } = require("../models/analysisBlock");

const band = (at, status, severity) => ({ at, status, severity });

const A = (at) => band(at, STATUS.AMBER, SEVERITY.MEDIUM);
const R = (at) => band(at, STATUS.RED, SEVERITY.HIGH);
const C = (at) => band(at, STATUS.RED, SEVERITY.CRITICAL);

/**
 * @typedef {object} Threshold
 * @property {string} rule    sentence shown to the user
 * @property {string} metric  what the normalised metric measures
 * @property {string} format  how to render the metric (see FORMAT)
 * @property {Array}  bands   ascending; the last one satisfied wins
 */
const THRESHOLDS = Object.freeze({
  /* ---------------- Trend ---------------- */

  /** L01.A01, L06.A01 — consecutive month-on-month declines. */
  DECLINE_STREAK: {
    rule: "Consecutive decline streak >= 3 months = RED",
    metric: "months of unbroken decline",
    format: "number",
    bands: [A(2), R(3)]
  },

  /** L01.A02, L06.A05 — latest month against the one before. */
  LATEST_MOM_DECLINE: {
    rule: "MoM decline > 5% = AMBER; > 10% = RED",
    metric: "latest month-on-month decline",
    format: "percent",
    bands: [A(0.05), R(0.10)]
  },

  /** L01.A03, L06.A02 — trailing 3 months vs the prior 3. */
  MOMENTUM_3M_DECLINE: {
    rule: "3M-over-3M decline > 5% = AMBER; > 10% = RED",
    metric: "3-month momentum decline",
    format: "percent",
    bands: [A(0.05), R(0.10)]
  },

  /** L01.A04, L06.A03 — distance below the historical peak. */
  PEAK_GAP: {
    rule: "Gap from peak > 20% = AMBER; > 40% = RED; > 60% = CRITICAL",
    metric: "shortfall against the peak month",
    format: "percent",
    bands: [A(0.20), R(0.40), C(0.60)]
  },

  /** L01.A05, L06.A07 — share lost over the period, in percentage points. */
  SHARE_LOSS_PP: {
    rule: "Share loss > 5 percentage points = AMBER; > 10pp = RED",
    metric: "share lost",
    format: "pp",
    bands: [A(0.05), R(0.10)]
  },

  /**
   * L01.A08, L06.A09, L12.A02 — negative linear trend.
   *
   * MEASURED AS A SHARE of the entity's own average month, not in rupees. The
   * workbook states this as "> ₹500/month = AMBER", which is a tenth of a
   * percent to a company turning over ₹5 crore a month and a tenth of the whole
   * business to a shop turning over ₹50,000. A fixed rupee cut-off cannot serve
   * both, so the trend is judged against the size of the thing that is
   * trending.
   *
   * The bands are set where the workbook's own rupee figures land on its own
   * data: ₹1,000 a month against its ₹2.6L average month is 0.38%. Half a
   * percent a month compounds to about 6% of a year and one percent to about
   * 12%, which is the right order for AMBER and RED.
   */
  NEGATIVE_SLOPE: {
    rule: "Trend losing more than 0.5% of an average month, per month = AMBER; more than 1% = RED",
    metric: "revenue lost per month on trend, as a share of an average month",
    format: "percent",
    bands: [A(0.005), R(0.01)]
  },

  /** L01.A09, L12.A02 — company-wide decline over the window. */
  COMPANY_DECLINE: {
    rule: "Company revenue decline > 5% = AMBER; > 10% = RED; > 20% = CRITICAL",
    metric: "company revenue decline",
    format: "percent",
    bands: [A(0.05), R(0.10), C(0.20)]
  },

  /** L01.A10, L06.A06 — how much of the portfolio is shrinking. */
  DECLINING_SHARE_OF_ENTITIES: {
    rule: "More than half of entities declining = AMBER; all but one = RED",
    metric: "proportion of entities declining",
    format: "percent",
    bands: [A(0.50), R(0.75)]
  },

  /* ---------------- Volatility ---------------- */

  /** L01.A06, L06.A04, L09.A* — coefficient of variation. */
  VOLATILITY_CV: {
    rule: "CV > 15% = MODERATE volatility; > 30% = HIGH VOLATILITY",
    metric: "coefficient of variation",
    format: "percent",
    bands: [A(0.15), R(0.30)]
  },

  /** L15.A01 — the workbook's headline volatility trigger. */
  PEAK_TROUGH_RATIO: {
    rule: "Peak-to-trough ratio >= 2.0 = AMBER; >= 3.0 = RED",
    metric: "peak-to-trough ratio",
    format: "ratio",
    bands: [A(2.0), R(3.0)]
  },

  /* ---------------- Concentration ---------------- */

  /**
   * L02.A03, L09.A01 — Herfindahl-Hirschman Index.
   *
   * MEASURED AS A MULTIPLE OF AN EVEN SPREAD, not as a raw index. HHI's floor
   * is 1/N, so a fixed cut-off means completely different things on a 4-city
   * axis (even = 0.25) and a 13-month one (even = 0.077) — and the workbook's
   * 0.15/0.25/0.80 were set for thirteen months, which made every balanced
   * 4-city book read as RED. The bands below are those same cut-offs divided by
   * the workbook's own 1/13 floor, so behaviour on its data is unchanged and
   * every other shape is now judged fairly. 1.0 means perfectly even.
   */
  HHI: {
    rule: "Concentration above 1.95x an even spread = MODERATE; 3.25x = HIGH; 10.4x = CRITICAL",
    metric: "concentration against an even spread",
    format: "ratio",
    bands: [A(0.15 * 13), R(0.25 * 13), C(0.80 * 13)]
  },

  /**
   * L09.A02 — the single most month-concentrated member.
   * Workbook: trigger at HHI > 0.15, HIGH above 0.20.
   */
  HHI_MEMBER_MAX: {
    rule: "Most concentrated member above 1.95x an even spread = flagged; above 2.6x = HIGH",
    metric: "highest member concentration against an even spread",
    format: "ratio",
    bands: [A(0.15 * 13), R(0.20 * 13)]
  },

  /**
   * L09.A03 — the portfolio average.
   * Workbook fires at 0.12 but only calls it HIGH above 0.15, so the first band
   * is deliberately AMBER/LOW rather than the usual AMBER/MEDIUM.
   */
  HHI_PORTFOLIO_AVERAGE: {
    rule: "Portfolio average above 1.56x an even spread = flagged; above 1.95x = HIGH",
    metric: "portfolio average concentration against an even spread",
    format: "ratio",
    bands: [band(0.12 * 13, STATUS.AMBER, SEVERITY.LOW), R(0.15 * 13)]
  },

  /** L09.A04 — distance between the most and least concentrated member. */
  HHI_SPREAD: {
    rule: "Spread between the most and least concentrated member above 0.65x an even spread = large disparity",
    metric: "concentration spread between members, against an even spread",
    format: "ratio",
    bands: [A(0.05 * 13)]
  },

  /**
   * L09.A05 — proportion of the portfolio above the moderate line.
   * The workbook's "3 or more of 6" is expressed as a proportion so it still
   * means "half the portfolio" for a company with 4 products or 40.
   */
  HHI_ABOVE_MODERATE: {
    rule: "Half or more of the portfolio above HHI 0.10 = flagged",
    metric: "share of the portfolio above moderate concentration",
    format: "percent",
    bands: [A(0.5)]
  },

  /** L09.A07 — how much of the portfolio sits above its own average. */
  HHI_ABOVE_AVERAGE: {
    rule: "Two thirds or more of the portfolio above its own average HHI = flagged",
    metric: "share of the portfolio above average concentration",
    format: "percent",
    bands: [A(2 / 3)]
  },

  /** L09.A08 — most concentrated member against the least, as a ratio. */
  HHI_MAX_MIN_RATIO: {
    rule: "Most concentrated member above 1.5x the most diversified = flagged; above 2x = HIGH",
    metric: "ratio of highest to lowest member HHI",
    format: "ratio",
    bands: [band(1.5, STATUS.AMBER, SEVERITY.LOW), R(2)]
  },

  /**
   * L09.A09 — the 0-100 health score, normalised as a shortfall so higher stays
   * worse. The workbook's score < 60 and < 50 become shortfalls of 40 and 50.
   */
  HHI_HEALTH_SHORTFALL: {
    rule: "Concentration health below 60 = flagged; below 50 = HIGH",
    metric: "concentration health shortfall out of 100",
    format: "number",
    bands: [A(40), R(50)]
  },

  /** L09.A10 — total concentration above what an even portfolio would carry. */
  HHI_EXCESS_TOTAL: {
    rule: "Total concentration above 1.3x what an even book would carry = meaningful smoothing headroom",
    metric: "excess concentration across the portfolio, against an even spread",
    format: "ratio",
    bands: [A(0.10 * 13)]
  },

  /** L01.A07 — how much rides on the two largest entities. */
  TOP2_DEPENDENCY: {
    rule: "Top 2 > 70% of total = AMBER; > 80% = RED",
    metric: "top-2 combined share",
    format: "percent",
    bands: [A(0.70), R(0.80)]
  },

  /** L10.A02 — Pareto check on the three largest combos. */
  TOP3_CONCENTRATION: {
    rule: "Top 3 combos > 40% of total = AMBER; > 55% = RED",
    metric: "top-3 combined share",
    format: "percent",
    bands: [A(0.40), R(0.55)]
  },

  /** L10.A01 — the single largest combination. */
  TOP1_CONCENTRATION: {
    rule: "Single largest combo > 15% of total = AMBER; > 25% = RED",
    metric: "largest single combo share",
    format: "percent",
    bands: [A(0.15), R(0.25)]
  },

  /** L10.A07 — the five largest together. */
  TOP5_CONCENTRATION: {
    rule: "Top 5 combos > 60% of total = AMBER; > 75% = RED",
    metric: "top-5 combined share",
    format: "percent",
    bands: [A(0.60), R(0.75)]
  },

  /** L03.A01, L04.A01 — one entity carrying a whole city or product line. */
  SINGLE_ENTITY_DEPENDENCY: {
    rule: "One entity above 75% of the total = over-concentrated",
    metric: "dominant entity share",
    format: "percent",
    bands: [A(0.60), R(0.75)]
  },

  /** L02.A01 — deviation from an equal split across entities. */
  EQUAL_SHARE_DEVIATION: {
    rule: "More than 50% away from the equal-share benchmark = flagged",
    metric: "absolute deviation from equal share",
    format: "percent",
    bands: [A(0.30), R(0.50)]
  },

  /* ---------------- Comparison ---------------- */

  /** L07.A01, L13.A01 — two entities too far apart to compare fairly. */
  HEAD_TO_HEAD_GAP: {
    rule: "Gap > 30% of the larger entity = not comparable in scale",
    metric: "gap as a share of the larger entity",
    format: "percent",
    bands: [A(0.30), R(0.60)]
  },

  /** L08.A01 — average rank across cities. Higher (worse) rank is worse. */
  AVERAGE_RANK_WEAK: {
    rule: "Average rank <= 2 = STRONG; >= 5 = WEAK",
    metric: "average rank across cities",
    format: "number",
    bands: [A(3.5), R(5)]
  },

  /** L14.A01 — month ranking, on a 13-month scale. */
  MONTH_RANK_WEAK: {
    rule: "Average month rank <= 4 = STRONG; >= 10 = WEAK",
    metric: "average month rank across cities",
    format: "number",
    bands: [A(7), R(10)]
  },

  /**
   * L08.A07 — one entity taking first place across most markets.
   * The workbook's "3 of 4 cities" is carried as a share, so it still means
   * three quarters of the markets for a company with twenty of them.
   */
  RANK_LEADER_UBIQUITY: {
    rule: "One entity ranked first in 75% or more of markets = concentration risk",
    metric: "share of markets led by a single entity",
    format: "percent",
    bands: [A(0.75), R(0.9)]
  },

  /**
   * L14.A02 — where the latest period sits in the ranking.
   * The workbook's "worse than rank 9 of 13" is the bottom third, carried as a
   * share so it reads the same over any window length.
   */
  LATEST_PERIOD_RANK_SHARE: {
    rule: "Latest period ranking in the bottom third across markets = flagged",
    metric: "latest period's average rank, as a share of the window",
    format: "percent",
    bands: [A(0.69), R(0.85)]
  },

  /**
   * L14.A06 — how much a market's ranking jumps about period to period.
   * The workbook's ">4 rank positions of 13" as a share of the window.
   */
  RANK_VOLATILITY_SHARE: {
    rule: "A market's period ranking swinging more than 31% of the window = volatile",
    metric: "widest rank standard deviation, as a share of the window",
    format: "percent",
    bands: [A(0.31), R(0.385)]
  },

  /**
   * L14.A08 — recent periods ranking worse than early ones.
   * The workbook's ">2 rank positions of 13" as a share of the window.
   */
  RANK_DRIFT_SHARE: {
    rule: "Recent periods ranking more than 15% of the window worse than early ones = flagged",
    metric: "rank drift from early to recent periods, as a share of the window",
    format: "percent",
    bands: [A(0.154), R(0.31)]
  },

  /**
   * L08.A09 — an entity sitting at the bottom of several markets at once.
   * Not "is it weak" but "is it weak everywhere", which is the difference
   * between a local problem and a product that has stopped working.
   */
  BOTTOM_RANK_UBIQUITY: {
    rule: "An entity in the bottom third of two or more markets = broadly weak",
    metric: "markets where a single entity ranks in the bottom third",
    format: "number",
    bands: [A(2), R(3)]
  },

  /**
   * L08.A04, L14.A04 — the entity that ranks worst across every market.
   *
   * The workbook states this as an absolute rank ("5 or worse of 6 products",
   * "11 or worse of 13 months"); both are the same share of their own window,
   * which is what is carried here so it means the same thing whatever a
   * company's product count or window length happens to be.
   */
  WEAKEST_RANK_SHARE: {
    rule: "Weakest entity averaging in the bottom sixth of the ranking = consistently last",
    metric: "weakest average rank, as a share of the field",
    format: "percent",
    bands: [A(0.83), R(0.95)]
  },

  /* ---------------- Contribution ---------------- */

  /** L11.A01 — an entity responsible for a material slice of the decline. */
  MATERIAL_NEGATIVE_CONTRIBUTOR: {
    rule: "More than 15% of the total negative change = material contributor",
    metric: "share of the total decline",
    format: "percent",
    bands: [A(0.15), R(0.30)]
  },

  /** L11.A06 — is the whole period's movement one entity's doing? */
  MOVEMENT_CONCENTRATION: {
    rule: "Largest mover above 30% of all movement = one entity drives the change",
    metric: "largest mover's share of total movement",
    format: "percent",
    bands: [A(0.30), R(0.50)]
  },

  /** L11.A07 — how much of the decline the two worst entities explain. */
  TOP2_NEGATIVE_SHARE: {
    rule: "Two entities explaining over 70% of the decline = concentrated cause",
    metric: "top-2 share of the total decline",
    format: "percent",
    bands: [band(0.70, STATUS.AMBER, SEVERITY.HIGH)]
  },

  /** L11.A09, L12.A05 — how far the biggest change sits from a typical one. */
  CHANGE_DISPERSION: {
    rule: "Largest change above 2x the average change = outlier-driven",
    metric: "largest change as a multiple of the average",
    format: "ratio",
    bands: [A(2)]
  },

  /** L12.A05 — spread of the changes themselves, as a coefficient of variation. */
  CHANGE_DISTRIBUTION_SPREAD: {
    rule: "Change dispersion above 1.5 = driven by outliers rather than broad drift",
    metric: "dispersion of entity changes",
    format: "ratio",
    bands: [A(1.5)]
  },

  /** L12.A06 — the company's net rupee position between the two periods. */
  NET_REVENUE_DECLINE: {
    rule: "Company in net revenue decline = flagged; a decline above 10% of the base = CRITICAL",
    metric: "net revenue decline as a share of the base period",
    format: "percent",
    bands: [band(0.0000001, STATUS.RED, SEVERITY.HIGH), C(0.10)]
  },

  /**
   * L12.A03 — did the latest month fall against the one before it?
   *
   * The workbook's rule is pure direction with no magnitude, so the band sits
   * just above zero: any decline at all trips it. The size of the drop is the
   * headline, not the test.
   */
  LATEST_MONTH_FELL: {
    rule: "Latest month below the month before it = flagged",
    metric: "decline against the prior month",
    format: "currency",
    bands: [A(0.01)]
  },

  /**
   * L12.A04 — how soon the current trend erodes a fifth of revenue.
   *
   * Normalised as the shortfall below a 12-month runway, so higher stays worse:
   * a 24-month runway scores 0, an 8-month runway scores 4, and a book already
   * inside 6 months is RED.
   */
  DECLINE_RUNWAY_SHORTFALL: {
    rule: "A fifth of revenue eroded within 12 months at the current trend = flagged; within 6 = RED",
    metric: "months short of a 12-month runway",
    format: "number",
    bands: [A(0.01), R(6)]
  },

  /**
   * L12.A08 — the worst single entity decline.
   *
   * The workbook states this in rupees (">₹20K"), which means nothing to a
   * company ten times the size, so it is carried here as a share of the base
   * period. ₹20K against the workbook's own ₹296K base is ~7%.
   */
  ENTITY_DECLINE_SHARE: {
    rule: "A single entity losing more than 7% of company revenue = flagged; more than 15% = RED",
    metric: "largest single entity decline, as a share of the base period",
    format: "percent",
    bands: [A(0.07), R(0.15)]
  },

  /**
   * L12.A09 — revenue recoverable by restoring the declining entities.
   *
   * The workbook's ">₹30K" is likewise carried as a share of the base (~10%).
   * This one is opportunity rather than damage, but it is still normalised
   * higher-is-worse: a large recoverable figure means a large hole.
   */
  RECOVERABLE_SHARE: {
    rule: "More than 10% of the base period recoverable from declining entities = flagged; more than 20% = RED",
    metric: "recoverable revenue as a share of the base period",
    format: "percent",
    bands: [A(0.10), R(0.20)]
  },

  /** L11.A08 — can the growers cover the decliners? */
  OFFSET_DEFICIT: {
    rule: "Growth cannot offset decline = net shrinkage",
    metric: "uncovered decline as a share of growth",
    format: "percent",
    bands: [A(0.25), R(0.50)]
  },

  /* ---------------- Coverage ---------------- */

  /** L03.A05, L04.A10 — how much of the product x city matrix is live. */
  COVERAGE_GAP: {
    rule: "Less than 60% of possible combinations active = growth headroom",
    metric: "share of possible combinations that are inactive",
    format: "percent",
    bands: [A(0.40), R(0.60)]
  }
});

module.exports = { THRESHOLDS, band, A, R, C };
