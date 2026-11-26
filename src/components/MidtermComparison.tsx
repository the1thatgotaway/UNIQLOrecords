import { memo } from 'react';
import type { SalesRecord } from '../types/sales';
import { employeeOf, filterScenarioRows, formatMoney, formatNumber, groupSales, metricSum, SCENARIO_META, storeOf } from '../utils/salesAnalytics';
import { ChartCanvas } from './ChartCanvas';

export const MidtermComparison = memo(function MidtermComparison({ midterm, finals, isLight }: {
  midterm: SalesRecord[]; finals: SalesRecord[]; isLight: boolean;
}) {
  return (
    <section aria-labelledby="comparison-heading" className="exam-comparison">
      <h2 id="comparison-heading">Comparative Analysis</h2>
      <p>Compare the four midterm questions across the saved Midterm warehouse ({formatNumber(midterm.length)} records) and the full Finals warehouse ({formatNumber(finals.length)} records).</p>
      <div className="exam-grid">
        {(['1', '2', '3', '4'] as const).map(id => {
          const matches = (rows: SalesRecord[]) => id === '3'
            ? rows.filter(row => employeeOf(row) === 'EMP-033' && storeOf(row) === 'STORE-033')
            : filterScenarioRows(rows, id);
          const before = matches(midterm);
          const after = matches(finals);
          const periods = [before, after].map(rows => groupSales(rows, id === '4' ? 'day' : 'month'));
          const labels = [...new Set(periods.flatMap(series => [...series.keys()]))].sort();
          const metrics = [
            { label: 'Matching records', a: before.length, b: after.length, format: formatNumber },
            { label: 'Units sold', a: metricSum(before, 'quantity_sold'), b: metricSum(after, 'quantity_sold'), format: formatNumber },
            { label: 'Net sales', a: metricSum(before, 'net_sales_collected'), b: metricSum(after, 'net_sales_collected'), format: formatMoney },
          ];
          return <article key={id}>
            <h3>{SCENARIO_META[id].title}</h3>
            <p>{id === '3' ? 'Employee EMP-033 at STORE-033' : SCENARIO_META[id].subtitle}</p>
            {labels.length ? <ChartCanvas isLight={isLight} containerClassName="exam-trend"
              ariaLabel={`Midterm and Finals net sales for ${SCENARIO_META[id].shortTitle}`}
              config={{ type: 'line', data: { labels, datasets: periods.map((series, i) => ({
                label: i ? 'Finals' : 'Midterm', data: labels.map(key => series.get(key)?.sales ?? 0),
                borderColor: i ? (isLight ? '#a92729' : '#ff8079') : (isLight ? '#506276' : '#9eb9d2'),
                borderDash: i ? [] : [4, 3], pointRadius: 2,
              })) }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, title: { display: true, text: 'Net sales (PHP)' } } } } }}
            /> : <p>No matching sales in either dataset.</p>}
            <div className="exam-metrics"><table aria-label={SCENARIO_META[id].title}>
              <thead><tr>{['Metric', 'Midterm', 'Finals', 'Change'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{metrics.map(({ label, a, b, format }) => <tr key={label}>
                <th scope="row">{label}</th><td>{format(a)}</td><td>{format(b)}</td><td>{b > a ? '+' : ''}{format(b - a)}</td>
              </tr>)}</tbody>
            </table></div>
          </article>;
        })}
      </div>
    </section>
  );
});
