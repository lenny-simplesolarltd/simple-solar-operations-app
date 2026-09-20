-- =============================================================================
-- Customer document generation: immutable revisions, and the work that makes
-- them.
--
-- The renderer already exists and is proven (docs/DOCUMENT_GENERATION_
-- ARCHITECTURE.md). This is everything around it: what a revision IS, how one
-- is asked for, how a worker picks it up exactly once, where the bytes go, and
-- how the whole thing stays visible while it happens.
--
-- Four rules shape the table below.
--
--   1. A Ready revision is never rewritten. Regenerating makes a new row and
--      marks the old one Superseded; the old file stays exactly where it was,
--      because an email sent last week still points at it.
--   2. The work is idempotent through the commands ledger. A double click, a
--      replayed request or a retried worker cannot produce a second revision.
--   3. Generation is DOWNSTREAM of the presale. It is queued by a trigger
--      after the presale row is committed, and nothing it does can roll the
--      presale back - the worker runs in its own transaction, later.
--   4. Nothing invents a file system. The bytes land in the same private
--      `evidence` bucket as every other document, registered through an
--      evidence row, so the job's Files tab shows them without being told.
--
-- On not building a second queue: `public.command_batches` is the right shape
-- but is task-specific - `command_batch_items.task_id` is `not null references
-- public.tasks` and `operation` is CHECK-constrained to four TASK_BATCH_*
-- values. Widening both to carry work that has no task would put the task
-- machinery at risk for no gain. Instead this table carries the SAME protocol
-- and calls the SAME policy functions - app.batch_max_attempts(),
-- app.batch_backoff_minutes(), app.batch_stalled_minutes() - so there is one
-- retry policy in the system, not two.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A category for generated documents
-- -----------------------------------------------------------------------------

-- Generated documents are evidence like anything else, but they are not
-- evidence OF anything: nobody uploaded them and no task depends on them. The
-- category keeps them identifiable in the Files surfaces.
create or replace function app.evidence_categories()
returns text[] language sql immutable set search_path = ''
as $$
  select array['Contract', 'CustomerDetails', 'FinanceAgreement', 'TaskEvidence',
               'DeliveryNote', 'GeneratedDocument', 'Other']
         || app.evidence_installer_categories()
$$;

-- -----------------------------------------------------------------------------
-- 2. The revisions
-- -----------------------------------------------------------------------------

create table public.document_revisions (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.jobs (id) on delete restrict,
  -- The frozen source. A revision is generated from the presale of record, not
  -- from whatever the job looks like today.
  presale_id           uuid not null references public.presales (id) on delete restrict,
  document_type        text not null check (document_type in ('QuotationContract', 'ROI')),
  revision_number      integer not null check (revision_number > 0),

  status               text not null default 'Queued'
                       check (status in ('Queued', 'Generating', 'Ready', 'Failed', 'Superseded')),

  -- Idempotency. Frozen when the revision is requested and used as the child
  -- command id, exactly as command_batch_items does: a retried worker, a
  -- refreshed browser and a replayed request are all answered by this row.
  command_id           uuid not null unique,
  source               text not null default 'ui' check (source in ('ui', 'system', 'simplebot')),

  -- What produced it. Recorded so a change to a master or a template can never
  -- make an old revision ambiguous, and so no old revision is ever re-rendered.
  template_id          text not null,
  template_version     text not null,
  renderer_version     text not null,
  master_sha256        text not null check (master_sha256 ~ '^[0-9a-f]{64}$'),

  -- The snapshot the renderer consumed, and its identity. Immutable.
  input_snapshot       jsonb,
  input_sha256         text check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$'),

  -- The artifact. Null until Ready.
  evidence_id          uuid references public.evidence (id) on delete restrict,
  storage_path         text,
  filename             text,
  mime_type            text,
  size_bytes           bigint check (size_bytes is null or size_bytes > 0),
  content_sha256       text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
  page_count           integer check (page_count is null or page_count > 0),
  -- Pages deliberately not generated, with the reason. This is NOT a failure:
  -- the MCS estimate is withheld because its inputs do not exist, and the rest
  -- of the quotation is perfectly valid without it.
  omitted_pages        jsonb not null default '[]'::jsonb
                       check (jsonb_typeof(omitted_pages) = 'array'),

  -- Retry bookkeeping, same shape as the outbox and command batches.
  attempt_count        integer not null default 0 check (attempt_count >= 0),
  next_attempt         timestamptz,
  claimed_at           timestamptz,
  error_code           text,
  error_detail         jsonb,

  requested_at         timestamptz not null default now(),
  requested_by         uuid references public.people (id),
  generated_at         timestamptz,
  generated_by         uuid references public.people (id),
  superseded_at        timestamptz,
  superseded_by        uuid references public.document_revisions (id),
  created_at           timestamptz not null default now(),

  unique (job_id, document_type, revision_number),
  -- A Ready revision has an artifact; anything else does not claim one.
  constraint document_revisions_ready_has_file
    check (status <> 'Ready' or (evidence_id is not null and content_sha256 is not null
                                 and storage_path is not null and page_count is not null)),
  constraint document_revisions_failed_has_reason
    check (status <> 'Failed' or error_code is not null)
);

comment on table public.document_revisions is
  'One generation attempt that produced, or tried to produce, a customer-facing PDF. Append-only: a Ready revision is never rewritten, only superseded.';

create index document_revisions_job_idx
  on public.document_revisions (job_id, document_type, revision_number desc);
create index document_revisions_due_idx
  on public.document_revisions (next_attempt)
  where status = 'Queued';
create index document_revisions_claimed_idx
  on public.document_revisions (claimed_at) where status = 'Generating';
create index document_revisions_open_idx
  on public.document_revisions (requested_at) where status in ('Queued', 'Generating');

alter table public.document_revisions enable row level security;
-- Every read goes through app.read_* below, which applies job visibility. No
-- client selects this table directly.
revoke all on public.document_revisions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Immutability
--
-- The whole promise of the feature is that R1 still means what it meant. So
-- the trigger allows only the transitions the lifecycle needs and refuses
-- every edit to a finished revision's substance.
-- -----------------------------------------------------------------------------

create function app.document_revision_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'DOCUMENT_REVISION_IMMUTABLE' using errcode = 'P0001',
      hint = 'A generated revision is evidence of what a customer was sent. It is superseded, never removed.';
  end if;

  -- Identity never changes, whatever the status.
  if new.id <> old.id or new.job_id <> old.job_id or new.presale_id <> old.presale_id
     or new.document_type <> old.document_type or new.revision_number <> old.revision_number
     or new.command_id <> old.command_id or new.created_at <> old.created_at then
    raise exception 'DOCUMENT_REVISION_IMMUTABLE' using errcode = 'P0001',
      hint = 'The identity of a revision cannot be changed.';
  end if;

  -- A finished artifact is frozen - and STAYS frozen once superseded, because
  -- a superseded revision is precisely the one an email sent last week points
  -- at. Freezing only while Ready would leave the historical record editable.
  if old.status in ('Ready', 'Superseded') then
    if new.status not in ('Ready', 'Superseded') then
      raise exception 'DOCUMENT_REVISION_IMMUTABLE' using errcode = 'P0001',
        hint = 'A Ready revision cannot be re-opened. Generate a new revision instead.';
    end if;
    if new.evidence_id is distinct from old.evidence_id
       or new.storage_path is distinct from old.storage_path
       or new.content_sha256 is distinct from old.content_sha256
       or new.input_snapshot is distinct from old.input_snapshot
       or new.input_sha256 is distinct from old.input_sha256
       or new.template_version is distinct from old.template_version
       or new.renderer_version is distinct from old.renderer_version
       or new.master_sha256 is distinct from old.master_sha256
       or new.page_count is distinct from old.page_count
       or new.size_bytes is distinct from old.size_bytes
       or new.generated_at is distinct from old.generated_at then
      raise exception 'DOCUMENT_REVISION_IMMUTABLE' using errcode = 'P0001',
        hint = 'The artifact of a Ready revision is fixed. Anything that changed it would change what a customer was sent.';
    end if;
  end if;

  if old.status = 'Superseded' and new.status <> 'Superseded' then
    raise exception 'DOCUMENT_REVISION_IMMUTABLE' using errcode = 'P0001',
      hint = 'A superseded revision stays superseded.';
  end if;

  return new;
end
$$;

create trigger document_revisions_guard
  before update or delete on public.document_revisions
  for each row execute function app.document_revision_guard();

create trigger document_revisions_audit
  after insert or update on public.document_revisions
  for each row execute function app.audit_row_change();

-- -----------------------------------------------------------------------------
-- 4. Asking for a revision
-- -----------------------------------------------------------------------------

create function app.document_types() returns text[]
language sql immutable set search_path = ''
as $$ select array['QuotationContract', 'ROI'] $$;

-- The renderer's own identity, bumped when its output could change. Stored on
-- every revision; never used to decide whether to re-render an old one.
create function app.document_renderer_version() returns text
language sql immutable set search_path = ''
as $$ select '1.0.0' $$;

/**
 * Queue a generation, or return the one already in flight.
 *
 * Idempotent three times over: the commands ledger answers a replayed
 * command_id; an open (Queued or Generating) revision for the same job and
 * type is returned rather than duplicated; and a Ready revision is only
 * superseded once its replacement is itself Ready.
 */
create function app.document_enqueue(p_job_id uuid, p_document_type text, p_command_id uuid,
                                     p_source text, p_requested_by uuid)
returns public.document_revisions
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.jobs;
  v_presale public.presales;
  v_open public.document_revisions;
  v_next integer;
  v_row public.document_revisions;
begin
  if not p_document_type = any (app.document_types()) then
    perform app.fail('DOCUMENT_TYPE_UNKNOWN', jsonb_build_object('document_type', p_document_type));
  end if;

  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    perform app.fail('DOCUMENT_JOB_NOT_FOUND');
  end if;
  -- Historical records are read-only and have no presale of record. They must
  -- never acquire a modern quotation, and no worker may pick one up.
  if v_job.record_class = 'HistoricalImport' then
    perform app.fail('HISTORICAL_IMPORT',
      jsonb_build_object('reason', 'An imported historical job has no presale of record; no customer document can be generated for it.'));
  end if;

  select * into v_presale from public.presales where job_id = p_job_id;
  if v_presale.id is null then
    perform app.fail('DOCUMENT_NO_PRESALE',
      jsonb_build_object('reason', 'This job has no presale, so there is no snapshot to generate from.'));
  end if;

  -- Serialise concurrent requests for the same document of the same job.
  perform pg_advisory_xact_lock(hashtextextended('document:' || p_job_id::text || ':' || p_document_type, 0));

  select * into v_open from public.document_revisions
  where job_id = p_job_id and document_type = p_document_type
    and status in ('Queued', 'Generating')
  order by revision_number desc limit 1;
  if v_open.id is not null then
    return v_open;
  end if;

  select coalesce(max(revision_number), 0) + 1 into v_next
  from public.document_revisions
  where job_id = p_job_id and document_type = p_document_type;

  insert into public.document_revisions
    (job_id, presale_id, document_type, revision_number, status, command_id, source,
     template_id, template_version, renderer_version, master_sha256,
     next_attempt, requested_by)
  values
    (p_job_id, v_presale.id, p_document_type, v_next, 'Queued', p_command_id, coalesce(p_source, 'ui'),
     case p_document_type when 'QuotationContract' then 'presale/quotation' else 'presale/roi' end,
     -- Template and master identity are set for real by the worker, which is
     -- the only thing that can read the files. These are placeholders that the
     -- worker overwrites before the revision can become Ready.
     'pending', app.document_renderer_version(), repeat('0', 64),
     now(), p_requested_by)
  returning * into v_row;

  return v_row;
end
$$;

-- -----------------------------------------------------------------------------
-- 5. The command
-- -----------------------------------------------------------------------------

create function app.cmd_document_generate(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_types text[];
  v_type text;
  v_out jsonb := '[]'::jsonb;
  v_row public.document_revisions;
  v_child uuid;
begin
  v_job_id := nullif(btrim(p_request ->> 'job_id'), '')::uuid;
  if v_job_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;

  -- Absent document_type means "everything this job should have".
  if p_request -> 'payload' ? 'document_type' then
    v_types := array[p_request -> 'payload' ->> 'document_type'];
  else
    v_types := app.document_types();
  end if;

  foreach v_type in array v_types loop
    -- One child command id per (command, type), derived deterministically so a
    -- replay of the parent command reaches the same rows.
    v_child := uuid_in(md5((p_request ->> 'command_id') || ':' || v_type)::cstring);
    v_row := app.document_enqueue(v_job_id, v_type, v_child, coalesce(p_request -> 'payload' ->> 'source', 'ui'),
                                  app.actor_id(p_actor));
    v_out := v_out || jsonb_build_object(
      'revision_id', v_row.id, 'document_type', v_row.document_type,
      'revision_number', v_row.revision_number, 'status', v_row.status);
  end loop;

  return jsonb_build_object('job_id', v_job_id, 'revisions', v_out);
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Queue on presale submission
--
-- AFTER INSERT on the presale, so the snapshot is committed before anything is
-- asked for, and so a generation problem can never roll back a sale. The
-- trigger only inserts queue rows; the rendering happens later, elsewhere, in
-- its own transaction.
-- -----------------------------------------------------------------------------

create function app.document_queue_on_presale()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.jobs;
  v_type text;
begin
  select * into v_job from public.jobs where id = new.job_id;
  if v_job.record_class = 'HistoricalImport' then
    return new;
  end if;

  foreach v_type in array app.document_types() loop
    perform app.document_enqueue(
      new.job_id, v_type,
      uuid_in(md5('presale:' || new.id::text || ':' || v_type)::cstring),
      'system', new.created_by);
  end loop;
  return new;
end
$$;

create trigger presales_queue_documents
  after insert on public.presales
  for each row execute function app.document_queue_on_presale();

-- -----------------------------------------------------------------------------
-- 7. The worker protocol
--
-- Same shape as public.outbox_claim: recover stalled rows first, then claim
-- due ones `for update skip locked`, incrementing the attempt and marking them
-- Generating BEFORE the renderer runs - so a crash leaves a visibly stuck row
-- rather than a silently lost one.
-- -----------------------------------------------------------------------------

create function public.document_revision_claim(p_limit integer default 5)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ids uuid[];
  v_stalled integer;
  v_out jsonb;
begin
  -- Anything that has been Generating longer than the stall window was
  -- abandoned by a worker that died. Put it back.
  update public.document_revisions
  set status = 'Queued', claimed_at = null,
      next_attempt = now(),
      error_code = coalesce(error_code, 'RENDER_STALLED')
  where status = 'Generating'
    and claimed_at < now() - make_interval(mins => app.batch_stalled_minutes());
  get diagnostics v_stalled = row_count;

  with due as (
    select r.id
    from public.document_revisions r
    join public.jobs j on j.id = r.job_id
    where r.status = 'Queued'
      and coalesce(r.next_attempt, now()) <= now()
      -- A historical import has no presale of record. Even if a row for one
      -- somehow existed, no worker may act on it.
      and j.record_class <> 'HistoricalImport'
      and r.attempt_count < app.batch_max_attempts()
    order by r.requested_at
    limit greatest(1, least(coalesce(p_limit, 5), 25))
    -- Two workers running at once take disjoint sets rather than blocking.
    for update of r skip locked
  ), taken as (
    update public.document_revisions r
    set status = 'Generating', claimed_at = now(), attempt_count = r.attempt_count + 1
    from due
    where r.id = due.id
    returning r.id
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_ids from taken;

  select coalesce(jsonb_agg(x order by x ->> 'requested_at'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'revision_id', r.id,
      'job_id', r.job_id,
      'job_reference', j.job_ref,
      'presale_id', r.presale_id,
      'document_type', r.document_type,
      'revision_number', r.revision_number,
      'attempt', r.attempt_count,
      'requested_at', r.requested_at,
      'source', jsonb_build_object(
        'presale', jsonb_build_object(
          'id', p.id, 'submitted_at', p.submitted_at, 'design', p.design,
          'design_schema_version', p.design_schema_version,
          'catalogue_version', p.catalogue_version, 'system_kwp', p.system_kwp,
          'net_panels', p.net_panels, 'agreed_price_pence', p.agreed_price_pence),
        'job', jsonb_build_object(
          'id', j.id, 'reference', j.job_ref,
          'is_historical_import', j.record_class = 'HistoricalImport'),
        'customer', jsonb_build_object(
          'first_name', c.first_name, 'last_name', c.last_name,
          'address_line1', c.address_line1, 'address_line2', c.address_line2,
          'town', c.town, 'postcode', c.postcode, 'email', c.email, 'phone', c.phone),
        'salesperson', jsonb_build_object(
          'display_name', sp.display_name, 'email', sp.email,
          -- public.people has no phone column. The ROI's back page asks for a
          -- "surveyor contact" that the schema simply does not hold, so it
          -- comes from configuration and is optional - never invented, and
          -- never a reason to fail a document.
          'phone', nullif(btrim(coalesce(app.setting('documents.contact_phone') #>> '{}', '')), '')),
        'settings', jsonb_build_object(
          'electricity_inflation_pct',
            coalesce((app.setting('documents.electricity_inflation_pct') #>> '{}')::numeric, 5),
          'seg_inflates',
            coalesce((app.setting('documents.seg_inflates') #>> '{}')::boolean, false))
      )
    ) as x
    from public.document_revisions r
    join public.jobs j on j.id = r.job_id
    join public.presales p on p.id = r.presale_id
    join public.customers c on c.id = j.customer_id
    left join public.people sp on sp.id = p.surveyor_id
    where r.id = any (coalesce(v_ids, array[]::uuid[]))
  ) s;

  return jsonb_build_object('claimed', v_out, 'released_stalled', v_stalled);
end
$$;

/**
 * The worker has bytes and needs somewhere to put them.
 *
 * Creates the Pending evidence row first so the storage path carries the
 * evidence id, exactly as an interactive upload does - identity in the path,
 * never filing. Safe to repeat: a revision that already has a row gets the
 * same one back.
 */
create function public.document_revision_begin_upload(p_revision_id uuid, p_filename text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.document_revisions;
  v_evidence public.evidence;
  v_evidence_id uuid;
  v_name text;
  v_path text;
begin
  select * into v_row from public.document_revisions where id = p_revision_id for update;
  if v_row.id is null then
    perform app.fail('DOCUMENT_REVISION_NOT_FOUND');
  end if;
  -- Answered before the status check on purpose: a revision that already has
  -- an upload slot gets the same one back, whatever state it is in now. That
  -- is what makes a replayed or retried worker harmless.
  if v_row.evidence_id is not null then
    select * into v_evidence from public.evidence where id = v_row.evidence_id;
    return jsonb_build_object('evidence_id', v_evidence.id, 'bucket', 'evidence',
                              'storage_path', v_evidence.storage_path);
  end if;
  if v_row.status <> 'Generating' then
    perform app.fail('DOCUMENT_REVISION_NOT_GENERATING',
      jsonb_build_object('status', v_row.status));
  end if;

  v_name := app.evidence_safe_filename(p_filename);
  if v_name is null then
    perform app.fail('R1A_UPLOAD_INVALID');
  end if;

  -- The id is minted here rather than by the default, because the storage path
  -- contains it and app.evidence_guard (rightly) refuses to let a path change
  -- afterwards. Identity in the path, decided once.
  v_evidence_id := gen_random_uuid();
  v_path := v_row.job_id::text || '/' || v_evidence_id::text || '/' || v_name;

  insert into public.evidence
    (id, job_id, scope, context_type, context_id, category, storage_path, filename,
     original_filename, mime_type, upload_status, captured_at, captured_by,
     uploaded_by, registered_at, customer_shareable, display_name)
  values
    (v_evidence_id, v_row.job_id, 'Job', 'Job', v_row.job_id, 'GeneratedDocument',
     v_path, v_name, v_name, 'application/pdf', 'Pending', now(), v_row.requested_by,
     v_row.requested_by, now(), true, v_name)
  returning * into v_evidence;

  update public.document_revisions
  set evidence_id = v_evidence.id, storage_path = v_path, filename = v_name
  where id = v_row.id;

  return jsonb_build_object('evidence_id', v_evidence.id, 'bucket', 'evidence',
                            'storage_path', v_path);
end
$$;

/**
 * The bytes are in storage: finish the revision.
 *
 * Confirms the object through the ordinary evidence path (so a revision can
 * never claim a file storage does not have), records the artifact, and
 * supersedes the previous Ready revision of the same type - only now, only
 * once this one is real.
 */
create function public.document_revision_ready(p_revision_id uuid, p_content_sha256 text,
                                               p_page_count integer, p_input_snapshot jsonb,
                                               p_input_sha256 text, p_template_version text,
                                               p_master_sha256 text, p_omitted_pages jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.document_revisions;
  v_evidence public.evidence;
  v_prior public.document_revisions;
begin
  select * into v_row from public.document_revisions where id = p_revision_id for update;
  if v_row.id is null then
    perform app.fail('DOCUMENT_REVISION_NOT_FOUND');
  end if;
  -- A replayed completion is not an error: the revision is already done.
  if v_row.status = 'Ready' then
    return jsonb_build_object('revision_id', v_row.id, 'status', 'Ready',
                              'revision_number', v_row.revision_number, 'replayed', true);
  end if;
  if v_row.status <> 'Generating' then
    perform app.fail('DOCUMENT_REVISION_NOT_GENERATING', jsonb_build_object('status', v_row.status));
  end if;
  if v_row.evidence_id is null then
    perform app.fail('DOCUMENT_REVISION_NO_UPLOAD');
  end if;

  perform set_config('app.executing_service', 'documents:generate', true);
  -- Raises R1A_UPLOAD_MISSING if storage does not actually have the object.
  v_evidence := app.evidence_finalize(v_row.evidence_id);

  update public.document_revisions
  set status = 'Ready',
      content_sha256 = p_content_sha256,
      page_count = p_page_count,
      input_snapshot = p_input_snapshot,
      input_sha256 = p_input_sha256,
      template_version = p_template_version,
      master_sha256 = p_master_sha256,
      omitted_pages = coalesce(p_omitted_pages, '[]'::jsonb),
      mime_type = coalesce(v_evidence.mime_type, 'application/pdf'),
      size_bytes = v_evidence.size_bytes,
      generated_at = now(),
      generated_by = v_row.requested_by,
      claimed_at = null,
      next_attempt = null,
      error_code = null,
      error_detail = null
  where id = v_row.id
  returning * into v_row;

  -- Supersede the previous Ready revision, now that a replacement exists. Its
  -- file, hash and snapshot are untouched: an email that quoted it still does.
  for v_prior in
    select * from public.document_revisions
    where job_id = v_row.job_id and document_type = v_row.document_type
      and status = 'Ready' and id <> v_row.id
  loop
    update public.document_revisions
    set status = 'Superseded', superseded_at = now(), superseded_by = v_row.id
    where id = v_prior.id;
  end loop;

  return jsonb_build_object('revision_id', v_row.id, 'status', v_row.status,
                            'revision_number', v_row.revision_number,
                            'evidence_id', v_row.evidence_id,
                            'content_sha256', v_row.content_sha256,
                            'size_bytes', v_row.size_bytes);
end
$$;

/** The attempt failed. Retry until the shared budget is spent, then stop. */
create function public.document_revision_failed(p_revision_id uuid, p_error_code text,
                                                p_error_detail jsonb default null,
                                                p_retryable boolean default true)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.document_revisions;
  v_backoff int[] := app.batch_backoff_minutes();
  v_status text;
  v_next timestamptz;
begin
  select * into v_row from public.document_revisions where id = p_revision_id for update;
  if v_row.id is null then
    perform app.fail('DOCUMENT_REVISION_NOT_FOUND');
  end if;
  if v_row.status in ('Ready', 'Superseded') then
    return jsonb_build_object('revision_id', v_row.id, 'status', v_row.status, 'ignored', true);
  end if;

  -- A missing required value or a historical job will fail identically on
  -- every attempt; burning five retries on it only delays the person who has
  -- to fix it.
  if not coalesce(p_retryable, true) or v_row.attempt_count >= app.batch_max_attempts() then
    v_status := 'Failed';
    v_next := null;
  else
    v_status := 'Queued';
    v_next := now() + make_interval(
      mins => v_backoff[least(v_row.attempt_count, array_length(v_backoff, 1))]);
  end if;

  update public.document_revisions
  set status = v_status, next_attempt = v_next, claimed_at = null,
      error_code = p_error_code, error_detail = p_error_detail
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object('revision_id', v_row.id, 'status', v_row.status,
                            'attempt', v_row.attempt_count, 'next_attempt', v_row.next_attempt);
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Settings
-- -----------------------------------------------------------------------------

insert into public.settings (key, typed_value, scope, version, effective_from, reason) values
  ('documents.electricity_inflation_pct', '5'::jsonb, 'Global', 1, '2026-01-01',
   'Annual electricity price inflation used by the ROI projection, as a percentage. A setting rather than a constant because the supplied masters print 7% as a customer-facing assumption while the performance engine computed with 5%. The rate each revision used is frozen on that revision, so changing this never alters a document already sent.'),
  ('documents.contact_phone', '""'::jsonb, 'Global', 1, '2026-01-01',
   'The telephone number printed on the ROI report''s back page. public.people holds no phone number, so there is no per-surveyor source for it; empty means the line is left blank rather than filled with a number nobody chose.'),
  ('documents.seg_inflates', 'false'::jsonb, 'Global', 1, '2026-01-01',
   'Whether the Smart Export Guarantee rate escalates with the import tariff. False understates income slightly, which is the safe direction for a customer projection, and is the resting state until the owner decides.')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 9. Reads
-- -----------------------------------------------------------------------------

create function app.document_revision_json(p_r public.document_revisions)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'revision_id', p_r.id,
    'document_type', p_r.document_type,
    'revision_number', p_r.revision_number,
    'status', p_r.status,
    'generated_at', p_r.generated_at,
    'requested_at', p_r.requested_at,
    'evidence_id', p_r.evidence_id,
    'filename', p_r.filename,
    'size_bytes', p_r.size_bytes,
    'page_count', p_r.page_count,
    'omitted_pages', p_r.omitted_pages,
    'error_code', p_r.error_code,
    'error_detail', p_r.error_detail,
    'attempt_count', p_r.attempt_count,
    'next_attempt', p_r.next_attempt,
    -- Kept out of the main card and shown under "generation details".
    'details', jsonb_build_object(
      'template_id', p_r.template_id,
      'template_version', p_r.template_version,
      'renderer_version', p_r.renderer_version,
      'master_sha256', p_r.master_sha256,
      'input_sha256', p_r.input_sha256,
      'content_sha256', p_r.content_sha256,
      'presale_id', p_r.presale_id,
      'source', p_r.source,
      'claimed_at', p_r.claimed_at,
      'superseded_at', p_r.superseded_at,
      'superseded_by', p_r.superseded_by))
$$;

/** Every document of one job: the current revision of each type, plus history. */
create function app.read_job_documents(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_job public.jobs;
  v_types jsonb := '[]'::jsonb;
  v_type text;
  v_current public.document_revisions;
  v_history jsonb;
begin
  v_job_id := nullif(btrim(p_request ->> 'job_id'), '')::uuid;
  if v_job_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  select * into v_job from public.jobs where id = v_job_id;
  if v_job.id is null or not app.can_read_job(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_NOT_VISIBLE');
  end if;

  foreach v_type in array app.document_types() loop
    -- "Current" is the newest revision that is not superseded: the one whose
    -- state the card should show, whether it is Ready, still running or failed.
    select * into v_current from public.document_revisions
    where job_id = v_job_id and document_type = v_type and status <> 'Superseded'
    order by revision_number desc limit 1;

    select coalesce(jsonb_agg(app.document_revision_json(h) order by h.revision_number desc), '[]'::jsonb)
    into v_history
    from public.document_revisions h
    where h.job_id = v_job_id and h.document_type = v_type;

    v_types := v_types || jsonb_build_object(
      'document_type', v_type,
      'current', case when v_current.id is null then null else app.document_revision_json(v_current) end,
      'history', v_history);
  end loop;

  return jsonb_build_object(
    'job_id', v_job_id,
    'job_reference', v_job.job_ref,
    'is_historical_import', v_job.record_class = 'HistoricalImport',
    'has_presale', exists (select 1 from public.presales where job_id = v_job_id),
    'documents', v_types);
end
$$;

/** The operations view: what is queued, running, failed or retrying, anywhere. */
create function app.read_document_operations(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_rows jsonb;
  v_counts jsonb;
begin
  select coalesce(jsonb_agg(x order by x ->> 'requested_at' desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'revision_id', r.id, 'job_id', r.job_id, 'job_reference', j.job_ref,
      'customer', trim(both ' ' from coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
      'document_type', r.document_type, 'revision_number', r.revision_number,
      'status', r.status, 'attempt_count', r.attempt_count,
      'next_attempt', r.next_attempt, 'claimed_at', r.claimed_at,
      'requested_at', r.requested_at, 'generated_at', r.generated_at,
      'error_code', r.error_code, 'error_detail', r.error_detail) as x
    from public.document_revisions r
    join public.jobs j on j.id = r.job_id
    left join public.customers c on c.id = j.customer_id
    where app.can_read_job(p_actor, j.id)
      and (r.status <> 'Superseded'
           or r.generated_at > now() - interval '7 days')
    order by r.requested_at desc
    limit 200
  ) s;

  select jsonb_object_agg(status, n) into v_counts
  from (
    select r.status, count(*) as n
    from public.document_revisions r
    join public.jobs j on j.id = r.job_id
    where app.can_read_job(p_actor, j.id)
    group by r.status
  ) t;

  return jsonb_build_object('revisions', v_rows, 'counts', coalesce(v_counts, '{}'::jsonb));
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Registration and grants
-- -----------------------------------------------------------------------------

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('DOCUMENT_GENERATE', array['Admin', 'Manager', 'Director', 'Office', 'Surveyor'], true, '[]', 'documents',
   'Queue a quotation/contract or ROI revision for a job. Creates a NEW revision; never rewrites a Ready one. Job-scoped: the actor must be assigned to the job. No release mode - generating a document sends nothing to anyone.')
on conflict (command_type) do nothing;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('JOB_DOCUMENTS', array['Admin', 'Manager', 'Director', 'Office', 'Surveyor', 'Finance'], '[]', 'documents',
   'The documents of one job: current revision per type plus full history. Job visibility is applied in the handler.'),
  ('DOCUMENT_OPERATIONS', array['Admin', 'Manager', 'Director', 'Office'], '[]', 'documents',
   'Generation work across every job the actor can see: queued, generating, failed, retrying, with attempt counts and reasons.')
on conflict (read_type) do nothing;

-- The worker protocol runs under the service key only: it bypasses the actor
-- entirely, so it must not be reachable from a browser session.
revoke all on function public.document_revision_claim(integer) from public, anon, authenticated;
revoke all on function public.document_revision_begin_upload(uuid, text) from public, anon, authenticated;
revoke all on function public.document_revision_ready(uuid, text, integer, jsonb, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.document_revision_failed(uuid, text, jsonb, boolean)
  from public, anon, authenticated;

grant execute on function public.document_revision_claim(integer) to service_role;
grant execute on function public.document_revision_begin_upload(uuid, text) to service_role;
grant execute on function public.document_revision_ready(uuid, text, integer, jsonb, text, text, text, jsonb)
  to service_role;
grant execute on function public.document_revision_failed(uuid, text, jsonb, boolean) to service_role;

-- -----------------------------------------------------------------------------
-- 11. Emailing a document
--
-- The document feature does not send email and does not own a recipient list.
-- It composes a DRAFT in the canonical communications spine and hands the
-- person over to it; approving and sending are that module's commands, gates
-- and audit, unchanged.
--
-- The attachment is the evidence id of ONE revision, captured here. That is
-- what makes the chain auditable: job -> revision R1 -> communication ->
-- attachment R1. Generating R2 later supersedes the revision but changes
-- nothing about this row, so an email sent last week still says what it sent.
-- -----------------------------------------------------------------------------

insert into app.communication_kinds (type, action_type, function_id, module, notes) values
  ('CustomerDocument', null, null, 'documents',
   'A generated quotation, contract or ROI sent to the customer. action_type is NULL on purpose: there is no released function for customer email, so this can be approved and recorded as sent by a person, and can never be queued for automatic dispatch.')
on conflict (type) do nothing;

create function app.cmd_communication_compose(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_job_id uuid;
  v_revision public.document_revisions;
  v_job public.jobs;
  v_customer public.customers;
  v_to text;
  v_subject text;
  v_body text;
  v_row public.communications;
begin
  v_job_id := nullif(btrim(p_request ->> 'job_id'), '')::uuid;
  if v_job_id is null then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;

  select * into v_revision from public.document_revisions
  where id = nullif(btrim(p_request -> 'payload' ->> 'revision_id'), '')::uuid;
  if v_revision.id is null or v_revision.job_id <> v_job_id then
    perform app.fail('DOCUMENT_REVISION_NOT_FOUND');
  end if;
  -- Only a finished artifact can be attached: there is nothing else to attach.
  if v_revision.status not in ('Ready', 'Superseded') or v_revision.evidence_id is null then
    perform app.fail('DOCUMENT_REVISION_NOT_READY',
      jsonb_build_object('status', v_revision.status));
  end if;

  select * into v_job from public.jobs where id = v_job_id;
  select * into v_customer from public.customers where id = v_job.customer_id;

  v_to := lower(btrim(coalesce(nullif(btrim(p_request -> 'payload' ->> 'to'), ''), v_customer.email, '')));
  if v_to = '' then
    perform app.fail('COMM_RECIPIENTS_INVALID',
      jsonb_build_object('reason', 'This customer has no email address. Add one, or send the document another way and record it.'));
  end if;

  v_subject := coalesce(nullif(btrim(p_request -> 'payload' ->> 'subject'), ''),
    case v_revision.document_type
      when 'QuotationContract' then 'Your Simple Solar quotation — ' || v_job.job_ref
      else 'Your Simple Solar savings report — ' || v_job.job_ref
    end);

  v_body := coalesce(nullif(btrim(p_request -> 'payload' ->> 'body'), ''),
    'Dear ' || v_customer.first_name || E',\n\n' ||
    'Please find your ' ||
    case v_revision.document_type
      when 'QuotationContract' then 'quotation and contract'
      else 'savings and return report'
    end || ' attached, for ' || v_job.job_ref || E'.\n\n' ||
    E'If anything looks wrong, or you have any questions, reply to this email and we will pick it up.\n\n' ||
    'Simple Solar (SW) Ltd');

  insert into public.communications
    (job_id, type, subject, body_snapshot, recipients_snapshot, attachment_ids,
     status, created_by, updated_by)
  values
    (v_job_id, 'CustomerDocument', v_subject, v_body, v_to,
     array[v_revision.evidence_id::text], 'Draft',
     app.actor_id(p_actor), app.actor_id(p_actor))
  returning * into v_row;

  return jsonb_build_object(
    'communication_id', v_row.id,
    'revision_id', v_revision.id,
    'document_type', v_revision.document_type,
    'revision_number', v_revision.revision_number,
    'attachment_evidence_id', v_revision.evidence_id,
    'to', v_to,
    'subject', v_subject);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('COMMUNICATION_COMPOSE', array['Admin', 'Manager', 'Director', 'Office'], true, '[]', 'communications',
   'Compose a Draft customer email with one generated document revision attached. Sends nothing: the draft then goes through COMMUNICATION_APPROVE and the manual record-sent route, because CustomerDocument has no dispatch action type.')
on conflict (command_type) do nothing;

-- -----------------------------------------------------------------------------
-- 12. Existing presales
--
-- The trigger only fires on NEW presales, so every job sold before this
-- migration has a snapshot and no documents. This queues them, in controlled
-- batches, without touching the presale itself.
--
-- It is not run by the migration. Somebody decides when to start, and how many
-- at a time; a few hundred 24-page renders is not something to set going as a
-- side effect of a deploy.
-- -----------------------------------------------------------------------------

create function public.document_backfill(p_limit integer default 25, p_job_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_presale public.presales;
  v_type text;
  v_queued integer := 0;
  v_jobs integer := 0;
begin
  for v_presale in
    select p.*
    from public.presales p
    join public.jobs j on j.id = p.job_id
    where j.record_class <> 'HistoricalImport'
      and (p_job_id is null or p.job_id = p_job_id)
      -- Nothing has ever been asked for on this job.
      and not exists (
        select 1 from public.document_revisions r where r.job_id = p.job_id)
    order by p.submitted_at
    limit greatest(1, least(coalesce(p_limit, 25), 200))
  loop
    v_jobs := v_jobs + 1;
    foreach v_type in array app.document_types() loop
      perform app.document_enqueue(
        v_presale.job_id, v_type,
        -- Same derivation as the trigger, so a backfill and a trigger can
        -- never both queue the same thing.
        uuid_in(md5('presale:' || v_presale.id::text || ':' || v_type)::cstring),
        'system', v_presale.created_by);
      v_queued := v_queued + 1;
    end loop;
  end loop;

  return jsonb_build_object('jobs', v_jobs, 'queued', v_queued);
end
$$;

revoke all on function public.document_backfill(integer, uuid) from public, anon, authenticated;
grant execute on function public.document_backfill(integer, uuid) to service_role;
