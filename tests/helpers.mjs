// Shared helpers for the integration tests. LOCAL Supabase stack only.
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const env = Object.fromEntries(
  execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .split('\n')
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value])
);

export const API_URL = env.API_URL;
assert.match(
  API_URL ?? '',
  /^http:\/\/(127\.0\.0\.1|localhost):/,
  'integration tests only run against the local Supabase stack'
);

export const PASSWORD = 'local-test-password-1';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
export const service = createClient(API_URL, env.SERVICE_ROLE_KEY, options);
export const anon = createClient(API_URL, env.ANON_KEY, options);

export const email = (name) => `${name}@simplesolarltd.co.uk`;

/** Creates the login if it does not exist yet (test files share one database). */
export async function ensureLogin(address) {
  const { error } = await service.auth.admin.createUser({
    email: address,
    password: PASSWORD,
    email_confirm: true
  });
  if (error && !/already/i.test(error.message)) throw error;
}

export async function signInAs(address) {
  const client = createClient(API_URL, env.ANON_KEY, options);
  const { error } = await client.auth.signInWithPassword({
    email: address,
    password: PASSWORD
  });
  assert.ifError(error);
  return client;
}

export async function person(legacyId) {
  const { data, error } = await service
    .from('people')
    .select('*')
    .eq('legacy_id', legacyId)
    .single();
  assert.ifError(error);
  return data;
}

export async function count(table, filter = (q) => q) {
  const { count: n, error } = await filter(
    service.from(table).select('*', { count: 'exact', head: true })
  );
  assert.ifError(error);
  return n;
}
