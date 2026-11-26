-- The function runs with the public dashboard role's existing RLS and column grants.
create or replace function public.sales_assistant_lookup(
  p_filters jsonb,
  p_offset integer default 0,
  p_limit integer default 25
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  filter_group jsonb;
  rule jsonb;
  field text;
  comparison text;
  filter_value text;
  result jsonb;
begin
  if p_offset is null or p_offset < 0 or p_offset > 100000
    or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid page' using errcode = '22023';
  end if;
  if jsonb_typeof(p_filters) is distinct from 'array' then
    raise exception 'Expected an array of filter groups' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filters) not between 1 and 8 or octet_length(p_filters::text) > 18000 then
    raise exception 'Invalid filter group count or size' using errcode = '22023';
  end if;
  for filter_group in select value from jsonb_array_elements(p_filters)
  loop
    if jsonb_typeof(filter_group) is distinct from 'array' then
      raise exception 'Expected a filter group array' using errcode = '22023';
    end if;
    if jsonb_array_length(filter_group) not between 1 and 10 then
      raise exception 'Invalid condition count' using errcode = '22023';
    end if;
    for rule in select value from jsonb_array_elements(filter_group)
    loop
      field := rule->>'field';
      comparison := rule->>'op';
      filter_value := rule->>'value';
      if jsonb_typeof(rule->'value') is distinct from 'string' or
        length(trim(filter_value)) not between 1 and 120 or
        comparison is null or comparison not in ('eq', 'gt', 'gte', 'lt', 'lte') then
        raise exception 'Invalid filter' using errcode = '22023';
      end if;
      case
        when field in ('sku', 'product', 'customer', 'employee', 'store', 'promotion') then
          if comparison <> 'eq' then
            raise exception 'Text conditions require equality' using errcode = '22023';
          end if;
        when field in ('unitPrice', 'netSales', 'quantity', 'saleId') then
          if filter_value !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
            raise exception 'Invalid numeric filter' using errcode = '22023';
          end if;
        when field = 'date' then
          if filter_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
            raise exception 'Invalid date filter' using errcode = '22023';
          end if;
          perform filter_value::date;
        else
          raise exception 'Unknown filter field' using errcode = '22023';
      end case;
    end loop;
  end loop;

  with conditions as materialized (
    select g.group_id, r.data->>'field' as col, r.data->>'op' as op,
           lower(trim(r.data->>'value')) as text_value,
           case
             when r.data->>'field' = 'date' then (r.data->>'value')::date - date '0001-01-01'
             when r.data->>'field' in ('unitPrice', 'netSales', 'quantity', 'saleId') then (r.data->>'value')::numeric
           end as numeric_value
    from jsonb_array_elements(p_filters) with ordinality as g(items, group_id)
    cross join lateral jsonb_array_elements(g.items) as r(data)
  ),
  matched as materialized (
    select f.sales_fact_id, f.date_key, f.quantity_sold, f.gross_unit_price, f.net_sales_collected,
           d.full_date, d.year_number, d.month_name, p.sku_code, p.product_name,
           c.full_name, e.employee_id, s.store_code, m.promo_code
    from public.fact_sales f
    join public.dim_date d using (date_key)
    join public.dim_product p using (product_key)
    join public.dim_customer c using (customer_key)
    join public.dim_employee e using (employee_key)
    join public.dim_store s using (store_key)
    join public.dim_promotion m using (promotion_key)
    where exists (
      select 1
      from conditions cond
      cross join lateral (
        select case cond.col
          when 'sku' then p.sku_code when 'product' then p.product_name
          when 'customer' then c.full_name when 'employee' then e.employee_id
          when 'store' then s.store_code when 'promotion' then m.promo_code
        end as text_actual,
        case cond.col
          when 'unitPrice' then f.gross_unit_price when 'netSales' then f.net_sales_collected
          when 'quantity' then f.quantity_sold when 'saleId' then f.sales_fact_id
          when 'date' then d.full_date - date '0001-01-01'
        end as numeric_actual
      ) actual
      group by cond.group_id
      having bool_and(coalesce(case
        when cond.numeric_value is null then lower(trim(actual.text_actual)) = cond.text_value
        when cond.op = 'eq' then actual.numeric_actual = cond.numeric_value
        when cond.op = 'gt' then actual.numeric_actual > cond.numeric_value
        when cond.op = 'gte' then actual.numeric_actual >= cond.numeric_value
        when cond.op = 'lt' then actual.numeric_actual < cond.numeric_value
        when cond.op = 'lte' then actual.numeric_actual <= cond.numeric_value
      end, false))
    )
  ),
  page as (
    select * from matched order by sales_fact_id offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'count', (select count(*) from matched),
    'rows', coalesce(jsonb_agg(jsonb_build_object(
      'sales_fact_id', sales_fact_id, 'date_key', date_key, 'quantity_sold', quantity_sold,
      'gross_unit_price', gross_unit_price, 'net_sales_collected', net_sales_collected,
      'dim_date', jsonb_build_object('full_date', full_date, 'year_number', year_number, 'month_name', month_name),
      'dim_product', jsonb_build_object('sku_code', sku_code, 'product_name', product_name),
      'dim_customer', jsonb_build_object('full_name', full_name),
      'dim_employee', jsonb_build_object('employee_id', employee_id),
      'dim_store', jsonb_build_object('store_code', store_code),
      'dim_promotion', jsonb_build_object('promo_code', promo_code)
    ) order by sales_fact_id), '[]'::jsonb)
  ) into result from page;
  return result;
end
$$;

revoke execute on function public.sales_assistant_lookup(jsonb, integer, integer) from public, authenticated, service_role;
grant execute on function public.sales_assistant_lookup(jsonb, integer, integer) to anon;
