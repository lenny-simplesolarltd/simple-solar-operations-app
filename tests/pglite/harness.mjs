// Applies migrations to a fresh in-memory Postgres (PGlite) with Supabase stubs.
//
// By default loads the proven core (every file up to 20260919124999) plus the
// files named in the PORT_EXTRA env var (comma-separated basenames), so one
// module's broken file never breaks another module's tests.
// PORT_ALL=1 loads every migration in the directory.
import { PGlite } from '@electric-sql/pglite'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
export const dir = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const CORE_UPTO = process.env.PORT_UPTO || '20260919160999';
export async function fresh({ extra } = {}) {
  const extras = extra ?? (process.env.PORT_EXTRA ? process.env.PORT_EXTRA.split(',').map(s => s.trim()).filter(Boolean) : []);
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;`);
  for (const f of fs.readdirSync(dir).sort()) {
    const load = process.env.PORT_ALL === '1' || f <= CORE_UPTO || extras.includes(f);
    if (!load) continue;
    try { await db.exec(fs.readFileSync(`${dir}/${f}`, 'utf8')); }
    catch (e) { throw new Error(`${f}: ${e.message}${e.position ? ' @' + e.position : ''}`); }
  }
  return db;
}
if (process.argv[1].endsWith('harness.mjs')) { const db = await fresh(); const r = await db.query(`select count(*)::int n from pg_tables where schemaname='public'`); console.log('OK tables:', r.rows[0].n); }
