import type { MidtermSnapshot, SalesRecord } from '../types/sales.ts';

export const SUPABASE_SNAPSHOT_SQL = `select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(x) order by sales_fact_id),'[]'::jsonb),'count',count(*)) as snapshot
from (select f.sales_fact_id, f.date_key, f.quantity_sold, f.gross_unit_price, f.net_sales_collected,
 jsonb_build_object('full_date', date.full_date, 'year_number', date.year_number, 'month_name', date.month_name) as dim_date,
 jsonb_build_object('sku_code', product.sku_code, 'product_name', product.product_name) as dim_product,
 jsonb_build_object('promo_code', promotion.promo_code) as dim_promotion,
 jsonb_build_object('store_code', store.store_code) as dim_store,
 jsonb_build_object('employee_id', employee.employee_id) as dim_employee,
 jsonb_build_object('full_name', customer.full_name) as dim_customer
 from public.fact_sales f
 left join public.dim_date date on date.date_key=f.date_key
 left join public.dim_product product on product.product_key=f.product_key
 left join public.dim_promotion promotion on promotion.promotion_key=f.promotion_key
 left join public.dim_store store on store.store_key=f.store_key
 left join public.dim_employee employee on employee.employee_key=f.employee_key
 left join public.dim_customer customer on customer.customer_key=f.customer_key) x;`;

const REQUIRED_ROW_KEYS = [
  'dim_date',
  'dim_product',
  'dim_customer',
  'dim_store',
  'dim_employee',
  'dim_promotion',
  'quantity_sold',
  'net_sales_collected',
  'gross_unit_price',
] as const;

function unwrapCsvCell(raw: string): string {
  let text = raw.trim();
  if (/^"?snapshot"?\r?\n/.test(text)) {
    text = text.slice(text.indexOf('\n') + 1).trim();
    if (text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1).replace(/""/g, '"');
    }
  }
  return text;
}

export function parseImportedSnapshot(raw: string): { rows: SalesRecord[]; count: number } {
  const jsonText = unwrapCsvCell(raw);
  const parsed = JSON.parse(jsonText) as { rows?: unknown; count?: unknown };

  if (
    !parsed ||
    !Array.isArray(parsed.rows) ||
    parsed.count !== parsed.rows.length ||
    new Set(parsed.rows.map((r: SalesRecord) => r.sales_fact_id)).size !== parsed.count ||
    parsed.rows.some(
      (r: Record<string, unknown>) =>
        !Number.isSafeInteger(r.sales_fact_id) ||
        !REQUIRED_ROW_KEYS.every((k) => k in r)
    )
  ) {
    throw new Error('Use the complete CSV or JSON exported by the Supabase snapshot query.');
  }

  return { rows: parsed.rows as SalesRecord[], count: parsed.count as number };
}

export function parseMidtermSnapshot(raw: string, expectedProject = 'chforetvcqdihokzimru'): MidtermSnapshot {
  const jsonText = unwrapCsvCell(raw);
  const snap = JSON.parse(jsonText) as Partial<MidtermSnapshot>;

  if (
    snap.format !== 'uniqlo-exam-v1' ||
    snap.project !== expectedProject ||
    !Number.isSafeInteger(snap.baseline) ||
    (snap.baseline ?? 0) < 1 ||
    snap.target !== Math.max(6000, 6 * (snap.baseline ?? 0), (snap.baseline ?? 0) + 5000)
  ) {
    throw new Error('Use the unedited snapshot exported by SQL step 02 for this project.');
  }

  for (const q of ['1', '2', '3', '4'] as const) {
    const rows = snap.scenarios?.[q];
    if (
      !Array.isArray(rows) ||
      rows.length > (snap.baseline ?? 0) ||
      new Set(rows.map((r) => r.sales_fact_id)).size !== rows.length ||
      rows.some(
        (r) =>
          !Number.isSafeInteger(r.sales_fact_id) ||
          !(['gross_unit_price', 'quantity_sold', 'net_sales_collected'] as const).every(
            (k) => k in r && Number.isFinite(Number(r[k]))
          )
      )
    ) {
      throw new Error('Incomplete scenario data in the Midterm snapshot file.');
    }
  }

  return snap as MidtermSnapshot;
}

export function csvEscape(value: unknown): string {
  const str = String(value ?? '');
  const safe = /^[\s]*[=+@\-\t\r]/.test(str) ? "'" + str : str;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function buildCsvDocument(headers: string[], rows: Array<Array<unknown>>, preamble?: string): string {
  const headerLine = headers.map(csvEscape).join(',');
  const bodyLines = rows.map((row) => row.map(csvEscape).join(','));
  const prefix = preamble ? `${preamble.replace(/[\r\n]+$/, '')}\r\n` : '';
  return '\ufeff' + prefix + [headerLine, ...bodyLines].join('\r\n');
}
