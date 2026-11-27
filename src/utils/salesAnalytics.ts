import type {
  AnomalyFlag,
  FocusedQuestionId,
  GroupingMode,
  IsolationForestFlag,
  LlmContextPayload,
  OverviewSortOrder,
  SalesBucket,
  SalesRecord,
  ScenarioId,
} from '../types/sales.ts';

export const PRICE_THRESHOLD = 1000;

export const SCENARIO_META: Record<
  ScenarioId,
  {
    code: string;
    shortTitle: string;
    title: string;
    subtitle: string;
    description: string;
  }
> = {
  overview: {
    code: '00',
    shortTitle: 'All Sales',
    title: 'Executive Dashboard',
    subtitle: 'Full fact_sales ledger across products, stores, and promotions',
    description:
      'Complete transaction ledger with live search, product filtering, revenue trends, statistical IQR audit, and Gemini AI executive intelligence.',
  },
  '1': {
    code: '01',
    shortTitle: 'Premium Pricing',
    title: 'Question 1: High-Price Sales',
    subtitle: 'UQ-HT-02 transactions above ₱1,000 gross unit price',
    description:
      'Sales with gross unit price greater than ₱1,000 for product UQ-HT-02 (HEATTECH Ultra Warm Long Sleeve).',
  },
  '2': {
    code: '02',
    shortTitle: 'Customer Behavior',
    title: 'Question 2: Customer Product Sales',
    subtitle: 'Customer Benjamin Aquino purchasing UQ-AIR-01',
    description:
      'Focused purchase cadence and unit volume analysis for customer Benjamin Aquino buying AIRism UQ-AIR-01.',
  },
  '3': {
    code: '03',
    shortTitle: 'Store Performance',
    title: 'Question 3: Employee and Store Sales',
    subtitle: 'Employee EMP-003 operating at STORE-003',
    description:
      'Transaction throughput, revenue velocity, and Isolation Forest outlier monitoring for EMP-003 at STORE-003.',
  },
  '4': {
    code: '04',
    shortTitle: 'Promo Analytics',
    title: 'Question 4: March 2024 Promotional Sales',
    subtitle: 'UQ-BAG-01 under PROMO-LIMITED during March 2024',
    description:
      'Campaign performance for Round Mini Shoulder Bag (UQ-BAG-01) under PROMO-LIMITED from March 1 to March 31, 2024.',
  },
};

export function formatMoney(value: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
  }).format(Number(value) || 0);
}

export function formatNumber(value: number | string | null | undefined): string {
  return new Intl.NumberFormat('en-PH').format(Number(value) || 0);
}

export function formatCompactPhp(value: number): string {
  return '₱' + new Intl.NumberFormat('en-PH', { notation: 'compact' }).format(value);
}

function unwrapDimension<T extends object>(val: T | T[] | null | undefined): Partial<T> {
  if (!val) return {};
  return Array.isArray(val) ? (val[0] ?? {}) : val;
}

export function dateOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_date).full_date || '';
}

export function skuOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_product).sku_code || '';
}

export function productOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_product).product_name || '';
}

export function customerOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_customer).full_name || '';
}

export function employeeOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_employee).employee_id || '';
}

export function storeOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_store).store_code || '';
}

export function promoOf(row: SalesRecord): string {
  return unwrapDimension(row.dim_promotion).promo_code || '';
}

export function metricSum(
  rows: SalesRecord[],
  key: 'net_sales_collected' | 'quantity_sold' | 'gross_unit_price'
): number {
  let sum = 0;
  for (const r of rows) {
    sum += Number(r[key]) || 0;
  }
  return sum;
}

export function idCompare(a: SalesRecord, b: SalesRecord): number {
  const aa = Number(a.sales_fact_id);
  const bb = Number(b.sales_fact_id);
  return Number.isFinite(aa) && Number.isFinite(bb)
    ? aa - bb
    : String(a.sales_fact_id).localeCompare(String(b.sales_fact_id), undefined, { numeric: true });
}

export function saleWeekStart(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function pointKey(row: SalesRecord, grouping: GroupingMode): string {
  const day = dateOf(row) || 'Unknown';
  if (grouping === 'sale') return '#' + row.sales_fact_id;
  if (grouping === 'week' && day !== 'Unknown') return saleWeekStart(day);
  if (grouping === 'month' && day !== 'Unknown') return day.slice(0, 7);
  return day;
}

export function groupSales(rows: SalesRecord[], grouping: GroupingMode): Map<string, SalesBucket> {
  const buckets = new Map<string, SalesBucket>();
  for (const row of rows) {
    const key = pointKey(row, grouping);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, sales: 0, qty: 0, price: 0, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.sales += Number(row.net_sales_collected) || 0;
    bucket.qty += Number(row.quantity_sold) || 0;
    bucket.price += Number(row.gross_unit_price) || 0;
    bucket.count += 1;
  }
  return buckets;
}

export function filterScenarioRows(rows: SalesRecord[], q: FocusedQuestionId): SalesRecord[] {
  return rows.filter((r) => {
    const sku = skuOf(r);
    const day = dateOf(r);
    if (q === '1') return sku === 'UQ-HT-02' && Number(r.gross_unit_price) > PRICE_THRESHOLD;
    if (q === '2') return sku === 'UQ-AIR-01' && customerOf(r) === 'Benjamin Aquino';
    if (q === '3') return employeeOf(r) === 'EMP-003' && storeOf(r) === 'STORE-003';
    if (q === '4') {
      return (
        day >= '2024-03-01' &&
        day < '2024-04-01' &&
        sku === 'UQ-BAG-01' &&
        promoOf(r) === 'PROMO-LIMITED'
      );
    }
    return false;
  });
}

export interface OverviewFilterOptions {
  search: string;
  sku: string;
  from: string;
  to: string;
  sort: OverviewSortOrder;
}

export function filterAndSortOverview(
  rows: SalesRecord[],
  opts: OverviewFilterOptions
): SalesRecord[] {
  const phrase = opts.search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    const d = dateOf(row);
    if (opts.from && (!d || d < opts.from)) return false;
    if (opts.to && (!d || d > opts.to)) return false;
    if (opts.sku && skuOf(row) !== opts.sku) return false;
    if (!phrase) return true;
    return [
      row.sales_fact_id,
      d,
      skuOf(row),
      productOf(row),
      customerOf(row),
      employeeOf(row),
      storeOf(row),
      promoOf(row),
      row.quantity_sold,
      row.gross_unit_price,
      row.net_sales_collected,
    ].some((value) => String(value ?? '').toLowerCase().includes(phrase));
  });

  return [...filtered].sort((a, b) => {
    if (opts.sort === 'date-desc') return dateOf(b).localeCompare(dateOf(a)) || idCompare(b, a);
    if (opts.sort === 'date-asc') return dateOf(a).localeCompare(dateOf(b)) || idCompare(a, b);
    if (opts.sort === 'revenue-desc') {
      return (Number(b.net_sales_collected) || 0) - (Number(a.net_sales_collected) || 0) || idCompare(b, a);
    }
    if (opts.sort === 'quantity-desc') {
      return (Number(b.quantity_sold) || 0) - (Number(a.quantity_sold) || 0) || idCompare(b, a);
    }
    return idCompare(b, a);
  });
}

function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function tukeySummary(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length < 8) return null;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  return iqr > 0 ? { q1, q3, iqr, upper: q3 + 1.5 * iqr } : null;
}

export function upperFence(values: number[]): number | null {
  return tukeySummary(values)?.upper ?? null;
}

export function detectSalesAnomalies(rows: SalesRecord[]): AnomalyFlag[] {
  const flags: AnomalyFlag[] = [];
  const bySku = new Map<string, SalesRecord[]>();
  const monthTotals = new Map<string, number>();

  for (const row of rows) {
    const id = String(row.sales_fact_id ?? '—');
    const sku = skuOf(row) || 'Unknown SKU';
    const list = bySku.get(sku);
    if (list) list.push(row);
    else bySku.set(sku, [row]);

    const date = dateOf(row);
    const rawKey =
      row.date_key === null || row.date_key === undefined ? '' : String(row.date_key);
    const validRaw = /^\d{8}$/.test(rawKey);
    if (
      !validRaw ||
      (date && rawKey !== date.replaceAll('-', '')) ||
      (date && (date < '2024-01-01' || date > '2026-11-25'))
    ) {
      const issue = !validRaw
        ? 'Missing or malformed date_key.'
        : date && rawKey !== date.replaceAll('-', '')
          ? 'Date key and linked full_date do not match.'
          : 'Date falls outside the requested simulation range (2024-01-01 to 2026-11-25).';
      flags.push({
        id,
        date: date || '—',
        sku,
        type: 'Date issue',
        reason: issue,
        severity: 'High',
      });
    }

    const unit = Number(row.gross_unit_price);
    const qty = Number(row.quantity_sold);
    const net = Number(row.net_sales_collected);
    if (
      !Number.isFinite(unit) ||
      unit < 0 ||
      !Number.isFinite(net) ||
      net < 0 ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isInteger(qty)
    ) {
      flags.push({
        id,
        date: date || '—',
        sku,
        type: 'Invalid value',
        reason: 'Quantity, gross unit price, or net sales contains an invalid or negative amount.',
        severity: 'High',
      });
    }

    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(net)) {
      const month = date.slice(0, 7);
      monthTotals.set(month, (monthTotals.get(month) || 0) + net);
    }
  }

  for (const [sku, items] of bySku) {
    const priceFence = upperFence(items.map((x) => Number(x.net_sales_collected)));
    const qtyFence = upperFence(items.map((x) => Number(x.quantity_sold)));
    for (const row of items) {
      const net = Number(row.net_sales_collected);
      const qty = Number(row.quantity_sold);
      const id = String(row.sales_fact_id ?? '—');
      const date = dateOf(row) || '—';
      if (priceFence !== null && net > priceFence) {
        flags.push({
          id,
          date,
          sku,
          type: 'High sale value',
          reason: `${formatMoney(net)} net sales exceeds ${formatMoney(priceFence)} (upper IQR limit) for ${sku} across ${formatNumber(items.length)} comparable records.`,
          severity: 'Review',
        });
      }
      if (qtyFence !== null && qty > qtyFence) {
        flags.push({
          id,
          date,
          sku,
          type: 'Unusual quantity',
          reason: `${formatNumber(qty)} units exceeds ${formatNumber(Math.round(qtyFence * 100) / 100)} (upper IQR limit) for ${sku} across ${formatNumber(items.length)} comparable records.`,
          severity: 'Review',
        });
      }
    }
  }

  const monthlyFence = upperFence([...monthTotals.values()]);
  if (monthlyFence !== null) {
    for (const [month, net] of monthTotals) {
      if (net > monthlyFence) {
        flags.push({
          id: month,
          date: month,
          sku: 'All products',
          type: 'Monthly sales spike',
          reason: `${formatMoney(net)} in monthly net sales exceeds the ${formatMoney(monthlyFence)} upper IQR limit across ${formatNumber(monthTotals.size)} months. Dates may be simulated.`,
          severity: 'Review',
        });
      }
    }
  }

  const priority = { High: 0, Review: 1 } as const;
  return flags.sort(
    (a, b) =>
      priority[a.severity] - priority[b.severity] ||
      a.type.localeCompare(b.type) ||
      a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

export function buildOverallSummary(
  allRows: SalesRecord[],
  overallAnomalyCount?: number
): LlmContextPayload['overallSummary'] {
  const totalLoadedCount = allRows.length;
  const totalNetSales = metricSum(allRows, 'net_sales_collected');
  const totalUnits = metricSum(allRows, 'quantity_sold');
  const averageOrderValue = totalLoadedCount ? totalNetSales / totalLoadedCount : 0;
  const uniqueDates = [...new Set(allRows.map(dateOf).filter(Boolean))].sort();
  const dateSpan = uniqueDates.length
    ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
    : 'No dated sales';

  const productMap = new Map<
    string,
    { sku: string; name: string; netSales: number; units: number }
  >();
  for (const row of allRows) {
    const sku = skuOf(row) || 'Unspecified';
    const name = productOf(row) || sku;
    const entry = productMap.get(sku) ?? { sku, name, netSales: 0, units: 0 };
    entry.netSales += Number(row.net_sales_collected) || 0;
    entry.units += Number(row.quantity_sold) || 0;
    productMap.set(sku, entry);
  }

  const topProducts = [...productMap.values()]
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, 6)
    .map((p) => ({
      ...p,
      netSales: Math.round(p.netSales * 100) / 100,
    }));

  const scenarioCounts = (['1', '2', '3', '4'] as const).reduce(
    (acc, q) => {
      const qRows = filterScenarioRows(allRows, q);
      acc[q] = {
        count: qRows.length,
        netSales: Math.round(metricSum(qRows, 'net_sales_collected') * 100) / 100,
      };
      return acc;
    },
    {} as Record<FocusedQuestionId, { count: number; netSales: number }>
  );

  return {
    totalLoadedCount,
    totalNetSales: Math.round(totalNetSales * 100) / 100,
    totalUnits,
    averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    dateSpan,
    distinctDates: uniqueDates.length,
    totalAnomalyFlags:
      overallAnomalyCount ?? detectSalesAnomalies(allRows).length,
    topProducts,
    scenarioCounts,
  };
}

export function buildLlmContextPayload(params: {
  viewId: ScenarioId;
  filteredRows: SalesRecord[];
  allRows?: SalesRecord[];
  totalLoadedCount: number;
  snapshotSource: string;
  filterDescription: string;
  activeGrouping?: GroupingMode;
  midtermLoaded?: boolean;
  midtermLabel?: string;
  overallAnomalyCount?: number;
  anomalies?: AnomalyFlag[];
  mlFlags?: IsolationForestFlag[];
}): LlmContextPayload {
  const {
    viewId,
    filteredRows,
    allRows,
    totalLoadedCount,
    snapshotSource,
    filterDescription,
    activeGrouping,
    midtermLoaded = false,
    midtermLabel,
    overallAnomalyCount,
    anomalies = [],
    mlFlags = [],
  } = params;

  const baseRows = allRows ?? filteredRows;
  const isFiltered = filteredRows.length !== totalLoadedCount || viewId !== 'overview';
  const overallSummary = buildOverallSummary(baseRows, overallAnomalyCount);

  const totalNetSales = metricSum(filteredRows, 'net_sales_collected');
  const totalUnits = metricSum(filteredRows, 'quantity_sold');
  const totalGrossPrice = metricSum(filteredRows, 'gross_unit_price');
  const recordCount = filteredRows.length;
  const averageOrderValue = recordCount ? totalNetSales / recordCount : 0;
  const averageGrossUnitPrice = recordCount ? totalGrossPrice / recordCount : 0;

  const uniqueDates = [...new Set(filteredRows.map(dateOf).filter(Boolean))].sort();
  const dateSpan = uniqueDates.length
    ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
    : 'No dated sales';

  const productMap = new Map<
    string,
    { sku: string; name: string; netSales: number; units: number; transactions: number }
  >();
  const storeMap = new Map<
    string,
    { store: string; netSales: number; units: number; transactions: number }
  >();
  const promoMap = new Map<
    string,
    { promo: string; netSales: number; units: number; transactions: number }
  >();

  for (const row of filteredRows) {
    const sku = skuOf(row) || 'Unspecified';
    const name = productOf(row) || sku;
    const net = Number(row.net_sales_collected) || 0;
    const qty = Number(row.quantity_sold) || 0;

    const pEntry = productMap.get(sku) ?? { sku, name, netSales: 0, units: 0, transactions: 0 };
    pEntry.netSales += net;
    pEntry.units += qty;
    pEntry.transactions += 1;
    productMap.set(sku, pEntry);

    const store = storeOf(row) || 'Unspecified';
    const sEntry = storeMap.get(store) ?? { store, netSales: 0, units: 0, transactions: 0 };
    sEntry.netSales += net;
    sEntry.units += qty;
    sEntry.transactions += 1;
    storeMap.set(store, sEntry);

    const promo = promoOf(row) || 'PROMO-NONE';
    const prEntry = promoMap.get(promo) ?? { promo, netSales: 0, units: 0, transactions: 0 };
    prEntry.netSales += net;
    prEntry.units += qty;
    prEntry.transactions += 1;
    promoMap.set(promo, prEntry);
  }

  const topProducts = [...productMap.values()]
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, 12)
    .map((p) => ({
      ...p,
      netSales: Math.round(p.netSales * 100) / 100,
      sharePercent:
        totalNetSales > 0 ? Math.round((p.netSales / totalNetSales) * 10000) / 100 : 0,
    }));

  const storeBreakdown = [...storeMap.values()]
    .sort((a, b) => b.netSales - a.netSales)
    .map((s) => ({ ...s, netSales: Math.round(s.netSales * 100) / 100 }));

  const promoBreakdown = [...promoMap.values()]
    .sort((a, b) => b.netSales - a.netSales)
    .map((pr) => ({ ...pr, netSales: Math.round(pr.netSales * 100) / 100 }));

  const monthlyBuckets = groupSales(filteredRows, 'month');
  const recentPeriods = [...monthlyBuckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-18)
    .map(([period, bucket]) => ({
      period,
      netSales: Math.round(bucket.sales * 100) / 100,
      units: bucket.qty,
      transactions: bucket.count,
    }));

  const highSeverityCount = anomalies.filter((a) => a.severity === 'High').length;
  const topSampleRows = [...filteredRows]
    .sort((a, b) => (Number(b.net_sales_collected) || 0) - (Number(a.net_sales_collected) || 0))
    .slice(0, 8)
    .map((r) => ({
      id: r.sales_fact_id,
      date: dateOf(r),
      sku: skuOf(r),
      store: storeOf(r),
      employee: employeeOf(r),
      customer: customerOf(r),
      promo: promoOf(r),
      qty: Number(r.quantity_sold) || 0,
      unitPrice: Number(r.gross_unit_price) || 0,
      netSales: Number(r.net_sales_collected) || 0,
    }));

  return {
    viewId,
    viewLabel: SCENARIO_META[viewId].title,
    snapshotSource,
    filterDescription,
    isFiltered,
    activeGrouping,
    midtermLoaded,
    midtermLabel,
    overallSummary,
    kpis: {
      recordCount,
      totalLoadedCount,
      totalNetSales: Math.round(totalNetSales * 100) / 100,
      totalUnits,
      averageOrderValue: Math.round(averageOrderValue * 100) / 100,
      averageGrossUnitPrice: Math.round(averageGrossUnitPrice * 100) / 100,
      distinctDates: uniqueDates.length,
      dateSpan,
    },
    topProducts,
    storeBreakdown,
    promoBreakdown,
    recentPeriods,
    anomalySummary: {
      totalFlags: anomalies.length,
      highSeverityCount,
      reviewCount: anomalies.length - highSeverityCount,
      topFlags: anomalies.slice(0, 10).map((f) => ({
        id: f.id,
        date: f.date,
        sku: f.sku,
        type: f.type,
        severity: f.severity,
        reason: f.reason,
      })),
    },
    mlGraphFlags: mlFlags.slice(0, 8).map((f) => ({
      period: f.period,
      netSales: Math.round(f.sales * 100) / 100,
      units: f.qty,
      score: Math.round(f.score * 1000) / 1000,
      reason: f.reason,
    })),
    sampleRecords: topSampleRows,
  };
}
