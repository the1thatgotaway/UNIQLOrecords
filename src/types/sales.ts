export interface DimDate {
  full_date?: string | null;
  year_number?: number | null;
  month_name?: string | null;
}

export interface DimProduct {
  sku_code?: string | null;
  product_name?: string | null;
}

export interface DimPromotion {
  promo_code?: string | null;
}

export interface DimStore {
  store_code?: string | null;
}

export interface DimEmployee {
  employee_id?: string | null;
}

export interface DimCustomer {
  full_name?: string | null;
}

export interface SalesRecord {
  sales_fact_id: number;
  date_key?: number | null;
  quantity_sold: number;
  gross_unit_price: number;
  net_sales_collected: number;
  dim_date?: DimDate | DimDate[] | null;
  dim_product?: DimProduct | DimProduct[] | null;
  dim_promotion?: DimPromotion | DimPromotion[] | null;
  dim_store?: DimStore | DimStore[] | null;
  dim_employee?: DimEmployee | DimEmployee[] | null;
  dim_customer?: DimCustomer | DimCustomer[] | null;
}

export type ScenarioId = 'overview' | '1' | '2' | '3' | '4';
export type FocusedQuestionId = '1' | '2' | '3' | '4';
export type GroupingMode = 'day' | 'week' | 'month' | 'sale';
export type StudioChartView = 'trend' | 'quantity' | 'price' | 'mix' | 'cumulative';
export type OverviewSortOrder = 'id-desc' | 'date-desc' | 'date-asc' | 'revenue-desc' | 'quantity-desc';

export type AnomalySeverity = 'High' | 'Review';
export type AnomalyCategory =
  | 'Date issue'
  | 'Invalid value'
  | 'High sale value'
  | 'Unusual quantity'
  | 'Monthly sales spike';

export interface AnomalyFlag {
  id: string;
  date: string;
  sku: string;
  type: AnomalyCategory;
  reason: string;
  severity: AnomalySeverity;
}

export interface SalesBucket {
  key: string;
  sales: number;
  qty: number;
  price: number;
  count: number;
}

export interface IsolationForestFlag {
  period: string;
  sales: number;
  qty: number;
  price: number;
  count: number;
  score: number;
  reason: string;
  index: number;
}

export interface IsolationForestResult {
  scores: number[];
  indices: number[];
  reason: string;
  threshold?: number;
  flags: IsolationForestFlag[];
}

export interface MidtermSnapshot {
  format: string;
  project: string;
  captured_at: string;
  baseline: number;
  target: number;
  max_midterm_id?: number;
  scenarios: Record<'1' | '2' | '3' | '4', SalesRecord[]>;
}

export type LlmAnalysisTask =
  | 'executive-briefing'
  | 'anomaly-explanation'
  | 'scenario-deep-dive';

export interface LlmOverallSummary {
  totalLoadedCount: number;
  totalNetSales: number;
  totalUnits: number;
  averageOrderValue: number;
  dateSpan: string;
  distinctDates: number;
  totalAnomalyFlags: number;
  topProducts: Array<{
    sku: string;
    name: string;
    netSales: number;
    units: number;
  }>;
  scenarioCounts: Record<FocusedQuestionId, { count: number; netSales: number }>;
}

export interface LlmContextPayload {
  viewId: ScenarioId;
  viewLabel: string;
  snapshotSource: string;
  filterDescription: string;
  isFiltered: boolean;
  activeGrouping?: GroupingMode;
  midtermLoaded?: boolean;
  midtermLabel?: string;
  overallSummary: LlmOverallSummary;
  kpis: {
    recordCount: number;
    totalLoadedCount: number;
    totalNetSales: number;
    totalUnits: number;
    averageOrderValue: number;
    averageGrossUnitPrice: number;
    distinctDates: number;
    dateSpan: string;
  };
  topProducts: Array<{
    sku: string;
    name: string;
    netSales: number;
    units: number;
    transactions: number;
    sharePercent: number;
  }>;
  storeBreakdown: Array<{
    store: string;
    netSales: number;
    units: number;
    transactions: number;
  }>;
  promoBreakdown: Array<{
    promo: string;
    netSales: number;
    units: number;
    transactions: number;
  }>;
  recentPeriods: Array<{
    period: string;
    netSales: number;
    units: number;
    transactions: number;
  }>;
  anomalySummary: {
    totalFlags: number;
    highSeverityCount: number;
    reviewCount: number;
    topFlags: Array<{
      id: string;
      date: string;
      sku: string;
      type: string;
      severity: string;
      reason: string;
    }>;
  };
  mlGraphFlags: Array<{
    period: string;
    netSales: number;
    units: number;
    score: number;
    reason: string;
  }>;
  sampleRecords: Array<{
    id: number;
    date: string;
    sku: string;
    store: string;
    employee: string;
    customer: string;
    promo: string;
    qty: number;
    unitPrice: number;
    netSales: number;
  }>;
}

export interface LlmChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface LlmBriefingSection {
  title: string;
  bullets: string[];
}

export interface LlmAnalysisResult {
  headline: string;
  executiveSummary: string;
  keyDrivers: string[];
  anomalyAssessment: string[];
  recommendedActions: string[];
  dataCaveat: string;
  model: string;
}
