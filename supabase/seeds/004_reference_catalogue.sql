-- =============================================================================
-- Reference configuration the port had not carried over: merchants, the panel
-- catalogue and the stock locations.
--
-- Ported verbatim from the reference system's configuration
-- (simple-solar-operations @ c4f56ea, schema/config-seed.json: Companies,
-- Products, StockLocations). Nothing here is invented: the merchants are the
-- real ones (contact emails stay NOT_CONFIGURED, as in the reference), the two
-- panels are the catalogue, and the five stock locations are the movement
-- model (Store, Quarantine, External balancing, Installed, Disposed).
--
-- Without these, R2 cannot run at all: MATERIAL_ADD needs a product,
-- ORDERS_BUILD needs a merchant, and every stock movement needs its locations.
--
-- Repeatable: matched by natural key (company name, product sku, location
-- name), so re-running changes nothing.
-- =============================================================================

insert into public.companies (name, type, active, standard_lead_days, delivery_weekday, notes)
select v.name, v.type, true, v.lead, v.weekday, v.notes
from (values
  ('Greentech', 'Merchant', 14, 4, 'Roofing merchant. Contact: Tom - email NOT_CONFIGURED.'),
  ('CEF',       'Merchant',  7, 4, 'Electrical merchant. Contact: Luke - email NOT_CONFIGURED.')
) as v (name, type, lead, weekday, notes)
where not exists (select 1 from public.companies c where c.name = v.name and c.type = v.type);

insert into public.products (sku, name, category, wattage, manufacturer, model, unit, unit_precision,
                             stock_tracked, active, default_supplier_id, standard_lead_days)
select v.sku, v.name, 'Panel', v.wattage, 'NOT_CONFIGURED', 'NOT_CONFIGURED', 'Each', 0,
       true, true, (select c.id from public.companies c where c.name = 'Greentech' and c.type = 'Merchant'), 14
from (values
  ('P460', '460W Solar Panel', 460),
  ('P515', '515W Solar Panel', 515)
) as v (sku, name, wattage)
where not exists (select 1 from public.products p where p.sku = v.sku);

insert into public.stock_locations (name, type, job_id, usable)
select v.name, v.type, null, v.usable
from (values
  ('Main Store',           'Store',     true),
  ('Quarantine',           'Quarantine', false),
  ('External (balancing)', 'Supplier',  false),
  ('Installed',            'Installed', false),
  ('Disposed',             'Disposed',  false)
) as v (name, type, usable)
where not exists (select 1 from public.stock_locations l where l.name = v.name);
