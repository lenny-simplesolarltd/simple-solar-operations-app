-- =============================================================================
-- Fix: searching Files & documents fails with
--   42846: cannot cast type record to public.evidence
--
-- WHAT WAS WRONG
-- --------------
-- public.file_search carried the whole evidence row through its CTE as a
-- composite column (`select e as ev, ...`), because app.file_document_json
-- takes a public.evidence and a row of "the evidence columns plus some join
-- columns" is not one. The comment there said exactly that.
--
-- The paging step underneath then did `select * from hits ... limit`. Passing a
-- composite column back out through that subquery loses its named type: by the
-- time `h.ev` reaches app.file_document_json it is an anonymous record, and
-- record -> public.evidence is not a cast Postgres will make. Every call failed,
-- whatever was searched for.
--
-- It went unnoticed because the Files screen only calls file_search once
-- somebody types in the search box - browsing uses file_browse, which passes
-- its CTE row directly and was never affected. Attaching a stored document in
-- SimpleBot calls it on open, which is how it came to light.
--
-- THE FIX
-- -------
-- The CTE now carries only ids and the join columns, and the evidence row is
-- fetched by joining public.evidence back on at the end. `e` there is a genuine
-- public.evidence, so nothing is being cast at all. Filters, ordering, paging,
-- the counts and the JSON shape are all unchanged - only where the row comes
-- from has changed.
--
-- ROLLBACK:
--   begin;
--   -- Re-run public.file_search(jsonb) from 20260920240000_file_manager.sql.
--   -- Note that doing so restores the failure above.
--   commit;
-- =============================================================================

create or replace function public.file_search(p_request jsonb)
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

  -- Ids and join columns only. The evidence row is joined back on below, where
  -- it is a real public.evidence rather than something that has to be cast.
  with hits as (
    select e.id, e.scope, e.job_id, e.folder_id,
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
             app.file_document_json(e, v_actor) || jsonb_build_object(
               'job_ref', h.job_ref, 'customer_name', h.customer_name, 'postcode', h.postcode,
               'workflow_stage', h.workflow_stage, 'record_class', h.record_class,
               -- Where it lives, so a result can be opened in place.
               'location', jsonb_build_object(
                 'scope', h.scope, 'job_id', h.job_id, 'job_ref', h.job_ref,
                 'folder_id', h.folder_id, 'folder_path', app.file_folder_path_text(h.folder_id)))
             order by h.sort_at desc, h.id), '[]'::jsonb)
          from (select * from hits
                order by sort_at desc, id
                limit v_limit offset v_offset) h
          join public.evidence e on e.id = h.id)
  into v_total, v_rows;

  return jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset,
                            'q', v_q, 'trashed', v_trashed, 'files', v_rows);
end
$$;

revoke execute on function public.file_search(jsonb) from public, anon;
grant execute on function public.file_search(jsonb) to authenticated, service_role;
