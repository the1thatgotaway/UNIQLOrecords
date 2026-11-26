export type KnowledgeSectionId =
  | 'overview'
  | 'navigation'
  | 'scenarios'
  | 'filtering_exports'
  | 'imports_midterm'
  | 'iqr_anomalies'
  | 'isolation_forest'
  | 'metrics_caveats'
  | 'copilot';

export type QueryIntent =
  | 'navigation'
  | 'methodology'
  | 'anomaly'
  | 'data'
  | 'mixed'
  | 'off_topic';

export interface QueryIntentResult {
  intent: QueryIntent;
  sections: KnowledgeSectionId[];
}

export const SYSTEM_KNOWLEDGE_SECTIONS: Record<KnowledgeSectionId, string> = {
  overview: `SYSTEM PURPOSE & OVERVIEW:
- Application: UniQlick (Executive Sales Analytics & Scout).
- Default Dataset: Live Finals sales from Supabase. The built-in November 20, 2026 snapshot contains 1,500 sales transactions for Midterm comparisons.
- Source of Truth Rule: The latest successfully loaded Supabase records are the source of truth for all dashboard views. The saved Midterm baseline is used for comparison.
- Currency: All monetary values use Philippine Pesos (₱, PHP) formatted with en-PH conventions.`,

  navigation: `NAVIGATION & UI WORKFLOWS:
- Top Header Bar:
  - "✦ Ask Scout": Opens the AI Copilot panel (also accessible anytime from the floating chat launcher in the bottom-right corner).
  - "▤ Print report": Opens browser print dialog using print-friendly CSS that automatically hides navigation tabs, toolbars, pagination, and chat overlays.
  - "☀ Light mode" / "☾ Dark mode": Toggles between dark obsidian/lime theme and high-contrast daylight theme across UI cards and Chart.js visualizations.
  - "↻ Reload records" (SYNC ENGINE v4): Fetches the latest sales from Supabase.
- 5 Dashboard View Tabs (keyboard ArrowLeft / ArrowRight supported):
  - "Executive Dashboard": Full transaction ledger, 5 KPI cards, search/SKU/date/sort filters, 3 overview charts, Quick Insights, Data Quality & Statistical Alerts (IQR), Complete Sales Records table, CSV export.
  - "01 Premium Pricing": Focused Scenario Q1.
  - "02 Customer Behavior": Focused Scenario Q2.
  - "03 Store Performance": Focused Scenario Q3.
  - "04 Promo Analytics": Focused Scenario Q4.`,

  scenarios: `FOUR FOCUSED ANALYTICAL SCENARIOS (TABS 01–04) & VISUALIZATION STUDIO:
- Question 1 (01 Premium Pricing): High-Price Sales — product SKU "UQ-HT-02" (HEATTECH Ultra Warm Long Sleeve) with gross_unit_price > ₱1,000. Unit price view includes a dashed red "₱1,000 threshold" reference line.
- Question 2 (02 Customer Behavior): Customer Product Sales — customer "Benjamin Aquino" purchasing SKU "UQ-AIR-01" (AIRism Cotton Crew Neck Oversized T-Shirt).
- Question 3 (03 Store Performance): Employee & Store Sales — employee "EMP-003" operating at store "STORE-003".
- Question 4 (04 Promo Analytics): March 2024 Promotional Sales — product SKU "UQ-BAG-01" (Round Mini Shoulder Bag) under promo code "PROMO-LIMITED" between 2024-03-01 and 2024-03-31 inclusive.
- Visualization Studio (inside tabs 01–04):
  - Chart views: "Sales trend" (net sales line), "Quantity analysis" (units bar), "Unit price analysis" (average gross unit price bar), "Sales vs quantity" (dual-axis bar + line), "Cumulative sales" (running total line).
  - Grouping: Day, Week (Monday UTC start), Month, or Individual sale (#sales_fact_id).
  - Date filters ("From", "To"), "Reset filters", and "↓ Save graph" (downloads chart canvas as PNG).`,

  filtering_exports: `SEARCH, FILTERING, SORTING & CSV EXPORTS:
- Executive Dashboard ("Explore transactions" card):
  - "Search records": Live case-insensitive match across Sale ID, date, SKU, product name, customer name, employee ID, store code, promo code, quantity, unit price, and net sales.
  - "Product": Filters by exact SKU (e.g., UQ-UT-01, UQ-HT-02, or "All products").
  - "Start date" / "End date": Inclusive YYYY-MM-DD bounds.
  - "Sort by": Sale ID newest first (default), Date newest first, Date oldest first, Highest net sales, or Highest quantity.
  - "Clear filters": Resets search, SKU, date bounds, sort order, and trend grouping back to defaults.
- Pagination & Tables:
  - Complete Sales Records table supports 25, 50, 100, or 250 rows per page.
  - Scenario tables (tabs 01–04) support live search, 25/50/100 rows per page, and "↓ Export CSV".
- Export Safety: All CSV downloads include a UTF-8 BOM and sanitize leading formula characters (=, +, -, @, tab) with csvEscape to prevent Excel/Sheets formula injection.`,

  imports_midterm: `LIVE SUPABASE SALES AND MIDTERM COMPARISON:
- The dashboard fetches live sales automatically. Use "Reload records" to retry or refresh. If the connection fails, an administrator can check the fact_sales count and read permissions in the Supabase SQL Editor.
- Use "Clear filters" to reset the view without changing the loaded records.
- Midterm Comparison (inside tabs 01–04):
  - Open any scenario tab for synchronized "Saved Midterm" and "Finals · Live Supabase" charts. Comparison notes show changes in matching records, net sales, and units, along with the largest date contributions and new sale IDs.`,

  iqr_anomalies: `DATA QUALITY & STATISTICAL ALERTS (IQR / TUKEY METHOD):
- Located in the Executive Dashboard under "Data Quality & Statistical Alerts" (also filterable by type and exportable via "↓ Export flags CSV").
- Statistical Outliers ("Review" severity):
  - Computed per product SKU when a product group has at least 8 filtered transactions: finds Q1 (25th percentile), Q3 (75th percentile), IQR = Q3 - Q1, and upper Tukey fence = Q3 + 1.5 × IQR. Flags transactions above the fence for "High sale value" (net_sales_collected) or "Unusual quantity" (quantity_sold).
  - Monthly Revenue Spikes ("Monthly sales spike"): Applies the same Q3 + 1.5 × IQR upper fence across monthly totals when at least 8 distinct months contain sales.
- Integrity Warnings ("High" severity):
  - "Date issue": Flags missing/non-8-digit date_key, mismatch between date_key and dim_date.full_date, or dates outside 2024-01-01 to 2026-11-25.
  - "Invalid value": Flags non-finite, negative unit price or net sales, or non-positive / non-integer quantity_sold.
- Interpretation rule: Flags are purely read-only signals suggesting an analyst review the receipt—never proof of fraud or DB error.`,

  isolation_forest: `ISOLATION FOREST MACHINE LEARNING GRAPH ANALYSIS:
- Runs client-side inside each focused scenario (tabs 01–04) under "AI Graph Analysis" on the currently grouped chart buckets (requires at least 8 chart points and measurable feature variance; otherwise displays "Needs 8+ chart points. Try daily or per-sale view.").
- How it works:
  1. Converts each chart bucket into 5 log-transformed features: log1p(netSales), log1p(units), log1p(transactionCount), log1p(avgGrossUnitPrice), log1p(avgRevenuePerTransaction).
  2. Uses a deterministic PRNG seeded by question/view/grouping/data so results are repeatable, building 96 random isolation trees over subsamples of up to 64 points (max depth = ceil(log2(subsample))).
  3. Points isolated with shorter average path lengths receive higher anomaly scores: s(x) = 2^(-avgPath / c(n)).
  4. Cutoff threshold = max(0.6, 90th percentile score), highlighting up to the top 10% of points in orange on the chart and listing human-readable reasons (e.g., "Revenue X× typical", "High unit volume", "High revenue per transaction").
  5. Analysts can expand "Inspect <period>..." to audit the exact underlying transaction receipts and click "↓ Export" for a CSV anomaly report.`,

  metrics_caveats: `METRIC DEFINITIONS & DATA CAVEATS:
- Sales records: Count of transactions in the current view/filter.
- Total net sales: Sum of net_sales_collected in Philippine Pesos (₱).
- Units sold: Sum of quantity_sold.
- Average transaction (AOV): Total net sales ÷ number of transactions.
- Average gross unit price (Scenario Q1): Sum of gross_unit_price ÷ number of records.
- Product Revenue Distribution Doughnut: Shows top 6 SKUs by net sales plus "Other products" as share of filtered net revenue—explicitly NOT profit margins (cost/COGS, tax breakdowns, and stock inventory levels do NOT exist in this snapshot).
- Simulated Dates Caveat: The exam dataset uses synthetic dates between January 1, 2024 and November 25, 2026 (inclusive). Monthly/daily spikes reflect statistical distribution in those synthetic dates, not verified real-world historical events.
- Active Filter vs Overall Dataset: Always check both active filtered KPIs and overall loaded KPIs before answering so filtered subset counts are never confused with total loaded snapshot counts.`,

  copilot: `Scout CAPABILITIES & PRIVACY:
- Accessible via the bottom-right "Open Scout" launcher button, the top-right "✦ Ask Scout" button, or inline "✦ Explain flags with Groq" / "✦ Ask Scout" buttons inside cards.
- Supports two integrated workflows:
  1. Chat: Multi-turn SSE-streaming Q&A in English, Filipino, or Taglish with persistent conversation history, suggested questions, Minimize/Reopen/Close controls, and Clear.
  2. Briefings: "✦ Executive Briefing", "✦ Explain Anomalies & ML", and "✦ Deep-Dive Slice" return schema-validated JSON insights grounded in the active view.
- Sales record lookup: Scout runs read-only Supabase lookups for filter questions and shows exact matching records, a total, and the applied filters. Supported fields include customer, SKU, product name, employee, store, promotion, gross unit price, net sales, quantity, sale ID, and date. Use AND, OR, and parentheses to combine conditions. Follow up with a phrase such as "And only in 2025" to refine the previous lookup.
- Security & Read-Only Boundary: General AI chat and structured briefings use Groq through Express. The live record lookup uses validated filters and the dashboard's existing database read policies. The assistant cannot modify database tables.`,
};

const ALL_SECTIONS: KnowledgeSectionId[] = Object.keys(
  SYSTEM_KNOWLEDGE_SECTIONS
) as KnowledgeSectionId[];

export function classifyQueryIntent(rawQuestion: string): QueryIntentResult {
  const q = rawQuestion.trim().toLowerCase();
  const qWithoutWorkflowPhrases = q.replace(
    /\b(sales records|sales anomalies|sales analytics|sales alert\w*|sales report\w*)\b/g,
    ' '
  );

  const hasNav =
    /\b(how (do|can|to)|use this|guide|navigate|navigation|step|tab|tabs|import|upload|export|csv|png|print|dark mode|light mode|theme|reload|sync|clear filter|reset|search|sort|filter|midterm|compare|overview dashboard|copilot|chatbot|what does .* show|paano|saan|gamitin)\b/i.test(
      q
    );
  const hasMethod =
    /\b(isolation forest|iqr|interquartile|tukey|quartile|quantile|percentile|algorithm|machine learning|\bml\b|formula|calculate|calculation|computed|how .* work|how .* detect|paano gumagana|paano kinukuha|what does .* mean|doughnut|threshold|aov|average transaction|metric|simulated date)\b/i.test(
      q
    );
  const hasAnomaly =
    /\b(anomal\w*|outlier\w*|flag\w*|alert\w*|spike\w*|warning\w*|data quality|suspicious|audit|review|severity|high severity|unusual|date issue\w*|invalid value\w*)\b/i.test(
      q
    );
  const hasData =
    /\b(total|revenue|sales|net sales|units|quantity|price|product\w*|sku\w*|store\w*|employee\w*|customer\w*|promo\w*|top|best|highest|lowest|rank\w*|month\w*|week\w*|day\w*|trend\w*|how many|count|uq-|store-|emp-|promo-|benjamin aquino|march 2024|magkano|ilan|pinakamataas)\b/i.test(
      qWithoutWorkflowPhrases
    );
  const looksOffTopic =
    !hasNav &&
    !hasMethod &&
    !hasAnomaly &&
    !hasData &&
    /\b(weather|recipe|cook|horoscope|bitcoin|crypto|football|basketball|nba|movie|song|poem|joke|president|capital of|translate this unrelated|math homework|python script unrelated)\b/i.test(
      q
    );

  if (looksOffTopic) {
    return {
      intent: 'off_topic',
      sections: ['overview', 'copilot'],
    };
  }

  const sections = new Set<KnowledgeSectionId>(['overview']);

  if (hasNav) {
    sections.add('navigation');
    sections.add('scenarios');
    sections.add('filtering_exports');
    sections.add('imports_midterm');
    sections.add('copilot');
  }
  if (hasMethod) {
    sections.add('iqr_anomalies');
    sections.add('isolation_forest');
    sections.add('metrics_caveats');
    sections.add('scenarios');
  }
  if (hasAnomaly) {
    sections.add('iqr_anomalies');
    sections.add('isolation_forest');
    sections.add('metrics_caveats');
  }
  if (hasData) {
    sections.add('metrics_caveats');
    sections.add('scenarios');
  }

  if (sections.size <= 1) {
    return {
      intent: 'mixed',
      sections: ALL_SECTIONS,
    };
  }

  const hitCount = [hasNav, hasMethod, hasAnomaly, hasData].filter(Boolean).length;
  const intent: QueryIntent =
    hitCount > 1
      ? 'mixed'
      : hasAnomaly
        ? 'anomaly'
        : hasMethod
          ? 'methodology'
          : hasNav
            ? 'navigation'
            : 'data';

  return {
    intent,
    sections: [...sections],
  };
}

export function selectSystemKnowledge(rawQuestion: string): {
  intent: QueryIntent;
  sections: KnowledgeSectionId[];
  knowledgeText: string;
} {
  const { intent, sections } = classifyQueryIntent(rawQuestion);
  const knowledgeText = sections
    .map((id) => `## [${id.toUpperCase()}]\n${SYSTEM_KNOWLEDGE_SECTIONS[id]}`)
    .join('\n\n');
  return { intent, sections, knowledgeText };
}
