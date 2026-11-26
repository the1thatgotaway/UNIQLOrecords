import { useEffect, useRef } from 'react';
import { Database, Link2, X } from 'lucide-react';

const dimensions = [
  { name: 'dim_date', key: 'date_key', grain: 'One row per calendar day', fields: ['full_date', 'day_of_week', 'day_of_month', 'month_name', 'quarter_of_year', 'year_number', 'is_weekend', 'fiscal_quarter', 'retail_season'] },
  { name: 'dim_product', key: 'product_key', grain: 'One row per product SKU', fields: ['sku_code', 'product_name', 'category', 'sub_category', 'apparel_fit', 'fabric_material', 'target_gender', 'size_code', 'color_variant', 'unit_price'] },
  { name: 'dim_store', key: 'store_key', grain: 'One row per store', fields: ['store_code', 'store_name', 'region_location', 'city', 'store_format', 'floor_area_sqm', 'has_alteration_service', 'pos_terminal_count'] },
  { name: 'dim_employee', key: 'employee_key', grain: 'One row per employee', fields: ['employee_id', 'full_name', 'job_title', 'department_assigned', 'shift_schedule_type', 'store_assigned'] },
  { name: 'dim_customer', key: 'customer_key', grain: 'One row per customer', fields: ['member_id', 'full_name', 'contact_number', 'email_address', 'membership_tier', 'customer_segment', 'loyalty_signup_date'] },
  { name: 'dim_promotion', key: 'promotion_key', grain: 'One row per promotion', fields: ['promo_code', 'promotion_name', 'discount_type', 'marketing_channel', 'is_app_exclusive'] },
];

export function WarehouseSchema({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} onClose={onClose} className="warehouse-dialog warehouse-schema" aria-labelledby="warehouse-title">
      <div className="warehouse-dialog-heading">
        <Database size={24} aria-hidden="true" />
        <h2 id="warehouse-title">UniQlick Data Warehouse Schema</h2>
        <button type="button" className="action-btn" aria-label="Close schema" onClick={() => dialog.current?.close()}><X size={18} /></button>
      </div>
      <div className="warehouse-dialog-body">
      <img className="warehouse-diagram" src="/assets/warehouse-schema.png" alt="Star schema showing fact_sales linked to the date, product, store, employee, customer, and promotion dimensions" />
      <h3>Warehouse tables</h3>
      <p>Six dimension tables describe each sale in <code>public.fact_sales</code>. Each foreign key links to the matching dimension’s primary key.</p>
      <article className="card warehouse-fact">
        <h3><Database size={19} aria-hidden="true" /> <code>fact_sales</code></h3>
        <p>One row per recorded sale line item.</p>
        <ul className="warehouse-fields" aria-label="Fact table columns">
          <li><code>sales_fact_id</code> <strong>PK</strong></li>
          {dimensions.map(({ key, name }) => <li key={key}><a href={`#warehouse-${name}`}><code>{key}</code> <strong>FK</strong></a></li>)}
          {['transaction_receipt_number', 'quantity_sold', 'gross_unit_price', 'item_discount_amount', 'tax_amount', 'net_sales_collected'].map(field => <li key={field}><code>{field}</code></li>)}
        </ul>
      </article>
      <div className="warehouse-dimensions">
        {dimensions.map(({ name, key, grain, fields }) => (
          <article className="card" key={name} id={`warehouse-${name}`}>
            <h3><Link2 size={18} aria-hidden="true" /> <code>{name}</code></h3>
            <p>{grain}</p>
            <p className="warehouse-join"><code>fact_sales.{key}</code> → <code>{name}.{key}</code></p>
            <ul className="warehouse-fields" aria-label={`${name} columns`}>
              <li><code>{key}</code> <strong>PK</strong></li>
              {fields.map(field => <li key={field}><code>{field}</code></li>)}
            </ul>
          </article>
        ))}
      </div>
      </div>
      <div className="warehouse-dialog-footer">
        <button type="button" className="action-btn" onClick={() => dialog.current?.close()}>Close</button>
      </div>
    </dialog>
  );
}
