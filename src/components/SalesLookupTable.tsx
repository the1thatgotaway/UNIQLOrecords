import type { SalesLookupResult } from '../types/salesLookup.ts';
import {
  customerOf, dateOf, employeeOf, formatMoney, formatNumber, productOf, promoOf, skuOf, storeOf,
} from '../utils/salesAnalytics.ts';

export function SalesLookupTable({ result, loading, onPage }: {
  result: SalesLookupResult;
  loading: boolean;
  onPage: (offset: number) => void;
}) {
  if (!result.rows.length) return null;
  const end = result.offset + result.rows.length;
  return (
    <div className="llm-section-card sales-lookup" aria-busy={loading}>
      <div className="sales-lookup-scroll" tabIndex={0} aria-label="Scrollable matching sales table">
        <table>
          <caption>Matching Supabase sales</caption>
          <thead>
            <tr>
              {['Sale ID', 'Date', 'Product', 'Customer', 'Employee', 'Store', 'Promotion', 'Units', 'Gross unit price', 'Net sales']
                .map(label => <th key={label} scope="col">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {result.rows.map(row => (
              <tr key={row.sales_fact_id}>
                <td>{row.sales_fact_id}</td>
                <td>{dateOf(row) || '—'}</td>
                <td>{productOf(row) || '—'} <small>{skuOf(row)}</small></td>
                <td>{customerOf(row) || '—'}</td>
                <td>{employeeOf(row) || '—'}</td>
                <td>{storeOf(row) || '—'}</td>
                <td>{promoOf(row) || '—'}</td>
                <td>{formatNumber(row.quantity_sold)}</td>
                <td>{formatMoney(row.gross_unit_price)}</td>
                <td>{formatMoney(row.net_sales_collected)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sales-lookup-pagination">
        <span role="status">{loading ? 'Loading sales…' :
          `${formatNumber(result.offset + 1)}–${formatNumber(end)} of ${formatNumber(result.count)}`}</span>
        <div>
          <button type="button" className="action-btn" disabled={loading || result.offset === 0}
            onClick={() => onPage(Math.max(0, result.offset - result.pageSize))}>Previous</button>
          <button type="button" className="action-btn" disabled={loading || end >= result.count}
            onClick={() => onPage(result.offset + result.pageSize)}>Next</button>
        </div>
      </div>
    </div>
  );
}
