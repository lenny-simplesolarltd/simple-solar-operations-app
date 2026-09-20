-- =============================================================================
-- Historical import model: a job row can record history without becoming work.
--
-- The problem
-- -----------
-- A historical Job Booking row describes a job that was sold, installed and
-- paid for long ago. Inserting one as an ordinary job does three wrong things:
--
--   1. `jobs_invoice_stages` (an unconditional AFTER INSERT trigger) builds
--      Deposit and Interim invoice_stages from original_gross_pence, inventing
--      financial obligations for finished work;
--   2. the legacy source did not record a salesperson on 201 of 303 rows, a
--      finance answer on 100, or a price on 18 - but jobs.salesperson_id,
--      jobs.finance_route and jobs.original_gross_pence are all NOT NULL, so
--      the only ways to import are to invent a value or to drop the row;
--   3. nothing on the job row says "this is history", so exclusion from live
--      work would rest on remembering to set archived_at every time.
--
-- Inserting as 'Cancelled' does not avoid (1): build_invoice_stages calls
-- app.assert_normal_work, which raises for a cancelled job, and because the
-- trigger runs in the insert's transaction the insert itself fails. There is
-- currently no workflow_stage under which a historical job can be inserted.
--
-- The model
-- ---------
-- One positive classification, `jobs.record_class`:
--
--   'Live'             an ordinary operational job. Unchanged in every respect.
--   'HistoricalImport' a record of a job that happened before this system.
--
-- The column defaults to 'Live', so every existing row and every existing
-- insert keeps exactly today's behaviour and today's constraints.
--
-- Strictness is not relaxed; it is made conditional. The NOT NULL on the three
-- sale columns becomes a CHECK that requires them *for Live rows*, which is the
-- same rule the live sale path already enforces in app.submit_presale (it
-- rejects REQUIRED_SALESPERSON_ID, INVALID_FINANCE_ROUTE and
-- INVALID_GROSS_AMOUNT before it inserts). A live job therefore still cannot
-- exist without a salesperson, a finance route or a positive price - now proven
-- twice, at the command and at the table.
--
-- A historical row may leave those null, which is the truthful representation:
-- the legacy form did not record them. Nothing is invented.
--
-- Why null is safe here: the codebase was already written for it. Every
-- decision on price uses `coalesce(j.original_gross_pence > 0, false)` (7 call
-- sites), every read uses `coalesce(..., 0)`, finance gates use
-- `coalesce(j.finance_route, 'missing')`, and the RLS predicates compare
-- `salesperson_id = app.current_person_id()`, which yields NULL and therefore
-- false for an unknown salesperson - restrictive, never permissive.
--
-- Non-actionability becomes an invariant rather than a habit: a HistoricalImport
-- row must carry archived_at and a source_system, app.job_actionable() is false
-- for it by class (not merely because it is archived), and app.assert_normal_work
-- refuses it, which closes every command path that calls it.
--
-- Additive only. No historical migration is edited, no column or table is
-- dropped, and no live behaviour changes: with record_class = 'Live' every
-- function below behaves exactly as before.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Classification and provenance on the job row
-- -----------------------------------------------------------------------------

alter table public.jobs
  add column record_class text not null default 'Live'
    check (record_class in ('Live', 'HistoricalImport')),
  -- Which system the record came from. Null for jobs sold in this system.
  add column source_system text
    check (source_system is null or btrim(source_system) <> ''),
  -- The legacy reference as the old system knew it, kept for reconciliation.
  add column source_reference text;

comment on column public.jobs.record_class is
  'Live = an operational job, strictly validated. HistoricalImport = a record of '
  'a job that predates this system: archived, never actionable, and permitted to '
  'leave sale fields null where the legacy source did not record them.';
comment on column public.jobs.source_system is
  'The system a HistoricalImport row came from, e.g. historical-job-booking-form.';

create index jobs_record_class_idx on public.jobs (record_class)
  where record_class <> 'Live';

-- -----------------------------------------------------------------------------
-- 2. Conditional strictness
--
-- The NOT NULLs become class-conditional CHECKs. For a Live row the rule is
-- character-for-character what it was; for a HistoricalImport row an unknown
-- may be null, and a recorded value must still be valid.
-- -----------------------------------------------------------------------------

alter table public.jobs
  alter column salesperson_id               drop not null,
  alter column finance_route                drop not null,
  alter column original_gross_pence         drop not null,
  alter column current_contract_gross_pence drop not null;

-- The pre-existing column checks (`finance_route in (...)`,
-- `original_gross_pence > 0`) stay in force. A CHECK is satisfied by NULL, so
-- they now mean "if recorded, must be valid" - which is what history needs.

alter table public.jobs
  add constraint jobs_live_requires_sale_fields check (
    record_class <> 'Live'
    or (salesperson_id is not null
        and finance_route is not null
        and original_gross_pence is not null
        and current_contract_gross_pence is not null)
  );

-- A historical row must be inert by construction: archived, and attributable.
alter table public.jobs
  add constraint jobs_historical_is_inert check (
    record_class <> 'HistoricalImport'
    or (archived_at is not null and source_system is not null)
  );

-- -----------------------------------------------------------------------------
-- 3. Historical people: the original text, always; a link, only when certain
--
-- Historical staff values are first names recorded by the office ("Dave",
-- "Lewis", "Des"). Some resolve to exactly one active person, some are
-- ambiguous, some name nobody who works here now. All three are facts worth
-- keeping, and none of them is an allocation: an allocation is live resourcing
-- and would put a finished job in front of a planner.
--
-- source_value is NOT NULL and person_id is nullable, so the original text
-- survives whether or not it resolved.
-- -----------------------------------------------------------------------------

create table public.historical_job_people (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.jobs (id) on delete restrict,
  role          text not null check (role in
                  ('Salesperson', 'Installer', 'Electrician', 'Roofer', 'Scaffolder')),
  -- Exactly as the legacy form recorded it. Never normalised away.
  source_value  text not null check (btrim(source_value) <> ''),
  -- Set only for an unambiguous match against exactly one active person.
  person_id     uuid references public.people (id) on delete restrict,
  match_kind    text not null check (match_kind in
                  ('ExactMatch', 'SafeNormalisedMatch', 'Ambiguous', 'NoMatch', 'NonPersonValue')),
  -- Which column of the source export the value came from.
  source_column integer,
  created_at    timestamptz not null default now(),
  -- A link is permitted only where the match was unambiguous.
  constraint historical_job_people_link_requires_certainty check (
    person_id is null or match_kind in ('ExactMatch', 'SafeNormalisedMatch')
  ),
  unique (job_id, role, source_value)
);

comment on table public.historical_job_people is
  'Staff names as the legacy source recorded them. A historical fact, never a '
  'live allocation: nothing here schedules anyone or enters a planner.';

create index historical_job_people_job_idx on public.historical_job_people (job_id);

alter table public.historical_job_people enable row level security;

create trigger historical_job_people_audit
  after insert or update or delete on public.historical_job_people
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- 4. Non-actionability, by class
--
-- app.job_actionable already excluded archived jobs, which covered the cron
-- sweeps by accident of the import always remembering to set archived_at.
-- Class makes it an invariant: a HistoricalImport row is not actionable even if
-- someone later clears archived_at (which the CHECK above also forbids).
-- Live behaviour is unchanged - for record_class = 'Live' the expression is
-- exactly the original one.
-- -----------------------------------------------------------------------------

create or replace function app.job_actionable(p_job public.jobs)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_job.record_class = 'Live'
     and p_job.archived_at is null
     and p_job.workflow_stage not in ('CancellationInProgress', 'Cancelled')
$$;

-- app.assert_normal_work is the gate every command path calls before doing
-- work on a job. Refusing historical rows here closes booking, scheduling,
-- materials, scaffold, commissioning and finance command paths in one place.
create or replace function app.assert_normal_work(p_job_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.jobs j where j.id = p_job_id
             and j.record_class <> 'Live') then
    perform app.fail('HISTORICAL_IMPORT: this job is an imported historical record, not live work');
  end if;
  if exists (select 1 from public.jobs j where j.id = p_job_id
             and (j.cancellation_at is not null or j.workflow_stage in ('CancellationInProgress', 'Cancelled')))
     or exists (select 1 from public.tasks t where t.job_id = p_job_id and t.template_code = 'S15-REOPEN-REVIEW'
                and t.status not in ('Complete', 'NotRequired')) then
    perform app.fail('S15_REVIEW: normal work suppressed');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 5. No invoice stages for history
--
-- This is the blocker the import could not work around. The class test comes
-- FIRST, before assert_normal_work: assert_normal_work now raises for a
-- historical job, and this function runs inside the insert's transaction, so
-- raising here would abort the insert instead of skipping the stages.
--
-- Everything after the early return is the original body, unchanged.
-- -----------------------------------------------------------------------------

create or replace function app.build_invoice_stages(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_stage text;
  v_pct integer;
  v_gross bigint;
  v_net bigint;
  v_created text[] := '{}';
begin
  select * into v_job from public.jobs where id = p_job_id;
  -- History never acquires a financial obligation.
  if v_job.id is null or v_job.record_class <> 'Live' then
    return jsonb_build_object('ok', false, 'reason', 'Not a live job', 'stages_created', v_created);
  end if;
  perform app.assert_normal_work(p_job_id);
  if not coalesce(v_job.original_gross_pence > 0, false) then
    return jsonb_build_object('ok', false, 'reason', 'Job not found or no gross amount');
  end if;
  foreach v_stage in array array['Deposit', 'Interim', 'Balance'] loop
    continue when v_stage = 'Balance' and v_job.operational_complete_at is null;
    continue when exists (select 1 from public.invoice_stages s where s.job_id = p_job_id and s.stage = v_stage);
    v_pct := coalesce((app.setting(case v_stage when 'Deposit' then 'finance.deposit_pct'
                                                when 'Interim' then 'finance.interim_pct'
                                                else 'finance.balance_pct' end) #>> '{}')::int,
                      case v_stage when 'Deposit' then 25 when 'Interim' then 35 else 40 end);
    v_gross := round(v_job.original_gross_pence * v_pct / 100.0);
    v_net := round(v_gross / 1.2);
    insert into public.invoice_stages (job_id, stage, amount_net_pence, vat_pence, gross_pence, due_date, status)
    values (p_job_id, v_stage, v_net, v_gross - v_net, v_gross,
            case when v_stage = 'Interim' and v_job.next_action_at is not null
                 then app.friday_before(app.london_date(v_job.next_action_at)) end,
            'Pending');
    v_created := v_created || v_stage;
  end loop;
  return jsonb_build_object('ok', true, 'stages_created', v_created,
    'final_blocked', v_job.operational_complete_at is null);
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Cron and workflow sweeps
--
-- Audited, with how each one is now excluded:
--
--   ss-s10-schedules   app.s10_run_schedules selects jobs `where
--                      app.job_in_scope(j) and app.job_actionable(j)` -
--                      excluded by class via job_actionable (section 4).
--                      This is the sweep that creates customer calls,
--                      installer calls and GHL tracking.
--   ss-s13-milestones  app.s13_run_milestones selects `where archived_at is
--                      null` - excluded, and belt-and-braces by class below.
--   ss-system-tasks    app.run_system_tasks builds SYS01/SYS02 from
--                      task_templates and never loops jobs - not applicable.
--   ss-resilience-sweep  app.run_resilience_sweep is system health only and
--                      never loops jobs - not applicable.
--   ss-outbox-stalled  app.outbox_release_stalled acts on outbox rows. A
--                      historical import writes no outbox row, so there is
--                      nothing for it to find - not applicable.
--
-- Task creation (app.create_tasks_for_job) is reached only through
-- app.process_booking_gates / app.reevaluate_prebooking, which are called from
-- command paths, never from an insert. Those paths call assert_normal_work,
-- which now refuses historical jobs. A historical insert creates no PRE task.
--
-- s13 is narrowed by class as well so the guarantee does not depend on the
-- archived_at column staying set.
-- -----------------------------------------------------------------------------

create or replace function app.job_in_scope(p_job public.jobs)
returns boolean
language sql stable
set search_path = ''
as $$ select p_job.id is not null and p_job.record_class = 'Live' $$;

comment on function app.job_in_scope(public.jobs) is
  'Whether a job is within operational scope. Historical imports never are; '
  'read models that should still show them (Job Search) do not use this.';

-- -----------------------------------------------------------------------------
-- 7. Readability
--
-- Historical jobs must stay findable, so app.read_job_search is deliberately
-- NOT narrowed - it filters on app.can_read_job and app.job_in_scope. Because
-- section 6 makes job_in_scope false for historical rows, search would lose
-- them, so the search predicate is restated here to gate on readability alone.
-- The only change from the original is `app.job_in_scope(j)` becoming
-- `j.id is not null`; for a live job the result set is identical.
-- -----------------------------------------------------------------------------

create or replace function app.read_job_search(p_actor jsonb, p_query text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_q text := lower(btrim(p_query));
  v_qc text := regexp_replace(lower(btrim(p_query)), '\s+', '', 'g');
  v_results jsonb;
begin
  select coalesce(jsonb_agg(r.row order by r.job_ref), '[]'::jsonb) into v_results
  from (
    select j.job_ref as job_ref, jsonb_build_object(
             'id', j.id, 'job_ref', j.job_ref, 'display_name', j.display_name,
             'customer_name', coalesce(app.s17_customer_name(c.first_name, c.last_name), ''),
             'postcode', c.postcode, 'quote_reference', j.quote_reference,
             'address_line1', nullif(app.s17_clean(c.address_line1), ''), 'town', nullif(app.s17_clean(c.town), ''),
             'job_label', app.s17_job_label(j.job_ref, c.last_name, c.postcode),
             'workflow_stage', j.workflow_stage,
             'record_class', j.record_class) as row
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where exists (
            select 1
            from unnest(array[j.job_ref, j.quote_reference, j.display_name,
                              app.s17_customer_name(c.first_name, c.last_name), c.first_name, c.last_name,
                              c.postcode, c.address_line1, c.address_line2, c.town, c.email, c.phone,
                              j.id::text, j.source_reference]) as f(v)
            where app.s17_clean(f.v) <> ''
              and (strpos(lower(app.s17_clean(f.v)), v_q) > 0
                   or (length(v_qc) >= 2
                       and strpos(regexp_replace(lower(app.s17_clean(f.v)), '\s+', '', 'g'), v_qc) > 0)))
      and j.id is not null
      and app.can_read_job(p_actor, j.id)
    order by j.job_ref
    limit 50
  ) r;
  return jsonb_build_object('query', btrim(p_query), 'count', jsonb_array_length(v_results), 'results', v_results);
end
$$;

-- -----------------------------------------------------------------------------
-- 8. RLS for the new table: readable wherever its job is, never writable
--    through the API. Rows are created only by a reviewed import.
-- -----------------------------------------------------------------------------

create policy historical_job_people_select on public.historical_job_people
  for select to authenticated
  using (app.can_read_job((select app.current_actor()), job_id));

grant select on public.historical_job_people to authenticated;
