#!/usr/bin/env bash
#
# Reads the hosted directory the matchers compare against. SELECT only.
#
#   scripts/imports/historical-job-bookings/snapshot.sh > <path>.json
#
# Three things make this safe to run against production:
#
#   * the session is opened read-only (`default_transaction_read_only = on`),
#     so the server refuses any write this script could contain;
#   * it connects as the database owner over the project's own configured
#     credential, not by weakening RLS and not through a service-role
#     application API;
#   * customer identifiers are hashed inside the database with a per-run salt,
#     so no plaintext email, postcode or surname is written to disk. The
#     matchers only ever compare these for equality, so hashing costs nothing.
#
# The salt is printed with the snapshot; the importer hashes the CSV side with
# the same salt. A new run means a new salt, so a stale snapshot cannot be
# silently matched against fresh CSV hashes.
set -euo pipefail

cd "$(dirname "$0")/../../.."

PW=$(grep -m1 '^SUPABASE_DB_PASSWORD' .env | cut -d= -f2- | tr -d '"'"'"' ')
REF=$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL' .env | sed -E 's#.*//([a-z0-9]+)\..*#\1#')
if [ -z "$PW" ] || [ -z "$REF" ]; then
  echo "hosted credentials are not configured in .env" >&2
  exit 1
fi

SALT=${SNAPSHOT_SALT:-$(openssl rand -hex 16)}

PGPASSWORD="$PW" PGCONNECT_TIMEOUT=15 psql \
  "postgresql://postgres@db.${REF}.supabase.co:5432/postgres?sslmode=require" \
  -v ON_ERROR_STOP=1 -v salt="$SALT" -tAq <<'SQL'
set default_transaction_read_only = on;

select jsonb_pretty(jsonb_build_object(
  'source', 'hosted-snapshot',
  'jobsAuthoritative', true,
  'salt', :'salt',
  'takenAt', now(),
  'people', coalesce((
    select jsonb_agg(jsonb_build_object(
      'legacyId', p.legacy_id, 'email', p.email,
      'displayName', p.display_name, 'active', p.active))
    from public.people p), '[]'::jsonb),
  'companies', coalesce((
    select jsonb_agg(jsonb_build_object('name', c.name, 'type', c.type))
    from public.companies c where c.active), '[]'::jsonb),
  -- Customer identifiers are hashed here, in the database.
  'jobs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'jobRef', j.job_ref,
      'customerPostcode', case when c.postcode is null then null
        else md5(:'salt' || upper(replace(c.postcode, ' ', ''))) end,
      'customerEmail', case when c.email is null then null
        else md5(:'salt' || lower(btrim(c.email))) end,
      'customerLastName', case when c.last_name is null then null
        else md5(:'salt' || lower(btrim(c.last_name))) end,
      'soldAt', j.sold_at))
    from public.jobs j left join public.customers c on c.id = j.customer_id), '[]'::jsonb),
  'intakeKeys', coalesce((
    select jsonb_agg(i.form_id || ':' || i.submission_id)
    from public.intake i where i.form_id = 'historical-job-booking-form'), '[]'::jsonb),
  'counts', jsonb_build_object(
    'people', (select count(*) from public.people),
    'customers', (select count(*) from public.customers),
    'jobs', (select count(*) from public.jobs),
    'companies', (select count(*) from public.companies),
    'intake', (select count(*) from public.intake))
));
SQL
