import { useMemo, type ComponentProps } from 'react';
import type { SalesRecord } from '../types/sales';
import { employeeOf, filterScenarioRows, formatNumber, SCENARIO_META, storeOf } from '../utils/salesAnalytics';
import { QuestionSection } from './QuestionSection';

type ComparisonProps = Omit<ComponentProps<typeof QuestionSection>, 'rows' | 'questionId' | 'totalOverviewCount' | 'comparisonOnly'> & {
  midterm: SalesRecord[];
  finals: SalesRecord[];
};

function matchesAssignedStore(row: SalesRecord) {
  return employeeOf(row) === 'EMP-033' && storeOf(row) === 'STORE-033';
}

export function MidtermComparison({ midterm, finals, midtermSnapshot, ...controls }: ComparisonProps) {
  const baseline = useMemo(() => ({
    ...midtermSnapshot,
    scenarios: { ...midtermSnapshot.scenarios, '3': midterm.filter(matchesAssignedStore) },
  }), [midterm, midtermSnapshot]);
  const scenarios = useMemo(() => (['1', '2', '3', '4'] as const).map(id => ({
    id,
    rows: id === '3' ? finals.filter(matchesAssignedStore) : filterScenarioRows(finals, id),
  })), [finals]);

  return (
    <section aria-labelledby="comparison-heading" className="exam-comparison">
      <h2 id="comparison-heading">Comparative Analysis</h2>
      <p>Compare {formatNumber(midterm.length)} saved Midterm records with {formatNumber(finals.length)} records in the Finals warehouse.</p>
      <div className="exam-grid">
        {scenarios.map(({ id, rows }) => (
          <article key={id}>
            <h2>{SCENARIO_META[id].title}</h2>
            <p>{id === '3' ? 'Employee EMP-033 at STORE-033' : SCENARIO_META[id].subtitle}</p>
            {!rows.length && !baseline.scenarios[id].length && <p>No matching sales in either dataset.</p>}
            <QuestionSection comparisonOnly questionId={id} rows={rows} totalOverviewCount={finals.length}
              midtermSnapshot={baseline} {...controls} />
          </article>
        ))}
      </div>
    </section>
  );
}
