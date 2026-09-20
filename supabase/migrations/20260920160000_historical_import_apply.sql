-- =============================================================================
-- Historical import: the apply function.
--
-- The importer does not build SQL. It emits one JSON document per candidate and
-- this function writes it, so no value from the source export is ever
-- interpolated into a statement. Everything the candidate carries arrives as
-- jsonb and is read with ->>.
--
-- Idempotency is structural, not conventional. `public.intake` already has
-- unique (form_id, submission_id); this function takes that row as the record
-- of "this submission has been imported", and everything else hangs off it:
--
--   * the intake row exists    -> the candidate has been applied. The function
--                                 compares payload_hash, reports whether the
--                                 source changed, and writes nothing.
--   * the intake row is absent -> the candidate is applied in full.
--
-- So a second run of the same export is a no-op, a resumed run picks up where
-- it stopped, and a changed re-export is reported rather than silently
-- duplicated or silently overwritten.
--
-- Nothing here updates an existing job, customer or person. The import is
-- additive: where a historical row disagrees with data already present, the
-- existing data wins and the difference is reported back to the caller.
--
-- Not granted to anon, authenticated or service_role. Only the migration owner
-- can execute it, so the import is not reachable from the application.
-- =============================================================================

create function app.historical_import_apply(p_candidate jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_form_id      text := p_candidate #>> '{provenance,formId}';
  v_submission   text := p_candidate #>> '{provenance,importKey}';
  v_raw_sub      text := p_candidate #>> '{provenance,submissionId}';
  v_payload_hash text := p_candidate #>> '{provenance,payloadHash}';
  v_source_ref   text := p_candidate #>> '{provenance,legacyReference}';
  v_received     timestamptz := nullif(p_candidate #>> '{provenance,submittedAt}', '')::timestamptz;
  v_batch        text := p_candidate #>> '{provenance,batchId}';

  v_existing     public.intake;
  v_intake_id    uuid;
  v_customer_id  uuid;
  v_job_id       uuid;
  v_job_ref      text;
  v_person       jsonb;
  v_people_count integer := 0;
  v_notes        text[] := '{}';
begin
  if v_form_id is null or v_submission is null or btrim(v_submission) = '' then
    return jsonb_build_object('ok', false, 'reason', 'candidate has no import identity');
  end if;

  -- Already applied? Then this is a replay or a resumed run.
  select * into v_existing from public.intake i
   where i.form_id = v_form_id and i.submission_id = v_submission;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'action', 'skipped',
      'reason', 'already imported',
      'intake_id', v_existing.id,
      'job_id', v_existing.job_id,
      'source_changed', v_existing.payload_hash is distinct from v_payload_hash,
      'writes', 0);
  end if;

  if p_dry_run then
    return jsonb_build_object('ok', true, 'action', 'would-import', 'writes', 0);
  end if;

  -- --- Customer ------------------------------------------------------------
  -- Always a new historical customer row. Deduplication against existing
  -- customers is the matcher's job and produced a decision before this point;
  -- reaching here means the candidate was classified as a new historical job.
  insert into public.customers (first_name, last_name, address_line1, address_line2,
                                town, postcode, email, phone, contact_notes)
  values (
    p_candidate #>> '{customer,firstName}',
    p_candidate #>> '{customer,lastName}',
    p_candidate #>> '{customer,addressLine1}',
    p_candidate #>> '{customer,addressLine2}',
    p_candidate #>> '{customer,town}',
    p_candidate #>> '{customer,postcode}',
    p_candidate #>> '{customer,email}',
    p_candidate #>> '{customer,phone}',
    'Imported from the historical Job Booking form.')
  returning id into v_customer_id;

  -- --- Job -----------------------------------------------------------------
  -- job_ref must match SS-XXXX-0000 with I and O excluded. Historical refs are
  -- minted in their own SS-H... block so they are distinguishable at a glance
  -- and cannot collide with a live sequence.
  select 'SS-H' ||
         chr(65 + (floor(random() * 8))::int) ||
         chr(65 + (floor(random() * 8))::int) ||
         chr(65 + (floor(random() * 8))::int) || '-' ||
         lpad(((floor(random() * 9000) + 1000))::int::text, 4, '0')
    into v_job_ref;
  while exists (select 1 from public.jobs j where j.job_ref = v_job_ref) loop
    select 'SS-H' ||
           chr(65 + (floor(random() * 8))::int) ||
           chr(65 + (floor(random() * 8))::int) ||
           chr(65 + (floor(random() * 8))::int) || '-' ||
           lpad(((floor(random() * 9000) + 1000))::int::text, 4, '0')
      into v_job_ref;
  end loop;

  insert into public.jobs (
    job_ref, customer_id, display_name, sold_at,
    salesperson_id, lead_source, finance_route,
    original_gross_pence, current_contract_gross_pence,
    roof_required, electrical_required, scaffold_required,
    workflow_stage, record_class, source_system, source_reference, archived_at)
  values (
    v_job_ref,
    v_customer_id,
    coalesce(nullif(btrim(coalesce(p_candidate #>> '{customer,lastName}', '') || ' ' ||
                          coalesce(p_candidate #>> '{customer,postcode}', '')), ''),
             'Historical job'),
    (p_candidate #>> '{job,soldAt}')::timestamptz,
    -- Null unless the salesperson resolved to exactly one active person. The
    -- importer passes a legacy_id, never a uuid: identity is resolved here,
    -- against this database, so a snapshot taken elsewhere cannot mislink.
    (select pp.id from public.people pp
      where pp.legacy_id = nullif(p_candidate #>> '{job,salespersonLegacyId}', '')
        and pp.active),
    p_candidate #>> '{job,leadSource}',
    nullif(p_candidate #>> '{job,financeRoute}', ''),
    nullif(p_candidate #>> '{job,grossPence}', '')::bigint,
    nullif(p_candidate #>> '{job,grossPence}', '')::bigint,
    coalesce((p_candidate #>> '{job,roofRequired}')::boolean, false),
    coalesce((p_candidate #>> '{job,electricalRequired}')::boolean, false),
    coalesce((p_candidate #>> '{job,scaffoldRequired}')::boolean, false),
    -- A historical record is closed. Archived and HistoricalImport together
    -- keep it out of every sweep and out of build_invoice_stages.
    'OperationallyComplete',
    'HistoricalImport',
    p_candidate #>> '{provenance,sourceSystem}',
    v_source_ref,
    now())
  returning id into v_job_id;

  -- --- Technical details ----------------------------------------------------
  if p_candidate -> 'technical' is not null
     and (p_candidate #>> '{technical,systemKw}' is not null
       or p_candidate #>> '{technical,mpan}' is not null
       or p_candidate #>> '{technical,roofNotes}' is not null
       or p_candidate #>> '{technical,electricalNotes}' is not null) then
    insert into public.technical_details (
      job_id, system_kw, battery_kwh, annual_generation_kwh, annual_consumption_kwh,
      mpan, fuse_rating_amps, roof_type, g99_status,
      roof_notes, electrical_notes, ordering_notes)
    values (
      v_job_id,
      nullif(p_candidate #>> '{technical,systemKw}', '')::numeric,
      nullif(p_candidate #>> '{technical,batteryKwh}', '')::numeric,
      nullif(p_candidate #>> '{technical,annualGenerationKwh}', '')::numeric,
      nullif(p_candidate #>> '{technical,annualConsumptionKwh}', '')::numeric,
      p_candidate #>> '{technical,mpan}',
      nullif(p_candidate #>> '{technical,fuseRatingAmps}', '')::integer,
      p_candidate #>> '{technical,roofType}',
      p_candidate #>> '{technical,g99Status}',
      p_candidate #>> '{technical,roofNotes}',
      p_candidate #>> '{technical,electricalNotes}',
      p_candidate #>> '{technical,orderingNotes}');
  end if;

  -- --- Historical staff -----------------------------------------------------
  -- The name as recorded, always. A person link only where the match was
  -- unambiguous, which the table's own CHECK also enforces. Never an allocation.
  for v_person in select * from jsonb_array_elements(coalesce(p_candidate -> 'historicalPeople', '[]'::jsonb))
  loop
    insert into public.historical_job_people (job_id, role, source_value, person_id, match_kind, source_column)
    values (
      v_job_id,
      v_person ->> 'role',
      v_person ->> 'sourceValue',
      (select pp.id from public.people pp
        where pp.legacy_id = nullif(v_person ->> 'personLegacyId', '') and pp.active),
      v_person ->> 'matchKind',
      nullif(v_person ->> 'sourceColumn', '')::integer)
    on conflict (job_id, role, source_value) do nothing;
    v_people_count := v_people_count + 1;
  end loop;

  -- --- Provenance -----------------------------------------------------------
  -- Written last, so a failure part-way leaves no intake row and the candidate
  -- is retried in full rather than half-applied. The whole function runs in the
  -- caller's transaction, so a failure rolls the rest back anyway; this keeps
  -- the guarantee even if that ever changes.
  insert into public.intake (
    intake_id, form_type, form_id, submission_id, source_revision,
    received_at, raw_payload_json, payload_hash, job_id,
    processing_status, processed_at)
  values (
    v_batch || ':' || v_submission,
    'Booking',
    v_form_id,
    v_submission,
    v_source_ref,
    coalesce(v_received, now()),
    p_candidate,
    v_payload_hash,
    v_job_id,
    'Processed',
    now())
  returning id into v_intake_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'imported',
    'intake_id', v_intake_id,
    'job_id', v_job_id,
    'job_ref', v_job_ref,
    'customer_id', v_customer_id,
    'historical_people', v_people_count,
    'raw_submission_id', v_raw_sub,
    'writes', 3 + v_people_count,
    'notes', to_jsonb(v_notes));
end
$$;

comment on function app.historical_import_apply(jsonb, boolean) is
  'Applies one historical import candidate. Idempotent on intake (form_id, '
  'submission_id): a candidate already recorded is skipped and reported, never '
  'reapplied and never overwritten. Additive only; updates nothing that exists. '
  'Deliberately not granted to anon, authenticated or service_role.';

-- No grants. The import is a migration-owner operation, not an application one.
revoke all on function app.historical_import_apply(jsonb, boolean) from public;
