-- =============================================================================
-- Reference-schema port, part 4: product catalogue, materials, ordering,
-- deliveries and the stock ledger.
--
-- Source: reference schema/tables.json (S02-1.0) - Products, StockLocations,
-- Materials, Orders, OrderLines, Deliveries, ReceiptLines, Reservations,
-- StockMovements, Stocktakes, StocktakeLines, PanelUse.
-- Conventions: see part 1 (20260919100000).
--
-- Added later: orders.sent_message_id FK (part 5), receipt_lines.evidence_id and
-- stock_movements.evidence_id FKs (part 6).
-- =============================================================================

create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text not null unique check (btrim(sku) <> ''),
  name                text not null,
  category            text not null,
  wattage             integer check (wattage > 0),
  manufacturer        text,
  model               text,
  unit                text not null check (unit in ('Each', 'Metre', 'Roll', 'Length', 'Set')),
  unit_precision      integer not null default 0 check (unit_precision between 0 and 6),
  stock_tracked       boolean not null,
  active              boolean not null default true,
  default_supplier_id uuid references public.companies (id) on delete restrict,
  standard_lead_days  integer check (standard_lead_days >= 0),
  unit_cost_pence     bigint check (unit_cost_pence >= 0),
  created_at          timestamptz not null default now(),
  created_by          uuid references public.people (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.people (id),
  version             integer not null default 1 check (version >= 1)
);
comment on table public.products is 'Product catalogue with SKUs and units.';

create table public.stock_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  type       text not null check (type in ('Store', 'JobSite', 'Installed', 'Quarantine', 'Supplier', 'Disposed')),
  job_id     uuid references public.jobs (id) on delete restrict,
  usable     boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid references public.people (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.people (id),
  version    integer not null default 1 check (version >= 1)
);
comment on table public.stock_locations is 'Physical stock storage locations.';
create index stock_locations_job_idx on public.stock_locations (job_id) where job_id is not null;

create table public.materials (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references public.jobs (id) on delete restrict,
  work_package_id           uuid not null references public.work_packages (id) on delete restrict,
  -- Null for "Other", in which case description is required.
  product_id                uuid references public.products (id) on delete restrict,
  description               text,
  required_quantity         numeric not null check (required_quantity >= 0),
  unit                      text not null,
  source                    text not null check (source in ('ToOrder', 'AlreadyOrdered', 'Stock')),
  need_by_date              date not null,
  merchant_id               uuid references public.companies (id) on delete restrict,
  order_line_id             uuid, -- FK order_lines (below)
  already_ordered_reference text,
  notes                     text,
  revision                  integer not null default 1 check (revision >= 1),
  cancelled_quantity        numeric not null default 0 check (cancelled_quantity >= 0),
  created_at                timestamptz not null default now(),
  created_by                uuid references public.people (id),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.people (id),
  version                   integer not null default 1 check (version >= 1),
  constraint materials_product_or_description check (product_id is not null or btrim(coalesce(description, '')) <> ''),
  constraint materials_cancelled_within_required check (cancelled_quantity <= required_quantity)
);
comment on table public.materials is 'Material requirements per job/package.';
create index materials_job_idx on public.materials (job_id);
create index materials_work_package_idx on public.materials (work_package_id);

create table public.orders (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references public.jobs (id) on delete restrict,
  merchant_id             uuid not null references public.companies (id) on delete restrict,
  work_type               text not null check (work_type in ('Roof', 'Electrical', 'Other')),
  requested_delivery_date date not null,
  delivery_location_id    uuid references public.stock_locations (id) on delete restrict,
  delivery_address        text,
  status                  text not null default 'Draft'
                          check (status in ('Draft', 'Review', 'Requested', 'Confirmed', 'PartReceived',
                                            'Received', 'Cancelled')),
  revision                integer not null default 1 check (revision >= 1),
  supplier_reference      text,
  sent_message_id         uuid, -- FK communications (part 5)
  confirmed_revision      integer check (confirmed_revision >= 1),
  confirmed_at            timestamptz,
  confirmed_by            uuid references public.people (id),
  created_at              timestamptz not null default now(),
  created_by              uuid references public.people (id),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.people (id),
  version                 integer not null default 1 check (version >= 1)
);
comment on table public.orders is 'Merchant/supplier purchase orders.';
create index orders_job_idx on public.orders (job_id);
create index orders_merchant_idx on public.orders (merchant_id, requested_delivery_date);

create table public.order_lines (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders (id) on delete restrict,
  material_id          uuid references public.materials (id) on delete restrict,
  product_id           uuid references public.products (id) on delete restrict,
  description_snapshot text not null,
  quantity             numeric not null check (quantity > 0),
  unit                 text not null,
  unit_net_cost_pence  bigint check (unit_net_cost_pence >= 0),
  vat_code             text,
  cancelled_quantity   numeric not null default 0 check (cancelled_quantity >= 0),
  created_at           timestamptz not null default now(),
  constraint order_lines_cancelled_within_quantity check (cancelled_quantity <= quantity)
);
comment on table public.order_lines is 'Line items within orders.';
create index order_lines_order_idx on public.order_lines (order_id);
create index order_lines_material_idx on public.order_lines (material_id) where material_id is not null;

alter table public.materials
  add constraint materials_order_line_id_fkey
  foreign key (order_line_id) references public.order_lines (id) on delete restrict;
create index materials_order_line_idx on public.materials (order_line_id) where order_line_id is not null;

create table public.deliveries (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders (id) on delete restrict,
  expected_date           date not null,
  actual_received_at      timestamptz,
  received_by             uuid references public.people (id),
  delivery_note_reference text,
  receipt_status          text not null,
  discrepancy_note        text,
  created_at              timestamptz not null default now()
);
comment on table public.deliveries is 'Physical delivery receipts against orders.';
create index deliveries_order_idx on public.deliveries (order_id);

create table public.receipt_lines (
  id                 uuid primary key default gen_random_uuid(),
  delivery_id        uuid not null references public.deliveries (id) on delete restrict,
  order_line_id      uuid not null references public.order_lines (id) on delete restrict,
  quantity_good      numeric not null default 0 check (quantity_good >= 0),
  quantity_damaged   numeric not null default 0 check (quantity_damaged >= 0),
  evidence_id        uuid, -- FK evidence (part 6)
  stock_movement_ids uuid[],
  created_at         timestamptz not null default now()
);
comment on table public.receipt_lines is 'Line-level delivery receipt detail.';
create index receipt_lines_delivery_idx on public.receipt_lines (delivery_id);
create index receipt_lines_order_line_idx on public.receipt_lines (order_line_id);

create table public.reservations (
  id              uuid primary key default gen_random_uuid(),
  material_id     uuid not null references public.materials (id) on delete restrict,
  product_id      uuid not null references public.products (id) on delete restrict,
  location_id     uuid not null references public.stock_locations (id) on delete restrict,
  quantity        numeric not null check (quantity > 0),
  status          text not null default 'Active' check (status in ('Active', 'Released', 'Issued', 'Cancelled')),
  picked_quantity numeric not null default 0 check (picked_quantity >= 0),
  picked_at       timestamptz,
  picked_by       uuid references public.people (id),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.people (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1 check (version >= 1)
);
comment on table public.reservations is 'Stock reservations for picking/issuing.';
create index reservations_material_idx on public.reservations (material_id);
create index reservations_product_location_idx on public.reservations (product_id, location_id) where status = 'Active';

create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null references public.products (id) on delete restrict,
  quantity         numeric not null check (quantity > 0),
  from_location_id uuid not null references public.stock_locations (id) on delete restrict,
  to_location_id   uuid not null references public.stock_locations (id) on delete restrict,
  movement_type    text not null
                   check (movement_type in ('Opening', 'Receipt', 'Issue', 'Install', 'Return', 'Damage',
                                            'SupplierReturn', 'Disposal', 'Adjustment')),
  job_id           uuid references public.jobs (id) on delete restrict,
  receipt_line_id  uuid references public.receipt_lines (id) on delete restrict,
  reason           text,
  evidence_id      uuid, -- FK evidence (part 6)
  approval_id      text,
  movement_at      timestamptz not null,
  idempotency_key  text not null unique,
  created_at       timestamptz not null default now(),
  constraint stock_movements_distinct_locations check (from_location_id <> to_location_id)
);
comment on table public.stock_movements is
  'Immutable stock movement ledger. Quantity is always positive; direction is from -> to. Corrections are new movements.';
create index stock_movements_product_idx on public.stock_movements (product_id, movement_at);
create index stock_movements_from_idx on public.stock_movements (from_location_id, product_id);
create index stock_movements_to_idx on public.stock_movements (to_location_id, product_id);
create index stock_movements_job_idx on public.stock_movements (job_id) where job_id is not null;

create table public.stocktakes (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.stock_locations (id) on delete restrict,
  counted_at  timestamptz not null,
  -- Reference: cut_off_commit_id. Expected quantities are the ledger as at this instant.
  cut_off_at  timestamptz not null,
  status      text not null default 'Draft' check (status in ('Draft', 'Review', 'Approved')),
  counted_by  uuid not null references public.people (id),
  approved_by uuid references public.people (id),
  created_at  timestamptz not null default now()
);
comment on table public.stocktakes is 'Physical stock count sessions.';
create index stocktakes_location_idx on public.stocktakes (location_id, counted_at);

create table public.stocktake_lines (
  id                          uuid primary key default gen_random_uuid(),
  stocktake_id                uuid not null references public.stocktakes (id) on delete restrict,
  product_id                  uuid not null references public.products (id) on delete restrict,
  expected_quantity_at_cutoff numeric not null,
  counted_quantity            numeric not null check (counted_quantity >= 0),
  variance                    numeric not null,
  reason                      text,
  adjustment_movement_id      uuid references public.stock_movements (id) on delete restrict,
  created_at                  timestamptz not null default now(),
  unique (stocktake_id, product_id),
  constraint stocktake_lines_variance check (variance = counted_quantity - expected_quantity_at_cutoff)
);
comment on table public.stocktake_lines is 'Per-product stocktake counts.';

create table public.panel_use (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  roof_package_id    uuid not null references public.work_packages (id) on delete restrict,
  product_id         uuid not null references public.products (id) on delete restrict,
  -- Derived from stock movements.
  issued_quantity    integer not null check (issued_quantity >= 0),
  installed_quantity integer not null check (installed_quantity >= 0),
  unused_quantity    integer not null check (unused_quantity >= 0),
  defective_quantity integer not null check (defective_quantity >= 0),
  broken_quantity    integer not null check (broken_quantity >= 0),
  photos             text[],
  roofer_notes       text,
  reported_by        uuid not null references public.people (id),
  reported_at        timestamptz not null,
  reviewed_by        uuid references public.people (id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
comment on table public.panel_use is 'Per-job panel installation counts.';
create index panel_use_job_idx on public.panel_use (job_id);
create index panel_use_package_idx on public.panel_use (roof_package_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger products_touch before insert or update on public.products
  for each row execute function app.touch_row();
create trigger stock_locations_touch before insert or update on public.stock_locations
  for each row execute function app.touch_row();
create trigger materials_touch before insert or update on public.materials
  for each row execute function app.touch_row();
create trigger orders_touch before insert or update on public.orders
  for each row execute function app.touch_row();
create trigger reservations_touch before insert or update on public.reservations
  for each row execute function app.touch_row();

create trigger products_audit after insert or update or delete on public.products
  for each row execute function app.audit_row_change();
create trigger stock_locations_audit after insert or update or delete on public.stock_locations
  for each row execute function app.audit_row_change();
create trigger materials_audit after insert or update or delete on public.materials
  for each row execute function app.audit_row_change();
create trigger orders_audit after insert or update or delete on public.orders
  for each row execute function app.audit_row_change();
create trigger order_lines_audit after insert or update or delete on public.order_lines
  for each row execute function app.audit_row_change();
create trigger deliveries_audit after insert or update or delete on public.deliveries
  for each row execute function app.audit_row_change();
create trigger receipt_lines_audit after insert or update or delete on public.receipt_lines
  for each row execute function app.audit_row_change();
create trigger reservations_audit after insert or update or delete on public.reservations
  for each row execute function app.audit_row_change();
create trigger stocktakes_audit after insert or update or delete on public.stocktakes
  for each row execute function app.audit_row_change();
create trigger stocktake_lines_audit after insert or update or delete on public.stocktake_lines
  for each row execute function app.audit_row_change();
create trigger panel_use_audit after insert or update or delete on public.panel_use
  for each row execute function app.audit_row_change();

-- The stock ledger is append-only.
create trigger stock_movements_no_update_delete before update or delete on public.stock_movements
  for each row execute function app.forbid_mutation();
create trigger stock_movements_no_truncate before truncate on public.stock_movements
  for each statement execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Privileges + RLS
-- -----------------------------------------------------------------------------

create function app.is_stock_class()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_any_role('Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Store') $$;
revoke execute on function app.is_stock_class() from public, anon;
grant execute on function app.is_stock_class() to authenticated, service_role;

revoke all on public.products, public.stock_locations, public.materials, public.orders, public.order_lines,
              public.deliveries, public.receipt_lines, public.reservations, public.stock_movements,
              public.stocktakes, public.stocktake_lines, public.panel_use
  from anon, authenticated;
grant select on public.products, public.stock_locations, public.materials, public.orders, public.order_lines,
                public.deliveries, public.receipt_lines, public.reservations, public.stock_movements,
                public.stocktakes, public.stocktake_lines, public.panel_use
  to authenticated;
-- Catalogue + locations are reference data maintained directly.
grant insert, update on public.products, public.stock_locations to authenticated;

alter table public.products        enable row level security;
alter table public.stock_locations enable row level security;
alter table public.materials       enable row level security;
alter table public.orders          enable row level security;
alter table public.order_lines     enable row level security;
alter table public.deliveries      enable row level security;
alter table public.receipt_lines   enable row level security;
alter table public.reservations    enable row level security;
alter table public.stock_movements enable row level security;
alter table public.stocktakes      enable row level security;
alter table public.stocktake_lines enable row level security;
alter table public.panel_use       enable row level security;

create policy products_select on public.products
  for select to authenticated using ((select app.is_active_actor()));
create policy products_insert on public.products
  for insert to authenticated with check ((select app.is_office_manager()));
create policy products_update on public.products
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy stock_locations_select on public.stock_locations
  for select to authenticated using ((select app.is_active_actor()));
create policy stock_locations_insert on public.stock_locations
  for insert to authenticated with check ((select app.is_office_manager()));
create policy stock_locations_update on public.stock_locations
  for update to authenticated
  using ((select app.is_office_manager())) with check ((select app.is_office_manager()));

create policy materials_select on public.materials
  for select to authenticated using ((select app.is_stock_class()));
create policy orders_select on public.orders
  for select to authenticated using ((select app.is_stock_class()));
create policy order_lines_select on public.order_lines
  for select to authenticated using ((select app.is_stock_class()));
create policy deliveries_select on public.deliveries
  for select to authenticated using ((select app.is_stock_class()));
create policy receipt_lines_select on public.receipt_lines
  for select to authenticated using ((select app.is_stock_class()));
create policy reservations_select on public.reservations
  for select to authenticated using ((select app.is_stock_class()));
create policy stock_movements_select on public.stock_movements
  for select to authenticated using ((select app.is_stock_class()));
create policy stocktakes_select on public.stocktakes
  for select to authenticated using ((select app.is_stock_class()));
create policy stocktake_lines_select on public.stocktake_lines
  for select to authenticated using ((select app.is_stock_class()));

-- Installers see the panel reports they made.
create policy panel_use_select on public.panel_use
  for select to authenticated
  using (
    (select app.is_stock_class())
    or ((select app.is_active_actor()) and reported_by = (select app.current_person_id()))
  );
