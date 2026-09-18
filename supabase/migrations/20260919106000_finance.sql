-- =============================================================================
-- Reference-schema port, part 7: finance plans, invoicing, payments,
-- accounting, job costs, CRM tasks and report snapshots.
--
-- Source: reference schema/tables.json (S02-1.0) - FinancePlans, InvoiceStages,
-- Payments, ManualBankChecks, AccountingEvents, JobCosts, GHLTasks,
-- ReportSnapshots. Conventions: see part 1 (20260919100000).
--
-- Money is integer pence (bigint). NOT_CONFIGURED placeholders from the
-- reference become nullable columns.
-- =============================================================================

create table public.finance_plans (
  id                          uuid primary key default gen_random_uuid(),
  job_id                      uuid not null unique references public.jobs (id) on delete restrict,
  route                       text not null check (route in ('Standard', 'Phoenix')),
  agreed_gross_pence          bigint not null check (agreed_gross_pence > 0),
  currency                    text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  policy_version              text not null,
  vat_basis                   text not null,
  deposit_pct                 integer not null default 25 check (deposit_pct between 0 and 100),
  interim_pct                 integer not null default 35 check (interim_pct between 0 and 100),
  balance_pct                 integer not null default 40 check (balance_pct between 0 and 100),
  first_installation_date     date,
  interim_due_date            date,
  operational_earned_date     date,
  accounting_recognition_date date,
  finance_agreement_status    text not null,
  finance_provider_id         uuid references public.companies (id) on delete restrict,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references public.people (id),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.people (id),
  version                     integer not null default 1 check (version >= 1),
  constraint finance_plans_split_total check (deposit_pct + interim_pct + balance_pct = 100)
);
comment on table public.finance_plans is 'Per-job finance configuration and stage tracking (reference split 25/35/40).';

create table public.invoice_stages (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete restrict,
  stage            text not null
                   check (stage in ('Deposit', 'Interim', 'Balance', 'Variation', 'Finance', 'RefundReview')),
  amount_net_pence bigint not null,
  vat_pence        bigint not null,
  gross_pence      bigint not null,
  due_date         date,
  status           text not null default 'Planned'
                   check (status in ('Planned', 'Draft', 'Authorised', 'Sent', 'PartPaid', 'Paid', 'Voided', 'Credited')),
  -- Plain text: Xero identifiers; reference includes the Job ID.
  xero_invoice_id  text,
  invoice_number   text,
  xero_contact_id  text,
  reference        text,
  request_id       text,
  last_synced_at   timestamptz,
  source_status    text,
  sent_at          timestamptz,
  cancelled_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.people (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.people (id),
  version          integer not null default 1 check (version >= 1),
  constraint invoice_stages_gross_total check (gross_pence = amount_net_pence + vat_pence)
);
comment on table public.invoice_stages is 'Per-stage invoice tracking (deposit / interim / balance etc.).';
create index invoice_stages_job_idx on public.invoice_stages (job_id);
create unique index invoice_stages_xero_invoice_key on public.invoice_stages (xero_invoice_id)
  where xero_invoice_id is not null;

create table public.payments (
  id                      uuid primary key default gen_random_uuid(),
  invoice_stage_id        uuid not null references public.invoice_stages (id) on delete restrict,
  xero_payment_id         text,
  amount_pence            bigint not null,
  payment_date            date not null,
  status                  text not null check (status in ('Reported', 'Reconciled', 'Reversed')),
  reconciliation_evidence text,
  last_synced_at          timestamptz,
  created_at              timestamptz not null default now()
);
comment on table public.payments is 'Payment records reconciled against invoice stages.';
create index payments_invoice_stage_idx on public.payments (invoice_stage_id);
create unique index payments_xero_payment_key on public.payments (xero_payment_id) where xero_payment_id is not null;

create table public.manual_bank_checks (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  stage              text not null,
  checked_at         timestamptz not null,
  checked_by         uuid not null references public.people (id),
  amount_pence       bigint not null,
  outcome            text not null,
  -- Redacted reference only - never bank credentials.
  evidence_reference text,
  created_at         timestamptz not null default now()
);
comment on table public.manual_bank_checks is 'Independent bank deposit confirmations (Director / Admin-class).';
create index manual_bank_checks_job_idx on public.manual_bank_checks (job_id);

create table public.accounting_events (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  policy_version     text not null,
  event_type         text not null,
  effective_date     date not null,
  net_amount_pence   bigint not null,
  -- Null until supplied by the accountant (reference: NOT_CONFIGURED).
  debit_account      text,
  credit_account     text,
  xero_journal_id    text,
  status             text not null default 'Proposed' check (status in ('Proposed', 'Reviewed', 'Posted', 'Reversed')),
  reviewed_by        uuid references public.people (id),
  reviewed_at        timestamptz,
  source_invoice_ids uuid[],
  created_at         timestamptz not null default now(),
  created_by         uuid references public.people (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.people (id),
  version            integer not null default 1 check (version >= 1),
  constraint accounting_events_posted_has_accounts check (
    status not in ('Posted', 'Reversed') or (debit_account is not null and credit_account is not null)
  )
);
comment on table public.accounting_events is 'Proposed/posted accounting journal entries.';
create index accounting_events_job_idx on public.accounting_events (job_id);

create table public.job_costs (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  category           text not null,
  supplier_id        uuid references public.companies (id) on delete restrict,
  source_document_id text,
  amount_net_pence   bigint not null,
  vat_pence          bigint not null default 0,
  status             text not null check (status in ('Estimated', 'Committed', 'Actual', 'Accrued')),
  accounting_date    date,
  policy_version     text not null,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.people (id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.people (id),
  version            integer not null default 1 check (version >= 1)
);
comment on table public.job_costs is 'Job-level cost tracking.';
create index job_costs_job_idx on public.job_costs (job_id);

create table public.ghl_tasks (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  task_id            uuid not null references public.tasks (id) on delete restrict,
  -- GoHighLevel identifiers; null until configured (reference: NOT_CONFIGURED).
  opportunity_id     text,
  target_pipeline_id text,
  target_stage_id    text,
  template_id        text,
  readiness_snapshot text,
  completed_at       timestamptz,
  completed_by       uuid references public.people (id),
  evidence_reference text,
  created_at         timestamptz not null default now()
);
comment on table public.ghl_tasks is 'GoHighLevel CRM task tracking.';
create index ghl_tasks_job_idx on public.ghl_tasks (job_id);
create index ghl_tasks_task_idx on public.ghl_tasks (task_id);

create table public.report_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  period_start       date not null,
  period_end         date not null,
  as_of_at           timestamptz not null,
  policy_version     text not null,
  report_type        text not null,
  totals_json        jsonb not null,
  underlying_job_ids uuid[] not null,
  file_id            text,
  -- Null when generated by a scheduled job rather than a person.
  generated_by       uuid references public.people (id),
  created_at         timestamptz not null default now(),
  constraint report_snapshots_period check (period_start <= period_end)
);
comment on table public.report_snapshots is 'Frozen periodic report data. Rows are immutable.';
create index report_snapshots_period_idx on public.report_snapshots (report_type, period_start);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger finance_plans_touch before insert or update on public.finance_plans
  for each row execute function app.touch_row();
create trigger invoice_stages_touch before insert or update on public.invoice_stages
  for each row execute function app.touch_row();
create trigger accounting_events_touch before insert or update on public.accounting_events
  for each row execute function app.touch_row();
create trigger job_costs_touch before insert or update on public.job_costs
  for each row execute function app.touch_row();

create trigger finance_plans_audit after insert or update or delete on public.finance_plans
  for each row execute function app.audit_row_change();
create trigger invoice_stages_audit after insert or update or delete on public.invoice_stages
  for each row execute function app.audit_row_change();
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function app.audit_row_change();
create trigger manual_bank_checks_audit after insert or update or delete on public.manual_bank_checks
  for each row execute function app.audit_row_change();
create trigger accounting_events_audit after insert or update or delete on public.accounting_events
  for each row execute function app.audit_row_change();
create trigger job_costs_audit after insert or update or delete on public.job_costs
  for each row execute function app.audit_row_change();
create trigger ghl_tasks_audit after insert or update or delete on public.ghl_tasks
  for each row execute function app.audit_row_change();
create trigger report_snapshots_audit after insert on public.report_snapshots
  for each row execute function app.audit_row_change();

-- Bank confirmations and frozen reports are append-only.
create trigger manual_bank_checks_no_update_delete before update or delete on public.manual_bank_checks
  for each row execute function app.forbid_mutation();
create trigger report_snapshots_no_update_delete before update or delete on public.report_snapshots
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Privileges + RLS: read-only to clients; writes go through command functions
-- and integration workers (service role).
-- -----------------------------------------------------------------------------

create function app.is_finance_class()
returns boolean
language sql stable security definer set search_path = ''
as $$ select app.has_any_role('Admin', 'Manager', 'Director', 'Office', 'Finance') $$;
revoke execute on function app.is_finance_class() from public, anon;
grant execute on function app.is_finance_class() to authenticated, service_role;

revoke all on public.finance_plans, public.invoice_stages, public.payments, public.manual_bank_checks,
              public.accounting_events, public.job_costs, public.ghl_tasks, public.report_snapshots
  from anon, authenticated;
grant select on public.finance_plans, public.invoice_stages, public.payments, public.manual_bank_checks,
                public.accounting_events, public.job_costs, public.ghl_tasks, public.report_snapshots
  to authenticated;

alter table public.finance_plans      enable row level security;
alter table public.invoice_stages     enable row level security;
alter table public.payments           enable row level security;
alter table public.manual_bank_checks enable row level security;
alter table public.accounting_events  enable row level security;
alter table public.job_costs          enable row level security;
alter table public.ghl_tasks          enable row level security;
alter table public.report_snapshots   enable row level security;

create policy finance_plans_select on public.finance_plans
  for select to authenticated using ((select app.is_finance_class()));
create policy invoice_stages_select on public.invoice_stages
  for select to authenticated using ((select app.is_finance_class()));
create policy payments_select on public.payments
  for select to authenticated using ((select app.is_finance_class()));
create policy manual_bank_checks_select on public.manual_bank_checks
  for select to authenticated using ((select app.is_director_class()));
create policy accounting_events_select on public.accounting_events
  for select to authenticated using ((select app.has_any_role('Admin', 'Manager', 'Director', 'Finance')));
create policy job_costs_select on public.job_costs
  for select to authenticated using ((select app.has_any_role('Admin', 'Manager', 'Director', 'Finance')));
create policy ghl_tasks_select on public.ghl_tasks
  for select to authenticated using ((select app.is_office_class()));
create policy report_snapshots_select on public.report_snapshots
  for select to authenticated using ((select app.has_any_role('Admin', 'Manager', 'Director', 'Finance')));
<<<<<<< HEAD
=======

>>>>>>> main
