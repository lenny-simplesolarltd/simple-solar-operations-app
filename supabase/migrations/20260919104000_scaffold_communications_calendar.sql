-- =============================================================================
-- Reference-schema port, part 5: scaffold bookings, outbound communications,
-- the outbox and calendar links.
--
-- Source: reference schema/tables.json (S02-1.0) - ScaffoldBookings, Outbox,
-- Communications, CommunicationJobs, Acknowledgements, CalendarLinks.
-- Conventions: see part 1 (20260919100000).
--
-- Also closes forward references from earlier parts: orders.sent_message_id,
-- allocations.calendar_link_id. Added later: acknowledgements.evidence_id FK
-- (part 6).
-- =============================================================================

create table public.scaffold_bookings (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs (id) on delete restrict,
  company_id          uuid not null references public.companies (id) on delete restrict,
  erect_planned_at    date,
  erect_confirmed_at  timestamptz,
  erect_actual_at     date,
  strip_forecast_at   date,
  strip_authorised_at timestamptz,
  strip_authorised_by uuid references public.people (id),
  strip_planned_at    date,
  strip_confirmed_at  timestamptz,
  strip_actual_at     date,
  status              text not null,
  revision            integer not null default 1 check (revision >= 1),
  confirmed_revision  integer check (confirmed_revision >= 1),
  access_notes        text,
  scope_file_id       text,
  quoted_cost_pence   bigint check (quoted_cost_pence >= 0),
  actual_cost_pence   bigint check (actual_cost_pence >= 0),
  invoice_reference   text,
  related_issue_ids   uuid[],
  created_at          timestamptz not null default now(),
  created_by          uuid references public.people (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.people (id),
  version             integer not null default 1 check (version >= 1)
);
comment on table public.scaffold_bookings is 'Scaffold erect/strip bookings per job. *_at date columns keep the reference names.';
create index scaffold_bookings_job_idx on public.scaffold_bookings (job_id);
create index scaffold_bookings_company_idx on public.scaffold_bookings (company_id);

create table public.outbox (
  id               uuid primary key default gen_random_uuid(),
  idempotency_key  text not null unique,
  action_type      text not null,
  target           text not null,
  payload_hash     text not null,
  job_revision     integer,
  attempt_count    integer not null default 0 check (attempt_count >= 0),
  next_attempt     timestamptz,
  external_id      text,
  response_summary text,
  correlation_id   text,
  status           text not null default 'Pending'
                   check (status in ('Pending', 'Processing', 'Succeeded', 'RetryDue', 'NeedsReview', 'Cancelled')),
  created_at       timestamptz not null default now()
);
comment on table public.outbox is 'Outbound message queue with retry tracking.';
create index outbox_due_idx on public.outbox (next_attempt) where status in ('Pending', 'RetryDue');

create table public.communications (
  id                  uuid primary key default gen_random_uuid(),
  -- Null for grouped lists (see communication_jobs).
  job_id              uuid references public.jobs (id) on delete restrict,
  company_id          uuid references public.companies (id) on delete restrict,
  type                text not null,
  subject             text not null,
  body_snapshot       text,
  attachment_ids      text[],
  recipients_snapshot text not null,
  covered_week_start  date,
  delivery_date       date,
  revision            integer not null default 1 check (revision >= 1),
  status              text not null default 'Draft'
                      check (status in ('Draft', 'Approved', 'Queued', 'Sent', 'Uncertain', 'Failed')),
  approved_at         timestamptz,
  approved_by         uuid references public.people (id),
  sent_at             timestamptz,
  external_message_id text,
  outbox_id           uuid references public.outbox (id) on delete restrict,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.people (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.people (id),
  version             integer not null default 1 check (version >= 1)
);
comment on table public.communications is 'Outbound messages (email, calendar invites, lists).';
create index communications_job_idx on public.communications (job_id) where job_id is not null;
create index communications_company_idx on public.communications (company_id) where company_id is not null;

create table public.communication_jobs (
  id                  uuid primary key default gen_random_uuid(),
  communication_id    uuid not null references public.communications (id) on delete restrict,
  job_id              uuid not null references public.jobs (id) on delete restrict,
  order_id            uuid references public.orders (id) on delete restrict,
  scaffold_booking_id uuid references public.scaffold_bookings (id) on delete restrict,
  entity_revision     integer not null check (entity_revision >= 1),
  created_at          timestamptz not null default now()
);
comment on table public.communication_jobs is 'Join: communications covering multiple jobs.';
create index communication_jobs_communication_idx on public.communication_jobs (communication_id);
create index communication_jobs_job_idx on public.communication_jobs (job_id);

create table public.acknowledgements (
  id                    uuid primary key default gen_random_uuid(),
  communication_id      uuid not null references public.communications (id) on delete restrict,
  company_id            uuid not null references public.companies (id) on delete restrict,
  -- The acknowledged entity (order, scaffold booking, ...); polymorphic, so no FK.
  entity_id             uuid not null,
  acknowledged_revision integer not null check (acknowledged_revision >= 1),
  response              text not null check (response in ('Confirmed', 'ChangesNeeded', 'Unable')),
  response_text         text,
  received_at           timestamptz not null,
  recorded_by           uuid not null references public.people (id),
  evidence_id           uuid, -- FK evidence (part 6)
  created_at            timestamptz not null default now()
);
comment on table public.acknowledgements is 'Supplier/scaffolder confirmations to communications.';
create index acknowledgements_communication_idx on public.acknowledgements (communication_id);
create index acknowledgements_entity_idx on public.acknowledgements (entity_id, acknowledged_revision);

create table public.calendar_links (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.jobs (id) on delete restrict,
  allocation_id        uuid references public.allocations (id) on delete restrict,
  scaffold_activity_id uuid references public.scaffold_bookings (id) on delete restrict,
  calendar_id          text not null,
  -- Plain text: Google Calendar identifiers.
  external_event_id    text,
  event_uid            text,
  producer             text not null check (producer in ('LegacyJotform', 'NewSystem')),
  entity_revision      integer not null check (entity_revision >= 1),
  last_synced_revision integer not null default 0 check (last_synced_revision >= 0),
  status               text not null default 'Pending'
                       check (status in ('Pending', 'Active', 'UpdatePending', 'Cancelled', 'Error')),
  start_at             timestamptz,
  end_at               timestamptz,
  all_day              boolean not null default false,
  guest_person_ids     uuid[],
  description_snapshot text,
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  error                text,
  outbox_id            uuid references public.outbox (id) on delete restrict,
  created_at           timestamptz not null default now(),
  created_by           uuid references public.people (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.people (id),
  version              integer not null default 1 check (version >= 1),
  constraint calendar_links_window check (start_at is null or end_at is null or start_at <= end_at)
);
comment on table public.calendar_links is 'Google Calendar event tracking per allocation/scaffold activity.';
create index calendar_links_job_idx on public.calendar_links (job_id);
create index calendar_links_allocation_idx on public.calendar_links (allocation_id) where allocation_id is not null;
create index calendar_links_scaffold_idx on public.calendar_links (scaffold_activity_id) where scaffold_activity_id is not null;

-- -----------------------------------------------------------------------------
-- Forward references from earlier parts
-- -----------------------------------------------------------------------------

alter table public.orders
  add constraint orders_sent_message_id_fkey
  foreign key (sent_message_id) references public.communications (id) on delete restrict;
alter table public.allocations
  add constraint allocations_calendar_link_id_fkey
  foreign key (calendar_link_id) references public.calendar_links (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger scaffold_bookings_touch before insert or update on public.scaffold_bookings
  for each row execute function app.touch_row();
create trigger communications_touch before insert or update on public.communications
  for each row execute function app.touch_row();
create trigger calendar_links_touch before insert or update on public.calendar_links
  for each row execute function app.touch_row();

create trigger scaffold_bookings_audit after insert or update or delete on public.scaffold_bookings
  for each row execute function app.audit_row_change();
create trigger communications_audit after insert or update or delete on public.communications
  for each row execute function app.audit_row_change();
create trigger communication_jobs_audit after insert or update or delete on public.communication_jobs
  for each row execute function app.audit_row_change();
create trigger acknowledgements_audit after insert or update or delete on public.acknowledgements
  for each row execute function app.audit_row_change();
create trigger calendar_links_audit after insert or update or delete on public.calendar_links
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Privileges + RLS: read-only to clients; writes go through command functions
-- and integration workers (service role).
-- -----------------------------------------------------------------------------

revoke all on public.scaffold_bookings, public.outbox, public.communications, public.communication_jobs,
              public.acknowledgements, public.calendar_links
  from anon, authenticated;
grant select on public.scaffold_bookings, public.outbox, public.communications, public.communication_jobs,
                public.acknowledgements, public.calendar_links
  to authenticated;

alter table public.scaffold_bookings  enable row level security;
alter table public.outbox             enable row level security;
alter table public.communications     enable row level security;
alter table public.communication_jobs enable row level security;
alter table public.acknowledgements   enable row level security;
alter table public.calendar_links     enable row level security;

create policy scaffold_bookings_select on public.scaffold_bookings
  for select to authenticated using ((select app.is_office_class()));
create policy outbox_select on public.outbox
  for select to authenticated using ((select app.is_admin()));
create policy communications_select on public.communications
  for select to authenticated using ((select app.is_office_class()));
create policy communication_jobs_select on public.communication_jobs
  for select to authenticated using ((select app.is_office_class()));
create policy acknowledgements_select on public.acknowledgements
  for select to authenticated using ((select app.is_office_class()));

-- Installers see the calendar entries they are a guest on.
create policy calendar_links_select on public.calendar_links
  for select to authenticated
  using (
    (select app.is_office_class())
    or ((select app.is_active_actor()) and (select app.current_person_id()) = any (guest_person_ids))
  );
<<<<<<< HEAD
=======

>>>>>>> main
