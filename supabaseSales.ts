import type { Express } from 'express';
import { describeSalesFilters, parseSalesQuestion, validateSalesFilters } from './salesQuery.ts';
import type { SalesFilters } from './src/types/salesLookup.ts';

const timeout = () => AbortSignal.timeout(10000);

function settings() {
  const rawUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.trim();
  const key = (process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!rawUrl || !key) return null;
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid Supabase project URL');
  }
  const headers: Record<string, string> = { apikey: key };
  if (!key.startsWith('sb_publishable_')) {
    const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (claims.role !== 'anon') throw new Error('Expected a publishable or legacy anon key');
    headers.Authorization = 'Bearer ' + key;
  }
  return { url: url.origin, headers };
}

const selectSales = [
  'sales_fact_id', 'date_key', 'quantity_sold', 'gross_unit_price', 'net_sales_collected',
  'dim_date(full_date,year_number,month_name)', 'dim_product(sku_code,product_name)',
  'dim_promotion(promo_code)', 'dim_store(store_code)', 'dim_employee(employee_id)',
  'dim_customer(full_name)',
].join(',');

export function registerSupabaseSales(app: Express) {
  app.get('/api/sales', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const config = settings();
      if (!config) {
        return res.status(503).json({ error: 'Live Supabase sales are waiting for server configuration.' });
      }
      const { url, headers } = config;
      const rows = [];
      let lastId = 0;
      const retrievalStarted = performance.now();
      while (true) {
        const query = new URLSearchParams({
          select: selectSales, order: 'sales_fact_id.asc', sales_fact_id: `gt.${lastId}`, limit: '1000',
        });
        const upstream = await fetch(`${url}/rest/v1/fact_sales?${query}`, { headers, signal: timeout() });
        if (!upstream.ok) throw new Error('Sales query failed');
        const page = await upstream.json();
        if (!Array.isArray(page)) throw new Error('Invalid sales response');
        if (!page.length) break;
        const nextId = page.at(-1)?.sales_fact_id;
        if (!Number.isSafeInteger(nextId) || nextId <= lastId || !page.every(row =>
          row.dim_date && row.dim_product && row.dim_promotion && row.dim_store && row.dim_employee && row.dim_customer
        )) throw new Error('Incomplete sales response');
        rows.push(...page);
        lastId = nextId;
      }
      if (!rows.length) {
        return res.status(502).json({ error: 'Supabase returned no visible sales for the configured key.' });
      }
      res.setHeader('Server-Timing', 'supabase;dur=' + (performance.now() - retrievalStarted).toFixed(2));
      return res.json({ rows, count: rows.length });
    } catch {
      res.status(502).json({ error: 'Could not load Supabase sales. Check the configured read permissions and try again.' });
    }
  });

  app.post('/api/sales-assistant/search', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { question, filters, previousFilters, offset = 0 } = req.body ?? {};
    const pageSize = 25;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000 ||
        (filters === undefined && (typeof question !== 'string' || question.length > 2000 || !question.trim()))) {
      return res.status(400).json({ error: 'Enter a question up to 2,000 characters and use a valid page.' });
    }

    let query: SalesFilters | null;
    try {
      query = filters !== undefined
        ? validateSalesFilters(filters)
        : parseSalesQuestion(question, previousFilters !== undefined ? validateSalesFilters(previousFilters) : undefined);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid sales filters.' });
    }
    if (!query) return res.sendStatus(204);

    try {
      const config = settings();
      if (!config) return res.status(503).json({ error: 'Live sales lookup is waiting for Supabase configuration.' });
      const result = await fetch(`${config.url}/rest/v1/rpc/sales_assistant_lookup`, {
        method: 'POST',
        headers: { ...config.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_filters: query, p_offset: offset, p_limit: pageSize }),
        signal: timeout(),
      });
      if (!result.ok) throw new Error('Supabase lookup failed');
      const body = await result.json();
      if (!Array.isArray(body?.rows) || !Number.isSafeInteger(body.count)) throw new Error('Unexpected lookup result');
      return res.json({ ...body, filters: query, explanation: describeSalesFilters(query), offset, pageSize });
    } catch {
      return res.status(502).json({ error: 'Could not query live Supabase sales. Please try the lookup again.' });
    }
  });
}
