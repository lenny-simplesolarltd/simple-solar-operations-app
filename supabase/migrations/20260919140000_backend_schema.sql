-- =============================================================================
-- Backend port: schema additions the R1 backend needs.
--
-- The identity foundation and Job Sold tables are canonical (restored by
-- 20260919120000). As the Job Sold design anticipated ("each arrives with the
-- slice that owns it, as NOT NULL DEFAULT where the reference sets an initial
-- value"), the reference Jobs columns used by the R1 workflow are added here.
-- Column names and vocabularies follow reference schema/tables.json.
--
-- Not added (Job Sold design, "never ported"): pilot_job, release_scope,
-- source_system, source_record_id, commit_id, sold_submission_id (the presale
-- row is the sold document), presale_file_id (Drive).
-- =============================================================================

alter table public.jobs
  add column booking_submission_id        uuid references public.intake (id) on delete restrict,
  add column contract_status              text not null default 'NotSent'
                                          check (contract_status in ('NotSent', 'Sent', 'Signed', 'Cancelled')),
  add column contract_id                  text,
  add column contract_signed_at           timestamptz,
  add column contract_evidence_id         uuid references public.evidence (id) on delete restrict,
  add column approved_change_pence        bigint,
  add column sold_booking_match_status    text not null default 'Pending'
                                          check (sold_booking_match_status in ('Pending', 'Match', 'Review', 'ApprovedDifference')),
  add column customer_details_verified_at timestamptz,
  add column customer_details_verified_by uuid references public.people (id),
  add column deposit_bank_confirmed_at    timestamptz,
  add column deposit_bank_confirmed_by    uuid references public.people (id),
  -- Redacted evidence reference, never bank credentials.
  add column deposit_bank_reference       text,
  add column booking_approved_at          timestamptz,
  add column booking_approved_by          uuid references public.people (id),
  add column operational_complete_at      timestamptz,
  add column operational_complete_by      uuid references public.people (id),
  add column customer_happy_at            timestamptz,
  add column customer_happy_by            uuid references public.people (id),
  add column handover_status              text not null default 'NotReady'
                                          check (handover_status in ('NotReady', 'Ready', 'Generating', 'Review', 'Approved', 'Sent')),
  -- Derived from invoice_stages.
  add column financial_status             text not null default 'Pending',
  add column cancellation_at              timestamptz,
  add column cancellation_by              uuid references public.people (id),
  add column cancellation_reason          text,
  add column archived_at                  timestamptz,
  -- Earliest planned work date (booking intake and moves keep it current).
  add column next_action_at               timestamptz,
  add column account_policy_version       text;

comment on column public.jobs.next_action_at is
  'Earliest planned work date (reference Jobs.next_action_at); drives FIN01, S06-UNPAID-INTERIM and the interim due date.';

-- Task evidence is a real evidence row of the same job.
alter table public.tasks
  add constraint tasks_evidence_id_fkey foreign key (evidence_id) references public.evidence (id) on delete restrict;

-- Scheduled/system work has no human actor: null means "system".
alter table public.task_events alter column actor drop not null;

-- The reference S13/PRE01/PRE03 code writes stage status Pending (at sale)
-- and Confirmed (bank-checked deposit) in addition to the schema list.
alter table public.invoice_stages drop constraint invoice_stages_status_check;
alter table public.invoice_stages add constraint invoice_stages_status_check
  check (status in ('Pending', 'Planned', 'Draft', 'Authorised', 'Sent', 'Confirmed', 'PartPaid', 'Paid', 'Voided', 'Credited'));
-- One stage row per job and stage (reference id IS-{jobId}-{stage}).
create unique index invoice_stages_job_stage_key on public.invoice_stages (job_id, stage)
  where stage in ('Deposit', 'Interim', 'Balance');

-- Manual bank checks record the command that wrote them (reference id
-- MBC-R1A-{command_id}); outcomes as the reference writes them.
alter table public.manual_bank_checks add column command_id text;
alter table public.manual_bank_checks add constraint manual_bank_checks_outcome_check
  check (outcome in ('Confirmed', 'NotReceived', 'AmountMismatch'));

-- One evidence row per (job, stored file) - reference EV-R1A-{job}-{hash(file)}.
create unique index evidence_job_path_key on public.evidence (job_id, storage_path);

-- Logs and ledgers are append-only (app.forbid_mutation is Job Sold's).
create trigger task_events_no_update_delete before update or delete on public.task_events
  for each row execute function app.forbid_mutation();
create trigger issue_events_no_update_delete before update or delete on public.issue_events
  for each row execute function app.forbid_mutation();
create trigger stock_movements_no_update_delete before update or delete on public.stock_movements
  for each row execute function app.forbid_mutation();
create trigger settings_no_update_delete before update or delete on public.settings
  for each row execute function app.forbid_mutation();
create trigger manual_bank_checks_no_update_delete before update or delete on public.manual_bank_checks
  for each row execute function app.forbid_mutation();
create trigger report_snapshots_no_update_delete before update or delete on public.report_snapshots
  for each row execute function app.forbid_mutation();
create trigger health_checks_no_update_delete before update or delete on public.health_checks
  for each row execute function app.forbid_mutation();
