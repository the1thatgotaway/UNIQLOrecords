import type { ChartConfiguration } from 'chart.js/auto';
import type { SalesBucket } from '../types/sales.ts';
import { formatMoney, tukeySummary } from '../utils/salesAnalytics.ts';
import { ChartCanvas } from './ChartCanvas.tsx';

export function TukeyChart({ groups, period, isLight }: { groups: SalesBucket[]; period: string; isLight: boolean }) {
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
        <p>{flagged.length ? `${flagged.length} flagged · ${flagged.map(group => `${group.key} (${formatMoney(group.sales)})`).join(' · ')}` : 'No sales periods exceeded the upper fence.'}</p>
      </> : <p>The Tukey check needs at least eight periods with sales and a positive interquartile range.</p>}
    </section>
  );
}
