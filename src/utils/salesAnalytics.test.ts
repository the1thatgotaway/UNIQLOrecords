import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import type { SalesRecord } from '../types/sales.ts';
import { computeIsolationForest, explainTrendSummary } from './isolationForest.ts';
import {
  buildLlmContextPayload,
  detectSalesAnomalies,
  filterAndSortOverview,
  filterScenarioRows,
  groupSales,
  metricSum,
} from './salesAnalytics.ts';
import { buildCsvDocument, csvEscape, parseImportedSnapshot } from './snapshotParser.ts';

const offlinePath = path.resolve(process.cwd(), 'src/data/offlineSales.json');
const offlineRows = JSON.parse(fs.readFileSync(offlinePath, 'utf8')) as SalesRecord[];

test('offline dataset contains 1,500 valid sales records', () => {
  assert.equal(offlineRows.length, 1500);
  assert.equal(offlineRows[0].sales_fact_id, 1);
  assert.equal(offlineRows[1499].sales_fact_id, 1500);
});

test('scenario filters match expected subsets accurately', () => {
  const q1 = filterScenarioRows(offlineRows, '1');
  assert.ok(q1.length > 0);
  assert.ok(
    q1.every((r) => r.dim_product && !Array.isArray(r.dim_product) && r.dim_product.sku_code === 'UQ-HT-02' && r.gross_unit_price > 1000)
  );

  const q2 = filterScenarioRows(offlineRows, '2');
  assert.ok(q2.length > 0);
  assert.ok(
    q2.every(
      (r) =>
        r.dim_product &&
        !Array.isArray(r.dim_product) &&
        r.dim_product.sku_code === 'UQ-AIR-01' &&
        r.dim_customer &&
        !Array.isArray(r.dim_customer) &&
        r.dim_customer.full_name === 'Benjamin Aquino'
    )
  );

  const q3 = filterScenarioRows(offlineRows, '3');
  assert.ok(q3.length > 0);
  assert.ok(
    q3.every(
      (r) =>
        r.dim_employee &&
        !Array.isArray(r.dim_employee) &&
        r.dim_employee.employee_id === 'EMP-003' &&
        r.dim_store &&
        !Array.isArray(r.dim_store) &&
        r.dim_store.store_code === 'STORE-003'
    )
  );

  const q4 = filterScenarioRows(offlineRows, '4');
  assert.ok(
    q4.every((r) => {
      const d = r.dim_date && !Array.isArray(r.dim_date) ? r.dim_date.full_date ?? '' : '';
      const sku = r.dim_product && !Array.isArray(r.dim_product) ? r.dim_product.sku_code : '';
      const promo = r.dim_promotion && !Array.isArray(r.dim_promotion) ? r.dim_promotion.promo_code : '';
      return d >= '2024-03-01' && d < '2024-04-01' && sku === 'UQ-BAG-01' && promo === 'PROMO-LIMITED';
    })
  );
});

test('overview filtering, sorting, and grouping produce deterministic totals', () => {
  const filtered = filterAndSortOverview(offlineRows, {
    search: 'Benjamin Aquino',
    sku: 'UQ-AIR-01',
    from: '2024-01-01',
    to: '2026-12-31',
    sort: 'revenue-desc',
  });
  assert.ok(filtered.length > 0);
  for (let i = 1; i < filtered.length; i++) {
    assert.ok(filtered[i - 1].net_sales_collected >= filtered[i].net_sales_collected);
  }

  const buckets = groupSales(offlineRows, 'month');
  assert.ok(buckets.size >= 12);
  let bucketSum = 0;
  for (const b of buckets.values()) bucketSum += b.sales;
  const totalSum = metricSum(offlineRows, 'net_sales_collected');
  assert.ok(Math.abs(bucketSum - totalSum) < 0.01);
});

test('IQR anomaly detector catches bad dates/values and keeps priorities ordered', () => {
  const synthetic: SalesRecord[] = [
    ...offlineRows.slice(0, 20),
    {
      sales_fact_id: 9999,
      date_key: 20240101,
      quantity_sold: -2,
      gross_unit_price: 500,
      net_sales_collected: -1000,
      dim_date: { full_date: '2024-05-05', year_number: 2024, month_name: 'May' },
      dim_product: { sku_code: 'UQ-TEST-01', product_name: 'Test Item' },
      dim_promotion: { promo_code: 'PROMO-NONE' },
      dim_store: { store_code: 'STORE-001' },
      dim_employee: { employee_id: 'EMP-001' },
      dim_customer: { full_name: 'Test User' },
    },
  ];
  const flags = detectSalesAnomalies(synthetic);
  const badRowFlags = flags.filter((f) => f.id === '9999');
  assert.equal(badRowFlags.length, 2);
  assert.ok(badRowFlags.every((f) => f.severity === 'High'));
  assert.equal(flags[0].severity, 'High');
});

test('Isolation Forest ML model runs deterministically on monthly buckets', () => {
  const buckets = [...groupSales(offlineRows, 'month').values()].sort((a, b) =>
    a.key.localeCompare(b.key)
  );
  const runA = computeIsolationForest(buckets, 'overview', 'trend', 'month');
  const runB = computeIsolationForest(buckets, 'overview', 'trend', 'month');
  assert.deepEqual(runA.indices, runB.indices);
  assert.equal(runA.scores.length, buckets.length);
  const narrative = explainTrendSummary(offlineRows, buckets, runA);
  assert.ok(narrative.includes('1,500 sales'));
});

test('snapshot parser validates schema and CSV escaping protects formula prefixes', () => {
  const wrappedCsv = `"snapshot"\n"${JSON.stringify({ rows: offlineRows.slice(0, 2), count: 2 }).replace(/"/g, '""')}"`;
  const parsed = parseImportedSnapshot(wrappedCsv);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.rows.length, 2);

  assert.throws(() => parseImportedSnapshot('{"rows":[],"count":1}'));
  assert.equal(csvEscape('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  const csv = buildCsvDocument(['ID', 'Note'], [[1, '+cmd']]);
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes('"\'+cmd"'));
});

test('buildLlmContextPayload produces compact grounded summary without full row dump', () => {
  const anomalies = detectSalesAnomalies(offlineRows);
  const payload = buildLlmContextPayload({
    viewId: 'overview',
    filteredRows: offlineRows,
    totalLoadedCount: offlineRows.length,
    snapshotSource: 'Midterm snapshot (1,500 rows)',
    filterDescription: 'All records',
    anomalies,
  });

  assert.equal(payload.kpis.recordCount, 1500);
  assert.ok(payload.topProducts.length > 0 && payload.topProducts.length <= 12);
  assert.ok(payload.sampleRecords.length <= 8);
  assert.ok(payload.kpis.totalNetSales > 0);
});
