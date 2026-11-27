import type { ChartConfiguration } from 'chart.js/auto';
import type { GroupingMode, SalesBucket, SalesRecord } from '../types/sales.ts';
import { dateOf, formatMoney, formatNumber, pointKey, promoOf, skuOf, storeOf, tukeySummary } from '../utils/salesAnalytics.ts';
import { ChartCanvas } from './ChartCanvas.tsx';

export function TukeyChart({ groups, rows, grouping, period, isLight }: { groups: SalesBucket[]; rows: SalesRecord[]; grouping: GroupingMode; period: string; isLight: boolean }) {
  const sales = groups.map(group => group.sales);
  const tukey = tukeySummary(sales);
  const flagged = tukey ? groups.filter(group => group.sales > tukey.upper) : [];
  const normal = isLight ? '#265e92' : '#91c8ff';
  const alert = isLight ? '#a52425' : '#ff928b';
  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: groups.map(group => group.key),
      datasets: [
        { label: 'Net sales', data: sales, borderColor: normal, backgroundColor: normal, pointRadius: 2 },
        ...(tukey ? [
          { label: 'Upper Tukey fence', data: sales.map(() => tukey.upper), borderColor: alert, backgroundColor: alert, borderDash: [6, 4], pointRadius: 0 },
          { label: 'Flagged by Tukey IQR', data: sales.map(value => value > tukey.upper ? value : null), showLine: false, pointRadius: 6, backgroundColor: alert },
        ] : []),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: value => formatMoney(value) } } },
      plugins: { tooltip: { callbacks: { label: item => item.dataset.label + ' ' + formatMoney(item.parsed.y) } } },
    },
  };

  return (
    <section className="card" aria-labelledby="tukey-heading">
      <h2 id="tukey-heading">How Tukey IQR flags high sales</h2>
      <p className="description">
        Compare net sales by {period}. The dashed line is the upper fence. A point is flagged when it exceeds Q3 + 1.5 × (Q3 − Q1).
        This statistical check runs separately from Isolation Forest.
      </p>
      {tukey ? <>
        <p>Q1 {formatMoney(tukey.q1)} · Q3 {formatMoney(tukey.q3)} · IQR {formatMoney(tukey.iqr)} · Upper fence {formatMoney(tukey.upper)}</p>
        <ChartCanvas config={config} isLight={isLight} ariaLabel={`Net sales by ${period} with the upper Tukey fence and flagged points`} />
        {flagged.length === 0 && <p>No sales periods exceeded the upper fence.</p>}
        {flagged.map(group => {
          const transactions = rows.filter(row => pointKey(row, grouping) === group.key)
            .sort((a, b) => b.net_sales_collected - a.net_sales_collected);
          return (
            <details className="ai-extra" key={group.key}>
              <summary>Inspect {group.key} · {formatNumber(group.count)} sales · {formatMoney(group.sales)}</summary>
              <p>Above the upper fence by {formatMoney(group.sales - tukey.upper)}. Highest net sales appear first.</p>
              <div className="ai-table-wrap" style={{ maxHeight: '22rem', overflow: 'auto' }} tabIndex={0}
                role="region" aria-label={`Transactions for ${group.key}`}>
                <table>
                  <thead><tr><th>Sale ID</th><th>Date</th><th>Product SKU</th><th>Store</th><th>Promotion</th><th>Units</th><th>Net sales</th></tr></thead>
                  <tbody>{transactions.map(row => (
                    <tr key={row.sales_fact_id}>
                      <td>{row.sales_fact_id}</td><td>{dateOf(row)}</td><td>{skuOf(row)}</td>
                      <td>{storeOf(row)}</td><td>{promoOf(row)}</td>
                      <td>{formatNumber(row.quantity_sold)}</td><td>{formatMoney(row.net_sales_collected)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </details>
          );
        })}
      </> : <p>The Tukey check needs at least eight periods with sales and a positive interquartile range.</p>}
    </section>
  );
}
