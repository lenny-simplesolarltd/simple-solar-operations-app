// The navigation matrix is only as truthful as the permission sets it assumes.
//
// src/components/layout/__tests__/role-navigation-matrix.test.ts asserts what
// each role is offered in the menu, using permission sets copied out of
// public.role_permissions. That copy is the weak point: grant a role a new
// permission in a migration and the matrix test would keep passing while
// describing a system that no longer exists.
//
// So this compares the two directly. It reads no navigation and renders nothing;
// it only insists that the table the unit test reasons about is still the table
// the database holds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { service } from './helpers.mjs';

const SOURCE = new URL(
  '../src/components/layout/__tests__/role-navigation-matrix.test.ts',
  import.meta.url
);

/** The ROLE_PERMISSIONS literal, read as text rather than imported. */
function embeddedSets() {
  const source = readFileSync(SOURCE, 'utf8');
  const start = source.indexOf('export const ROLE_PERMISSIONS');
  assert.notEqual(start, -1, 'ROLE_PERMISSIONS is no longer exported');
  const end = source.indexOf('\n};', start);
  const body = source.slice(start, end);

  const sets = {};
  // Each entry is `Role: <one or more string literals>` followed by a split.
  for (const match of body.matchAll(
    /(\w+):\s*((?:`[^`]*`|'[^']*')(?:\s*\.\s*\w+\([^)]*\))*)/g
  )) {
    const [, role, literal] = match;
    const words = literal
      .replace(/`|'/g, ' ')
      .replace(/\.\s*\w+\([^)]*\)/g, ' ')
      .split(/\s+/)
      .filter((w) => /^[a-z][a-z._]*$/.test(w) && w.includes('.'));
    sets[role] = [...new Set(words)].sort();
  }
  return sets;
}

describe('the navigation matrix describes the real role permissions', () => {
  test('every embedded permission set matches public.role_permissions', async () => {
    const embedded = embeddedSets();
    assert.ok(
      Object.keys(embedded).length >= 6,
      `expected the six signed-off roles, parsed ${Object.keys(embedded)}`
    );

    const { data, error } = await service
      .from('role_permissions')
      .select('role_code, permission_code')
      .in('role_code', Object.keys(embedded));
    assert.ifError(error);

    const actual = {};
    for (const row of data) {
      (actual[row.role_code] ??= []).push(row.permission_code);
    }

    for (const [role, expected] of Object.entries(embedded)) {
      const real = [...new Set(actual[role] ?? [])].sort();
      assert.deepEqual(
        expected,
        real,
        `the navigation matrix's permissions for ${role} no longer match the ` +
          `database. Missing here: ${real.filter((p) => !expected.includes(p))}. ` +
          `No longer granted: ${expected.filter((p) => !real.includes(p))}.`
      );
    }
  });
});
