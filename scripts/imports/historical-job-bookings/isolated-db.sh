#!/usr/bin/env bash
#
# Builds an isolated database that stands in for hosted production.
#
#   scripts/imports/historical-job-bookings/isolated-db.sh [dbname]
#
# It replays every migration from zero, applies the repo's controlled seeds,
# sets the release modes to the values hosted currently holds, and creates two
# live jobs through the ordinary insert path so the baseline carries the same
# kind of operational rows hosted does (tasks, invoice stages).
#
# No production data is copied. The staff list comes from the repo seed that
# hosted itself was seeded from; the two jobs are synthetic. Nothing here
# touches hosted.
set -euo pipefail

cd "$(dirname "$0")/../../.."

DB=${1:-hist_iso}
C=ss-hist-iso

if ! docker ps --format '{{.Names}}' | grep -qx "$C"; then
  docker rm -f "$C" >/dev/null 2>&1 || true
  docker run -d --name "$C" -e POSTGRES_PASSWORD=postgres -p 56999:5432 postgres:17-alpine >/dev/null
  for _ in $(seq 1 60); do docker exec "$C" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
fi

psqli() { docker exec -i "$C" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

docker exec "$C" psql -U postgres -q -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null

# Supabase stand-ins the migrations expect. pg_cron is deliberately absent, so
# the schedule block in 20260919150000 skips itself.
psqli <<'SQL' >/dev/null
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now());
SQL

for f in supabase/migrations/*.sql; do
  if ! psqli < "$f" > /tmp/iso_mig.log 2>&1; then
    echo "migration failed: $(basename "$f")" >&2; head -8 /tmp/iso_mig.log >&2; exit 1
  fi
done

for f in supabase/seeds/*.sql; do
  psqli < "$f" > /dev/null 2>&1 || true   # seeds are insert-if-absent
done

# Release modes as hosted holds them today.
psqli <<'SQL' >/dev/null
update public.release_modes set mode = 'Automated'
  where function_id in ('FN-01','FN-02','FN-03','FN-04','FN-05','FN-06','FN-07','FN-08','FN-09','FN-12','FN-13','FN-14');
update public.release_modes set mode = 'Disabled' where function_id = 'FN-10';
update public.release_modes set mode = 'Manual'
  where function_id in ('FN-11','FN-15','FN-16','FN-17','FN-18','FN-19','FN-20','FN-21');
SQL

# Two live jobs, so the baseline has the operational rows hosted has. Inserted
# directly (not through submit_presale, which needs an authenticated actor);
# the AFTER INSERT trigger still builds their invoice stages, which is the
# behaviour the import must not disturb.
psqli <<'SQL' >/dev/null
do $$
declare
  v_sales uuid := (select id from public.people where legacy_id = 'PERSON-mike');
  v_cust uuid;
  v_i int;
begin
  for v_i in 1..2 loop
    insert into public.customers (first_name, last_name, address_line1, town, postcode, email)
    values ('Live', 'Baseline' || v_i, v_i || ' Baseline Road', 'Plymouth', 'ZZ9 9Z' || chr(64 + v_i),
            'live.baseline' || v_i || '@example.invalid')
    returning id into v_cust;

    insert into public.jobs (job_ref, customer_id, display_name, sold_at, salesperson_id,
      finance_route, original_gross_pence, current_contract_gross_pence,
      roof_required, electrical_required, scaffold_required, workflow_stage)
    values ('SS-BASE-000' || v_i, v_cust, 'Live baseline job ' || v_i, now() - (v_i || ' days')::interval,
            v_sales, 'Standard', 1200000, 1200000, true, true, true, 'Prebooking');
  end loop;
end
$$;
SQL

echo "isolated database '$DB' ready on port 56999"
docker exec "$C" psql -U postgres -d "$DB" -tAc \
  "select 'people=' || (select count(*) from public.people)
       || ' jobs=' || (select count(*) from public.jobs)
       || ' customers=' || (select count(*) from public.customers)
       || ' invoice_stages=' || (select count(*) from public.invoice_stages)
       || ' release_modes=' || (select count(*) from public.release_modes)"
