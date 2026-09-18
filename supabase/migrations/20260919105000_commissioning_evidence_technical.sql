-- =============================================================================
-- Reference-schema port, part 6: commissioning, evidence, technical details,
-- installed equipment and customer handover.
--
-- Source: reference schema/tables.json (S02-1.0) - CommissioningTemplates,
-- CommissioningQuestions, CommissioningSubmissions, CommissioningAnswers,
-- Evidence, TechnicalDetails, JobEquipment, Handover.
-- Conventions: see part 1 (20260919100000).
--
-- Also closes the evidence_id forward references from parts 3-5.
--
-- =============================================================================

create table public.commissioning_templates (
  id               uuid primary key default gen_random_uuid(),
  trade            text not null,
  equipment_type   text not null,
  template_version text not null,
  effective_from   date not null,
  active           boolean not null default true,
  approved_by      uuid references public.people (id),
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.people (id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.people (id),
  version          integer not null default 1 check (version >= 1),
  unique (trade, equipment_type, template_version)
);
comment on table public.commissioning_templates is 'Versioned per-trade commissioning form definitions.';

create table public.commissioning_questions (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references public.commissioning_templates (id) on delete restrict,
  question_key   text not null,
  label          text not null,
  data_type      text not null,
  required_when  text,
  allowed_values text[],
  photo_category text,
  review_rule    text,
  help_text      text,
  display_order  integer not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.people (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.people (id),
  version        integer not null default 1 check (version >= 1),
  unique (template_id, question_key)
);
comment on table public.commissioning_questions is 'Questions within commissioning templates.';

create table public.commissioning_submissions (
  id                       uuid primary key default gen_random_uuid(),
  job_id                   uuid not null references public.jobs (id) on delete restrict,
  work_package_id          uuid not null references public.work_packages (id) on delete restrict,
  allocation_id            uuid not null references public.allocations (id) on delete restrict,
  installer_id             uuid not null references public.people (id),
  template_version         text not null,
  status                   text not null default 'Draft'
                           check (status in ('Draft', 'Submitted', 'UnderReview', 'Returned', 'Accepted')),
  submitted_at             timestamptz,
  reviewed_at              timestamptz,
  reviewed_by              uuid references public.people (id),
  review_notes             text,
  supersedes_submission_id uuid references public.commissioning_submissions (id) on delete restrict,
  created_at               timestamptz not null default now(),
  created_by               uuid references public.people (id),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.people (id),
  version                  integer not null default 1 check (version >= 1)
);
comment on table public.commissioning_submissions is 'Installer commissioning form submissions.';
create index commissioning_submissions_job_idx on public.commissioning_submissions (job_id);
create index commissioning_submissions_package_idx on public.commissioning_submissions (work_package_id);
create index commissioning_submissions_installer_idx on public.commissioning_submissions (installer_id);

create table public.commissioning_answers (
  id                    uuid primary key default gen_random_uuid(),
  submission_id         uuid not null references public.commissioning_submissions (id) on delete restrict,
  question_key          text not null,
  value_text            text,
  value_number          numeric,
  value_date            date,
  value_boolean         boolean,
  not_applicable_reason text,
  created_at            timestamptz not null default now(),
  unique (submission_id, question_key)
);
comment on table public.commissioning_answers is 'Individual answers within submissions.';

create table public.evidence (
  id                 uuid primary key default gen_random_uuid(),
  job_id             uuid not null references public.jobs (id) on delete restrict,
  submission_id      uuid references public.commissioning_submissions (id) on delete restrict,
  issue_id           uuid references public.issues (id) on delete restrict,
  category           text not null,
  -- Reference: drive_file_id. The object's location in file storage.
  storage_path       text not null,
  filename           text not null,
  mime_type          text,
  upload_status      text not null,
  captured_at        timestamptz,
  captured_by        uuid references public.people (id),
  received_at        timestamptz,
  customer_shareable boolean not null default false,
  -- File version, not a row-stamping version.
  version            integer not null default 1 check (version >= 1),
  checksum           text,
  created_at         timestamptz not null default now()
);
comment on table public.evidence is 'File/document references linked to jobs, commissioning submissions and issues.';
create index evidence_job_idx on public.evidence (job_id);
create index evidence_submission_idx on public.evidence (submission_id) where submission_id is not null;
create index evidence_issue_idx on public.evidence (issue_id) where issue_id is not null;

create table public.technical_details (
  id                     uuid primary key default gen_random_uuid(),
  job_id                 uuid not null unique references public.jobs (id) on delete restrict,
  system_kw              numeric check (system_kw >= 0),
  battery_kwh            numeric check (battery_kwh >= 0),
  annual_generation_kwh  numeric check (annual_generation_kwh >= 0),
  annual_consumption_kwh numeric check (annual_consumption_kwh >= 0),
  -- Plain text: preserve formatting.
  mpan                   text,
  fuse_rating_amps       integer check (fuse_rating_amps > 0),
  roof_type              text,
  mounting_orientation   text,
  survey_file_id         text,
  roof_design_file_id    text,
  schematic_file_id      text,
  shutdown_file_id       text,
  g99_status             text,
  g99_reference          text,
  technical_review_at    timestamptz,
  technical_review_by    uuid references public.people (id),
  roof_notes             text,
  electrical_notes       text,
  ordering_notes         text,
  created_at             timestamptz not null default now(),
  created_by             uuid references public.people (id),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.people (id),
  version                integer not null default 1 check (version >= 1)
);
comment on table public.technical_details is 'Per-job technical specifications (one row per job).';

create table public.job_equipment (
  id                          uuid primary key default gen_random_uuid(),
  job_id                      uuid not null references public.jobs (id) on delete restrict,
  work_package_id             uuid not null references public.work_packages (id) on delete restrict,
  equipment_type              text not null,
  planned_product_id          uuid references public.products (id) on delete restrict,
  installed_product_id        uuid references public.products (id) on delete restrict,
  quantity                    integer not null check (quantity > 0),
  planned_location            text,
  installed_location          text,
  serial_number               text,
  commissioning_submission_id uuid references public.commissioning_submissions (id) on delete restrict,
  variation_id                uuid references public.issues (id) on delete restrict,
  technical_review_status     text not null,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references public.people (id),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.people (id),
  version                     integer not null default 1 check (version >= 1)
);
comment on table public.job_equipment is 'Installed equipment per job/package.';
create index job_equipment_job_idx on public.job_equipment (job_id);
create index job_equipment_package_idx on public.job_equipment (work_package_id);

create table public.handover (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid not null references public.jobs (id) on delete restrict,
  checklist_version       text not null,
  required_document_types text[] not null,
  completeness_status     text not null,
  generated_file_id       text,
  generated_version       integer check (generated_version >= 1),
  reviewed_at             timestamptz,
  reviewed_by             uuid references public.people (id),
  approved_at             timestamptz,
  approved_by             uuid references public.people (id),
  sent_at                 timestamptz,
  communication_id        uuid references public.communications (id) on delete restrict,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.people (id),
  updated_at              timestamptz not null default now(),
  updated_by              uuid references public.people (id),
  version                 integer not null default 1 check (version >= 1)
);
comment on table public.handover is 'Customer handover pack tracking.';
create index handover_job_idx on public.handover (job_id);

-- -----------------------------------------------------------------------------
-- Forward references from earlier parts
-- -----------------------------------------------------------------------------

alter table public.issue_events
  add constraint issue_events_evidence_id_fkey
  foreign key (evidence_id) references public.evidence (id) on delete restrict;
alter table public.receipt_lines
  add constraint receipt_lines_evidence_id_fkey
  foreign key (evidence_id) references public.evidence (id) on delete restrict;
alter table public.stock_movements
  add constraint stock_movements_evidence_id_fkey
  foreign key (evidence_id) references public.evidence (id) on delete restrict;
alter table public.acknowledgements
  add constraint acknowledgements_evidence_id_fkey
  foreign key (evidence_id) references public.evidence (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- Triggers
-- -----------------------------------------------------------------------------

create trigger commissioning_templates_touch before insert or update on public.commissioning_templates
  for each row execute function app.touch_row();
create trigger commissioning_questions_touch before insert or update on public.commissioning_questions
  for each row execute function app.touch_row();
create trigger commissioning_submissions_touch before insert or update on public.commissioning_submissions
  for each row execute function app.touch_row();
create trigger technical_details_touch before insert or update on public.technical_details
  for each row execute function app.touch_row();
create trigger job_equipment_touch before insert or update on public.job_equipment
  for each row execute function app.touch_row();
create trigger handover_touch before insert or update on public.handover
  for each row execute function app.touch_row();

create trigger commissioning_templates_audit after insert or update or delete on public.commissioning_templates
  for each row execute function app.audit_row_change();
create trigger commissioning_questions_audit after insert or update or delete on public.commissioning_questions
  for each row execute function app.audit_row_change();
create trigger commissioning_submissions_audit after insert or update or delete on public.commissioning_submissions
  for each row execute function app.audit_row_change();
create trigger commissioning_answers_audit after insert or update or delete on public.commissioning_answers
  for each row execute function app.audit_row_change();
create trigger evidence_audit after insert or update or delete on public.evidence
  for each row execute function app.audit_row_change();
create trigger technical_details_audit after insert or update or delete on public.technical_details
  for each row execute function app.audit_row_change();
create trigger job_equipment_audit after insert or update or delete on public.job_equipment
  for each row execute function app.audit_row_change();
create trigger handover_audit after insert or update or delete on public.handover
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- Privileges + RLS
-- -----------------------------------------------------------------------------

revoke all on public.commissioning_templates, public.commissioning_questions, public.commissioning_submissions,
              public.commissioning_answers, public.evidence, public.technical_details, public.job_equipment,
              public.handover
  from anon, authenticated;
grant select on public.commissioning_templates, public.commissioning_questions, public.commissioning_submissions,
                public.commissioning_answers, public.evidence, public.technical_details, public.job_equipment,
                public.handover
  to authenticated;
-- Commissioning form definitions are configuration maintained directly.
grant insert, update on public.commissioning_templates, public.commissioning_questions to authenticated;

alter table public.commissioning_templates   enable row level security;
alter table public.commissioning_questions   enable row level security;
alter table public.commissioning_submissions enable row level security;
alter table public.commissioning_answers     enable row level security;
alter table public.evidence                  enable row level security;
alter table public.technical_details         enable row level security;
alter table public.job_equipment             enable row level security;
alter table public.handover                  enable row level security;

create policy commissioning_templates_select on public.commissioning_templates
  for select to authenticated using ((select app.is_active_actor()));
create policy commissioning_templates_insert on public.commissioning_templates
  for insert to authenticated with check ((select app.is_admin()));
create policy commissioning_templates_update on public.commissioning_templates
  for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

create policy commissioning_questions_select on public.commissioning_questions
  for select to authenticated using ((select app.is_active_actor()));
create policy commissioning_questions_insert on public.commissioning_questions
  for insert to authenticated with check ((select app.is_admin()));
create policy commissioning_questions_update on public.commissioning_questions
  for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Installers see their own submissions and answers.
create policy commissioning_submissions_select on public.commissioning_submissions
  for select to authenticated
  using (
    (select app.is_office_class())
    or ((select app.is_active_actor()) and installer_id = (select app.current_person_id()))
  );
create policy commissioning_answers_select on public.commissioning_answers
  for select to authenticated
  using (
    (select app.is_office_class())
    or exists (
      select 1 from public.commissioning_submissions s
      where s.id = submission_id
        and s.installer_id = (select app.current_person_id())
    )
  );

create policy evidence_select on public.evidence
  for select to authenticated using ((select app.is_office_class()));
create policy technical_details_select on public.technical_details
  for select to authenticated using ((select app.is_office_class()));
create policy job_equipment_select on public.job_equipment
  for select to authenticated
  using ((select app.is_office_class()) or app.holds_active_allocation(work_package_id));
create policy handover_select on public.handover
  for select to authenticated using ((select app.is_office_class()));
