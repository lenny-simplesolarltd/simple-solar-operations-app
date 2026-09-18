-- =============================================================================
-- Reference-schema port, part 2: form intake and customer detail changes.
--
-- Source: reference schema/tables.json (S02-1.0) - Intake, MappingRules,
-- CustomerChanges. Conventions: see part 1 (20260919100000).
--
-- Writes happen only through server-side command functions; clients get
-- read access at most.
-- =============================================================================

create table public.intake (
  id                uuid primary key default gen_random_uuid(),
  intake_id         text not null unique,
  form_type         text not null check (form_type in ('Sold', 'Booking')),
  -- Plain text: Jotform identifiers.
  form_id           text not null,
  submission_id     text not null,
  source_revision   text,
  received_at       timestamptz not null,
  raw_payload_json  jsonb,
  payload_hash      text,
  -- Set after processing.
  job_id            uuid references public.jobs (id) on delete restrict,
  processing_status text not null default 'Pending'
                    check (processing_status in ('Pending', 'Processed', 'Review', 'Rejected')),
  validation_errors text,
  processed_at      timestamptz,
  retry_count       integer not null default 0 check (retry_count >= 0),
  created_at        timestamptz not null default now(),
  unique (form_id, submission_id)
);
comment on table public.intake is 'Raw Jotform/Zapier submission records.';
create index intake_job_idx on public.intake (job_id) where job_id is not null;
create index intake_status_idx on public.intake (processing_status, received_at);

create table public.mapping_rules (
  id              uuid primary key default gen_random_uuid(),
  form_id         text not null,
  question_id     text not null,
  source_label    text not null,
  target_table    text not null,
  target_field    text not null,
  transform       text,
  required_when   text,
  active          boolean not null default true,
  mapping_version text not null,
  effective_from  date not null,
  owner           text not null,
  disposition     text not null
                  check (disposition in ('Import', 'Transform', 'RetainRaw', 'Retired', 'RequiresDecision')),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.people (id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.people (id),
  version         integer not null default 1 check (version >= 1),
  unique (form_id, question_id, mapping_version)
);
comment on table public.mapping_rules is 'Jotform question-to-field mapping configuration.';

create table public.customer_changes (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.jobs (id) on delete restrict,
  field_name           text not null,
  previous_value       text,
  incoming_value       text,
  source_submission_id text not null,
  resolution           text not null check (resolution in ('Accept', 'Keep', 'Correct')),
  resolved_value       text,
  resolved_at          timestamptz,
  resolved_by          uuid references public.people (id),
  reason               text,
  created_at           timestamptz not null default now()
);
comment on table public.customer_changes is
  'Audit trail of customer detail changes from intake: later identity differences are reviewed, never overwritten.';
create index customer_changes_job_idx on public.customer_changes (job_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger mapping_rules_touch before insert or update on public.mapping_rules
  for each row execute function app.touch_row();

create trigger intake_audit after insert or update or delete on public.intake
  for each row execute function app.audit_row_change();
create trigger mapping_rules_audit after insert or update or delete on public.mapping_rules
  for each row execute function app.audit_row_change();
create trigger customer_changes_audit after insert or update or delete on public.customer_changes
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Privileges + RLS
-- -----------------------------------------------------------------------------

revoke all on public.intake, public.mapping_rules, public.customer_changes from anon, authenticated;
grant select on public.intake, public.mapping_rules, public.customer_changes to authenticated;

alter table public.intake           enable row level security;
alter table public.mapping_rules    enable row level security;
alter table public.customer_changes enable row level security;

create policy intake_select on public.intake
  for select to authenticated using ((select app.is_admin()));
create policy mapping_rules_select on public.mapping_rules
  for select to authenticated using ((select app.is_admin()));
create policy customer_changes_select on public.customer_changes
  for select to authenticated using ((select app.is_office_class()));

