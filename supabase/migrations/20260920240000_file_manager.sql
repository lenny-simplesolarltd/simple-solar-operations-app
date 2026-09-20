-- =============================================================================
-- File manager: real folders over the documents that already exist.
--
-- The system already had ONE document spine: public.evidence, one row per
-- stored file, and a private "evidence" bucket whose objects are named
-- "<job_id>/<evidence_id>/<safe name>". Two facts about that spine decide the
-- whole design here:
--
--   * the storage object's name already carries IDENTITY (the evidence id),
--     never filing. Nothing about where a document "lives" has ever been
--     encoded in its path.
--   * app.evidence_guard makes job_id and storage_path immutable, storage's
--     own policies look an object up in public.evidence rather than parsing
--     its name, and there is no storage UPDATE or DELETE policy at all.
--
-- So filing is added as a LOGICAL layer and nothing is migrated:
--
--   * public.file_folders is a nested folder tree. A folder is either a job's
--     folder (scope 'Job') or a company folder (scope 'Library').
--   * public.evidence gains folder_id, display_name, trashed_at and
--     filing_version - all mutable, none of them load-bearing for evidence.
--     Moving or renaming a document touches only these, so its task,
--     work package, submission and issue links, its category, its job and its
--     stored bytes are untouched by construction. There is no code path that
--     can move a document to another job: job_id remains immutable.
--   * every existing document is reachable exactly as before (folder_id null
--     means "the job's top level"), so no backfill and no storage rename.
--
-- Company documents (scope 'Library') are the one invariant that genuinely
-- changes: public.evidence.job_id becomes nullable, permitted ONLY for a row
-- whose scope is 'Library'. Such a row may carry no task, work package,
-- submission or issue link - it is a filed document, never evidence of work -
-- and is read through the new file.library.read permission rather than job
-- visibility. Job rows are unchanged: scope 'Job' still requires job_id, and
-- every existing row is scope 'Job'.
--
-- Deleting is filing, not destruction: trashing sets trashed_at, restoring
-- clears it, and a document that any task, submission or issue actually relies
-- on cannot be trashed at all. Permanent deletion is a separate permission and
-- leaves an unreadable tombstone row so the audit trail survives the file.
--
-- Additive only: no column, table or function of another module is dropped.
-- app.evidence_guard, app.can_read_evidence, app.evidence_attach,
-- app.evidence_upload_context, public.evidence_upload_begin and
-- public.search_evidence are replaced in place and keep their signatures.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('file.manage',
   'Organise documents: create, rename, move and trash folders; rename, move, trash and restore files.'),
  ('file.purge',
   'Permanently delete a trashed document, destroying the stored file. Cannot be undone.'),
  ('file.library.read',
   'See company documents - the file library that belongs to no job.'),
  ('file.library.manage',
   'Add, organise and trash company documents in the file library.')
on conflict (code) do nothing;

-- Office class organises documents; Finance and Surveyor read the library
-- because contracts, price lists and templates are theirs to consult.
-- Only Admin/Manager may destroy a document for good.
insert into public.role_permissions (role_code, permission_code)
select r.code, p.code
from public.roles r
cross join (values ('file.manage'), ('file.library.read'), ('file.library.manage')) as p (code)
where r.code in ('Admin', 'Manager', 'Director', 'Office')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.code, 'file.library.read'
from public.roles r
where r.code in ('Finance', 'Surveyor', 'VariationApprover')
on conflict do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.code, 'file.purge'
from public.roles r
where r.code in ('Admin', 'Manager')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Names
-- -----------------------------------------------------------------------------

-- A folder or display name a person typed. Returns a refusal code, or null
-- when the name is usable. Deliberately stricter than storage needs: these
-- names are shown, searched and used in breadcrumbs, never in a path.
create function app.file_name_problem(p_name text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v text := coalesce(p_name, '');
begin
  if v <> btrim(v) then
    return 'FILE_NAME_INVALID';
  end if;
  if length(v) = 0 then
    return 'FILE_NAME_REQUIRED';
  end if;
  if length(v) > 80 then
    return 'FILE_NAME_TOO_LONG';
  end if;
  -- Separators and traversal: a name is one segment, never a path.
  if v ~ '[/\\]' or v in ('.', '..') or v ~ '\.\.' then
    return 'FILE_NAME_INVALID';
  end if;
  -- Control characters, and the characters that break a download header.
  if v ~ '[[:cntrl:]]' or v ~ '["<>|:*?]' then
    return 'FILE_NAME_INVALID';
  end if;
  if v ~ '^\.' then
    return 'FILE_NAME_INVALID';
  end if;
  return null;
end
$$;

create function app.file_require_name(p_name text)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  v_problem text := app.file_name_problem(p_name);
begin
  if v_problem is not null then
    perform app.fail(v_problem);
  end if;
  return p_name;
end
$$;

-- -----------------------------------------------------------------------------
-- 3. The folder tree
-- -----------------------------------------------------------------------------

create table public.file_folders (
  id          uuid primary key default gen_random_uuid(),
  -- 'Job': the folders of one job. 'Library': company documents, no job.
  scope       text not null check (scope in ('Job', 'Library')),
  job_id      uuid references public.jobs (id) on delete restrict,
  parent_id   uuid references public.file_folders (id) on delete restrict,
  name        text not null,
  -- Ancestors, outermost first, excluding this folder. Maintained by trigger:
  -- it makes "is this folder inside that one" a containment test rather than a
  -- recursive walk, which is what cycle prevention and subtree moves need.
  path_ids    uuid[] not null default '{}',
  depth       integer not null default 0 check (depth between 0 and 10),
  trashed_at  timestamptz,
  trashed_by  uuid references public.people (id),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.people (id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.people (id),
  version     integer not null default 1 check (version >= 1),
  constraint file_folders_scope_job_check check ((scope = 'Job') = (job_id is not null)),
  constraint file_folders_not_own_parent check (parent_id is distinct from id),
  constraint file_folders_trashed_by_check check ((trashed_at is null) = (trashed_by is null))
);

comment on table public.file_folders is
  'User-visible filing hierarchy. A folder holds documents (public.evidence) and other folders. '
  'Folders carry no bytes: storage object names are identity, never filing.';
comment on column public.file_folders.path_ids is
  'Ancestor ids outermost first, excluding this folder. Maintained by app.file_folders_guard.';

-- Sentinels: a unique index cannot treat two nulls as equal, but "two folders
-- called Contracts at a job's top level" must still collide.
create unique index file_folders_sibling_name_key on public.file_folders (
  coalesce(job_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(name)
) where trashed_at is null;

create index file_folders_job_idx on public.file_folders (job_id) where job_id is not null;
create index file_folders_parent_idx on public.file_folders (parent_id);
create index file_folders_path_idx on public.file_folders using gin (path_ids);

alter table public.file_folders enable row level security;

-- Structure, depth and cycles. Authorization is the commands' job; this is the
-- invariant that must hold however a row is written.
create function app.file_folders_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.file_folders;
begin
  if tg_op = 'UPDATE' then
    if new.scope is distinct from old.scope or new.job_id is distinct from old.job_id then
      raise exception 'FILE_FOLDER_SCOPE_IMMUTABLE' using errcode = 'P0001';
    end if;
  end if;

  perform app.file_require_name(new.name);

  if new.parent_id is null then
    new.path_ids := '{}';
    new.depth := 0;
  else
    select * into v_parent from public.file_folders where id = new.parent_id;
    if v_parent.id is null then
      raise exception 'FILE_FOLDER_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- A folder never leaves its scope, and a job's folders never mix.
    if v_parent.scope is distinct from new.scope or v_parent.job_id is distinct from new.job_id then
      raise exception 'FILE_FOLDER_SCOPE_MISMATCH' using errcode = 'P0001';
    end if;
    if v_parent.trashed_at is not null and new.trashed_at is null then
      raise exception 'FILE_FOLDER_PARENT_TRASHED' using errcode = 'P0001';
    end if;
    -- Into itself, or into its own descendant.
    if v_parent.id = new.id or v_parent.path_ids @> array[new.id] then
      raise exception 'FILE_FOLDER_CYCLE' using errcode = 'P0001';
    end if;
    new.path_ids := v_parent.path_ids || v_parent.id;
    new.depth := v_parent.depth + 1;
    if new.depth > 10 then
      raise exception 'FILE_FOLDER_TOO_DEEP' using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$$;

create trigger file_folders_guard before insert or update on public.file_folders
  for each row execute function app.file_folders_guard();

create trigger file_folders_stamp before insert or update on public.file_folders
  for each row execute function app.stamp_row();

create trigger file_folders_audit after insert or update or delete on public.file_folders
  for each row execute function app.audit_row_change();

insert into app.audit_required (table_name, operations, reason) values
  ('file_folders', '{INSERT,UPDATE,DELETE}', 'filing hierarchy for business documents')
on conflict (table_name) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Filing columns on the document spine
-- -----------------------------------------------------------------------------

alter table public.evidence
  add column scope          text not null default 'Job' check (scope in ('Job', 'Library')),
  add column folder_id      uuid references public.file_folders (id) on delete restrict,
  -- What staff called the document. Null means "use the uploaded file name".
  -- The stored object's name never changes.
  add column display_name   text,
  add column trashed_at     timestamptz,
  add column trashed_by     uuid references public.people (id),
  -- Permanently deleted: the row survives as an unreadable tombstone so the
  -- audit trail outlives the file.
  add column purged_at      timestamptz,
  add column purged_by      uuid references public.people (id),
  -- Optimistic concurrency for filing operations only. Independent of
  -- evidence.version, which counts file versions.
  add column filing_version integer not null default 1 check (filing_version >= 1);

-- Company documents are the only rows allowed to have no job.
alter table public.evidence alter column job_id drop not null;

alter table public.evidence
  add constraint evidence_scope_job_check check ((scope = 'Job') = (job_id is not null)),
  -- A filed company document is never evidence of work on a job.
  add constraint evidence_library_has_no_work_links check (
    scope = 'Job' or (task_id is null and work_package_id is null
                      and submission_id is null and issue_id is null)),
  add constraint evidence_trashed_by_check check ((trashed_at is null) = (trashed_by is null)),
  add constraint evidence_purged_by_check check ((purged_at is null) = (purged_by is null)),
  -- Nothing is destroyed that was not first put in the trash.
  add constraint evidence_purge_requires_trash check (purged_at is null or trashed_at is not null);

comment on column public.evidence.scope is
  'Job = a document of one job (the original invariant). Library = a company document with no job.';
comment on column public.evidence.folder_id is
  'Where staff filed the document. Null = the top level of its job or of the library. '
  'Purely logical: the stored object never moves.';
comment on column public.evidence.display_name is
  'The name staff gave the document. Null = the uploaded file name. Storage is unaffected.';
comment on column public.evidence.filing_version is
  'Bumped by every filing change (rename, move, trash, restore). Used for conflict detection.';

create index evidence_folder_idx on public.evidence (folder_id) where folder_id is not null;
create index evidence_trashed_idx on public.evidence (trashed_at) where trashed_at is not null;
create index evidence_library_idx on public.evidence (scope) where scope = 'Library';

-- The name a person sees, and the one a download is called.
create function app.file_document_name(p_e public.evidence)
returns text
language sql immutable
set search_path = ''
as $$ select coalesce(nullif(btrim(coalesce(p_e.display_name, '')), ''), p_e.original_filename, p_e.filename) $$;

-- Is this document actually relied upon as evidence of work? Such a document
-- may be renamed and moved (filing is free) but never trashed.
create function app.file_evidence_locked(p_e public.evidence)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_e.task_id is not null
      or p_e.work_package_id is not null
      or p_e.submission_id is not null
      or p_e.issue_id is not null
      or p_e.attached_at is not null
      or exists (select 1 from public.tasks t where t.evidence_id = p_e.id)
$$;

comment on function app.file_evidence_locked(public.evidence) is
  'True when a task, work package, commissioning submission or issue relies on this document, '
  'or a command attached it. Such a document cannot be trashed or destroyed.';

-- -----------------------------------------------------------------------------
-- 5. The table guard, extended
-- -----------------------------------------------------------------------------

-- Everything the original guard enforced still holds. Added: scope is
-- immutable, a document never changes job (already true, now also for null),
-- filing may not point at another job's folder, and a purged row is frozen.
create or replace function app.evidence_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder public.file_folders;
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
       or new.scope is distinct from old.scope
       or (old.uploaded_by is not null and new.uploaded_by is distinct from old.uploaded_by)
       or (old.upload_status <> 'Pending' and new.upload_status = 'Pending') then
      raise exception 'EVIDENCE_IMMUTABLE' using errcode = 'P0001';
    end if;
    -- A destroyed document is a tombstone: nothing about it changes again.
    if old.purged_at is not null and new.purged_at is not null
       and to_jsonb(new) - 'purged_at' is distinct from to_jsonb(old) - 'purged_at' then
      raise exception 'FILE_ALREADY_DESTROYED' using errcode = 'P0001';
    end if;
  end if;

  -- Filing must stay inside the document's own job (or the library).
  if new.folder_id is not null then
    select * into v_folder from public.file_folders where id = new.folder_id;
    if v_folder.id is null then
      raise exception 'FILE_FOLDER_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_folder.scope is distinct from new.scope or v_folder.job_id is distinct from new.job_id then
      raise exception 'FILE_FOLDER_SCOPE_MISMATCH' using errcode = 'P0001';
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

-- app.evidence_attach compared job ids with <>, which is null for a library
-- row and would have fallen through instead of refusing. Same behaviour for
-- every job document; a library document is now explicitly not attachable.
create or replace function app.evidence_attach(p_job_id uuid, p_category text, p_storage_path text,
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

  -- is distinct from: a library document has no job and is never work evidence.
  if v_row.job_id is distinct from p_job_id then
    perform app.fail('R1A_CROSS_JOB_EVIDENCE');
  end if;
  -- A document in the trash, or destroyed, is not available to a command.
  if v_row.trashed_at is not null then
    perform app.fail('FILE_IN_TRASH');
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

-- -----------------------------------------------------------------------------
-- 6. Read authorization
-- -----------------------------------------------------------------------------

-- Everything the original rule allowed still applies to a job document that is
-- not in the trash. Added:
--   * a destroyed document is readable by nobody;
--   * a trashed document is visible only to someone who may organise files
--     (so it can be found, previewed and restored from the Trash);
--   * a company document is read through file.library.read, not job access.
create or replace function app.can_read_evidence(p_actor jsonb, p_e public.evidence)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_actor is not null and p_e.id is not null
    and p_e.upload_status in ('Uploaded', 'Referenced')
    and p_e.purged_at is null
    and (p_e.trashed_at is null or app.actor_has_permission(p_actor, 'file.manage'))
    and case when p_e.scope = 'Library'
      then app.actor_has_permission(p_actor, 'file.library.read')
      else (
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
      end
$$;

drop policy if exists evidence_select on public.evidence;
create policy evidence_select on public.evidence for select to authenticated
  using (app.can_read_evidence((select app.current_actor()), evidence)
         or (upload_status = 'Pending' and uploaded_by = (select app.current_person_id())));

-- May this person see this folder at all?
create function app.can_read_folder(p_actor jsonb, p_f public.file_folders)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_actor is not null and p_f.id is not null
    and (p_f.trashed_at is null or app.actor_has_permission(p_actor, 'file.manage'))
    and case when p_f.scope = 'Library'
      then app.actor_has_permission(p_actor, 'file.library.read')
      else app.has_role(p_actor, 'Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance')
           and app.can_read_job(p_actor, p_f.job_id)
      end
$$;

create policy file_folders_select on public.file_folders for select to authenticated
  using (app.can_read_folder((select app.current_actor()), file_folders));

-- -----------------------------------------------------------------------------
-- 7. Write authorization
-- -----------------------------------------------------------------------------

-- Who may reorganise documents in a scope. Refuses by code; returns the job
-- for a job scope so the caller does not look it up again.
--
-- A job's documents may be organised by office staff who are assigned to it
-- and hold file.manage, and only while the job is live work: a HistoricalImport
-- row is not actionable, so its documents stay read-only exactly like the rest
-- of it. The library is governed by file.library.manage alone.
create function app.file_authorize_write(p_actor jsonb, p_scope text, p_job_id uuid)
returns public.jobs
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
begin
  if p_scope = 'Library' then
    if p_job_id is not null then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'job_id'));
    end if;
    if not app.actor_has_permission(p_actor, 'file.library.manage') then
      perform app.fail('FILE_PERMISSION_DENIED');
    end if;
    return v_job;
  end if;

  if p_scope <> 'Job' or p_job_id is null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'scope'));
  end if;
  select * into v_job from public.jobs where id = p_job_id;
  if v_job.id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  if not app.actor_has_permission(p_actor, 'file.manage') then
    perform app.fail('FILE_PERMISSION_DENIED');
  end if;
  if not app.is_office(p_actor) then
    perform app.fail('R1A_ROLE_DENIED');
  end if;
  if not app.can_read_job(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  if not app.is_assigned(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  if v_job.record_class = 'HistoricalImport' then
    perform app.fail('HISTORICAL_IMPORT');
  end if;
  if not app.job_actionable(v_job) then
    perform app.fail('R1A_JOB_NOT_ACTIONABLE');
  end if;
  return v_job;
end
$$;

-- A folder this person may reorganise, locked for the rest of the statement.
create function app.file_folder_for_write(p_actor jsonb, p_folder_id uuid, p_expected_version integer)
returns public.file_folders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folder public.file_folders;
begin
  if p_folder_id is null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'folder_id'));
  end if;
  select * into v_folder from public.file_folders where id = p_folder_id for update;
  if v_folder.id is null or not app.can_read_folder(p_actor, v_folder) then
    perform app.fail('FILE_FOLDER_NOT_FOUND');
  end if;
  perform app.file_authorize_write(p_actor, v_folder.scope, v_folder.job_id);
  if p_expected_version is not null and v_folder.version <> p_expected_version then
    perform app.fail('FILE_CONFLICT', jsonb_build_object(
      'kind', 'folder', 'id', v_folder.id, 'expected', p_expected_version, 'actual', v_folder.version));
  end if;
  return v_folder;
end
$$;

-- A document this person may reorganise, locked for the rest of the statement.
create function app.file_document_for_write(p_actor jsonb, p_file_id uuid, p_expected_version integer)
returns public.evidence
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.evidence;
begin
  if p_file_id is null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'file_id'));
  end if;
  select * into v_row from public.evidence where id = p_file_id for update;
  -- Not found and not yours look the same from outside.
  if v_row.id is null or v_row.purged_at is not null or not app.can_read_evidence(p_actor, v_row) then
    perform app.fail('EVIDENCE_NOT_FOUND');
  end if;
  perform app.file_authorize_write(p_actor, v_row.scope, v_row.job_id);
  if p_expected_version is not null and v_row.filing_version <> p_expected_version then
    perform app.fail('FILE_CONFLICT', jsonb_build_object(
      'kind', 'file', 'id', v_row.id, 'expected', p_expected_version, 'actual', v_row.filing_version));
  end if;
  return v_row;
end
$$;

-- The destination of a move, checked against the thing being moved. Null is
-- the top level of the scope. Returns nothing; refuses by code.
create function app.file_assert_destination(p_actor jsonb, p_scope text, p_job_id uuid, p_folder_id uuid)
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_dest public.file_folders;
begin
  if p_folder_id is null then
    return;
  end if;
  select * into v_dest from public.file_folders where id = p_folder_id;
  if v_dest.id is null or not app.can_read_folder(p_actor, v_dest) then
    perform app.fail('FILE_FOLDER_NOT_FOUND');
  end if;
  if v_dest.trashed_at is not null then
    perform app.fail('FILE_FOLDER_TRASHED');
  end if;
  -- The one rule the whole design rests on: filing never crosses a job.
  if v_dest.scope is distinct from p_scope or v_dest.job_id is distinct from p_job_id then
    perform app.fail('FILE_CROSS_SCOPE_MOVE');
  end if;
  perform app.file_authorize_write(p_actor, v_dest.scope, v_dest.job_id);
end
$$;

create function app.file_folder_audit_json(p_f public.file_folders)
returns jsonb language sql immutable set search_path = ''
as $$
  select jsonb_build_object('id', p_f.id, 'scope', p_f.scope, 'job_id', p_f.job_id,
    'parent_id', p_f.parent_id, 'name', p_f.name, 'depth', p_f.depth,
    'trashed_at', p_f.trashed_at, 'version', p_f.version)
$$;

create function app.file_filing_json(p_e public.evidence)
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object('id', p_e.id, 'scope', p_e.scope, 'job_id', p_e.job_id,
    'folder_id', p_e.folder_id, 'name', app.file_document_name(p_e), 'category', p_e.category,
    'trashed_at', p_e.trashed_at, 'purged_at', p_e.purged_at, 'filing_version', p_e.filing_version,
    'storage_path_unchanged', true)
$$;

-- Marks the transaction as a file-manager action so every app.audit call in it
-- is attributed without the caller passing a reason.
create function app.file_begin(p_actor jsonb, p_service text)
returns void
language sql
security definer
set search_path = ''
as $$
  select set_config('app.actor_id', app.actor_id(p_actor)::text, true),
         set_config('app.executing_service', p_service, true)
$$;

-- -----------------------------------------------------------------------------
-- 8. Folder commands
-- -----------------------------------------------------------------------------

-- Request: {scope, job_id?, parent_id?, name}
create function public.file_folder_create(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_scope text;
  v_job_id uuid;
  v_parent public.file_folders;
  v_name text;
  v_row public.file_folders;
begin
  perform app.req_keys(p_request, array['scope', 'job_id', 'parent_id', 'name']);
  v_scope := nullif(btrim(coalesce(p_request ->> 'scope', '')), '');
  if v_scope not in ('Job', 'Library') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'scope'));
  end if;
  v_job_id := app.file_uuid(p_request -> 'job_id', 'job_id');
  v_name := app.file_require_name(btrim(coalesce(p_request ->> 'name', '')));

  if app.file_uuid(p_request -> 'parent_id', 'parent_id') is not null then
    -- The subfolder inherits its parent's scope and job. A request that names
    -- a different pair is a mistake worth refusing rather than silently
    -- overriding: it is how a cross-job move would be attempted.
    v_parent := app.file_folder_for_write(v_actor, app.file_uuid(p_request -> 'parent_id', 'parent_id'), null);
    if v_parent.trashed_at is not null then
      perform app.fail('FILE_FOLDER_TRASHED');
    end if;
    if v_parent.scope <> v_scope or v_parent.job_id is distinct from v_job_id then
      perform app.fail('FILE_CROSS_SCOPE_MOVE');
    end if;
  else
    perform app.file_authorize_write(v_actor, v_scope, v_job_id);
  end if;

  perform app.file_begin(v_actor, 'files:folder');

  insert into public.file_folders (scope, job_id, parent_id, name)
  values (v_scope, v_job_id, v_parent.id, v_name)
  returning * into v_row;

  perform app.audit('FileFolder', v_row.id::text, 'Create', null, app.file_folder_audit_json(v_row));
  return jsonb_build_object('folder', app.file_folder_audit_json(v_row));
exception when unique_violation then
  perform app.fail('FILE_NAME_TAKEN');
  return null;
end
$$;

-- Request: {folder_id, name, expected_version?}
create function public.file_folder_rename(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_before public.file_folders;
  v_after public.file_folders;
  v_name text;
begin
  perform app.req_keys(p_request, array['folder_id', 'name', 'expected_version']);
  v_name := app.file_require_name(btrim(coalesce(p_request ->> 'name', '')));
  v_before := app.file_folder_for_write(v_actor, app.file_uuid(p_request -> 'folder_id', 'folder_id'),
                                        app.file_int(p_request -> 'expected_version'));
  if v_before.trashed_at is not null then
    perform app.fail('FILE_FOLDER_TRASHED');
  end if;
  if v_before.name = v_name then
    return jsonb_build_object('folder', app.file_folder_audit_json(v_before), 'changed', false);
  end if;

  perform app.file_begin(v_actor, 'files:folder');
  update public.file_folders set name = v_name where id = v_before.id returning * into v_after;
  perform app.audit('FileFolder', v_after.id::text, 'Rename',
                    app.file_folder_audit_json(v_before), app.file_folder_audit_json(v_after));
  return jsonb_build_object('folder', app.file_folder_audit_json(v_after), 'changed', true);
exception when unique_violation then
  perform app.fail('FILE_NAME_TAKEN');
  return null;
end
$$;

-- Request: {folder_id, parent_id (null = top level), expected_version?}
-- The subtree's cached depth and ancestry are rebuilt in the same statement.
create function public.file_folder_move(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_before public.file_folders;
  v_after public.file_folders;
  v_parent uuid;
  v_moved integer := 0;
  v_level uuid[];
begin
  perform app.req_keys(p_request, array['folder_id', 'parent_id', 'expected_version']);
  if not p_request ? 'parent_id' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'parent_id'));
  end if;
  v_before := app.file_folder_for_write(v_actor, app.file_uuid(p_request -> 'folder_id', 'folder_id'),
                                        app.file_int(p_request -> 'expected_version'));
  if v_before.trashed_at is not null then
    perform app.fail('FILE_FOLDER_TRASHED');
  end if;
  v_parent := app.file_uuid(p_request -> 'parent_id', 'parent_id');

  if v_parent is not null then
    if v_parent = v_before.id then
      perform app.fail('FILE_FOLDER_CYCLE');
    end if;
    -- Into one of its own descendants.
    if exists (select 1 from public.file_folders f where f.id = v_parent and f.path_ids @> array[v_before.id]) then
      perform app.fail('FILE_FOLDER_CYCLE');
    end if;
    perform app.file_assert_destination(v_actor, v_before.scope, v_before.job_id, v_parent);
  end if;
  if v_before.parent_id is not distinct from v_parent then
    return jsonb_build_object('folder', app.file_folder_audit_json(v_before), 'changed', false, 'descendants_moved', 0);
  end if;

  perform app.file_begin(v_actor, 'files:folder');
  update public.file_folders set parent_id = v_parent where id = v_before.id returning * into v_after;

  -- Descendants keep their shape; only their cached ancestry moves. One
  -- statement per level, outermost first: a BEFORE trigger reads the snapshot
  -- its own statement started from, so a child can only rebuild its path once
  -- its parent's new path is committed by an earlier statement.
  v_level := array[v_after.id];
  loop
    select coalesce(array_agg(f.id), '{}') into v_level
    from public.file_folders f where f.parent_id = any (v_level);
    exit when cardinality(v_level) = 0;
    -- Setting parent_id to itself re-fires the guard, which rebuilds path_ids
    -- and depth and raises FILE_FOLDER_TOO_DEEP if the subtree now overflows.
    update public.file_folders f set parent_id = f.parent_id where f.id = any (v_level);
    v_moved := v_moved + cardinality(v_level);
  end loop;

  perform app.audit('FileFolder', v_after.id::text, 'Move',
                    app.file_folder_audit_json(v_before), app.file_folder_audit_json(v_after));
  return jsonb_build_object('folder', app.file_folder_audit_json(v_after), 'changed', true,
                            'descendants_moved', v_moved);
exception when unique_violation then
  perform app.fail('FILE_NAME_TAKEN');
  return null;
end
$$;

-- Request: {folder_id, expected_version?}
-- A folder goes to the trash with everything inside it. Refused outright when
-- any document in the subtree is relied on as evidence: filing must never be
-- able to remove a business record by accident.
create function public.file_folder_trash(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_before public.file_folders;
  v_after public.file_folders;
  v_locked integer;
  v_folders integer := 0;
  v_files integer := 0;
begin
  perform app.req_keys(p_request, array['folder_id', 'expected_version']);
  v_before := app.file_folder_for_write(v_actor, app.file_uuid(p_request -> 'folder_id', 'folder_id'),
                                        app.file_int(p_request -> 'expected_version'));
  if v_before.trashed_at is not null then
    return jsonb_build_object('folder', app.file_folder_audit_json(v_before), 'changed', false,
                              'folders_trashed', 0, 'files_trashed', 0);
  end if;

  select count(*) into v_locked
  from public.evidence e
  where e.trashed_at is null
    and (e.folder_id = v_before.id
         or e.folder_id in (select f.id from public.file_folders f where f.path_ids @> array[v_before.id]))
    and app.file_evidence_locked(e);
  if v_locked > 0 then
    perform app.fail('FILE_EVIDENCE_LOCKED', jsonb_build_object('locked_files', v_locked));
  end if;

  perform app.file_begin(v_actor, 'files:folder');

  with descendants as (
    select f.id from public.file_folders f
    where (f.id = v_before.id or f.path_ids @> array[v_before.id]) and f.trashed_at is null
  ),
  moved_files as (
    update public.evidence e
    set trashed_at = now(), trashed_by = app.actor_id(v_actor), filing_version = e.filing_version + 1
    where e.folder_id in (select id from descendants) and e.trashed_at is null
    returning e.id
  ),
  moved_folders as (
    update public.file_folders f
    set trashed_at = now(), trashed_by = app.actor_id(v_actor)
    where f.id in (select id from descendants)
    returning f.id
  )
  select (select count(*) from moved_folders), (select count(*) from moved_files)
  into v_folders, v_files;

  select * into v_after from public.file_folders where id = v_before.id;
  perform app.audit('FileFolder', v_after.id::text, 'Trash',
                    app.file_folder_audit_json(v_before),
                    app.file_folder_audit_json(v_after)
                      || jsonb_build_object('folders_trashed', v_folders, 'files_trashed', v_files));
  return jsonb_build_object('folder', app.file_folder_audit_json(v_after), 'changed', true,
                            'folders_trashed', v_folders, 'files_trashed', v_files);
end
$$;

-- Request: {folder_id}
-- Restores the folder and what was trashed with it. A folder whose parent is
-- still in the trash comes back at the top level rather than nowhere.
create function public.file_folder_restore(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_before public.file_folders;
  v_after public.file_folders;
  v_parent public.file_folders;
  v_folders integer := 0;
  v_files integer := 0;
  v_level uuid[];
  v_all uuid[];
begin
  perform app.req_keys(p_request, array['folder_id']);
  v_before := app.file_folder_for_write(v_actor, app.file_uuid(p_request -> 'folder_id', 'folder_id'), null);
  if v_before.trashed_at is null then
    return jsonb_build_object('folder', app.file_folder_audit_json(v_before), 'changed', false,
                              'folders_restored', 0, 'files_restored', 0);
  end if;

  if v_before.parent_id is not null then
    select * into v_parent from public.file_folders where id = v_before.parent_id;
  end if;

  perform app.file_begin(v_actor, 'files:folder');

  -- A folder whose parent is still in the trash comes back at the top level
  -- rather than somewhere nobody can reach.
  update public.file_folders
  set trashed_at = null, trashed_by = null,
      parent_id = case when v_parent.id is not null and v_parent.trashed_at is not null then null else parent_id end
  where id = v_before.id
  returning * into v_after;

  -- One statement per level, outermost first: the guard refuses to lift a
  -- folder out of the trash while its parent is still in it, and it reads the
  -- snapshot its own statement started from.
  v_level := array[v_after.id];
  v_all := array[v_after.id];
  loop
    select coalesce(array_agg(f.id), '{}') into v_level
    from public.file_folders f where f.parent_id = any (v_level) and f.trashed_at is not null;
    exit when cardinality(v_level) = 0;
    update public.file_folders f
    set trashed_at = null, trashed_by = null
    where f.id = any (v_level);
    v_folders := v_folders + cardinality(v_level);
    v_all := v_all || v_level;
  end loop;

  with restored_files as (
    update public.evidence e
    set trashed_at = null, trashed_by = null, filing_version = e.filing_version + 1
    where e.trashed_at is not null and e.purged_at is null and e.folder_id = any (v_all)
    returning e.id
  )
  select count(*) into v_files from restored_files;

  perform app.audit('FileFolder', v_after.id::text, 'Restore',
                    app.file_folder_audit_json(v_before),
                    app.file_folder_audit_json(v_after)
                      || jsonb_build_object('folders_restored', v_folders + 1, 'files_restored', v_files));
  return jsonb_build_object('folder', app.file_folder_audit_json(v_after), 'changed', true,
                            'folders_restored', v_folders + 1, 'files_restored', v_files);
exception when unique_violation then
  perform app.fail('FILE_NAME_TAKEN');
  return null;
end
$$;

-- -----------------------------------------------------------------------------
-- 9. Document commands
-- -----------------------------------------------------------------------------

-- Request: {file_id, name, expected_version?}
-- Renames what staff see. The stored object keeps its name for ever, so every
-- evidence, task and command reference survives untouched.
create function public.file_rename(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_before public.evidence;
  v_after public.evidence;
  v_name text;
begin
  perform app.req_keys(p_request, array['file_id', 'name', 'expected_version']);
  v_name := app.file_require_name(btrim(coalesce(p_request ->> 'name', '')));
  v_before := app.file_document_for_write(v_actor, app.file_uuid(p_request -> 'file_id', 'file_id'),
                                          app.file_int(p_request -> 'expected_version'));
  if app.file_document_name(v_before) = v_name then
    return jsonb_build_object('file', app.file_filing_json(v_before), 'changed', false);
  end if;

  perform app.file_begin(v_actor, 'files:document');
  update public.evidence
  set display_name = v_name, filing_version = filing_version + 1
  where id = v_before.id
  returning * into v_after;

  perform app.audit('Evidence', v_after.id::text, 'Rename',
                    app.file_filing_json(v_before), app.file_filing_json(v_after));
  return jsonb_build_object('file', app.file_filing_json(v_after), 'changed', true);
end
$$;

-- Request: {file_ids: [...], folder_id (null = top level), expected?: {id: version}}
-- One transaction: either every document moves or none does.
create function public.file_move(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_ids uuid[];
  v_id uuid;
  v_dest uuid;
  v_before public.evidence;
  v_after public.evidence;
  v_moved jsonb := '[]'::jsonb;
  v_unchanged integer := 0;
begin
  perform app.req_keys(p_request, array['file_ids', 'folder_id', 'expected']);
  if not p_request ? 'folder_id' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'folder_id'));
  end if;
  v_ids := app.file_uuid_array(p_request -> 'file_ids', 'file_ids');
  v_dest := app.file_uuid(p_request -> 'folder_id', 'folder_id');

  perform app.file_begin(v_actor, 'files:document');

  -- Deterministic order: two people bulk-moving overlapping selections queue
  -- rather than deadlock.
  foreach v_id in array (select array_agg(x order by x) from unnest(v_ids) x) loop
    v_before := app.file_document_for_write(v_actor, v_id,
                  app.file_int(p_request -> 'expected' -> v_id::text));
    if v_before.trashed_at is not null then
      perform app.fail('FILE_IN_TRASH');
    end if;
    -- The destination must belong to the same job as THIS document.
    perform app.file_assert_destination(v_actor, v_before.scope, v_before.job_id, v_dest);
    if v_before.folder_id is not distinct from v_dest then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;
    update public.evidence
    set folder_id = v_dest, filing_version = filing_version + 1
    where id = v_before.id
    returning * into v_after;
    perform app.audit('Evidence', v_after.id::text, 'Move',
                      app.file_filing_json(v_before), app.file_filing_json(v_after));
    v_moved := v_moved || jsonb_build_array(app.file_filing_json(v_after));
  end loop;

  return jsonb_build_object('folder_id', v_dest, 'moved', jsonb_array_length(v_moved),
                            'unchanged', v_unchanged, 'files', v_moved);
end
$$;

-- Request: {file_ids: [...], expected?: {id: version}}
-- The trash, not destruction. A document any task, submission or issue relies
-- on is refused: business records are not tidied away.
create function public.file_trash(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_ids uuid[];
  v_id uuid;
  v_before public.evidence;
  v_after public.evidence;
  v_trashed jsonb := '[]'::jsonb;
  v_already integer := 0;
begin
  perform app.req_keys(p_request, array['file_ids', 'expected']);
  v_ids := app.file_uuid_array(p_request -> 'file_ids', 'file_ids');
  perform app.file_begin(v_actor, 'files:document');

  foreach v_id in array (select array_agg(x order by x) from unnest(v_ids) x) loop
    v_before := app.file_document_for_write(v_actor, v_id,
                  app.file_int(p_request -> 'expected' -> v_id::text));
    if v_before.trashed_at is not null then
      v_already := v_already + 1;
      continue;
    end if;
    if app.file_evidence_locked(v_before) then
      perform app.fail('FILE_EVIDENCE_LOCKED', jsonb_build_object('file_id', v_before.id));
    end if;
    update public.evidence
    set trashed_at = now(), trashed_by = app.actor_id(v_actor), filing_version = filing_version + 1
    where id = v_before.id
    returning * into v_after;
    perform app.audit('Evidence', v_after.id::text, 'Trash',
                      app.file_filing_json(v_before), app.file_filing_json(v_after));
    v_trashed := v_trashed || jsonb_build_array(app.file_filing_json(v_after));
  end loop;

  return jsonb_build_object('trashed', jsonb_array_length(v_trashed), 'already_trashed', v_already,
                            'files', v_trashed);
end
$$;

-- Request: {file_ids: [...]}
create function public.file_restore(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_ids uuid[];
  v_id uuid;
  v_before public.evidence;
  v_after public.evidence;
  v_folder public.file_folders;
  v_restored jsonb := '[]'::jsonb;
  v_already integer := 0;
begin
  perform app.req_keys(p_request, array['file_ids']);
  v_ids := app.file_uuid_array(p_request -> 'file_ids', 'file_ids');
  perform app.file_begin(v_actor, 'files:document');

  foreach v_id in array (select array_agg(x order by x) from unnest(v_ids) x) loop
    v_before := app.file_document_for_write(v_actor, v_id, null);
    if v_before.trashed_at is null then
      v_already := v_already + 1;
      continue;
    end if;
    -- Its folder may itself be in the trash: restore to the top level rather
    -- than to somewhere the person cannot see.
    if v_before.folder_id is not null then
      select * into v_folder from public.file_folders where id = v_before.folder_id;
    else
      v_folder := null;
    end if;
    update public.evidence
    set trashed_at = null, trashed_by = null,
        folder_id = case when v_folder.id is not null and v_folder.trashed_at is not null
                         then null else folder_id end,
        filing_version = filing_version + 1
    where id = v_before.id
    returning * into v_after;
    perform app.audit('Evidence', v_after.id::text, 'Restore',
                      app.file_filing_json(v_before), app.file_filing_json(v_after));
    v_restored := v_restored || jsonb_build_array(app.file_filing_json(v_after));
  end loop;

  return jsonb_build_object('restored', jsonb_array_length(v_restored), 'already_restored', v_already,
                            'files', v_restored);
end
$$;

-- Request: {file_ids: [...]}
-- Permanent deletion. Needs file.purge, only from the trash, never for a
-- document that carries an evidence relationship. The row stays as a tombstone
-- so the audit outlives the file; the caller removes the stored object and the
-- returned storage paths are the only place they are ever handed out.
create function public.file_purge(p_request jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_ids uuid[];
  v_id uuid;
  v_before public.evidence;
  v_after public.evidence;
  v_paths jsonb := '[]'::jsonb;
begin
  perform app.req_keys(p_request, array['file_ids']);
  if not app.actor_has_permission(v_actor, 'file.purge') then
    perform app.fail('FILE_PURGE_DENIED');
  end if;
  v_ids := app.file_uuid_array(p_request -> 'file_ids', 'file_ids');
  perform app.file_begin(v_actor, 'files:purge');

  foreach v_id in array (select array_agg(x order by x) from unnest(v_ids) x) loop
    v_before := app.file_document_for_write(v_actor, v_id, null);
    if v_before.trashed_at is null then
      perform app.fail('FILE_NOT_IN_TRASH', jsonb_build_object('file_id', v_before.id));
    end if;
    if app.file_evidence_locked(v_before) then
      perform app.fail('FILE_EVIDENCE_LOCKED', jsonb_build_object('file_id', v_before.id));
    end if;
    update public.evidence
    set purged_at = now(), purged_by = app.actor_id(v_actor), filing_version = filing_version + 1
    where id = v_before.id
    returning * into v_after;
    perform app.audit('Evidence', v_after.id::text, 'Destroy',
                      app.file_filing_json(v_before) || app.evidence_audit_json(v_before),
                      app.file_filing_json(v_after), 'permanently deleted by an administrator');
    v_paths := v_paths || jsonb_build_array(jsonb_build_object('file_id', v_after.id,
                                                               'storage_path', v_after.storage_path));
  end loop;

  return jsonb_build_object('destroyed', jsonb_array_length(v_paths), 'objects', v_paths);
end
$$;

-- -----------------------------------------------------------------------------
-- 10. Request parsing helpers (shared by the commands above)
-- -----------------------------------------------------------------------------

create function app.file_uuid(p_value jsonb, p_field text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', p_field));
  end if;
  v := btrim(p_value #>> '{}');
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', p_field));
  end if;
  return v::uuid;
end
$$;

create function app.file_int(p_value jsonb)
returns integer
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,9}$' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'expected_version'));
  end if;
  return (p_value #>> '{}')::integer;
end
$$;

-- A non-empty selection of at most 200 distinct ids.
create function app.file_uuid_array(p_value jsonb, p_field text)
returns uuid[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', p_field));
  end if;
  if jsonb_array_length(p_value) = 0 then
    perform app.fail('FILE_SELECTION_EMPTY');
  end if;
  if jsonb_array_length(p_value) > 200 then
    perform app.fail('FILE_SELECTION_TOO_LARGE');
  end if;
  select array_agg(distinct app.file_uuid(e, p_field)) into v_ids
  from jsonb_array_elements(p_value) e;
  if v_ids is null or array_position(v_ids, null) is not null then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', p_field));
  end if;
  return v_ids;
end
$$;

-- -----------------------------------------------------------------------------
-- 10b. Uploading into a folder, and into the library
--
-- The three-step upload is unchanged - register, send the bytes to a one-off
-- signed URL, confirm - and so is every rule it enforces (type, size, name,
-- who may add a file to what). Two things are added: a registration may name
-- the folder the file is being dropped into, and 'Library' is a context of its
-- own for a company document that belongs to no job.
-- -----------------------------------------------------------------------------

create or replace function app.evidence_upload_context(p_actor jsonb, p_type text, p_id uuid, p_category text)
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
  -- A company document has no domain object behind it: the permission is the
  -- whole authorization, and there is no job to derive.
  if p_type = 'Library' then
    perform app.file_authorize_write(p_actor, 'Library', null);
    if v_category is not null and not v_category = any (app.evidence_categories()) then
      perform app.fail('EVIDENCE_CATEGORY_INVALID');
    end if;
    return jsonb_build_object('scope', 'Library', 'category', coalesce(v_category, 'Other'));
  end if;

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
    return jsonb_build_object('scope', 'Job', 'job_id', v_task.job_id, 'task_id', v_task.id,
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
    return jsonb_build_object('scope', 'Job', 'job_id', v_wp.job_id, 'work_package_id', v_wp.id, 'category', v_category);

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
    return jsonb_build_object('scope', 'Job', 'job_id', v_job_id, 'category', 'DeliveryNote');

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
    return jsonb_build_object('scope', 'Job', 'job_id', p_id, 'category', v_category);
  end if;

  perform app.fail('EVIDENCE_CONTEXT_INVALID');
  return null;
end
$$;

create or replace function public.evidence_upload_begin(p_request jsonb)
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
  v_folder_id uuid;
  v_type text;
  v_scope text;
  v_job_id uuid;
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
    if v_key not in ('upload_id', 'context_type', 'context_id', 'category', 'filename', 'mime_type',
                     'size_bytes', 'folder_id') then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
  end loop;

  v_actor := app.resolve_actor();
  v_type := p_request ->> 'context_type';

  if coalesce(p_request ->> 'upload_id', '') !~* v_uuid then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_upload_id := (p_request ->> 'upload_id')::uuid;
  -- A company document has no context object; every other context needs one.
  if v_type <> 'Library' then
    if coalesce(p_request ->> 'context_id', '') !~* v_uuid then
      perform app.fail('R1A_INVALID_FIELDS');
    end if;
    v_context_id := (p_request ->> 'context_id')::uuid;
  elsif p_request ? 'context_id' and p_request -> 'context_id' <> 'null'::jsonb then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_folder_id := app.file_uuid(p_request -> 'folder_id', 'folder_id');

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
  v_scope := coalesce(v_ctx ->> 'scope', 'Job');
  v_job_id := (v_ctx ->> 'job_id')::uuid;

  -- Dropping a file into a folder is filing, and filing never crosses a job.
  if v_folder_id is not null then
    perform app.file_assert_destination(v_actor, v_scope, v_job_id, v_folder_id);
  end if;

  select * into v_row from public.evidence
  where uploaded_by = app.actor_id(v_actor) and client_upload_id = v_upload_id;
  if v_row.id is not null then
    if v_row.context_type is distinct from nullif(v_type, 'Library')
       or v_row.context_id is distinct from v_context_id
       or v_row.filename <> v_name
       -- once confirmed, size and type are what storage measured, not what was declared
       or (v_row.upload_status = 'Pending'
           and (v_row.mime_type is distinct from v_mime or v_row.size_bytes is distinct from v_size)) then
      perform app.fail('EVIDENCE_UPLOAD_CONFLICT');
    end if;
    -- A retry that names a different folder refiles rather than duplicating.
    if v_row.upload_status = 'Pending' and v_row.folder_id is distinct from v_folder_id then
      update public.evidence set folder_id = v_folder_id where id = v_row.id returning * into v_row;
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
  insert into public.evidence (id, scope, job_id, task_id, work_package_id, context_type, context_id, category,
                               folder_id, storage_path, filename, original_filename, mime_type, size_bytes,
                               upload_status, captured_at, captured_by, uploaded_by, client_upload_id,
                               registered_at, customer_shareable)
  values (v_id, v_scope, v_job_id, (v_ctx ->> 'task_id')::uuid, (v_ctx ->> 'work_package_id')::uuid,
          nullif(v_type, 'Library'), v_context_id, v_ctx ->> 'category',
          v_folder_id,
          -- Identity, never filing: a company document is filed under the
          -- library rather than a job, and neither path ever changes again.
          coalesce(v_job_id::text, 'library') || '/' || v_id || '/' || v_name, v_name,
          nullif(left(regexp_replace(btrim(coalesce(p_request ->> 'filename', '')), '[[:cntrl:]]', '', 'g'), 255), ''),
          v_mime, v_size, 'Pending', now(), app.actor_id(v_actor), app.actor_id(v_actor), v_upload_id, now(), false)
  returning * into v_row;

  perform app.audit('Evidence', v_row.id::text, 'Register', null,
                    app.evidence_audit_json(v_row) || jsonb_build_object('scope', v_scope, 'folder_id', v_folder_id));

  return jsonb_build_object('evidence_id', v_row.id, 'bucket', 'evidence', 'storage_path', v_row.storage_path,
    'upload_status', v_row.upload_status, 'category', v_row.category, 'replayed', false);
end
$$;

-- -----------------------------------------------------------------------------
-- 11. Reads
-- -----------------------------------------------------------------------------

-- The same rule as app.file_authorize_write, as a question rather than a
-- refusal: the UI uses it to decide what to offer, the commands decide what
-- actually happens. A hidden button was never the authorization.
create function app.file_can_manage(p_actor jsonb, p_scope text, p_job_id uuid)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform app.file_authorize_write(p_actor, p_scope, p_job_id);
  return true;
exception when sqlstate 'P0001' then
  return false;
end
$$;

-- "Contracts / Signed" - where a document lives, for search results.
create function app.file_folder_path_text(p_folder_id uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  select case when p_folder_id is null then null else (
    select string_agg(n.name, ' / ' order by n.ord)
    from public.file_folders f
    cross join lateral (
      select a.name as name, p.ord as ord
      from unnest(f.path_ids) with ordinality as p (id, ord)
      join public.file_folders a on a.id = p.id
      union all
      select f.name, coalesce(array_length(f.path_ids, 1), 0) + 1
    ) n
    where f.id = p_folder_id
  ) end
$$;

create function app.file_document_json(p_e public.evidence, p_actor jsonb)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_e.id,
    'name', app.file_document_name(p_e),
    'scope', p_e.scope,
    'job_id', p_e.job_id,
    'folder_id', p_e.folder_id,
    'category', p_e.category,
    'mime_type', p_e.mime_type,
    'size_bytes', p_e.size_bytes,
    'added_at', coalesce(p_e.received_at, p_e.created_at),
    'added_by_name', app.s17_person_name(coalesce(p_e.uploaded_by, p_e.captured_by)),
    'modified_at', coalesce(p_e.received_at, p_e.created_at),
    'filing_version', p_e.filing_version,
    'trashed_at', p_e.trashed_at,
    'trashed_by_name', app.s17_person_name(p_e.trashed_by),
    -- Why an action may be refused, so the UI can say so instead of failing late.
    'evidence_locked', app.file_evidence_locked(p_e),
    'task_id', p_e.task_id,
    'issue_id', p_e.issue_id,
    'submission_id', p_e.submission_id,
    'work_package_id', p_e.work_package_id,
    'can_open', p_e.upload_status = 'Uploaded' and p_e.purged_at is null)
$$;

-- The level above a job's folders: which jobs have documents this person can
-- see. Request: {q?, limit?, offset?}. Read-only.
create function public.file_job_index(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_q text := nullif(btrim(coalesce(p_request ->> 'q', '')), '');
  v_limit int;
  v_offset int;
  v_rows jsonb;
  v_total int;
begin
  perform app.req_keys(coalesce(p_request, '{}'::jsonb), array['q', 'limit', 'offset']);
  v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 50), 1), 200);
  v_offset := greatest(coalesce(nullif(p_request ->> 'offset', '')::int, 0), 0);

  with visible as (
    select j.id, j.job_ref, j.workflow_stage, j.record_class,
           nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') as customer_name, c.postcode,
           (select count(*) from public.evidence e
            where e.job_id = j.id and e.trashed_at is null and e.purged_at is null
              and app.can_read_evidence(v_actor, e)) as file_count
    from public.jobs j
    left join public.customers c on c.id = j.customer_id
    where app.can_read_job(v_actor, j.id)
      and (v_q is null or j.job_ref ilike '%' || v_q || '%' or c.postcode ilike '%' || v_q || '%'
           or concat_ws(' ', c.first_name, c.last_name) ilike '%' || v_q || '%')
  ),
  withfiles as (
    select * from visible
    where file_count > 0
       or exists (select 1 from public.file_folders f where f.job_id = visible.id and f.trashed_at is null)
  )
  select (select count(*) from withfiles),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'job_id', w.id, 'job_ref', w.job_ref, 'customer_name', w.customer_name, 'postcode', w.postcode,
             'workflow_stage', w.workflow_stage, 'record_class', w.record_class, 'file_count', w.file_count)
             order by w.job_ref), '[]'::jsonb)
          from (select * from withfiles order by job_ref limit v_limit offset v_offset) w)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'jobs', v_rows,
    'can_read_library', app.actor_has_permission(v_actor, 'file.library.read'),
    'can_manage_library', app.file_can_manage(v_actor, 'Library', null));
end
$$;

-- One folder's contents. Request:
--   {scope, job_id?, folder_id?, view?: 'folder' | 'trash', q?, sort?, dir?, limit?, offset?}
-- 'trash' lists everything trashed in the scope, wherever it sat. Read-only.
create function public.file_browse(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_scope text;
  v_job_id uuid;
  v_folder public.file_folders;
  v_view text;
  v_q text;
  v_sort text;
  v_dir text;
  v_limit int;
  v_offset int;
  v_job public.jobs;
  v_customer text;
  v_folders jsonb;
  v_files jsonb;
  v_total int;
  v_trash boolean;
begin
  perform app.req_keys(p_request, array['scope', 'job_id', 'folder_id', 'view', 'q', 'sort', 'dir', 'limit', 'offset']);
  v_scope := nullif(btrim(coalesce(p_request ->> 'scope', '')), '');
  if v_scope not in ('Job', 'Library') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'scope'));
  end if;
  v_job_id := app.file_uuid(p_request -> 'job_id', 'job_id');
  if (v_scope = 'Job') <> (v_job_id is not null) then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'job_id'));
  end if;
  v_view := coalesce(nullif(btrim(coalesce(p_request ->> 'view', '')), ''), 'folder');
  if v_view not in ('folder', 'trash') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'view'));
  end if;
  v_trash := v_view = 'trash';
  v_q := nullif(btrim(coalesce(p_request ->> 'q', '')), '');
  v_sort := coalesce(nullif(btrim(coalesce(p_request ->> 'sort', '')), ''), 'name');
  if v_sort not in ('name', 'modified', 'size', 'category') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'sort'));
  end if;
  v_dir := lower(coalesce(nullif(btrim(coalesce(p_request ->> 'dir', '')), ''), 'asc'));
  if v_dir not in ('asc', 'desc') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'dir'));
  end if;
  v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 200), 1), 500);
  v_offset := greatest(coalesce(nullif(p_request ->> 'offset', '')::int, 0), 0);

  -- Reading is authorized per scope, exactly as opening a file is.
  if v_scope = 'Library' then
    if not app.actor_has_permission(v_actor, 'file.library.read') then
      perform app.fail('FILE_PERMISSION_DENIED');
    end if;
  else
    select * into v_job from public.jobs where id = v_job_id;
    if v_job.id is null or not app.can_read_job(v_actor, v_job.id) then
      perform app.fail('R1A_JOB_NOT_FOUND');
    end if;
    select nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') into v_customer
    from public.customers c where c.id = v_job.customer_id;
  end if;

  if app.file_uuid(p_request -> 'folder_id', 'folder_id') is not null then
    select * into v_folder from public.file_folders where id = app.file_uuid(p_request -> 'folder_id', 'folder_id');
    if v_folder.id is null or not app.can_read_folder(v_actor, v_folder)
       or v_folder.scope <> v_scope or v_folder.job_id is distinct from v_job_id then
      perform app.fail('FILE_FOLDER_NOT_FOUND');
    end if;
  end if;

  -- Folders. In the trash view, every trashed folder of the scope; otherwise
  -- the children of the folder being looked at.
  select coalesce(jsonb_agg(x order by
           case when v_dir = 'asc' then lower(x ->> 'name') end asc,
           case when v_dir = 'desc' then lower(x ->> 'name') end desc), '[]'::jsonb)
  into v_folders
  from (
    select jsonb_build_object(
      'id', f.id, 'name', f.name, 'parent_id', f.parent_id, 'version', f.version,
      'depth', f.depth, 'updated_at', f.updated_at,
      'trashed_at', f.trashed_at, 'trashed_by_name', app.s17_person_name(f.trashed_by),
      'original_location', case when v_trash then app.file_folder_path_text(f.parent_id) end,
      'folder_count', (select count(*) from public.file_folders c
                       where c.parent_id = f.id and c.trashed_at is null),
      'file_count', (select count(*) from public.evidence e
                     where e.folder_id = f.id and e.trashed_at is null and e.purged_at is null
                       and app.can_read_evidence(v_actor, e))) as x
    from public.file_folders f
    where f.scope = v_scope and f.job_id is not distinct from v_job_id
      and app.can_read_folder(v_actor, f)
      and (v_q is null or f.name ilike '%' || v_q || '%')
      and case when v_trash
            -- Only the top of each trashed subtree: its contents are inside it.
            then f.trashed_at is not null
                 and (f.parent_id is null
                      or not exists (select 1 from public.file_folders p
                                     where p.id = f.parent_id and p.trashed_at is not null))
            else f.trashed_at is null and f.parent_id is not distinct from v_folder.id
          end
  ) s;

  -- Documents.
  with hits as (
    select e.*
    from public.evidence e
    where e.scope = v_scope and e.job_id is not distinct from v_job_id
      and e.purged_at is null
      and app.can_read_evidence(v_actor, e)
      and (v_q is null or coalesce(e.display_name, e.original_filename, e.filename) ilike '%' || v_q || '%')
      and case when v_trash
            then e.trashed_at is not null
            else e.trashed_at is null and e.folder_id is not distinct from v_folder.id
          end
  )
  select (select count(*) from hits),
         (select coalesce(jsonb_agg(
             app.file_document_json(h, v_actor)
               || case when v_trash
                    then jsonb_build_object('original_location', app.file_folder_path_text(h.folder_id))
                    else '{}'::jsonb end
             order by
               case when v_dir = 'asc' then
                 case v_sort when 'name' then lower(app.file_document_name(h))
                             when 'category' then h.category end end asc,
               case when v_dir = 'desc' then
                 case v_sort when 'name' then lower(app.file_document_name(h))
                             when 'category' then h.category end end desc,
               case when v_dir = 'asc' and v_sort = 'size' then h.size_bytes end asc,
               case when v_dir = 'desc' and v_sort = 'size' then h.size_bytes end desc,
               case when v_dir = 'asc' and v_sort = 'modified' then coalesce(h.received_at, h.created_at) end asc,
               case when v_dir = 'desc' and v_sort = 'modified' then coalesce(h.received_at, h.created_at) end desc,
               h.id), '[]'::jsonb)
          from (select * from hits
                order by
                  case when v_dir = 'asc' then
                    case v_sort when 'name' then lower(coalesce(display_name, original_filename, filename))
                                when 'category' then category end end asc,
                  case when v_dir = 'desc' then
                    case v_sort when 'name' then lower(coalesce(display_name, original_filename, filename))
                                when 'category' then category end end desc,
                  case when v_dir = 'asc' and v_sort = 'size' then size_bytes end asc,
                  case when v_dir = 'desc' and v_sort = 'size' then size_bytes end desc,
                  case when v_dir = 'asc' and v_sort = 'modified' then coalesce(received_at, created_at) end asc,
                  case when v_dir = 'desc' and v_sort = 'modified' then coalesce(received_at, created_at) end desc,
                  id
                limit v_limit offset v_offset) h)
  into v_total, v_files;

  return jsonb_build_object(
    'scope', v_scope,
    'view', v_view,
    'job', case when v_scope = 'Job' then jsonb_build_object(
             'id', v_job.id, 'job_ref', v_job.job_ref, 'customer_name', v_customer,
             'workflow_stage', v_job.workflow_stage, 'record_class', v_job.record_class) end,
    'folder', case when v_folder.id is not null then jsonb_build_object(
                'id', v_folder.id, 'name', v_folder.name, 'parent_id', v_folder.parent_id,
                'version', v_folder.version, 'trashed_at', v_folder.trashed_at) end,
    'breadcrumbs', case when v_folder.id is null then '[]'::jsonb else (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by p.ord), '[]'::jsonb)
      from unnest(v_folder.path_ids) with ordinality as p (id, ord)
      join public.file_folders a on a.id = p.id) end,
    'can_manage', app.file_can_manage(v_actor, v_scope, v_job_id),
    'can_purge', app.actor_has_permission(v_actor, 'file.purge'),
    'sort', v_sort, 'dir', v_dir, 'q', v_q,
    'folders', v_folders,
    'files', v_files,
    'total_files', v_total, 'limit', v_limit, 'offset', v_offset);
end
$$;

-- Cross-scope search that says WHERE each document lives. Request:
--   {q?, scope?, job_id?, category?, from?, to?, trashed?, limit?, offset?}
-- Never returns a storage path; documents open through /api/evidence/<id>.
-- Read-only, and paged in the database: no client ever loads the filesystem.
create function public.file_search(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_q text := nullif(btrim(coalesce(p_request ->> 'q', '')), '');
  v_scope text := nullif(btrim(coalesce(p_request ->> 'scope', '')), '');
  v_job uuid;
  v_category text := nullif(btrim(coalesce(p_request ->> 'category', '')), '');
  v_from date;
  v_to date;
  v_trashed boolean := coalesce((p_request ->> 'trashed')::boolean, false);
  v_limit int;
  v_offset int;
  v_rows jsonb;
  v_total int;
begin
  perform app.req_keys(coalesce(p_request, '{}'::jsonb),
                       array['q', 'scope', 'job_id', 'category', 'from', 'to', 'trashed', 'limit', 'offset']);
  if v_scope is not null and v_scope not in ('Job', 'Library') then
    perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'scope'));
  end if;
  v_job := app.file_uuid(p_request -> 'job_id', 'job_id');
  begin
    v_from := nullif(p_request ->> 'from', '')::date;
    v_to := nullif(p_request ->> 'to', '')::date;
    v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 50), 1), 200);
    v_offset := greatest(coalesce(nullif(p_request ->> 'offset', '')::int, 0), 0);
  exception when others then
    perform app.fail('R1A_INVALID_FIELDS');
  end;
  v_q := left(coalesce(v_q, ''), 120);
  v_q := nullif(v_q, '');

  -- The evidence row travels as a whole composite value (ev), not as spread
  -- columns: app.file_document_json takes a public.evidence, and a record of
  -- "the row plus some join columns" is not castable to it.
  with hits as (
    select e as ev, e.id, e.scope, e.job_id, e.folder_id,
           coalesce(e.received_at, e.created_at) as sort_at,
           j.job_ref, j.workflow_stage, j.record_class,
           nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') as customer_name, c.postcode
    from public.evidence e
    left join public.jobs j on j.id = e.job_id
    left join public.customers c on c.id = j.customer_id
    where e.upload_status = 'Uploaded'
      and e.purged_at is null
      and (case when v_trashed then e.trashed_at is not null else e.trashed_at is null end)
      and app.can_read_evidence(v_actor, e)
      and (v_scope is null or e.scope = v_scope)
      and (v_job is null or e.job_id = v_job)
      and (v_category is null or e.category = v_category)
      and (v_from is null or coalesce(e.received_at, e.created_at) >= v_from::timestamptz)
      and (v_to is null or coalesce(e.received_at, e.created_at) < (v_to + 1)::timestamptz)
      -- Filename, folder, job reference, customer, address.
      and (v_q is null
           or coalesce(e.display_name, e.original_filename, e.filename) ilike '%' || v_q || '%'
           or j.job_ref ilike '%' || v_q || '%'
           or c.postcode ilike '%' || v_q || '%'
           or concat_ws(' ', c.first_name, c.last_name) ilike '%' || v_q || '%'
           or e.category ilike '%' || v_q || '%'
           or exists (select 1 from public.file_folders f
                      where f.id = e.folder_id and f.name ilike '%' || v_q || '%'))
  )
  select (select count(*) from hits),
         (select coalesce(jsonb_agg(
             app.file_document_json(h.ev, v_actor) || jsonb_build_object(
               'job_ref', h.job_ref, 'customer_name', h.customer_name, 'postcode', h.postcode,
               'workflow_stage', h.workflow_stage, 'record_class', h.record_class,
               -- Where it lives, so a result can be opened in place.
               'location', jsonb_build_object(
                 'scope', h.scope, 'job_id', h.job_id, 'job_ref', h.job_ref,
                 'folder_id', h.folder_id, 'folder_path', app.file_folder_path_text(h.folder_id)))
             order by h.sort_at desc, h.id), '[]'::jsonb)
          from (select * from hits
                order by sort_at desc, id
                limit v_limit offset v_offset) h)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset,
                            'q', v_q, 'trashed', v_trashed, 'files', v_rows);
end
$$;

-- One document: what it is, where it lives, what relies on it, and what has
-- been done to it. Request: {file_id}. Read-only.
create function public.file_details(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_row public.evidence;
  v_job public.jobs;
  v_customer text;
  v_history jsonb;
begin
  perform app.req_keys(p_request, array['file_id']);
  select * into v_row from public.evidence where id = app.file_uuid(p_request -> 'file_id', 'file_id');
  if v_row.id is null or v_row.purged_at is not null or not app.can_read_evidence(v_actor, v_row) then
    perform app.fail('EVIDENCE_NOT_FOUND');
  end if;
  if v_row.job_id is not null then
    select * into v_job from public.jobs where id = v_row.job_id;
    select nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '') into v_customer
    from public.customers c where c.id = v_job.customer_id;
  end if;

  -- The audit log is the history; nothing separate is kept.
  select coalesce(jsonb_agg(jsonb_build_object(
           'action', a.action, 'at', a.occurred_at,
           'by_name', app.s17_person_name(a.initiating_person_id),
           'service', a.executing_service,
           'from', a.before_json -> 'name', 'to', a.after_json -> 'name',
           'from_folder', a.before_json -> 'folder_id', 'to_folder', a.after_json -> 'folder_id',
           'reason', a.reason)
           order by a.occurred_at desc, a.id desc), '[]'::jsonb)
  into v_history
  from (select * from public.audit_events a
        where a.entity_type = 'Evidence' and a.entity_id = v_row.id::text
        order by a.occurred_at desc, a.id desc limit 100) a;

  return jsonb_build_object(
    'file', app.file_document_json(v_row, v_actor) || jsonb_build_object(
      'uploaded_filename', v_row.original_filename,
      'upload_status', v_row.upload_status,
      'checksum', v_row.checksum,
      'open_url', '/api/evidence/' || v_row.id,
      'download_url', '/api/evidence/' || v_row.id || '?download=1'),
    'location', jsonb_build_object(
      'scope', v_row.scope, 'job_id', v_row.job_id, 'job_ref', v_job.job_ref,
      'customer_name', v_customer, 'record_class', v_job.record_class,
      'folder_id', v_row.folder_id, 'folder_path', app.file_folder_path_text(v_row.folder_id)),
    'can_manage', app.file_can_manage(v_actor, v_row.scope, v_row.job_id),
    'can_purge', app.actor_has_permission(v_actor, 'file.purge'),
    'evidence_locked', app.file_evidence_locked(v_row),
    'task_title', (select t.title from public.tasks t where t.id = v_row.task_id),
    'history', v_history);
end
$$;

-- The existing Files-library search. Its request and its row shape are
-- unchanged - the Files library, the job Files tab and SimpleBot all read it -
-- but a document in the trash or destroyed is no longer a search result, and
-- the name it reports is the one staff gave it. Company documents have no job,
-- so the join to jobs already excludes them; they are reached through
-- public.file_search, which knows about scope.
create or replace function public.search_evidence(p_request jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_actor jsonb := app.resolve_actor();
  v_key text;
  v_q text := nullif(btrim(coalesce(p_request ->> 'q', '')), '');
  v_category text := nullif(btrim(coalesce(p_request ->> 'category', '')), '');
  v_job uuid;
  v_from date;
  v_to date;
  v_limit int;
  v_offset int;
  v_rows jsonb;
  v_total int;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  for v_key in select jsonb_object_keys(p_request) loop
    if v_key not in ('q', 'category', 'job_id', 'from', 'to', 'limit', 'offset') then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', v_key));
    end if;
  end loop;
  if coalesce(p_request ->> 'job_id', '') <> '' then
    if p_request ->> 'job_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform app.fail('R1A_INVALID_FIELDS', jsonb_build_object('field', 'job_id'));
    end if;
    v_job := (p_request ->> 'job_id')::uuid;
  end if;
  begin
    v_from := nullif(p_request ->> 'from', '')::date;
    v_to := nullif(p_request ->> 'to', '')::date;
    v_limit := least(greatest(coalesce(nullif(p_request ->> 'limit', '')::int, 50), 1), 200);
    v_offset := greatest(coalesce(nullif(p_request ->> 'offset', '')::int, 0), 0);
  exception when others then
    perform app.fail('R1A_INVALID_FIELDS');
  end;

  with hits as (
    select e.*, j.job_ref, j.workflow_stage, c.first_name, c.last_name, c.postcode
    from public.evidence e
    join public.jobs j on j.id = e.job_id
    left join public.customers c on c.id = j.customer_id
    where e.upload_status = 'Uploaded'
      -- New: filing state. Everything else is as it was.
      and e.trashed_at is null and e.purged_at is null
      and app.can_read_evidence(v_actor, e)
      and (v_job is null or e.job_id = v_job)
      and (v_category is null or e.category = v_category)
      and (v_from is null or coalesce(e.received_at, e.created_at) >= v_from::timestamptz)
      and (v_to is null or coalesce(e.received_at, e.created_at) < (v_to + 1)::timestamptz)
      and (v_q is null or j.job_ref ilike '%' || v_q || '%'
           or coalesce(e.display_name, e.original_filename, e.filename) ilike '%' || v_q || '%'
           or c.postcode ilike '%' || v_q || '%'
           or concat_ws(' ', c.first_name, c.last_name) ilike '%' || v_q || '%')
  )
  select (select count(*) from hits),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'id', h.id, 'job_id', h.job_id, 'job_ref', h.job_ref, 'workflow_stage', h.workflow_stage,
             'customer_name', nullif(btrim(concat_ws(' ', h.first_name, h.last_name)), ''), 'postcode', h.postcode,
             'category', h.category,
             'filename', coalesce(h.display_name, h.original_filename, h.filename), 'mime_type', h.mime_type,
             'size_bytes', h.size_bytes, 'added_at', coalesce(h.received_at, h.created_at),
             'added_by_name', app.s17_person_name(coalesce(h.uploaded_by, h.captured_by)),
             'task_id', h.task_id, 'task_title', (select t.title from public.tasks t where t.id = h.task_id),
             'issue_id', h.issue_id, 'submission_id', h.submission_id, 'work_package_id', h.work_package_id,
             'context_type', h.context_type,
             -- Added: where it lives, so a result can say so and open in place.
             'folder_id', h.folder_id, 'folder_path', app.file_folder_path_text(h.folder_id))
           order by coalesce(h.received_at, h.created_at) desc, h.id), '[]'::jsonb)
          from (select * from hits order by coalesce(received_at, created_at) desc, id limit v_limit offset v_offset) h)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'files', v_rows);
end
$$;

-- Likewise public.list_evidence: a job's Files tab must not show what has been
-- trashed. Same request, same rows, minus the filing state - plus the folder a
-- document sits in and the version a filing change must quote.
create or replace function public.list_evidence(p_request jsonb)
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
  select k into v_scope from jsonb_object_keys(p_request) k;
  if v_scope not in ('job_id', 'task_id', 'work_package_id')
     or coalesce(p_request ->> v_scope, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    perform app.fail('R1A_INVALID_FIELDS');
  end if;
  v_id := (p_request ->> v_scope)::uuid;
  if v_scope = 'task_id' then
    select * into v_task from public.tasks where id = v_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'job_id', e.job_id, 'task_id', e.task_id, 'work_package_id', e.work_package_id,
           'submission_id', e.submission_id, 'issue_id', e.issue_id, 'category', e.category,
           'filename', coalesce(e.display_name, e.original_filename, e.filename), 'mime_type', e.mime_type,
           'size_bytes', e.size_bytes, 'upload_status', e.upload_status,
           'added_at', coalesce(e.received_at, e.created_at),
           'added_by_name', (select p.display_name from public.people p where p.id = coalesce(e.uploaded_by, e.captured_by)),
           'task_title', (select t.title from public.tasks t where t.id = e.task_id),
           'current', case when v_scope = 'task_id' then e.id = v_task.evidence_id end,
           'can_open', e.upload_status = 'Uploaded',
           'folder_id', e.folder_id, 'folder_path', app.file_folder_path_text(e.folder_id),
           'filing_version', e.filing_version, 'evidence_locked', app.file_evidence_locked(e))
           order by coalesce(e.received_at, e.created_at) desc, e.id), '[]'::jsonb)
  into v_rows
  from public.evidence e
  where app.can_read_evidence(v_actor, e)
    and e.trashed_at is null and e.purged_at is null
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
-- 12. Refusal wording
-- -----------------------------------------------------------------------------

alter function app.result_error_catalogue() rename to result_error_catalogue_pre_files;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_pre_files() || '{
  "FILE_NAME_REQUIRED": ["ActionRequired", "Give it a name."],
  "FILE_NAME_TOO_LONG": ["ActionRequired", "That name is too long. Use 80 characters or fewer."],
  "FILE_NAME_INVALID": ["ActionRequired", "That name can''t be used. Avoid slashes and punctuation like : * ? \" < > |."],
  "FILE_NAME_TAKEN": ["ActionRequired", "Something with that name is already here. Choose a different name."],
  "FILE_FOLDER_NOT_FOUND": ["Failed", "That folder could not be found."],
  "FILE_FOLDER_TRASHED": ["Failed", "That folder is in the trash. Restore it first."],
  "FILE_FOLDER_PARENT_TRASHED": ["Failed", "The folder it would go into is in the trash."],
  "FILE_FOLDER_CYCLE": ["ActionRequired", "A folder can''t be moved into itself or into one of its own folders."],
  "FILE_FOLDER_TOO_DEEP": ["ActionRequired", "Folders can only be nested ten deep. Move it somewhere nearer the top."],
  "FILE_FOLDER_SCOPE_MISMATCH": ["Failed", "That folder belongs to different work."],
  "FILE_FOLDER_SCOPE_IMMUTABLE": ["Failed", "A folder can''t be moved to another job."],
  "FILE_CROSS_SCOPE_MOVE": ["Failed", "Documents can''t be moved to another job. Upload a copy there instead."],
  "FILE_PERMISSION_DENIED": ["Failed", "You don''t have permission to organise these documents."],
  "FILE_PURGE_DENIED": ["Failed", "Only an administrator can permanently delete a document."],
  "FILE_EVIDENCE_LOCKED": ["Failed", "This document is the evidence for work that has been recorded, so it can''t be deleted."],
  "FILE_IN_TRASH": ["Failed", "That document is in the trash. Restore it first."],
  "FILE_NOT_IN_TRASH": ["Failed", "Only a document in the trash can be permanently deleted."],
  "FILE_ALREADY_DESTROYED": ["Failed", "That document was permanently deleted."],
  "FILE_SELECTION_EMPTY": ["ActionRequired", "Choose at least one item."],
  "FILE_SELECTION_TOO_LARGE": ["ActionRequired", "Too many items at once. Select 200 or fewer."],
  "FILE_CONFLICT": ["ActionRequired", "Someone else changed this while you were working. Refresh and try again."],
  "HISTORICAL_IMPORT": ["Failed", "This is an imported historical record, not live work. Its documents are read-only."]
  }'::jsonb
$$;

grant execute on function app.result_error_catalogue(), app.result_error_catalogue_pre_files()
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 13. Privileges
--
-- Entry points for signed-in staff only. Every one of them resolves the actor
-- itself and authorizes from the database's own rules, so being able to call
-- one grants nothing: a person who guesses a document id, a folder id or a
-- storage path still gets EVIDENCE_NOT_FOUND.
-- -----------------------------------------------------------------------------

revoke execute on function
  public.file_folder_create(jsonb), public.file_folder_rename(jsonb), public.file_folder_move(jsonb),
  public.file_folder_trash(jsonb), public.file_folder_restore(jsonb),
  public.file_rename(jsonb), public.file_move(jsonb), public.file_trash(jsonb),
  public.file_restore(jsonb), public.file_purge(jsonb),
  public.file_browse(jsonb), public.file_search(jsonb), public.file_details(jsonb),
  public.file_job_index(jsonb)
  from public, anon;

grant execute on function
  public.file_folder_create(jsonb), public.file_folder_rename(jsonb), public.file_folder_move(jsonb),
  public.file_folder_trash(jsonb), public.file_folder_restore(jsonb),
  public.file_rename(jsonb), public.file_move(jsonb), public.file_trash(jsonb),
  public.file_restore(jsonb), public.file_purge(jsonb),
  public.file_browse(jsonb), public.file_search(jsonb), public.file_details(jsonb),
  public.file_job_index(jsonb)
  to authenticated, service_role;

grant execute on function app.can_read_folder(jsonb, public.file_folders) to authenticated;
grant select on public.file_folders to authenticated;
