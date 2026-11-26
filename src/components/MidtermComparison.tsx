import { useMemo, type ComponentProps } from 'react';
import type { SalesRecord } from '../types/sales';
import { filterScenarioRows, formatNumber, SCENARIO_META } from '../utils/salesAnalytics';
import { QuestionSection } from './QuestionSection';

type ComparisonProps = Omit<ComponentProps<typeof QuestionSection>, 'rows' | 'questionId' | 'totalOverviewCount' | 'comparisonOnly'> & {
  midterm: SalesRecord[];
  finals: SalesRecord[];
};

export function MidtermComparison({ midterm, finals, midtermSnapshot, ...controls }: ComparisonProps) {
  const scenarios = useMemo(() => (['1', '2', '3', '4'] as const).map(id => ({
    id,
    rows: filterScenarioRows(finals, id),
  })), [finals]);

  const recordChange = finals.length - midterm.length;
  const scale = midterm.length ? (finals.length / midterm.length).toFixed(2) : null;

  return (
    <section aria-labelledby="comparison-heading" className="exam-comparison">
      <h2 id="comparison-heading">Comparative Analysis</h2>
      <p>Warehouse records <strong>{formatNumber(midterm.length)} → {formatNumber(finals.length)}</strong>{' '}
        ({recordChange > 0 ? '+' : ''}{formatNumber(recordChange)} records{scale && `, ${scale}× the Midterm size`}).
      </p>
      <div className="exam-grid">
        {scenarios.map(({ id, rows }) => (
          <article key={id}>
            <h2>{SCENARIO_META[id].title}</h2>
            <p>{SCENARIO_META[id].subtitle}</p>
            {!rows.length && !midtermSnapshot.scenarios[id].length && <p>No matching sales in either dataset.</p>}
            <QuestionSection comparisonOnly questionId={id} rows={rows} totalOverviewCount={finals.length}
              midtermSnapshot={midtermSnapshot} {...controls} />
          </article>
        ))}
      </div>
    </section>
  );
}
