import type { LlmAnalysisResult, LlmAnalysisTask, LlmContextPayload } from '../types/sales.ts';
import { formatMoney, formatNumber } from './salesAnalytics.ts';

export function buildDashboardBriefing(
  task: LlmAnalysisTask,
  context: LlmContextPayload
): LlmAnalysisResult {
  const { kpis, anomalySummary, mlGraphFlags } = context;
  const dateIssues = anomalySummary.topFlags.filter(flag => flag.type === 'Date issue');
  const top = context.topProducts[0];
  const store = context.storeBreakdown[0];
  const promo = context.promoBreakdown[0];
  const graphFlag = mlGraphFlags[0];
  const [monthlyPeak] = [...context.recentPeriods].sort((a, b) => b.netSales - a.netSales);
  const headline = {
    'executive-briefing': 'Executive briefing',
    'anomaly-explanation': 'Anomaly and ML review',
    'scenario-deep-dive': 'Scenario deep dive',
  }[task];

  return {
    headline: `${headline} · ${context.viewLabel}`,
    executiveSummary: `This view contains ${formatNumber(kpis.recordCount)} of ${formatNumber(kpis.totalLoadedCount)} loaded sales, with ${formatMoney(kpis.totalNetSales)} in net sales and ${formatNumber(kpis.totalUnits)} units. Date coverage: ${kpis.dateSpan}.`,
    keyDrivers: [
      ...(top ? [`Top product by net sales: ${top.name} (${top.sku}) at ${formatMoney(top.netSales)}.`] : []),
      ...(store ? [`Leading store: ${store.store}, with ${formatMoney(store.netSales)} in net sales.`] : []),
      ...(promo ? [`Leading promotion category: ${promo.promo}, with ${formatMoney(promo.netSales)} in net sales.`] : []),
      ...(monthlyPeak ? [`Highest-revenue month in the supplied summary: ${monthlyPeak.period} at ${formatMoney(monthlyPeak.netSales)}.`] : []),
    ],
    anomalyAssessment: [
      `The dashboard identified ${formatNumber(anomalySummary.totalFlags)} statistical or data-quality flags in this view.`,
      ...dateIssues.slice(0, 2).map(flag => `${flag.date}: ${flag.reason}`),
      ...(graphFlag ? [`Top Isolation Forest flag: ${graphFlag.period}, score ${graphFlag.score.toFixed(3)}. ${graphFlag.reason}`] : []),
    ],
    recommendedActions: task === 'anomaly-explanation'
      ? ['Open the flagged period and inspect its transactions, quantities, and dates before attributing a cause.']
      : ['Use the same filters in the Midterm and Finals comparison and inspect the records driving the change.'],
    dataCaveat: 'Computed from the loaded dashboard data while Groq was unavailable. Finals sales are simulated, and flags identify points for review.',
    model: 'Dashboard data',
  };
}
