-- =============================================================================
-- Reference-schema port, part 3: work packages, allocations, task history,
-- calls and issues.
--
-- Source: reference schema/tables.json (S02-1.0) - WorkPackages, Allocations,
-- TaskDependencies, TaskEvents, Calls, Issues, IssueEvents.
-- Conventions: see part 1 (20260919100000).
--
-- Added later: allocations.calendar_link_id FK (part 5), issue_events.evidence_id
-- FK (part 6).
-- =============================================================================

create table public.work_packages (
  id                        uuid primary key default gen_random_uuid(),
  job_id                    uuid not null references public.jobs (id) on delete restrict,
  trade                     text not null check (trade in ('Roof', 'Electrical', 'ReturnVisit', 'Other')),
  required                  boolean not null,
  planned_start             date,
  planned_end               date,
  actual_start              date,
  actual_end                date,
  status                    text not null default 'Unscheduled'
                            check (status in ('Unscheduled', 'Scheduled', 'InProgress', 'ReportedComplete',
                                              'ConfirmedComplete', 'ReturnRequired', 'Cancelled')),
  need_by_date              date,
  completion_outcome        text,
  installer_confirmation_at timestamptz,
  installer_confirmation_by uuid references public.people (id),
  commissioning_required    boolean not null,
  sequence                  integer not null,
  revision                  integer not null default 1 check (revision >= 1),
  -- Set for return visits.
  parent_package_id         uuid references public.work_packages (id) on delete restrict,
  created_at                timestamptz not null default now(),
  created_by                uuid references public.people (id),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.people (id),
  version                   integer not null default 1 check (version >= 1),
  constraint work_packages_planned_window check (planned_start is null or planned_end is null or planned_start <= planned_end),
  constraint work_packages_actual_window check (actual_start is null or actual_end is null or actual_start <= actual_end)
);
comment on table public.work_packages is 'Per-trade work scheduling within a job.';
create index work_packages_job_idx on public.work_packages (job_id);
create index work_packages_parent_idx on public.work_packages (parent_package_id) where parent_package_id is not null;

create table public.allocations (
  id                     uuid primary key default gen_random_uuid(),
  work_package_id        uuid not null references public.work_packages (id) on delete restrict,
  person_id              uuid not null references public.people (id) on delete restrict,
  role                   text not null check (role in ('Lead', 'Second', 'Support')),
  -- Dates (the reference column names are kept).
  start_at               date,
  end_at                 date,
  active                 boolean not null default true,
  replaced_allocation_id uuid references public.allocations (id) on delete restrict,
  cancellation_reason    text,
  calendar_link_id       uuid, -- FK calendar_links (part 5)
  created_at             timestamptz not null default now(),
  created_by             uuid references public.people (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.people (id),
  version                integer not null default 1 check (version >= 1),
  constraint allocations_window check (start_at is null or end_at is null or start_at <= end_at)
);
comment on table public.allocations is 'Installer assignment to work packages.';
create index allocations_work_package_idx on public.allocations (work_package_id);
create index allocations_person_idx on public.allocations (person_id, start_at) where active;

create table public.task_dependencies (
  id                   uuid primary key default gen_random_uuid(),
  task_id              uuid not null references public.tasks (id) on delete restrict,
  prerequisite_task_id uuid references public.tasks (id) on delete restrict, -- null for a named gate
  named_gate           text,
  satisfied_at         timestamptz,
  created_at           timestamptz not null default now(),
  constraint task_dependencies_target check ((prerequisite_task_id is null) <> (named_gate is null))
);
comment on table public.task_dependencies is
  'Prerequisite relationships between tasks: either another task or a named gate, never both.';
create index task_dependencies_task_idx on public.task_dependencies (task_id);
create index task_dependencies_prerequisite_idx on public.task_dependencies (prerequisite_task_id)
  where prerequisite_task_id is not null;

create table public.task_events (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete restrict,
  action      text not null,
  old_status  text,
  new_status  text,
  old_owner   uuid references public.people (id),
  new_owner   uuid references public.people (id),
  old_due     timestamptz,
  new_due     timestamptz,
  reason      text,
  actor       uuid not null references public.people (id),
  -- Reference column "timestamp".
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now()
);
comment on table public.task_events is 'Immutable task history log.';
create index task_events_task_idx on public.task_events (task_id, occurred_at);

create table public.calls (
  id                          uuid primary key default gen_random_uuid(),
  job_id                      uuid not null references public.jobs (id) on delete restrict,
  work_package_id             uuid references public.work_packages (id) on delete restrict,
  task_id                     uuid not null references public.tasks (id) on delete restrict,
  type                        text not null check (type in ('Installer', 'Customer', 'Payment', 'Supplier')),
  contact_id                  uuid references public.contacts (id) on delete restrict,
  person_id                   uuid references public.people (id),
  attempted_at                timestamptz not null,
  attempted_by                uuid not null references public.people (id),
  outcome                     text not null
                              check (outcome in ('NoAnswer', 'Complete', 'ReturnRequired', 'Unhappy', 'Confirmed', 'Other')),
  notes                       text,
  next_attempt_at             timestamptz,
  actual_completion_confirmed boolean not null default false,
  customer_happy              boolean,
  strip_authorised            boolean,
  created_at                  timestamptz not null default now()
);
comment on table public.calls is 'Phone call records linked to jobs/packages.';
create index calls_job_idx on public.calls (job_id, attempted_at);
create index calls_task_idx on public.calls (task_id);

create table public.issues (
  id                            uuid primary key default gen_random_uuid(),
  job_id                        uuid not null references public.jobs (id) on delete restrict,
  work_package_id               uuid references public.work_packages (id) on delete restrict,
  type                          text not null check (type in ('Variation', 'Remedial', 'Complaint')),
  category                      text not null,
  description                   text not null check (btrim(description) <> ''),
  raised_at                     timestamptz not null,
  raised_by                     uuid not null references public.people (id),
  responsible_person_id         uuid references public.people (id),
  responsible_company_id        uuid references public.companies (id) on delete restrict,
  -- Reference default: the VariationApprover (Tanya); resolved by the command, not here.
  office_owner_id               uuid not null references public.people (id),
  severity                      text not null,
  status                        text not null default 'Open'
                                check (status in ('Open', 'Acknowledged', 'InProgress', 'AwaitingCustomer',
                                                  'AwaitingSupplier', 'Resolved', 'Closed')),
  due_at                        timestamptz,
  next_followup_at              timestamptz,
  blocks_completion             boolean not null default false,
  blocks_strip                  boolean not null default false,
  estimated_value_pence         bigint,
  approved_value_pence          bigint,
  approval_status               text not null,
  approved_at                   timestamptz,
  approved_by                   uuid references public.people (id),
  resolution                    text,
  resolved_at                   timestamptz,
  closed_at                     timestamptz,
  closed_by                     uuid references public.people (id),
  customer_resolution_confirmed boolean,
  linked_return_package_id      uuid references public.work_packages (id) on delete restrict,
  evidence_folder_id            text,
  created_at                    timestamptz not null default now(),
  created_by                    uuid references public.people (id),
  updated_at                    timestamptz not null default now(),
  updated_by                    uuid references public.people (id),
  version                       integer not null default 1 check (version >= 1)
);
comment on table public.issues is 'Variations, remedials and complaints.';
create index issues_job_idx on public.issues (job_id);
create index issues_open_idx on public.issues (office_owner_id, next_followup_at) where status not in ('Resolved', 'Closed');

create table public.issue_events (
  id              uuid primary key default gen_random_uuid(),
  issue_id        uuid not null references public.issues (id) on delete restrict,
  event_type      text not null,
  actor           uuid not null references public.people (id),
  -- Reference column "timestamp".
  occurred_at     timestamptz not null,
  note            text,
  previous_status text,
  new_status      text,
  evidence_id     uuid, -- FK evidence (part 6)
  created_at      timestamptz not null default now()
);
comment on table public.issue_events is 'Immutable issue history log.';
create index issue_events_issue_idx on public.issue_events (issue_id, occurred_at);

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger work_packages_touch before insert or update on public.work_packages
  for each row execute function app.touch_row();
create trigger allocations_touch before insert or update on public.allocations
  for each row execute function app.touch_row();
create trigger issues_touch before insert or update on public.issues
  for each row execute function app.touch_row();

create trigger work_packages_audit after insert or update or delete on public.work_packages
  for each row execute function app.audit_row_change();
create trigger allocations_audit after insert or update or delete on public.allocations
  for each row execute function app.audit_row_change();
create trigger task_dependencies_audit after insert or update or delete on public.task_dependencies
  for each row execute function app.audit_row_change();
create trigger calls_audit after insert or update or delete on public.calls
  for each row execute function app.audit_row_change();
create trigger issues_audit after insert or update or delete on public.issues
  for each row execute function app.audit_row_change();

-- History logs are append-only.
create trigger task_events_no_update_delete before update or delete on public.task_events
  for each row execute function app.forbid_mutation();
create trigger task_events_no_truncate before truncate on public.task_events
  for each statement execute function app.forbid_mutation();
create trigger issue_events_no_update_delete before update or delete on public.issue_events
  for each row execute function app.forbid_mutation();
create trigger issue_events_no_truncate before truncate on public.issue_events
  for each statement execute function app.forbid_mutation();

-- -----------------------------------------------------------------------------
-- Privileges + RLS: read-only to clients; writes go through command functions.
-- -----------------------------------------------------------------------------

revoke all on public.work_packages, public.allocations, public.task_dependencies, public.task_events,
              public.calls, public.issues, public.issue_events
  from anon, authenticated;
grant select on public.work_packages, public.allocations, public.task_dependencies, public.task_events,
                public.calls, public.issues, public.issue_events
  to authenticated;

alter table public.work_packages     enable row level security;
alter table public.allocations       enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_events       enable row level security;
alter table public.calls             enable row level security;
alter table public.issues            enable row level security;
alter table public.issue_events      enable row level security;

-- An installer sees the packages they hold an active allocation on (reference
-- installer scope); office-class see all.
create function app.holds_active_allocation(p_work_package_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.allocations a
    where a.work_package_id = p_work_package_id
      and a.person_id = app.current_person_id()
      and a.active
  )
$$;
revoke execute on function app.holds_active_allocation(uuid) from public, anon;
grant execute on function app.holds_active_allocation(uuid) to authenticated, service_role;

create policy work_packages_select on public.work_packages
  for select to authenticated
  using ((select app.is_office_class()) or app.holds_active_allocation(id));

create policy allocations_select on public.allocations
  for select to authenticated
  using (
    ((select app.is_active_actor()) and person_id = (select app.current_person_id()))
    or (select app.is_office_class())
  );

create policy task_dependencies_select on public.task_dependencies
  for select to authenticated using ((select app.is_office_class()));
create policy task_events_select on public.task_events
  for select to authenticated using ((select app.is_office_class()));
create policy calls_select on public.calls
  for select to authenticated using ((select app.is_office_class()));
create policy issues_select on public.issues
  for select to authenticated using ((select app.is_office_class()));
create policy issue_events_select on public.issue_events
  for select to authenticated using ((select app.is_office_class()));
