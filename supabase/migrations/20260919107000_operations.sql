-- =============================================================================
-- Reference-schema port, part 8: operational plumbing - commit journal,
-- integration health checks and the archive index.
--
-- Source: reference schema/tables.json (S02-1.0) - CommitJournal, HealthChecks,
-- ArchiveIndex. Conventions: see part 1 (20260919100000).
--
-- =============================================================================

create table public.commit_journal (
  id               uuid primary key default gen_random_uuid(),
  -- The journal is the one table that keeps the reference commit id.
  commit_id        text not null unique,
  state            text not null check (state in ('Prepared', 'Applying', 'Committed', 'RecoveryRequired')),
  command_id       text not null,
  entity_type      text not null,
  entity_id        text not null,
  expected_version integer check (expected_version >= 1),
  changes_json     jsonb not null,
  prepared_at      timestamptz not null,
  committed_at     timestamptz,
  created_at       timestamptz not null default now()
);
comment on table public.commit_journal is 'Write-ahead commit journal for recovery.';
create index commit_journal_command_idx on public.commit_journal (command_id);
create index commit_journal_open_idx on public.commit_journal (state) where state <> 'Committed';

create table public.health_checks (
  id                  uuid primary key default gen_random_uuid(),
  integration         text not null,
  checked_at          timestamptz not null,
  outcome             text not null,
  last_success        timestamptz,
  error_code          text,
  next_action_task_id uuid references public.tasks (id) on delete restrict,
  created_at          timestamptz not null default now()
);
comment on table public.health_checks is 'Integration health monitoring results.';
create index health_checks_integration_idx on public.health_checks (integration, checked_at desc);

create table public.archive_index (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references public.jobs (id) on delete restrict,
  archive_location text not null,
  archived_at      timestamptz not null,
  record_counts    jsonb not null,
  checksum         text not null,
  schema_version   text not null,
  restored_at      timestamptz,
  created_at       timestamptz not null default now()
);
comment on table public.archive_index is 'Archive manifest for archived / restored job records.';
create index archive_index_job_idx on public.archive_index (job_id);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger archive_index_audit after insert or update or delete on public.archive_index
  for each row execute function app.audit_row_change();

create trigger health_checks_no_update_delete before update or delete on public.health_checks
  for each row execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Privileges + RLS: Admin-class read only; written by server-side code.
-- -----------------------------------------------------------------------------

revoke all on public.commit_journal, public.health_checks, public.archive_index from anon, authenticated;
grant select on public.commit_journal, public.health_checks, public.archive_index to authenticated;

alter table public.commit_journal enable row level security;
alter table public.health_checks  enable row level security;
alter table public.archive_index  enable row level security;

create policy commit_journal_select on public.commit_journal
  for select to authenticated using ((select app.is_admin()));
create policy health_checks_select on public.health_checks
  for select to authenticated using ((select app.is_admin()));
create policy archive_index_select on public.archive_index
  for select to authenticated using ((select app.is_admin()));
