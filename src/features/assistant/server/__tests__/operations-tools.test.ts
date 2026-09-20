import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// get_job_timeline and get_job_blockers read through the ported backend's own
// entry points (public.execute_read / public.execute_operations_read), which
// resolve the actor from the session and apply the role, visibility and
// release rules. These tests stand in for the database's answer and check
// what the tools ask it for, what reaches the model, and that a refusal is
// repeated honestly instead of being turned into an empty success.
const rpc = vi.fn();
const createDataClient = vi.fn(async () => ({ rpc }));
vi.mock('@/lib/supabase/data', () => ({
  createDataClient: () => createDataClient()
}));
// Both tools ask what kind of record this is before choosing a path. A live
// job is the default so the existing expectations below are unchanged.
const getJobDetail = vi.fn(async (_id?: string) => ({
  job: { id: JOB_ID, job_ref: 'SS-ABCD-0001', record_class: 'Live' },
  tasks: []
}));
vi.mock('@/features/jobs/server/queries', () => ({
  getJobDetail: (id: string) => getJobDetail(id),
  OPEN_TASK_STATUSES: ['Open', 'Waiting', 'InProgress', 'Blocked']
}));
const getHistoricalPeople = vi.fn(async (_id?: string) => [] as unknown[]);
vi.mock('@/features/jobs/server/historical', () => ({
  getHistoricalPeople: (id: string) => getHistoricalPeople(id),
  historicalPersonNote: (m: string) =>
    m === 'Ambiguous'
      ? 'more than one person could have been meant, so it was not linked to anybody'
      : 'matched to a member of staff'
}));

// The contact-correction tools read the job's customer (and both row versions)
// before proposing anything. Mocked here so the historical refusal below can be
// exercised without a database.
const customerContact = vi.fn(async (_id?: string) => LIVE_CONTACT);
vi.mock('@/features/customers/server/contact', () => ({
  getCustomerContact: (id: string) => customerContact(id)
}));

/** Makes the next lookup answer "this is an archived historical import". */
function asHistorical(over: Record<string, unknown> = {}) {
  getJobDetail.mockResolvedValueOnce({
    job: {
      id: JOB_ID,
      job_ref: 'SS-HIST-0001',
      record_class: 'HistoricalImport',
      sold_at: '2025-04-11T15:16:19Z',
      archived_at: '2026-09-20T05:00:00Z',
      source_reference: 'TQ125DB21',
      source_system: 'historical-job-booking-form',
      workflow_stage: 'OperationallyComplete',
      ...over
    },
    tasks: []
  } as never);
}

import { resolveToolCall } from '../registry';
import { createToolRegistry } from '../tools';
import { JOB_ID, makeActor, THREAD } from './helpers';

/** A live job's customer, as getCustomerContact returns it. */
const LIVE_CONTACT = {
  customerId: '00000000-0000-4000-8000-0000000000c1',
  version: 1,
  name: 'Parton',
  phone: null,
  email: 'parton@example.com',
  alternateContact: null,
  contactNotes: null,
  jobId: JOB_ID,
  jobRef: 'SS-ABCD-0001',
  leadSource: null,
  jobVersion: 1,
  recordClass: 'Live'
};

const ctx = () => ({ actor: makeActor(), threadId: THREAD });

const registry = createToolRegistry({ forms: false });

async function call(name: string, args: unknown, actor = makeActor()) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  if (resolved.tool.kind !== 'read') throw new Error('expected a read tool');
  return resolved.tool.execute(resolved.input, { actor, threadId: THREAD });
}

/** The envelope public.execute_read / execute_operations_read return. */
const ok = (data: unknown) => ({ data: { ok: true, data }, error: null });
const refused = (message: string) => ({
  data: null,
  error: { code: 'P0001', message }
});

/** Routes each stubbed RPC call by its read_type. */
function answerWith(map: Record<string, ReturnType<typeof ok>>) {
  rpc.mockImplementation(
    async (_fn: string, args: { p_request: { read_type: string } }) =>
      map[args.p_request.read_type] ?? ok(null)
  );
}

beforeEach(() => {
  rpc.mockReset();
  createDataClient.mockClear();
  getJobDetail.mockClear();
  getHistoricalPeople.mockClear();
});

describe('get_job_timeline', () => {
  const history = {
    total_events: 3,
    audit_events: 2,
    task_events: 1,
    issue_events: 0,
    events: [
      {
        type: 'audit',
        timestamp: '2026-09-20T10:00:00Z',
        action: 'JobBooked',
        actor: 'Tanya Harris',
        reason: 'Customer agreed the dates'
      },
      {
        type: 'task_event',
        timestamp: '2026-09-19T09:00:00Z',
        action: 'TaskCompleted',
        actor: 'Tanya Harris',
        old_status: 'Open',
        new_status: 'Completed',
        note: 'Contract received'
      }
    ]
  };

  it('reads AUDIT_HISTORY for the job and returns what was recorded', async () => {
    answerWith({ AUDIT_HISTORY: ok(history) });
    const result = await call('get_job_timeline', { jobId: JOB_ID });

    expect(rpc).toHaveBeenCalledWith('execute_read', {
      p_request: { read_type: 'AUDIT_HISTORY', job_id: JOB_ID }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      total_events: number;
      events: { action: string; actor: string; status_change: unknown }[];
    };
    expect(data.total_events).toBe(3);
    expect(data.events[0]).toMatchObject({
      action: 'JobBooked',
      actor: 'Tanya Harris',
      reason: 'Customer agreed the dates',
      status_change: null
    });
    expect(data.events[1].status_change).toEqual({
      from: 'Open',
      to: 'Completed'
    });
  });

  it('repeats a refusal instead of reporting an empty history', async () => {
    rpc.mockResolvedValue(refused('R1A_FORBIDDEN: not your job'));
    const result = await call('get_job_timeline', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('R1A_FORBIDDEN');
  });

  it('says so when the job is not visible', async () => {
    answerWith({ AUDIT_HISTORY: ok(null) });
    const result = await call('get_job_timeline', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});

describe('get_job_blockers', () => {
  const operations = {
    job: {
      id: JOB_ID,
      job_ref: 'SS-ABCD-0001',
      version: 4,
      workflow_stage: 'Installation',
      operational_complete_at: null,
      operational_complete_by_name: null,
      customer_happy_at: null,
      archived_at: null,
      cancellation_at: null,
      cancellation_reason: null,
      cancellation_by_name: null,
      open_cancellation_tasks: 0
    },
    packages: [
      {
        trade: 'Roof',
        status: 'Completed',
        required: true,
        planned_start: '2026-10-01',
        installer_confirmation_at: '2026-09-30T08:00:00Z'
      }
    ],
    issues: [
      {
        id: 'i1',
        type: 'Remedial',
        category: 'Roof',
        description: 'Tile cracked',
        severity: 'High',
        status: 'Open',
        blocks_completion: true,
        owner_name: 'Rosie Ashley'
      },
      {
        id: 'i2',
        type: 'Variation',
        category: 'Electrical',
        description: 'Extra socket',
        severity: 'Low',
        status: 'Closed',
        blocks_completion: false,
        owner_name: null
      }
    ],
    calls: [],
    installers: [],
    completion: {
      gate: {
        status: 'NeedsReview',
        ready: false,
        reasons: ['An open issue blocks completion']
      },
      action: { available: false, denied: 'STATE' }
    },
    actions: {}
  };

  const availability = {
    job_id: JOB_ID,
    job_ref: 'SS-ABCD-0001',
    workflow_stage: 'Installation',
    version: 4,
    assigned: true,
    commands: {
      OPERATIONAL_COMPLETE: {
        available: false,
        denied: 'STATE',
        reason: 'An open issue blocks completion'
      },
      CALL_RECORD: { available: true }
    }
  };

  it("lists the whole operation surface, with the database's own reasons", async () => {
    // The point of this tool is that the model stops guessing. It should be
    // able to say what is possible on THIS job, what is refused and why, and
    // which of them it can carry out itself - without inventing a screen.
    answerWith({ ACTION_AVAILABILITY: ok(availability) });
    const result = await call('list_job_operations', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      available: { command: string; simplebot_tool: string | null }[];
      unavailable: { command: string; reason: string }[];
      guidance: string;
    };
    expect(data.available.map((a) => a.command)).toEqual(['CALL_RECORD']);
    // CALL_RECORD is task-scoped and has no adapter, so it must not claim one.
    expect(data.available[0].simplebot_tool).toBeNull();
    expect(data.unavailable).toEqual([
      {
        operation: 'Operational complete',
        command: 'OPERATIONAL_COMPLETE',
        reason: 'An open issue blocks completion'
      }
    ]);
    // Unavailable must never read as "not built".
    expect(data.guidance).toMatch(/refused by the system.*not missing/i);
    expect(data.guidance).toMatch(/do not invent where/i);
  });

  it('offers no operations at all on a historical record', async () => {
    asHistorical();
    const result = await call('list_job_operations', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { available: unknown[]; guidance: string };
    expect(data.available).toEqual([]);
    expect(data.guidance).toMatch(/imported history/i);
  });

  it('combines the operations read with action availability', async () => {
    answerWith({
      JOB_OPERATIONS: ok(operations),
      ACTION_AVAILABILITY: ok(availability)
    });
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      open_issues: { description: string }[];
      blocking_issue_count: number;
      completion: { ready: boolean; reasons: string[] };
      actions_unavailable: { command: string; reason: string }[];
    };
    // Only the still-open issue; the closed one is not a blocker.
    expect(data.open_issues).toHaveLength(1);
    expect(data.open_issues[0].description).toBe('Tile cracked');
    expect(data.blocking_issue_count).toBe(1);
    expect(data.completion).toMatchObject({
      ready: false,
      reasons: ['An open issue blocks completion']
    });
    // Available commands are not listed; refused ones carry the database's reason.
    expect(data.actions_unavailable).toEqual([
      {
        command: 'OPERATIONAL_COMPLETE',
        reason: 'An open issue blocks completion'
      }
    ]);
  });

  it('still answers when only the availability read refuses', async () => {
    rpc.mockImplementation(
      async (fn: string, args: { p_request: { read_type: string } }) =>
        args.p_request.read_type === 'JOB_OPERATIONS'
          ? ok(operations)
          : refused('R1A_FORBIDDEN: no')
    );
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      actions_unavailable: unknown[];
      availability_note?: string;
    };
    expect(data.actions_unavailable).toEqual([]);
    expect(data.availability_note).toMatch(/refused/);
  });

  it('repeats a refusal from the operations read', async () => {
    rpc.mockResolvedValue(refused('R1A_FORBIDDEN: not your job'));
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('R1A_FORBIDDEN');
  });
});

describe('the registry no longer claims these are unavailable', () => {
  it('registers both as available reads, not planned', () => {
    for (const name of ['get_job_timeline', 'get_job_blockers']) {
      const tool = registry.get(name);
      expect(tool, name).toBeDefined();
      expect(tool?.status, name).toBe('available');
      expect(tool?.kind, name).toBe('read');
    }
  });
});

describe('an archived historical import', () => {
  it('get_job_timeline answers from recorded facts and never calls AUDIT_HISTORY', async () => {
    asHistorical();
    getHistoricalPeople.mockResolvedValueOnce([
      {
        role: 'Installer',
        source_value: 'Dave',
        match_kind: 'Ambiguous',
        person: null
      },
      {
        role: 'Salesperson',
        source_value: 'Mike Bater',
        match_kind: 'ExactMatch',
        person: { display_name: 'Mike Bater' }
      }
    ] as never);

    const result = await call('get_job_timeline', { jobId: JOB_ID });
    // The operational read is gated on scope and would refuse; it must not run.
    expect(rpc).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      record_type: string;
      previous_system_reference: string;
      events: { what: string }[];
      workflow_history_available: boolean;
      people_recorded_on_the_job: {
        role: string;
        linked_person: string | null;
        note: string;
      }[];
    };
    expect(data.record_type).toMatch(/historical_import/);
    expect(data.previous_system_reference).toBe('TQ125DB21');
    // Only facts that exist: the recorded sale and the import itself.
    expect(data.events.map((e) => e.what)).toEqual([
      'Recorded as sold in the previous system',
      'Imported into this system as an archived historical record'
    ]);
    expect(data.workflow_history_available).toBe(false);
    // An ambiguous name is reported, never resolved to somebody.
    const installer = data.people_recorded_on_the_job.find(
      (p) => p.role === 'Installer'
    );
    expect(installer?.linked_person).toBeNull();
    expect(installer?.note).toMatch(/more than one person/);
  });

  it('get_job_timeline invents no workflow events when nothing was recorded', async () => {
    asHistorical({ sold_at: null, archived_at: null });
    const result = await call('get_job_timeline', { jobId: JOB_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      events: unknown[];
      workflow_history_note: string;
    };
    expect(data.events).toEqual([]);
    expect(data.workflow_history_note).toMatch(/recorded no workflow events/i);
  });

  it('get_job_blockers says blockers do not apply, without running the operational reads', async () => {
    asHistorical();
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as {
      applicable: boolean;
      not_applicable_reason: string;
      blocking_issue_count: number | null;
      completion: unknown;
      guidance: string;
    };
    expect(data.applicable).toBe(false);
    // Never "0 blockers": that would read as a live job being clear to proceed.
    expect(data.blocking_issue_count).toBeNull();
    expect(data.completion).toBeNull();
    expect(data.not_applicable_reason).toMatch(/not the same as a live job/i);
    expect(data.guidance).toMatch(/do not describe this job as clear/i);
  });

  it('refuses every job-scoped mutation on a historical job', async () => {
    // This used to assert that no mutation had the 'jobs' domain at all, which
    // was a proxy for the real rule and stopped being true when contact
    // corrections arrived. The rule itself is unchanged: an imported record is
    // an archive of what the previous system held, and nothing may edit it.
    // So ask the tools directly rather than inspecting their labels.
    const jobScoped = registry
      .all()
      .filter(
        (t) =>
          t.kind === 'mutation' &&
          t.status === 'available' &&
          (t.domain === 'jobs' ||
            t.domain === 'customers' ||
            t.domain === 'calendar')
      );
    expect(jobScoped.length).toBeGreaterThan(0);

    for (const tool of jobScoped) {
      if (tool.status !== 'available' || tool.kind !== 'mutation') continue;
      // Each tool asks a different question to find out what kind of record
      // this is: the contact tools read the customer, the job operations read
      // the job. Answer both as historical, for the whole loop - queueing one
      // answer per tool would leave the unconsumed ones behind for the next
      // test.
      customerContact.mockResolvedValue({
        ...LIVE_CONTACT,
        jobRef: 'SS-HIST-0001',
        recordClass: 'HistoricalImport'
      });
      getJobDetail.mockResolvedValue({
        job: {
          id: JOB_ID,
          job_ref: 'SS-HIST-0001',
          record_class: 'HistoricalImport'
        },
        tasks: []
      } as never);
      const prepared = await tool.prepare(
        {
          job: JOB_ID,
          phone: '01752 000000',
          lead_source: 'Facebook',
          activities: ['Roof'],
          reason: 'Customer asked to move it',
          issue_type: 'Remedial',
          title: 'Tile cracked',
          description: 'A tile was cracked during the install.'
        },
        ctx()
      );
      expect(prepared.ok, `${tool.name} must refuse a historical job`).toBe(
        false
      );
      if (prepared.ok) continue;
      expect(prepared.code).toBe('HISTORICAL_IMPORT');
      // And it must say so plainly rather than inviting another attempt.
      expect(prepared.message).toMatch(/imported historical record/i);
    }
    customerContact.mockResolvedValue(LIVE_CONTACT);
    getJobDetail.mockReset();
  });

  it('reports a job it cannot see as not found, not as historical', async () => {
    getJobDetail.mockResolvedValueOnce(null as never);
    const result = await call('get_job_blockers', { jobId: JOB_ID });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('NOT_FOUND');
  });
});
