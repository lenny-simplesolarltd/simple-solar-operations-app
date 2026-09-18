-- =============================================================================
-- Backend port: staff-facing wording for the R2-R4 refusal codes.
--
-- Append-only extension of the S17 result catalogue (20260919149000):
--   * the R1 catalogue function is kept (renamed) and merged with the codes
--     the R2-R4 modules raise;
--   * describe_command_error recognises every "<NS>_REVIEW / _REFUSED /
--     _CONFIG" namespace (MAT, STK, SCF, IW, CAL, XO, RP, OUTBOX, STOCK ...),
--     as the reference parser did (r1-appsheet/command-result.js:207-211);
--     it previously matched only S<nn>_ codes, so R2-R4 refusals fell
--     through to the generic "unknown" failure. Otherwise unchanged.
-- =============================================================================

alter function app.result_error_catalogue() rename to result_error_catalogue_r1;

create function app.result_error_catalogue()
returns jsonb
language sql immutable
set search_path = ''
as $$
  select app.result_error_catalogue_r1() || '{
  "R1C_ASSIGNMENT_DENIED": [
    "Failed",
    "You''re not allocated to this work package."
  ],
  "R1C_OFFICE_REASON_REQUIRED": [
    "ActionRequired",
    "Give a reason when acting for an installer, then try again."
  ],
  "R1C_EXPECTED_VERSION_REQUIRED": [
    "ActionRequired",
    "STALE"
  ],
  "R1C_STALE_SUBMISSION": [
    "ActionRequired",
    "STALE"
  ],
  "R1C_APPROVED_TEMPLATE_REQUIRED": [
    "Failed",
    "No approved commissioning form exists for this trade yet, so it can''t be accepted."
  ],
  "R1C_APPROVED_QUESTION_REQUIRED": [
    "Failed",
    "That question isn''t on an approved commissioning form."
  ],
  "R1C_UPLOAD_PATH_INVALID": [
    "ActionRequired",
    "Upload the file for this job and try again."
  ],
  "R1C_EVIDENCE_FILE_REQUIRED": [
    "ActionRequired",
    "Attach the required photo or file and try again."
  ],
  "R1C_RECEIPT_LINES_REQUIRED": [
    "ActionRequired",
    "Enter the quantities received and try again."
  ],
  "R1C_DUPLICATE_RECEIPT_LINE": [
    "ActionRequired",
    "Each order line can only be entered once. Remove the duplicate and try again."
  ],
  "R1C_REVIEW_STATE_OR_NOTES": [
    "ActionRequired",
    "Choose Accepted or Returned and add review notes, then try again."
  ],
  "R1C_JOB_MISMATCH": [
    "Failed",
    "That record belongs to a different job."
  ],
  "R1C_SUBMISSION_MISMATCH": [
    "Failed",
    "That form belongs to a different job or work package."
  ],
  "R1A_ORDER_JOB_MISMATCH": [
    "Failed",
    "That order belongs to a different job."
  ],
  "R1A_SCAFFOLD_BOOKING_JOB_MISMATCH": [
    "Failed",
    "That scaffold booking belongs to a different job."
  ],
  "STK_INSUFFICIENT": [
    "ActionRequired",
    "There isn''t enough stock available for that quantity."
  ],
  "SCF_STRIP_BLOCKED": [
    "ActionRequired",
    "The scaffold can''t be stripped yet. Clear the listed blockers first."
  ]
}'::jsonb
$$;

create or replace function public.describe_command_error(p_error text, p_command_id text default null, p_field text default null)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_text text := btrim(coalesce(p_error, ''));
  v_match text[];
  v_code text;
  v_detail text := '';
  v_hit jsonb;
  v_status text;
  v_message text;
  v_field text;
begin
  v_match := regexp_match(v_text, '^([A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9])(?::\s*(.*))?$');
  if v_match is null then
    v_code := 'UNCLASSIFIED';
    v_detail := v_text;
  else
    v_code := v_match[1];
    v_detail := btrim(coalesce(v_match[2], ''));
  end if;
  v_hit := app.result_error_catalogue() -> v_code;
  if v_code ~ '^(R1[ACU]_)?REQUIRED_[A-Z0-9_]+$' then
    v_field := lower(regexp_replace(v_code, '^(R1[ACU]_)?REQUIRED_', ''));
  end if;
  -- Job Sold refusals (app.reject) carry the offending field in HINT.
  if nullif(btrim(coalesce(p_field, '')), '') is not null then
    v_field := btrim(p_field);
  end if;

  if v_hit is not null then
    v_status := v_hit ->> 0;
    v_message := coalesce(app.result_message(v_hit ->> 1), v_hit ->> 1);
  elsif v_code ~ '^TOO_LONG_' then
    v_field := coalesce(v_field, lower(regexp_replace(v_code, '^TOO_LONG_', '')));
    v_status := 'ActionRequired';
    v_message := app.result_field_label(v_field) || ' is too long. Shorten it and try again.';
  elsif v_code ~ '^(R1[ACU]_)?REQUIRED_' and v_field is not null then
    v_status := 'ActionRequired';
    v_message := app.result_field_label(v_field) || ' is required. Add it and try again.';
  elsif v_code ~ 'STALE' or (v_code ~ '^[A-Z][A-Z0-9]*_REVIEW$' and v_detail ~* 'stale') then
    v_status := 'ActionRequired'; v_message := app.result_message('STALE');
  elsif v_code ~ 'RECOVERY_REQUIRED$' then
    v_status := 'Failed'; v_message := app.result_message('RECOVERY');
  elsif v_code ~ '_MODE_DENIED|_MODE_MISSING' then
    v_status := 'Failed'; v_message := app.result_message('MODE');
  elsif v_code ~ '_DENIED' then
    v_status := 'Failed'; v_message := app.result_message('PERMISSION');
  elsif v_code ~ '_DEV_ONLY$|_SCHEMA$|^R1A_SCHEMA_|_TABLE_MISSING$|_UNSUPPORTED$|_NOT_CONFIGURED$|_RESOLVER_MISSING$|_COMMAND_ID_REQUIRED$|_BACKEND_MISSING|^[A-Z][A-Z0-9]*_CONFIG$' then
    v_status := 'Failed'; v_message := app.result_message('CONFIG');
  elsif (v_code ~ '_CONFLICT$' or v_code ~ '^[A-Z][A-Z0-9]*_REVIEW$') and (v_code || ' ' || v_detail) ~* 'conflict' then
    v_status := 'Failed'; v_message := app.result_message('CONFLICT');
  elsif v_code ~ '_DATE_INVALID$' then
    v_status := 'ActionRequired'; v_message := app.result_message('DATE');
  elsif v_code ~ '^(R1[ACU]_)?INVALID_' then
    v_status := 'ActionRequired'; v_message := app.result_message('INVALID');
  elsif v_code ~ '^[A-Z][A-Z0-9]*_REVIEW$' then
    v_status := 'ActionRequired';
    v_message := 'This needs checking before it can go ahead'
      || case when v_detail <> '' and v_detail !~ '[A-Z0-9]+_[A-Z0-9_]{2,}'
              then ': ' || regexp_replace(v_detail, '[.[:space:]]+$', '') else '' end || '.';
  elsif v_code ~ '^[A-Z][A-Z0-9]*_REFUSED$' then
    v_status := 'Failed'; v_message := 'This action isn''t allowed for this job at the moment.';
  elsif v_code ~ '_NOT_FOUND$' then
    v_status := 'Failed'; v_message := app.result_message('NOT_FOUND');
  else
    v_status := 'Failed'; v_message := app.result_message('UNKNOWN');
  end if;

  if v_status = 'Failed' and nullif(btrim(coalesce(p_command_id, '')), '') is not null then
    v_message := v_message || ' Reference: ' || btrim(p_command_id) || '.';
  end if;
  return jsonb_strip_nulls(jsonb_build_object('status', v_status, 'heading', app.result_heading(v_status),
                                              'message', v_message, 'code', v_code,
                                              'detail', nullif(left(v_detail, 300), ''), 'field', v_field));
end
$$;

revoke execute on function public.describe_command_error(text, text, text) from public, anon;
grant execute on function public.describe_command_error(text, text, text) to authenticated, service_role;
