import type {
  GroupingMode,
  IsolationForestFlag,
  IsolationForestResult,
  SalesBucket,
  SalesRecord,
  StudioChartView,
} from '../types/sales.ts';
import { formatMoney, formatNumber, metricSum } from './salesAnalytics.ts';

function aiRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aiHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function aiExpectedPath(size: number): number {
  if (size <= 1) return 0;
  if (size === 2) return 1;
  return 2 * (Math.log(size - 1) + 0.5772156649) - (2 * (size - 1)) / size;
}

interface TreeNode {
  count?: number;
  j?: number;
  split?: number;
  left?: TreeNode;
  right?: TreeNode;
}

function aiMakeTree(
  points: number[][],
  depth: number,
  maxDepth: number,
  rand: () => number
): TreeNode {
  if (depth >= maxDepth || points.length <= 1) return { count: points.length };
  const dims = points[0].length;
  const usable: Array<{ j: number; min: number; max: number }> = [];
  for (let j = 0; j < dims; j++) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      min = Math.min(min, p[j]);
      max = Math.max(max, p[j]);
    }
    if (max - min > 1e-9) usable.push({ j, min, max });
  }
  if (!usable.length) return { count: points.length };

  for (let attempt = 0; attempt < 8; attempt++) {
    const field = usable[Math.floor(rand() * usable.length)];
    const split = field.min + (field.max - field.min) * (0.001 + rand() * 0.998);
    const left: number[][] = [];
    const right: number[][] = [];
    for (const p of points) {
      (p[field.j] < split ? left : right).push(p);
    }
    if (!left.length || !right.length) continue;
    return {
      j: field.j,
      split,
      left: aiMakeTree(left, depth + 1, maxDepth, rand),
      right: aiMakeTree(right, depth + 1, maxDepth, rand),
    };
  }
  return { count: points.length };
}

function aiPath(point: number[], node: TreeNode, depth: number): number {
  if (node.count !== undefined) return depth + aiExpectedPath(node.count);
  const goLeft = point[node.j!] < node.split!;
  return aiPath(point, goLeft ? node.left! : node.right!, depth + 1);
}

function aiMedian(values: number[]): number {
  if (!values.length) return 0;
  const arr = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return 0;
  const half = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[half] : (arr[half - 1] + arr[half]) / 2;
}

export function explainBucketFlag(
  bucket: SalesBucket,
  groups: SalesBucket[],
  mode: StudioChartView
): string {
  const parts: string[] = [];
  const rev = aiMedian(groups.map((x) => x.sales));
  const units = aiMedian(groups.map((x) => x.qty));
  const count = aiMedian(groups.map((x) => x.count));
  const perSale = aiMedian(groups.map((x) => x.sales / Math.max(1, x.count)));

  if (rev > 0 && bucket.sales > rev * 1.65) {
    parts.push(`Revenue ${(bucket.sales / rev).toFixed(1)}× typical`);
  } else if (rev > 0 && bucket.sales < rev * 0.42) {
    parts.push('Revenue well below typical');
  }
  if (units > 0 && bucket.qty > units * 1.6) parts.push('High unit volume');
  if (count > 0 && bucket.count > count * 1.6) parts.push('High transaction count');
  if (perSale > 0 && bucket.sales / Math.max(1, bucket.count) > perSale * 1.6) {
    parts.push('High revenue per transaction');
  }
  if (mode === 'price') {
    const average = aiMedian(groups.map((x) => x.price / Math.max(1, x.count)));
    if (average > 0 && bucket.price / Math.max(1, bucket.count) > average * 1.5) {
      parts.push('High average unit price');
    }
  }
  return parts.length ? parts.slice(0, 2).join('; ') + '.' : 'Unusual sales and quantity pattern.';
}

export function computeIsolationForest(
  buckets: SalesBucket[],
  question: string,
  mode: StudioChartView,
  grouping: GroupingMode
): IsolationForestResult {
  if (buckets.length < 8) {
    return {
      scores: [],
      indices: [],
      reason: 'Needs 8+ chart points. Try daily or per-sale view.',
      flags: [],
    };
  }

  const features = buckets.map((b) => [
    Math.log1p(Math.max(0, b.sales)),
    Math.log1p(Math.max(0, b.qty)),
    Math.log1p(Math.max(0, b.count)),
    Math.log1p(Math.max(0, b.price / Math.max(1, b.count))),
    Math.log1p(Math.max(0, b.sales / Math.max(1, b.count))),
  ]);

  const variableFeatures = features[0].map(
    (_, j) => new Set(features.map((f) => f[j].toFixed(8))).size
  );
  if (variableFeatures.every((v) => v === 1)) {
    return {
      scores: [],
      indices: [],
      reason: 'Not enough variation for a useful ML score.',
      flags: [],
    };
  }

  const n = features.length;
  const subsample = Math.min(n, 64);
  const numTrees = 96;
  const maxDepth = Math.ceil(Math.log2(subsample));
  const seed = aiHash([question, mode, grouping, ...features.map((f) => f.join(','))].join('|'));
  const rand = aiRandom(seed);

  const forest: TreeNode[] = [];
  for (let t = 0; t < numTrees; t++) {
    const sampled: number[][] = [];
    const selected = new Set<number>();
    while (sampled.length < subsample) {
      const i = Math.floor(rand() * n);
      if (!selected.has(i)) {
        selected.add(i);
        sampled.push(features[i]);
      }
    }
    forest.push(aiMakeTree(sampled, 0, maxDepth, rand));
  }

  const normalizer = aiExpectedPath(subsample);
  const scores = features.map((p) => {
    const avgPath = forest.reduce((sum, tree) => sum + aiPath(p, tree, 0), 0) / numTrees;
    return Math.pow(2, -avgPath / normalizer);
  });

  const ordered = [...scores].sort((a, b) => a - b);
  const threshold = Math.max(0.6, ordered[Math.floor((n - 1) * 0.9)]);
  const limit = Math.max(1, Math.ceil(n * 0.1));
  const indices = scores
    .map((score, i) => ({ score, i }))
    .filter((x) => x.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.i);

  const flags: IsolationForestFlag[] = indices.map((i) => ({
    period: buckets[i].key,
    sales: buckets[i].sales,
    qty: buckets[i].qty,
    price: buckets[i].price,
    count: buckets[i].count,
    score: scores[i],
    reason: explainBucketFlag(buckets[i], buckets, mode),
    index: i,
  }));

  return { scores, indices, reason: '', threshold, flags };
}

export function explainTrendSummary(
  rows: SalesRecord[],
  groups: SalesBucket[],
  model: IsolationForestResult
): string {
  if (!groups.length) return 'No data for these filters.';
  const total = groups.reduce((s, g) => s + g.sales, 0);
  const peakBucket = groups.reduce((best, g) => (g.sales > best.sales ? g : best), groups[0]);
  const stat = `${formatNumber(rows.length)} sales · ${formatMoney(total)} revenue. Peak: ${peakBucket.key} (${formatMoney(peakBucket.sales)}).`;
  if (model.reason) return `${stat} ML check unavailable: ${model.reason}`;
  if (!model.indices.length) return `${stat} No strong anomalies detected.`;
  return `${stat} ${formatNumber(model.indices.length)} unusual point${model.indices.length === 1 ? '' : 's'} flagged for review.`;
}

export function describeStudioGraph(
  rows: SalesRecord[],
  mode: StudioChartView,
  grouping: GroupingMode,
  labels: string[],
  values: number[]
): string {
  if (!rows.length) return 'No matching sales in this date range.';
  const names: Record<StudioChartView, string> = {
    trend: 'Revenue trend',
    quantity: 'Units sold',
    price: 'Average unit price',
    mix: 'Revenue vs units',
    cumulative: 'Cumulative revenue',
  };
  const periodNames: Record<GroupingMode, string> = {
    day: 'daily',
    week: 'weekly',
    month: 'monthly',
    sale: 'per-sale',
  };
  const total = metricSum(rows, 'net_sales_collected');
  const peak = values.length ? Math.max(...values) : 0;
  const idx = values.indexOf(peak);
  const peakNote =
    mode === 'trend' && idx >= 0 && labels[idx]
      ? ` Highest: ${labels[idx]} (${formatMoney(peak)}).`
      : '';
  return `${names[mode]} (${periodNames[grouping]}): ${formatNumber(rows.length)} sales, ${formatMoney(total)} total.${peakNote}`;
}
