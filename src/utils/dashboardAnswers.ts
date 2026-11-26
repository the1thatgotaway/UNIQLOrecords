import type { LlmContextPayload } from '../types/sales.ts';
import { formatMoney, formatNumber } from './salesAnalytics.ts';

const helpAnswers: Record<string, string> = {
  'how do i use this system': 'Start on Executive Dashboard to see totals, charts, and the transaction table. Use Search records or the product and date filters to narrow the results. Tabs 01–04 open the four focused analyses. The dashboard loads Supabase sales automatically. Use Reload records to fetch updates.',
  'what does the overview dashboard show': 'Executive Dashboard shows transaction counts, net sales, units sold, average transaction value, revenue charts, data-quality alerts, and a searchable transaction table. The charts and totals update when you change filters.',
  'how does isolation forest work': 'Isolation Forest splits chart points at random using features such as revenue, units, and transaction count. Points that are easier to isolate receive higher anomaly scores. Review the flagged periods and their underlying sales before drawing conclusions.',
  'how do i import sales records': 'The dashboard loads current sales from Supabase automatically. Use Reload records to refresh. Open any scenario tab to see the saved Midterm data alongside live Finals sales.',
};

export function answerFromDashboard(
  question: string,
  context?: LlmContextPayload
): string | undefined {
  const normalized = question.toLowerCase().trim().replace(/[?.!]+$/, '').replace(/[–—‑]/g, '-');
  const help = Object.hasOwn(helpAnswers, normalized) ? helpAnswers[normalized] : undefined;
  if (help) return help;

  if (context && /^(?:what are the highest[- ]performing products|(?:show me |list )?(?:the )?top products(?: by net sales)?)$/.test(normalized)) {
    const top = context.topProducts.slice(0, 5);
    return top.length
      ? `Top products by net sales in ${context.viewLabel} (active filters):\n${top.map((p, index) =>
          `${index + 1}. ${p.name} (${p.sku}) · ${formatMoney(p.netSales)} · ${formatNumber(p.units)} units`
        ).join('\n')}`
      : `There are no matching products in ${context.viewLabel} with the active filters.`;
  }
  if (context && /^(?:explain|show|list) (?:the )?(?:current )?(?:sales )?anomalies$/.test(normalized)) {
    const { totalFlags, topFlags } = context.anomalySummary;
    const details = [
      ...topFlags.slice(0, 3).map(flag => `${flag.date} · ${flag.type}: ${flag.reason}`),
      ...context.mlGraphFlags.slice(0, 2).map(flag =>
        `${flag.period} · Isolation Forest score ${flag.score.toFixed(3)}: ${flag.reason}`
      ),
    ];
    return `${context.viewLabel} has ${formatNumber(totalFlags)} statistical or data-quality flags and ${formatNumber(context.mlGraphFlags.length)} Isolation Forest flags in the assistant’s summary.${details.length
      ? `\n${details.join('\n')}\nFlags identify records or periods to review.`
      : ''}`;
  }

  return undefined;
}
