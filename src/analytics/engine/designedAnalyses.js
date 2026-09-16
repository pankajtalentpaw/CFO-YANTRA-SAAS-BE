/**
 * The analyses the workbook specifies a slot for but never filled in.
 *
 * The source workbook contains 152 analysis blocks against a design grid of
 * 16 lenses x 10 slots. Nine slots are empty:
 *
 *   L03.A02, L03.A03, L03.A04   (sheet 08 Table 1 jumps straight from A01 to A05)
 *   L07.A10, L08.A10, L12.A10, L13.A10, L14.A10, L15.A10
 *
 * These nine are authored here to complete the grid. Every one reuses primitives
 * already proven against workbook-derived analyses — no new maths — and each
 * carries `source: "designed"`, which surfaces as `provenance.derived` on the
 * block. That distinction matters: the other 152 can be checked against the
 * workbook's own computed cells, and these cannot.
 *
 * HAND-WRITTEN, and deliberately separate from the generated analysisCatalog.js
 * so re-running the extractor never clobbers them.
 *
 * Note L05 legitimately carries 11 analyses (the workbook gives it an A11), so
 * the completed catalog totals 161 rather than 160.
 */

const DESIGNED_ANALYSES = [
  /* ---- Lens 3: City-Product Dependency Risk ---- */
  {
    id: "L03.A02",
    lensId: 3,
    lensName: "City-Product Dependency Risk",
    slot: 2,
    title: "City Portfolio Strength — Revenue x Product Breadth",
    question: "Which city has the strongest combination of scale and product range, and which is narrowest?",
    dimension: "City x SubCategory",
    narrative: "Revenue alone rewards a city carrying one large product. Weighting revenue by how much of the product range it actually sells rewards a city that is both large and broad, which is far harder to disrupt.",
    recommendedAction: "Treat a high-revenue, low-breadth city as a concentration risk rather than a success, and target the missing products there first.",
    actionOwner: "Owner",
    decisionType: "Portfolio Strategy",
    source: "designed"
  },
  {
    id: "L03.A03",
    lensId: 3,
    lensName: "City-Product Dependency Risk",
    slot: 3,
    title: "City Revenue Parity",
    question: "How evenly is revenue spread across cities, or is the business really one or two territories?",
    dimension: "City",
    narrative: "Perfect parity would mean every city earning the same. Real books never do, but a very wide spread means the business depends on a small number of territories with the rest as a supporting cast.",
    recommendedAction: "Where parity is low, decide explicitly whether the small cities are under-developed markets worth investing in or genuinely small ones worth serving cheaply.",
    actionOwner: "Owner",
    decisionType: "Resource Allocation",
    source: "designed"
  },
  {
    id: "L03.A04",
    lensId: 3,
    lensName: "City-Product Dependency Risk",
    slot: 4,
    title: "Product Revenue Range Within Each City",
    question: "Inside each city, how far apart are its strongest and weakest products?",
    dimension: "City x SubCategory",
    narrative: "A wide internal range means a city sells one product well and the rest poorly. That is usually an execution or coverage difference rather than a market one, which makes it addressable.",
    recommendedAction: "For cities with the widest internal range, check whether the weak products are stocked and actively sold before concluding there is no demand.",
    actionOwner: "Sales Manager",
    decisionType: "Territory Action",
    source: "designed"
  },

  /* ---- Lens 7: SubCategory Head-to-Head ---- */
  {
    id: "L07.A10",
    lensId: 7,
    lensName: "SubCategory Head-to-Head",
    slot: 10,
    title: "Head-to-Head Recovery Opportunity",
    question: "If the trailing product closed its gap to the leader in the cities where it is weakest, what would that be worth?",
    dimension: "SubCategory Pair x City",
    narrative: "The head-to-head gap is only actionable once it is priced. Summing the shortfall city by city gives the revenue at stake, and shows whether the gap is one bad market or a uniform weakness.",
    recommendedAction: "Pursue the gap only where the trailing product already has distribution — closing a gap in a city that does not stock it is a different, larger decision.",
    actionOwner: "Sales Manager",
    decisionType: "Competitive Recovery",
    source: "designed"
  },

  /* ---- Lens 8: SubCategory Ranking by City ---- */
  {
    id: "L08.A10",
    lensId: 8,
    lensName: "SubCategory Ranking by City",
    slot: 10,
    title: "Rank vs Revenue Divergence",
    question: "Which products rank better than their revenue justifies, and which rank worse?",
    dimension: "SubCategory",
    narrative: "Rank and revenue usually agree. Where they diverge, a product is either winning many small markets or losing narrowly in large ones — two very different situations that a ranking table alone hides.",
    recommendedAction: "For products ranking well but earning little, check whether they are confined to small cities. For the reverse, they are close to losing their lead where it counts.",
    actionOwner: "Owner",
    decisionType: "Product Positioning",
    source: "designed"
  },

  /* ---- Lens 12: Contribution Bridge by Month ---- */
  {
    id: "L12.A10",
    lensId: 12,
    lensName: "Contribution Bridge by Month",
    slot: 10,
    title: "Monthly Bridge Net Position",
    question: "Across the period, did the growing months more than cover the declining ones?",
    dimension: "Month",
    narrative: "Netting every month's gain against every month's loss gives the single number behind the headline change, and shows whether the business is genuinely growing or merely offsetting.",
    recommendedAction: "Where losses exceed gains, identify whether the weak months are seasonal and expected or a new pattern requiring intervention.",
    actionOwner: "Owner",
    decisionType: "Trajectory Assessment",
    source: "designed"
  },

  /* ---- Lens 13: Month Head-to-Head ---- */
  {
    id: "L13.A10",
    lensId: 13,
    lensName: "Month Head-to-Head",
    slot: 10,
    title: "Month Comparison Recovery Opportunity",
    question: "If the weaker of the two months matched the stronger, city by city, what would that be worth?",
    dimension: "Month Pair x City",
    narrative: "Comparing two months is diagnostic until it is priced. The city-by-city shortfall shows whether the weaker month was uniformly soft or dragged down by one territory.",
    recommendedAction: "Where a single city explains most of the gap, treat it as a territory issue rather than a seasonal one.",
    actionOwner: "Sales Manager",
    decisionType: "Recovery Planning",
    source: "designed"
  },

  /* ---- Lens 14: Month Ranking by City ---- */
  {
    id: "L14.A10",
    lensId: 14,
    lensName: "Month Ranking by City",
    slot: 10,
    title: "Month Rank Consistency Across Cities",
    question: "Do all cities agree on which months are strong, or does each have its own rhythm?",
    dimension: "Month x City",
    narrative: "When cities agree on the strong months, the pattern is seasonal and can be planned for centrally. When they disagree, the swings are local and need territory-level plans instead.",
    recommendedAction: "Plan promotions centrally where cities agree on the weak months, and locally where they do not.",
    actionOwner: "Sales Manager",
    decisionType: "Sales Planning",
    source: "designed"
  },

  /* ---- Lens 15: Peak & Trough by SubCategory ---- */
  {
    id: "L15.A10",
    lensId: 15,
    lensName: "Peak & Trough by SubCategory",
    slot: 10,
    title: "Volatility-Weighted Revenue at Risk",
    question: "How much revenue sits behind the most volatile products?",
    dimension: "SubCategory x Revenue",
    narrative: "A volatile product matters in proportion to its size. Weighting each product's revenue by its own peak-to-trough swing gives the rupees whose timing genuinely cannot be relied on for planning.",
    recommendedAction: "Hold working capital against the volatility-weighted figure rather than against total revenue, and prioritise smoothing the largest contributors to it.",
    actionOwner: "Owner",
    decisionType: "Cash Flow Planning",
    source: "designed"
  }
];

module.exports = { DESIGNED_ANALYSES };
