// Operational health as the database reports it (app.operational_health, inside
// the SYSTEM_STATUS read and public.health_ping). The database decides every
// state from evidence; nothing here upgrades one. Anything missing, unexpected
// or unparseable is Unknown - the screen never shows a pass it was not given.

export const EVIDENCE_STATES = [
  'Verified',
  'Stale',
  'Failed',
  'Unknown'
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

/** Checked while answering the request, so there is no "last evidence" time to show. */
const LIVE_KEYS = new Set(['Database', 'ReleaseFunctions', 'AuditCoverage']);

export interface OperationalItem {
  key: string;
  label: string;
  state: EvidenceState;
  detail: string;
  /** true = evaluated just now, not from a stored record. */
  live: boolean;
  evidenceAt: string | null;
  lastVerifiedAt: string | null;
  outcome: string | null;
  recordedBy: string | null;
  source: string | null;
  method: string | null;
  evidenceReference: string | null;
}

export interface OperationalHealth {
  /** false when the backend did not send operational health at all (not deployed yet). */
  reported: boolean;
  /** Release gate FN-14: evidence can only be recorded while it is switched on. */
  monitoringEnabled: boolean;
  overallState: EvidenceState;
  items: OperationalItem[];
}

/** What each item is called when the backend sends nothing, in display order. */
export const EXPECTED_ITEMS: { key: string; label: string }[] = [
  { key: 'Database', label: 'Database' },
  { key: 'HealthCheck', label: 'System health check' },
  { key: 'Scheduler', label: 'Background scheduler' },
  { key: 'ReleaseFunctions', label: 'Release functions' },
  { key: 'AuditCoverage', label: 'Audit trail coverage' },
  { key: 'DatabaseBackup', label: 'Database backup verified' },
  { key: 'DatabaseRestoreDrill', label: 'Database recovery tested' },
  { key: 'StorageBackup', label: 'File storage backup verified' },
  { key: 'StorageRestoreDrill', label: 'File storage recovery tested' }
];

export function toEvidenceState(value: unknown): EvidenceState {
  return EVIDENCE_STATES.includes(value as EvidenceState)
    ? (value as EvidenceState)
    : 'Unknown';
}

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v : null;

/** The worst state wins: Failed, then Stale, then Unknown; Verified only if all are. */
export function worstState(states: EvidenceState[]): EvidenceState {
  if (states.length === 0) return 'Unknown';
  for (const s of ['Failed', 'Stale', 'Unknown'] as const)
    if (states.includes(s)) return s;
  return 'Verified';
}

export function normalizeOperational(raw: unknown): OperationalHealth {
  const candidate =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>).items
      : null;
  const rawItems = Array.isArray(candidate) ? (candidate as unknown[]) : null;
  if (!rawItems) {
    return {
      reported: false,
      monitoringEnabled: false,
      overallState: 'Unknown',
      items: EXPECTED_ITEMS.map(({ key, label }) => ({
        key,
        label,
        state: 'Unknown',
        detail: 'This check is not available on this database yet.',
        live: false,
        evidenceAt: null,
        lastVerifiedAt: null,
        outcome: null,
        recordedBy: null,
        source: null,
        method: null,
        evidenceReference: null
      }))
    };
  }
  const items = rawItems
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i) => ({
      key: text(i.key) ?? 'Unknown',
      label: text(i.label) ?? text(i.key) ?? 'Unknown check',
      state: toEvidenceState(i.state),
      detail: text(i.detail) ?? '',
      live: LIVE_KEYS.has(text(i.key) ?? ''),
      evidenceAt: text(i.evidence_at),
      lastVerifiedAt: text(i.last_verified_at) ?? text(i.last_success_at),
      outcome: text(i.outcome),
      recordedBy: text(i.recorded_by),
      source: text(i.source),
      method: text(i.method),
      evidenceReference: text(i.evidence_reference)
    }));
  // An expected check the backend left out is Unknown, not absent.
  for (const { key, label } of EXPECTED_ITEMS) {
    if (!items.some((i) => i.key === key)) {
      items.push({
        key,
        label,
        state: 'Unknown',
        detail: 'The system did not report this check.',
        live: false,
        evidenceAt: null,
        lastVerifiedAt: null,
        outcome: null,
        recordedBy: null,
        source: null,
        method: null,
        evidenceReference: null
      });
    }
  }
  // Never trust a summary over its parts.
  return {
    reported: true,
    monitoringEnabled: rawItems.some(
      (i) =>
        !!i &&
        typeof i === 'object' &&
        (i as Record<string, unknown>).key === 'ReleaseFunctions' &&
        (i as Record<string, unknown>).monitoring_enabled === true
    ),
    overallState: worstState(items.map((i) => i.state)),
    items
  };
}

export const STATE_LABEL: Record<EvidenceState, string> = {
  Verified: 'Verified',
  Stale: 'Stale',
  Failed: 'Failed',
  Unknown: 'Unknown'
};

export const STATE_VARIANT: Record<
  EvidenceState,
  'success' | 'warning' | 'danger' | 'outline'
> = {
  Verified: 'success',
  Stale: 'warning',
  Failed: 'danger',
  Unknown: 'outline'
};

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export type PingResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'not_deployed' }
  | { kind: 'error' };

export interface LivenessBody {
  app: 'responding';
  database: 'responding' | 'not_responding';
  /** Whether the database has the operational health functions at all. */
  operational_health: 'reported' | 'not_deployed' | 'unavailable';
  overall_state: EvidenceState;
  states: Record<string, EvidenceState>;
  checked_at: string;
}

/**
 * Liveness for an outside monitor. 200 = the app and the database answered;
 * 503 = the database did not. With `strict`, 503 unless every operational
 * check is Verified, so a status-code monitor can also alert on stale evidence.
 */
export function buildLiveness(
  ping: PingResult,
  opts: { strict: boolean; now: Date }
): { status: number; body: LivenessBody } {
  const states: Record<string, EvidenceState> = {};
  let database: LivenessBody['database'] = 'not_responding';
  let operational: LivenessBody['operational_health'] = 'unavailable';

  if (ping.kind === 'not_deployed') {
    // PostgREST answered from the database's schema cache: it is up, but the
    // health functions are not installed there.
    database = 'responding';
    operational = 'not_deployed';
  } else if (ping.kind === 'ok') {
    const data = ping.data as Record<string, unknown> | null;
    if (data && data.database === 'responding') {
      database = 'responding';
      operational = 'reported';
      const raw = data.states;
      if (raw && typeof raw === 'object')
        for (const [k, v] of Object.entries(raw as Record<string, unknown>))
          states[k] = toEvidenceState(v);
    }
  }

  const overall =
    operational === 'reported'
      ? worstState(Object.values(states))
      : ('Unknown' as const);
  const healthy =
    database === 'responding' && (!opts.strict || overall === 'Verified');
  return {
    status: healthy ? 200 : 503,
    body: {
      app: 'responding',
      database,
      operational_health: operational,
      overall_state: overall,
      states,
      checked_at: opts.now.toISOString()
    }
  };
}
