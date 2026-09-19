-- =============================================================================
-- P0 Evidence: files are tied to their job/task in the database, uploads are
-- registered before they happen, and staff can open what they may see.
--
-- Reference semantics kept (r1-appsheet/services.js _r1sEnsureOfficeTaskEvidence,
-- installer/workflow.js _iwEvidenceRows, materials/workflow.js :481):
--   * every evidence row belongs to exactly one job; a file belongs to one job
--     only (R1A_CROSS_JOB_EVIDENCE / R1C_CROSS_JOB_EVIDENCE);
--   * the same file used twice is the same evidence row (created:false);
--   * tasks.evidence_id is a pointer that a later upload replaces - earlier
--     evidence rows are kept; nothing is ever deleted or revoked;
--   * a command that needs a file writes nothing until the file is durable
--     (the reference R1C_UPLOAD_PENDING rule) - here the command and the
--     file check share one transaction, so no retry sweep is needed;
--   * installers see only the evidence of work packages they are allocated
--     to, never contract / finance / customer files (_r1cRead, _iwMyWork).
--
-- What was wrong before this migration:
--   * who may upload/read a file was decided by parsing "<job id>/..." out of
--     the storage path (app.can_access_job_files, app.installer_can_upload_
--     job_file). A command accepted ANY existing path and recorded it against
--     its own job, so a file stored under job B could be adopted by job A;
--   * Store staff could never upload a delivery note (office + assigned only),
--     read access ignored the canonical read permissions, and nobody could
--     open a file at all (no read path);
--   * rows carried no uploader, size, real filename, task or work package.
--
-- New model: database metadata is authoritative.
--   1. public.evidence_upload_begin registers the upload: the server derives
--      the job from the task / work package / delivery the actor may act on,
--      validates category, MIME type, size and filename, and mints the
--      storage path. Row status 'Pending'. Idempotent per (person, upload_id).
--   2. Storage accepts an object only where a Pending row of the caller names
--      exactly that path, and serves one only through a row the caller may
--      read. Paths are never parsed for authorization.
--   3. public.evidence_upload_complete (or the command itself, via
--      app.ensure_evidence) checks the stored object and marks the row
--      'Uploaded'. A command never adopts an unregistered path.
--   4. public.evidence_open / public.list_evidence authorize reads.
--
-- Additive only: no column, table or function of another module is dropped.
-- The three path-parsing storage policies are replaced; their helper
-- functions stay (unused). app.ensure_evidence, app.job_evidence and
-- app.iw_evidence keep their signatures.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------

alter table public.evidence
  add column task_id           uuid references public.tasks (id) on delete restrict,
  add column work_package_id   uuid references public.work_packages (id) on delete restrict,
  -- What the upload was registered for: Task | WorkPackage | Delivery | Job.
  add column context_type      text check (context_type in ('Task', 'WorkPackage', 'Delivery', 'Job')),
  add column context_id        uuid,
  add column uploaded_by       uuid references public.people (id),
  add column size_bytes        bigint check (size_bytes is null or size_bytes > 0),
  -- The name the person's device gave the file (display only). "filename" is
  -- the sanitised name used in storage.
  add column original_filename text,
  -- The browser's idempotency key for one upload attempt.
  add column client_upload_id  uuid,
  add column registered_at     timestamptz,
  add column attached_at       timestamptz,
  add column attached_by       uuid references public.people (id);

alter table public.evidence
  add constraint evidence_upload_status_check check (upload_status in ('Pending', 'Uploaded', 'Referenced')),
  add constraint evidence_context_check check ((context_type is null) = (context_id is null));

comment on column public.evidence.upload_status is
  'Pending: registered, file not yet confirmed in storage. Uploaded: file confirmed. Referenced: legacy reference only.';

-- A stored file belongs to one evidence row, so to one job.
create unique index evidence_storage_path_key on public.evidence (storage_path);
create unique index evidence_client_upload_key on public.evidence (uploaded_by, client_upload_id)
  where client_upload_id is not null;
create index evidence_task_idx on public.evidence (task_id) where task_id is not null;
create index evidence_work_package_idx on public.evidence (work_package_id) where work_package_id is not null;
create index evidence_pending_idx on public.evidence (uploaded_by, registered_at) where upload_status = 'Pending';

-- -----------------------------------------------------------------------------
-- Rules: categories, file types, size, names
-- -----------------------------------------------------------------------------

create function app.evidence_installer_categories()
returns text[] language sql immutable set search_path = ''
as $$ select array['Progress', 'Completion', 'Commissioning', 'Problem', 'Variation', 'Return'] $$;

create function app.evidence_categories()
returns text[] language sql immutable set search_path = ''
as $$
  select array['Contract', 'CustomerDetails', 'FinanceAgreement', 'TaskEvidence', 'DeliveryNote', 'Other']
         || app.evidence_installer_categories()
$$;

create function app.evidence_max_bytes()
returns bigint language sql immutable set search_path = ''
as $$ select (25 * 1024 * 1024)::bigint $$;

-- Photos and PDFs only: nothing a browser would run. MIME type -> extensions.
create function app.evidence_file_types()
returns jsonb language sql immutable set search_path = ''
as $$
  select '{"image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"],
           "image/heic": ["heic", "heif"], "image/heif": ["heif", "heic"], "application/pdf": ["pdf"]}'::jsonb
$$;

-- Storage-safe file name: no directories, no control or shell characters, no
-- "..", no leading dot. Null when nothing usable is left.
create function app.evidence_safe_filename(p_name text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_name, ''));
begin
  v := regexp_replace(v, '^.*[/\\]', '');
  v := regexp_replace(v, '[^A-Za-z0-9._ -]+', '', 'g');
  v := regexp_replace(btrim(v), '\s+', '-', 'g');
  v := regexp_replace(v, '\.{2,}', '.', 'g');
  v := right(v, 100);
  v := regexp_replace(v, '^[.-]+', '');
  return nullif(v, '');
end
$$;

-- -----------------------------------------------------------------------------
-- Guards on the table
-- -----------------------------------------------------------------------------

-- Evidence never changes job or file, never goes back to Pending, and every
-- link (task, package, submission, issue) is an object of the same job.
create function app.evidence_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Append-only (reference). Only a registration whose file never arrived may go.
    if old.upload_status <> 'Pending' then
      raise exception 'EVIDENCE_IMMUTABLE' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.job_id is distinct from old.job_id or new.storage_path is distinct from old.storage_path
       or (old.uploaded_by is not null and new.uploaded_by is distinct from old.uploaded_by)
       or (old.upload_status <> 'Pending' and new.upload_status = 'Pending') then
      raise exception 'EVIDENCE_IMMUTABLE' using errcode = 'P0001';
    end if;
  end if;
  if new.task_id is not null
     and not exists (select 1 from public.tasks t where t.id = new.task_id and t.job_id = new.job_id) then
    raise exception 'R1A_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if new.work_package_id is not null
     and not exists (select 1 from public.work_packages w where w.id = new.work_package_id and w.job_id = new.job_id) then
    raise exception 'R1C_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if new.submission_id is not null
     and not exists (select 1 from public.commissioning_submissions s where s.id = new.submission_id and s.job_id = new.job_id) then
    raise exception 'R1C_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if new.issue_id is not null
     and not exists (select 1 from public.issues i where i.id = new.issue_id and i.job_id = new.job_id) then
    raise exception 'R1C_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger evidence_guard before insert or update or delete on public.evidence
  for each row execute function app.evidence_guard();

-- The task -> evidence pointer: same job only; the evidence row learns its
-- task (first task wins - the row is history, the pointer is current); a
-- changed pointer is audited as a replacement. Earlier rows are kept.
create function app.tasks_evidence_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev public.evidence;
  v_old uuid := case when tg_op = 'UPDATE' then old.evidence_id end;
begin
  if new.evidence_id is null or new.evidence_id is not distinct from v_old then
    return new;
  end if;
  select * into v_ev from public.evidence where id = new.evidence_id;
  if v_ev.id is null or new.job_id is null or v_ev.job_id <> new.job_id then
    raise exception 'R1A_CROSS_JOB_EVIDENCE' using errcode = 'P0001';
  end if;
  if v_ev.task_id is null then
    update public.evidence set task_id = new.id where id = v_ev.id;
  end if;
  perform app.audit('Evidence', v_ev.id::text, case when v_old is null then 'TaskLink' else 'TaskReplace' end,
                    case when v_old is null then null
                         else jsonb_build_object('task_id', new.id, 'evidence_id', v_old) end,
                    jsonb_build_object('task_id', new.id, 'evidence_id', v_ev.id, 'job_id', new.job_id,
                                       'template_code', new.template_code, 'category', v_ev.category));
  return new;
end
$$;

create trigger tasks_evidence_link after insert or update of evidence_id on public.tasks
  for each row execute function app.tasks_evidence_link();

-- Backfill the task link for rows that already exist.
update public.evidence e set task_id = t.id
from (select distinct on (evidence_id) id, evidence_id, job_id from public.tasks
      where evidence_id is not null order by evidence_id, created_at, id) t
where t.evidence_id = e.id and t.job_id = e.job_id and e.task_id is null;

update public.evidence e set work_package_id = s.work_package_id
from public.commissioning_submissions s
where s.id = e.submission_id and s.job_id = e.job_id and e.work_package_id is null;

update public.evidence set uploaded_by = captured_by where uploaded_by is null and captured_by is not null;

-- -----------------------------------------------------------------------------
-- Snapshot for audit: metadata only - never file contents, never a URL.
-- -----------------------------------------------------------------------------

create function app.evidence_audit_json(p_e public.evidence)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', p_e.id, 'job_id', p_e.job_id, 'task_id', p_e.task_id,
    'work_package_id', p_e.work_package_id, 'submission_id', p_e.submission_id, 'issue_id', p_e.issue_id,
    'context_type', p_e.context_type, 'context_id', p_e.context_id, 'category', p_e.category,
    'filename', p_e.filename, 'mime_type', p_e.mime_type, 'size_bytes', p_e.size_bytes,
    'upload_status', p_e.upload_status, 'uploaded_by', p_e.uploaded_by)
$$;

-- -----------------------------------------------------------------------------
-- Upload registration
-- -----------------------------------------------------------------------------

-- Who may add a file, and to which job. The job always comes from the domain
-- object the actor may act on - never from the browser.
--   Task         the rule of TASK_COMPLETE / TASK_EVIDENCE_ATTACH: office class,
--                assigned to the job, owner/backup of the task (or Admin).
--                The category follows the template, as the commands set it.
--   WorkPackage  the rule of the installer commands (app.iw_package): an active
--                allocation, or Office/Manager/Admin; FN-06 on.
--   Delivery     the roles and modes registered for GOODS_IN_RECEIVE.
--   Job          office class assigned to the job (issue / supplier / scaffold
--                responses that quote an evidence id).
create function app.evidence_upload_context(p_actor jsonb, p_type text, p_id uuid, p_category text)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_wp public.work_packages;
  v_job public.jobs;
  v_job_id uuid;
  v_reg app.command_registry;
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
begin
  if p_id is null then
    perform app.fail('EVIDENCE_CONTEXT_INVALID');
  end if;

  if p_type = 'Task' then
    select * into v_task from public.tasks where id = p_id;
    if v_task.id is null then
      perform app.fail('R1A_TASK_NOT_FOUND');
    end if;
    if v_task.job_id is null then
      perform app.fail('EVIDENCE_CONTEXT_INVALID');
    end if;
    if not app.is_office(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    if not app.is_assigned(p_actor, v_task.job_id) then
      perform app.fail('R1A_JOB_ACCESS_DENIED');
    end if;
    if app.actor_id(p_actor) not in (v_task.owner_id, coalesce(v_task.backup_id, v_task.owner_id))
       and not app.is_admin(p_actor) then
      perform app.fail('R1A_TASK_ACCESS_DENIED');
    end if;
    perform app.require_mode('FN-01', 'Automated');
    return jsonb_build_object('job_id', v_task.job_id, 'task_id', v_task.id,
      'category', case v_task.template_code when 'PRE02' then 'Contract' when 'PRE04' then 'CustomerDetails'
                                            when 'PRE05' then 'FinanceAgreement' else 'TaskEvidence' end);

  elsif p_type = 'WorkPackage' then
    select * into v_wp from public.work_packages where id = p_id;
    if v_wp.id is null then
      perform app.fail('R1C_WORK_PACKAGE_NOT_FOUND');
    end if;
    select * into v_job from public.jobs where id = v_wp.job_id;
    if not app.iw_job_actionable(v_job) then
      perform app.fail('R1C_JOB_NOT_ACTIONABLE');
    end if;
    if not app.iw_allocated(v_wp.id, app.actor_id(p_actor)) and not app.iw_office(p_actor) then
      perform app.fail('R1C_ASSIGNMENT_DENIED');
    end if;
    perform app.require_mode('FN-06', 'Automated');
    if v_category is null or not v_category = any (app.evidence_installer_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('job_id', v_wp.job_id, 'work_package_id', v_wp.id, 'category', v_category);

  elsif p_type = 'Delivery' then
    select o.job_id into v_job_id from public.deliveries d join public.orders o on o.id = d.order_id where d.id = p_id;
    if v_job_id is null then
      perform app.fail('R1C_DELIVERY_NOT_FOUND');
    end if;
    select * into v_reg from app.command_registry where command_type = 'GOODS_IN_RECEIVE';
    if v_reg.command_type is null or not app.has_role(p_actor, variadic v_reg.roles) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    perform app.require_modes(v_reg.modes);
    return jsonb_build_object('job_id', v_job_id, 'category', 'DeliveryNote');

  elsif p_type = 'Job' then
    if not exists (select 1 from public.jobs j where j.id = p_id) then
      perform app.fail('R1A_JOB_NOT_FOUND');
    end if;
    if not app.is_office(p_actor) then
      perform app.fail('R1A_ROLE_DENIED');
    end if;
    if not app.is_assigned(p_actor, p_id) then
      perform app.fail('R1A_JOB_ACCESS_DENIED');
    end if;
    if v_category is null or not v_category = any (app.evidence_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('job_id', p_id, 'category', v_category);
  end if;

  perform app.fail('EVIDENCE_CONTEXT_INVALID');
  return null;
end
$$;

-- Registers one upload and returns where the file must be stored.
-- Request: { upload_id, context_type, context_id, category?, filename,
--            mime_type, size_bytes }
-- The same upload_id from the same person returns the same registration
-- (a retry); the same upload_id for different content is refused.
create function public.evidence_upload_begin(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb;
  v_key text;
  v_upload_id uuid;
  v_context_id uuid;
  v_type text;
  v_mime text;
  v_size bigint;
  v_name text;
  v_ext text;
  v_part text;
  v_ctx jsonb;
  v_row public.evidence;
  v_id uuid;
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('upload_id', 'context_type', 'context_id', 'category', 'filename', 'mime_type', 'size_bytes') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;

  v_actor := app.resolve_actor();

  if coalesce(p_request ->> 'upload_id', '') !~* v_uuid or coalesce(p_request ->> 'context_id', '') !~* v_uuid then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_upload_id := (p_request ->> 'upload_id')::uuid;
  v_context_id := (p_request ->> 'context_id')::uuid;
  v_type := p_request ->> 'context_type';

  -- File rules first: they need no database state.
  v_mime := lower(btrim(coalesce(p_request ->> 'mime_type', '')));
  if not app.evidence_file_types() ? v_mime then
    perform app.fail('EVIDENCE_TYPE_NOT_ALLOWED');
  end if;
  if coalesce(p_request ->> 'size_bytes', '') !~ '^[0-9]{1,12}$' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_size := (p_request ->> 'size_bytes')::bigint;
  if v_size <= 0 then
    perform app.fail('R1A_UPLOAD_INVALID');
  end if;
  if v_size > app.evidence_max_bytes() then
    perform app.fail('EVIDENCE_TOO_LARGE');
  end if;
  v_name := app.evidence_safe_filename(p_request ->> 'filename');
  if v_name is null or position('.' in v_name) = 0 then
    perform app.fail('EVIDENCE_FILENAME_INVALID');
  end if;
  v_ext := lower(substring(v_name from '\.([A-Za-z0-9]+)$'));
  if v_ext is null or not (app.evidence_file_types() -> v_mime) ? v_ext then
    perform app.fail('EVIDENCE_TYPE_NOT_ALLOWED');
  end if;
  -- "invoice.php.pdf": no inner segment may be something a server or browser runs.
  foreach v_part in array (string_to_array(lower(v_name), '.'))[2:] loop
    if v_part in ('php', 'phtml', 'exe', 'dll', 'com', 'bat', 'cmd', 'sh', 'ps1', 'js', 'mjs', 'jsp', 'asp', 'aspx',
                  'cgi', 'pl', 'py', 'rb', 'jar', 'msi', 'scr', 'vbs', 'html', 'htm', 'xhtml', 'svg', 'xml', 'hta') then
      perform app.fail('EVIDENCE_FILENAME_INVALID');
    end if;
  end loop;

  perform set_config('app.actor_id', app.actor_id(v_actor)::text, true);
  perform set_config('app.executing_service', 'evidence:upload', true);
  perform pg_advisory_xact_lock(hashtextextended('evidence-upload:' || v_upload_id, 0));

  -- Current authorization always applies, including to a retry.
  v_ctx := app.evidence_upload_context(v_actor, v_type, v_context_id, p_request ->> 'category');

  select * into v_row from public.evidence
  where uploaded_by = app.actor_id(v_actor) and client_upload_id = v_upload_id;
  if v_row.id is not null then
    if v_row.context_type is distinct from v_type or v_row.context_id is distinct from v_context_id
       or v_row.filename <> v_name
       -- once confirmed, size and type are what storage measured, not what was declared
       or (v_row.upload_status = 'Pending'
           and (v_row.mime_type is distinct from v_mime or v_row.size_bytes is distinct from v_size)) then
      perform app.fail('EVIDENCE_UPLOAD_CONFLICT');
    end if;
    return jsonb_build_object('evidence_id', v_row.id, 'bucket', 'evidence', 'storage_path', v_row.storage_path,
      'upload_status', v_row.upload_status, 'category', v_row.category, 'replayed', true);
  end if;

  if exists (select 1 from public.evidence where client_upload_id = v_upload_id) then
    perform app.fail('EVIDENCE_UPLOAD_CONFLICT');
  end if;
  if (select count(*) from public.evidence e where e.uploaded_by = app.actor_id(v_actor)
        and e.upload_status = 'Pending' and e.registered_at > now() - interval '1 hour') >= 50 then
    perform app.fail('EVIDENCE_TOO_MANY_PENDING');
  end if;

  v_id := gen_random_uuid();
  insert into public.evidence (id, job_id, task_id, work_package_id, context_type, context_id, category,
                               storage_path, filename, original_filename, mime_type, size_bytes, upload_status,
                               captured_at, captured_by, uploaded_by, client_upload_id, registered_at,
                               customer_shareable)
  values (v_id, (v_ctx ->> 'job_id')::uuid, (v_ctx ->> 'task_id')::uuid, (v_ctx ->> 'work_package_id')::uuid,
          v_type, v_context_id, v_ctx ->> 'category',
          (v_ctx ->> 'job_id') || '/' || v_id || '/' || v_name, v_name,
          nullif(left(regexp_replace(btrim(coalesce(p_request ->> 'filename', '')), '[[:cntrl:]]', '', 'g'), 255), ''),
          v_mime, v_size, 'Pending', now(), app.actor_id(v_actor), app.actor_id(v_actor), v_upload_id, now(), false)
  returning * into v_row;

  perform app.audit('Evidence', v_row.id::text, 'Register', null, app.evidence_audit_json(v_row));

  return jsonb_build_object('evidence_id', v_row.id, 'bucket', 'evidence', 'storage_path', v_row.storage_path,
    'upload_status', v_row.upload_status, 'category', v_row.category, 'replayed', false);
end
$$;

-- Confirms the stored object of a Pending row and marks it Uploaded. Storage
-- is the witness: the object must exist under exactly the registered path,
-- belong to the uploader, and be an allowed type within the size limit.
-- (Test engines without a storage schema have nothing to check.)
create function app.evidence_finalize(p_evidence_id uuid)
returns public.evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.evidence;
  v_after public.evidence;
  v_meta jsonb;
  v_owner text;
  v_uploader text;
  v_size bigint;
  v_mime text;
begin
  select * into v_row from public.evidence where id = p_evidence_id for update;
  if v_row.id is null then
    perform app.fail('EVIDENCE_NOT_FOUND');
  end if;
  if v_row.upload_status <> 'Pending' then
    return v_row;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select o.metadata, o.owner_id::text from storage.objects o where o.bucket_id = $1 and o.name = $2'
      into v_meta, v_owner using 'evidence', v_row.storage_path;
    if v_meta is null then
      perform app.fail('R1A_UPLOAD_MISSING');
    end if;
    v_size := nullif(v_meta ->> 'size', '')::bigint;
    v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
    if v_size is null or v_size <= 0 then
      perform app.fail('R1A_UPLOAD_INVALID');
    end if;
    if v_size > app.evidence_max_bytes() then
      perform app.fail('EVIDENCE_TOO_LARGE');
    end if;
    if not app.evidence_file_types() ? v_mime then
      perform app.fail('EVIDENCE_TYPE_NOT_ALLOWED');
    end if;
    select p.auth_user_id::text into v_uploader from public.people p where p.id = v_row.uploaded_by;
    if v_owner is not null and v_uploader is not null and v_owner <> v_uploader then
      perform app.fail('EVIDENCE_OBJECT_MISMATCH');
    end if;
  end if;
  update public.evidence
  set upload_status = 'Uploaded', received_at = now(), size_bytes = coalesce(v_size, size_bytes),
      mime_type = coalesce(nullif(v_mime, ''), mime_type), checksum = coalesce(v_meta ->> 'eTag', checksum)
  where id = v_row.id
  returning * into v_after;
  perform app.audit('Evidence', v_after.id::text, 'Upload', app.evidence_audit_json(v_row), app.evidence_audit_json(v_after));
  return v_after;
end
$$;

-- The uploader reports the file is in storage. Safe to repeat.
create function public.evidence_upload_complete(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_row public.evidence;
begin
  select * into v_row from public.evidence where id = p_evidence_id;
  if v_row.id is null or (v_row.uploaded_by is distinct from app.actor_id(v_actor) and not app.is_admin(v_actor)) then
    perform app.fail('EVIDENCE_NOT_FOUND');
  end if;
  perform set_config('app.actor_id', app.actor_id(v_actor)::text, true);
  perform set_config('app.executing_service', 'evidence:upload', true);
  v_row := app.evidence_finalize(v_row.id);
  return jsonb_build_object('evidence_id', v_row.id, 'storage_path', v_row.storage_path,
    'upload_status', v_row.upload_status, 'category', v_row.category, 'filename', v_row.filename,
    'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes);
end
$$;

-- -----------------------------------------------------------------------------
-- Attaching a file to a command's work (replaces the path-trusting version)
-- -----------------------------------------------------------------------------

-- Returns the job's evidence row for a storage path and whether this call is
-- the first to use it. A registered row must be of the same job and its file
-- must be durable (a Pending row is confirmed here, inside the command's
-- transaction: if the file is missing the whole command fails and nothing is
-- written). The command decides the category of a file it is the first to use.
-- An unregistered path is never adopted where storage exists.
create function app.evidence_attach(p_job_id uuid, p_category text, p_storage_path text,
                                    out evidence_id uuid, out newly_attached boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text := nullif(btrim(p_storage_path), '');
  v_row public.evidence;
  v_after public.evidence;
begin
  if v_path is null then
    perform app.fail('R1A_UPLOAD_INVALID');
  end if;
  select * into v_row from public.evidence e where e.storage_path = v_path for update;

  if v_row.id is null then
    if to_regclass('storage.objects') is not null then
      perform app.fail('R1A_UPLOAD_INVALID', jsonb_build_object('reason', 'unregistered upload'));
    end if;
    -- Engines without storage (database tests): the reference behaviour, one
    -- row per (job, file), and the file may not sit under another job's folder.
    if app.storage_job_id(v_path) is distinct from p_job_id then
      perform app.fail('R1A_CROSS_JOB_EVIDENCE');
    end if;
    insert into public.evidence (job_id, category, storage_path, filename, upload_status, captured_at, captured_by,
                                 uploaded_by, received_at, customer_shareable, attached_at, attached_by)
    values (p_job_id, p_category, v_path, regexp_replace(v_path, '^.*/', ''), 'Uploaded', now(),
            app.context_actor_id(), app.context_actor_id(), now(), false, now(), app.context_actor_id())
    returning * into v_after;
    perform app.audit('Evidence', v_after.id::text, 'Attach', null, app.evidence_audit_json(v_after));
    evidence_id := v_after.id;
    newly_attached := true;
    return;
  end if;

  if v_row.job_id <> p_job_id then
    perform app.fail('R1A_CROSS_JOB_EVIDENCE');
  end if;
  if v_row.upload_status = 'Pending' then
    v_row := app.evidence_finalize(v_row.id);
  end if;
  evidence_id := v_row.id;
  newly_attached := v_row.attached_at is null;
  if newly_attached then
    update public.evidence
    set category = coalesce(p_category, category), attached_at = now(), attached_by = app.context_actor_id()
    where id = v_row.id
    returning * into v_after;
    perform app.audit('Evidence', v_after.id::text, 'Attach', app.evidence_audit_json(v_row), app.evidence_audit_json(v_after));
  end if;
end
$$;

create or replace function app.ensure_evidence(p_job_id uuid, p_category text, p_storage_path text)
returns uuid
language sql
security definer
set search_path = ''
as $$ select a.evidence_id from app.evidence_attach(p_job_id, p_category, p_storage_path) a $$;

-- An existing evidence id (or registered path) that must belong to the job and
-- whose file must have arrived.
create or replace function app.job_evidence(p_job_id uuid, p_evidence_id text, p_missing_code text)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_row public.evidence;
begin
  if nullif(btrim(p_evidence_id), '') is null then
    perform app.fail('R1A_REQUIRED_EVIDENCE_ID');
  end if;
  if btrim(p_evidence_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into v_row from public.evidence where id = btrim(p_evidence_id)::uuid;
  end if;
  if v_row.id is null then
    select * into v_row from public.evidence where storage_path = btrim(p_evidence_id);
  end if;
  if v_row.id is null then
    perform app.fail(p_missing_code);
  end if;
  if v_row.job_id <> p_job_id then
    perform app.fail('R1A_CROSS_JOB_EVIDENCE');
  end if;
  if v_row.upload_status = 'Pending' then
    perform app.fail('R1A_UPLOAD_MISSING');
  end if;
  return v_row.id;
end
$$;

-- Installer evidence (installer/workflow.js _iwEvidenceRows). Same contract as
-- before - [{evidence_id, created}], created = first use of the file - but
-- every file now goes through app.evidence_attach, so a registered upload is
-- confirmed, categorised by the command and linked to its issue / submission.
-- File name and type come from the registration, not from the command.
create or replace function app.iw_evidence(p_job_id uuid, p_items jsonb, p_category text,
                                           p_submission_id uuid default null, p_issue_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_att record;
  v_row public.evidence;
  v_out jsonb := '[]'::jsonb;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select * into v_att from app.evidence_attach(p_job_id, p_category, app.iw_text(v_item -> 'storage_path'));
    select * into v_row from public.evidence where id = v_att.evidence_id;
    if v_att.newly_attached then
      update public.evidence
      set submission_id = p_submission_id, issue_id = p_issue_id,
          work_package_id = coalesce(work_package_id,
            (select s.work_package_id from public.commissioning_submissions s where s.id = p_submission_id)),
          filename = case when registered_at is null then coalesce(app.iw_text(v_item -> 'filename'), filename) else filename end,
          mime_type = case when registered_at is null then app.iw_text(v_item -> 'mime_type') else mime_type end
      where id = v_row.id;
    else
      if p_submission_id is not null and v_row.submission_id is distinct from p_submission_id then
        if v_row.submission_id is not null then
          -- Deviation (kept): one evidence row per file - a returned version keeps its link.
          perform app.fail('IW_REVIEW: evidence file already linked to another submission; upload it again');
        end if;
        update public.evidence
        set submission_id = p_submission_id,
            work_package_id = coalesce(work_package_id,
              (select s.work_package_id from public.commissioning_submissions s where s.id = p_submission_id))
        where id = v_row.id;
      end if;
      if p_issue_id is not null and v_row.issue_id is null then
        update public.evidence set issue_id = p_issue_id where id = v_row.id;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('evidence_id', v_row.id, 'created', v_att.newly_attached));
  end loop;
  return v_out;
end
$$;

-- -----------------------------------------------------------------------------
-- Read authorization
-- -----------------------------------------------------------------------------

-- Who may see (and open) an evidence file. Only files that have arrived.
--   * staff roles read the evidence of every job they may read
--     (app.can_read_job: job.read.all / job.read.own / assignment);
--   * Store reads delivery notes (goods-in is not job-assigned);
--   * field roles (Installer ...) read installer-category evidence of a work
--     package they hold an active allocation on - or, for older rows with no
--     package, their own photos on a job they are allocated to. Never
--     contracts, finance agreements, customer details or delivery notes.
create function app.can_read_evidence(p_actor jsonb, p_e public.evidence)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_actor is not null and p_e.id is not null and p_e.upload_status in ('Uploaded', 'Referenced') and (
    (app.has_role(p_actor, 'Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance')
      and app.can_read_job(p_actor, p_e.job_id))
    or (app.has_role(p_actor, 'Store') and p_e.category = 'DeliveryNote')
    or (p_e.category = any (app.evidence_installer_categories())
        and exists (
          select 1
          from public.allocations a
          join public.work_packages w on w.id = a.work_package_id
          where a.person_id = app.actor_id(p_actor) and a.active and w.status <> 'Cancelled' and w.job_id = p_e.job_id
            and case
                  when coalesce(p_e.work_package_id,
                                (select s.work_package_id from public.commissioning_submissions s
                                 where s.id = p_e.submission_id)) is not null
                    then w.id = coalesce(p_e.work_package_id,
                                         (select s.work_package_id from public.commissioning_submissions s
                                          where s.id = p_e.submission_id))
                  else app.actor_id(p_actor) in (p_e.captured_by, p_e.uploaded_by)
                end)))
$$;

-- Direct table reads agree with the rule above; the uploader also sees their
-- own registration while the file is on its way.
drop policy if exists evidence_select on public.evidence;
create policy evidence_select on public.evidence for select to authenticated
  using (app.can_read_evidence((select app.current_actor()), evidence)
         or (upload_status = 'Pending' and uploaded_by = (select app.current_person_id())));

-- The file behind an evidence row. Refuses by code; the caller turns the
-- storage path into a short-lived signed URL under the same session, which
-- storage checks again (policy below). Read-only.
create function public.evidence_open(p_evidence_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_row public.evidence;
begin
  select * into v_row from public.evidence where id = p_evidence_id;
  if v_row.id is null then
    perform app.fail('EVIDENCE_NOT_FOUND');
  end if;
  if v_row.upload_status = 'Pending' then
    if v_row.uploaded_by = app.actor_id(v_actor) then
      perform app.fail('EVIDENCE_NOT_READY');
    end if;
    perform app.fail('EVIDENCE_ACCESS_DENIED');
  end if;
  if not app.can_read_evidence(v_actor, v_row) then
    perform app.fail('EVIDENCE_ACCESS_DENIED');
  end if;
  if v_row.upload_status = 'Referenced' then
    perform app.fail('EVIDENCE_FILE_MISSING');
  end if;
  return jsonb_build_object('evidence_id', v_row.id, 'bucket', 'evidence', 'storage_path', v_row.storage_path,
    'filename', coalesce(v_row.original_filename, v_row.filename), 'safe_filename', v_row.filename,
    'mime_type', v_row.mime_type, 'size_bytes', v_row.size_bytes, 'category', v_row.category, 'job_id', v_row.job_id);
end
$$;

-- Evidence of one job, task or work package, as the actor may see it.
-- Request: exactly one of { job_id | task_id | work_package_id }.
-- Never returns a storage path. Read-only.
create function public.list_evidence(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_key text;
  v_scope text;
  v_id uuid;
  v_task public.tasks;
  v_rows jsonb;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object'
     or (select count(*) from jsonb_object_keys(p_request)) <> 1 then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  select k into v_key from jsonb_object_keys(p_request) k;
  if v_key not in ('job_id', 'task_id', 'work_package_id')
     or coalesce(p_request ->> v_key, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_scope := v_key;
  v_id := (p_request ->> v_key)::uuid;
  if v_scope = 'task_id' then
    select * into v_task from public.tasks where id = v_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'job_id', e.job_id, 'task_id', e.task_id, 'work_package_id', e.work_package_id,
           'submission_id', e.submission_id, 'issue_id', e.issue_id, 'category', e.category,
           'filename', coalesce(e.original_filename, e.filename), 'mime_type', e.mime_type,
           'size_bytes', e.size_bytes, 'upload_status', e.upload_status,
           'added_at', coalesce(e.received_at, e.created_at),
           'added_by_name', (select p.display_name from public.people p where p.id = coalesce(e.uploaded_by, e.captured_by)),
           'task_title', (select t.title from public.tasks t where t.id = e.task_id),
           'current', case when v_scope = 'task_id' then e.id = v_task.evidence_id end,
           'can_open', e.upload_status = 'Uploaded')
           order by coalesce(e.received_at, e.created_at) desc, e.id), '[]'::jsonb)
  into v_rows
  from public.evidence e
  where app.can_read_evidence(v_actor, e)
    and case v_scope
          when 'job_id' then e.job_id = v_id
          when 'task_id' then v_task.id is not null and e.job_id = v_task.job_id
                              and (e.task_id = v_task.id or e.id = v_task.evidence_id)
          else e.work_package_id = v_id
               or exists (select 1 from public.commissioning_submissions s
                          where s.id = e.submission_id and s.work_package_id = v_id)
        end;
  return jsonb_build_object('scope', v_scope, 'id', v_id, 'count', jsonb_array_length(v_rows), 'evidence', v_rows);
end
$$;

-- -----------------------------------------------------------------------------
-- Metadata and storage must not drift apart silently
-- -----------------------------------------------------------------------------

-- A reader found the file gone. Verified against storage, audited once.
create function public.evidence_report_missing(p_evidence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_row public.evidence;
  v_exists boolean := true;
begin
  select * into v_row from public.evidence where id = p_evidence_id;
  if v_row.id is null or not app.can_read_evidence(v_actor, v_row) then
    perform app.fail('EVIDENCE_NOT_FOUND');
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select exists (select 1 from storage.objects o where o.bucket_id = $1 and o.name = $2)'
      into v_exists using 'evidence', v_row.storage_path;
  end if;
  if not v_exists and not exists (select 1 from public.audit_events a where a.entity_type = 'Evidence'
                                  and a.entity_id = v_row.id::text and a.action = 'FileMissing') then
    perform set_config('app.actor_id', app.actor_id(v_actor)::text, true);
    perform set_config('app.executing_service', 'evidence:open', true);
    perform app.audit('Evidence', v_row.id::text, 'FileMissing', app.evidence_audit_json(v_row), null,
                      'stored file not found when opening');
  end if;
  return jsonb_build_object('evidence_id', v_row.id, 'file_present', v_exists);
end
$$;

-- Admin check: uploads that never arrived, rows whose file is gone, stored
-- files with no row. (Up to 200 of each.)
create function public.evidence_consistency()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_missing jsonb := '[]'::jsonb;
  v_orphans jsonb := '[]'::jsonb;
  v_stale jsonb;
begin
  if not app.is_admin(v_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('evidence_id', s.id, 'job_id', s.job_id, 'registered_at', s.registered_at,
                                               'uploaded_by', s.uploaded_by)), '[]'::jsonb)
  into v_stale
  from (select * from public.evidence e where e.upload_status = 'Pending' and e.registered_at < now() - interval '1 hour'
        order by e.registered_at limit 200) s;
  if to_regclass('storage.objects') is not null then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('evidence_id', m.id, 'job_id', m.job_id, 'category', m.category)), '[]'::jsonb)
      from (select e.id, e.job_id, e.category from public.evidence e
            where e.upload_status = 'Uploaded'
              and not exists (select 1 from storage.objects o where o.bucket_id = 'evidence' and o.name = e.storage_path)
            order by e.created_at limit 200) m $q$ into v_missing;
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('object_id', x.id, 'created_at', x.created_at)), '[]'::jsonb)
      from (select o.id, o.created_at from storage.objects o
            where o.bucket_id = 'evidence'
              and not exists (select 1 from public.evidence e where e.storage_path = o.name)
            order by o.created_at limit 200) x $q$ into v_orphans;
  end if;
  return jsonb_build_object('pending_stale', v_stale, 'file_missing', v_missing, 'object_without_metadata', v_orphans);
end
$$;

-- -----------------------------------------------------------------------------
-- Storage: private bucket, limits enforced by storage itself, and policies
-- that look the object up in the evidence table (never parse its name).
-- -----------------------------------------------------------------------------

create function app.evidence_can_store_object(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_actor() and exists (
    select 1 from public.evidence e
    where e.storage_path = p_name and e.upload_status = 'Pending' and e.uploaded_by = app.current_person_id())
$$;

create function app.evidence_can_read_object(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_active_actor() and exists (
    select 1 from public.evidence e
    where e.storage_path = p_name and app.can_read_evidence(app.current_actor(), e))
$$;

do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
  on conflict (id) do nothing;
  update storage.buckets
  set public = false, file_size_limit = app.evidence_max_bytes(),
      allowed_mime_types = array(select jsonb_object_keys(app.evidence_file_types()))
  where id = 'evidence';
  drop policy if exists evidence_insert on storage.objects;
  drop policy if exists evidence_select on storage.objects;
  drop policy if exists evidence_installer_insert on storage.objects;
  -- No update or delete policy: a stored file can be neither overwritten nor removed by staff.
  execute $p$create policy evidence_object_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'evidence' and app.evidence_can_store_object(name))$p$;
  execute $p$create policy evidence_object_select on storage.objects for select to authenticated
    using (bucket_id = 'evidence' and app.evidence_can_read_object(name))$p$;
end
$$;

-- -----------------------------------------------------------------------------
-- Staff wording for the new refusals (append-only extension of the catalogue)
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_evidence;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_evidence() || '{
  "EVIDENCE_TYPE_NOT_ALLOWED": ["ActionRequired", "Only photos (JPG, PNG, WebP, HEIC) and PDF files can be added. Choose a different file."],
  "EVIDENCE_TOO_LARGE": ["ActionRequired", "Files must be 25 MB or smaller. Choose a smaller file."],
  "EVIDENCE_FILENAME_INVALID": ["ActionRequired", "That file name can''t be used. Rename the file and try again."],
  "EVIDENCE_CATEGORY_INVALID": ["Failed", "That kind of evidence can''t be added here."],
  "EVIDENCE_CONTEXT_INVALID": ["Failed", "Files can''t be added to that record."],
  "EVIDENCE_UPLOAD_CONFLICT": ["ActionRequired", "That upload was already used for a different file. Choose the file again."],
  "EVIDENCE_TOO_MANY_PENDING": ["ActionRequired", "Too many unfinished uploads. Wait a few minutes and try again."],
  "EVIDENCE_NOT_FOUND": ["Failed", "That file could not be found."],
  "EVIDENCE_ACCESS_DENIED": ["Failed", "You don''t have access to that file."],
  "EVIDENCE_NOT_READY": ["ActionRequired", "That file is still uploading. Try again in a moment."],
  "EVIDENCE_FILE_MISSING": ["Failed", "The record exists but the stored file is missing. Tell an administrator."],
  "EVIDENCE_OBJECT_MISMATCH": ["Failed", "The stored file doesn''t match the upload. Upload it again."],
  "EVIDENCE_IMMUTABLE": ["Failed", "Saved evidence can''t be changed."]
  }'::jsonb
$$;

-- -----------------------------------------------------------------------------
-- Privileges: entry points for signed-in staff; policy helpers for RLS.
-- -----------------------------------------------------------------------------

revoke execute on function public.evidence_upload_begin(jsonb), public.evidence_upload_complete(uuid),
  public.evidence_open(uuid), public.list_evidence(jsonb), public.evidence_report_missing(uuid),
  public.evidence_consistency() from public, anon;
grant execute on function public.evidence_upload_begin(jsonb), public.evidence_upload_complete(uuid),
  public.evidence_open(uuid), public.list_evidence(jsonb), public.evidence_report_missing(uuid),
  public.evidence_consistency() to authenticated, service_role;
grant execute on function app.can_read_evidence(jsonb, public.evidence), app.evidence_can_store_object(text),
  app.evidence_can_read_object(text) to authenticated;
