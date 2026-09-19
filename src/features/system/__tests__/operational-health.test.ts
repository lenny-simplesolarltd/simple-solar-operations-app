import { describe, expect, it } from 'vitest';
import {
  buildLiveness,
  EXPECTED_ITEMS,
  normalizeOperational,
  toEvidenceState,
  worstState
} from '../operational-health';

const now = new Date('2026-09-19T10:00:00Z');
const allVerified = Object.fromEntries(
  EXPECTED_ITEMS.map((i) => [i.key, 'Verified'])
);

describe('evidence states', () => {
  it('treats anything that is not a known state as Unknown, never as a pass', () => {
    expect(toEvidenceState('Verified')).toBe('Verified');
    for (const v of [
      'Pass',
      'OK',
      'verified',
      'Healthy',
      '',
      null,
      undefined,
      1,
      true
    ])
      expect(toEvidenceState(v)).toBe('Unknown');
  });

  it('lets the worst state win and needs every part to be Verified', () => {
    expect(worstState([])).toBe('Unknown');
    expect(worstState(['Verified', 'Verified'])).toBe('Verified');
    expect(worstState(['Verified', 'Unknown'])).toBe('Unknown');
    expect(worstState(['Unknown', 'Stale'])).toBe('Stale');
    expect(worstState(['Stale', 'Failed', 'Verified'])).toBe('Failed');
  });
});

describe('normalizeOperational', () => {
  it('shows every check as Unknown when the backend sends nothing', () => {
    for (const raw of [undefined, null, {}, { items: 'nope' }, 'Verified']) {
      const h = normalizeOperational(raw);
      expect(h.reported).toBe(false);
      expect(h.overallState).toBe('Unknown');
      expect(h.items).toHaveLength(EXPECTED_ITEMS.length);
      expect(h.items.every((i) => i.state === 'Unknown')).toBe(true);
    }
  });

  it('does not trust a summary over its parts', () => {
    const h = normalizeOperational({
      overall_state: 'Verified',
      items: [
        { key: 'Database', label: 'Database', state: 'Verified', detail: 'ok' },
        {
          key: 'DatabaseBackup',
          label: 'Database backup verified',
          state: 'Pass'
        }
      ]
    });
    expect(h.reported).toBe(true);
    expect(h.items.find((i) => i.key === 'DatabaseBackup')?.state).toBe(
      'Unknown'
    );
    expect(h.overallState).toBe('Unknown');
  });

  it('adds expected checks the backend left out, as Unknown', () => {
    const h = normalizeOperational({
      items: [
        { key: 'Database', label: 'Database', state: 'Verified', detail: 'ok' }
      ]
    });
    expect(h.items).toHaveLength(EXPECTED_ITEMS.length);
    expect(h.items.find((i) => i.key === 'StorageRestoreDrill')?.state).toBe(
      'Unknown'
    );
    expect(h.overallState).toBe('Unknown');
  });

  it('carries the evidence through', () => {
    const h = normalizeOperational({
      items: EXPECTED_ITEMS.map((i) => ({
        ...i,
        state: i.key === 'DatabaseBackup' ? 'Stale' : 'Verified',
        detail: 'd',
        evidence_at: '2026-09-01T09:00:00Z',
        last_verified_at: '2026-09-01T09:00:00Z',
        recorded_by: 'Ben Quick',
        source: 'Person',
        method: 'Dashboard',
        evidence_reference: 'OPS-1'
      }))
    });
    const b = h.items.find((i) => i.key === 'DatabaseBackup');
    expect(b).toMatchObject({
      state: 'Stale',
      evidenceAt: '2026-09-01T09:00:00Z',
      recordedBy: 'Ben Quick',
      evidenceReference: 'OPS-1'
    });
    expect(h.overallState).toBe('Stale');
  });

  it('knows whether evidence can be recorded (release gate FN-14)', () => {
    const items = (on: unknown) => ({
      items: [
        {
          key: 'ReleaseFunctions',
          label: 'Release functions',
          state: 'Verified',
          monitoring_enabled: on
        }
      ]
    });
    expect(normalizeOperational(items(true)).monitoringEnabled).toBe(true);
    for (const v of [false, 'true', 1, undefined, null])
      expect(normalizeOperational(items(v)).monitoringEnabled).toBe(false);
    expect(normalizeOperational(undefined).monitoringEnabled).toBe(false);
  });
});

describe('buildLiveness (GET /api/health)', () => {
  it('is 503 when the database did not answer', () => {
    const r = buildLiveness({ kind: 'error' }, { strict: false, now });
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({
      app: 'responding',
      database: 'not_responding',
      operational_health: 'unavailable',
      overall_state: 'Unknown'
    });
  });

  it('is 200 but Unknown when the health functions are not deployed', () => {
    const r = buildLiveness({ kind: 'not_deployed' }, { strict: false, now });
    expect(r.status).toBe(200);
    expect(r.body.database).toBe('responding');
    expect(r.body.operational_health).toBe('not_deployed');
    expect(r.body.overall_state).toBe('Unknown');
    expect(
      buildLiveness({ kind: 'not_deployed' }, { strict: true, now }).status
    ).toBe(503);
  });

  it('does not accept a reply that does not say the database responded', () => {
    const r = buildLiveness(
      { kind: 'ok', data: { states: allVerified } },
      { strict: false, now }
    );
    expect(r.status).toBe(503);
    expect(r.body.database).toBe('not_responding');
  });

  it('reports states, and strict mode needs all of them Verified', () => {
    const stale = { ...allVerified, DatabaseBackup: 'Stale' };
    const data = {
      database: 'responding',
      overall_state: 'Verified',
      states: stale
    };
    const loose = buildLiveness({ kind: 'ok', data }, { strict: false, now });
    expect(loose.status).toBe(200);
    expect(loose.body.overall_state).toBe('Stale'); // recomputed, not the claimed summary
    expect(
      buildLiveness({ kind: 'ok', data }, { strict: true, now }).status
    ).toBe(503);
    const good = { database: 'responding', states: allVerified };
    const strict = buildLiveness(
      { kind: 'ok', data: good },
      { strict: true, now }
    );
    expect(strict.status).toBe(200);
    expect(strict.body.overall_state).toBe('Verified');
    expect(strict.body.checked_at).toBe('2026-09-19T10:00:00.000Z');
  });

  it('is never Verified with no states at all', () => {
    const r = buildLiveness(
      { kind: 'ok', data: { database: 'responding', states: {} } },
      { strict: true, now }
    );
    expect(r.body.overall_state).toBe('Unknown');
    expect(r.status).toBe(503);
  });
});
