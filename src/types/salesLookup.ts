import type { SalesRecord } from './sales.ts';

export type SalesFilterField =
  | 'sku' | 'product' | 'customer' | 'employee' | 'store' | 'promotion'
  | 'unitPrice' | 'netSales' | 'quantity' | 'saleId' | 'date';

export interface SalesFilter {
  field: SalesFilterField;
  op: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string;
}

// AND within a group, OR across groups.
export type SalesFilters = SalesFilter[][];

export interface SalesLookupResult {
  filters: SalesFilters;
  explanation: string;
  rows: SalesRecord[];
  count: number;
  offset: number;
  pageSize: number;
}
