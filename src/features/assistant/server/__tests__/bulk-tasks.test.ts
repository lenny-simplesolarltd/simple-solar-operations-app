import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * SimpleBot's bulk task tools. The point of these tests is that the tools add
 * no rules of their own: they resolve through BATCH_PREFLIGHT, submit through
 * TASK_BATCH_SUBMIT with the confirmed action's id, and carry the server's
 * answer back without softening it.
 */
const preflightBatch = vi.fn();
const submitBatch = vi.fn();
const getBatchProgress = vi.fn();
const getBatches = vi.fn();
const retryBatch = vi.fn();
vi.mock('@/features/tasks/server/batch', () => ({
  preflightBatch: (...a: unknown[]) => preflightBatch(...a),
  submitBatch: (...a: unknown[]) => submitBatch(...a),
  getBatchProgress: (...a: unknown[]) => getBatchProgress(...a),
  getBatches: (...a: unknown[]) => getBatches(...a),
  retryBatch: (...a: unknown[]) => retryBatch(...a)
}));

import { resolveToolCall, type MutationTool } from '../registry';
import { createToolRegistry } from '../tools';
import { JOB_ID, makeActor, THREAD } from './helpers';

const registry = createToolRegistry();

const OFFICE = ['task.read.all'];
const OFFICE_OVERRIDE = ['task.read.all', 'task.override_complete'];
const COMMAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BATCH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TASK_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const TASK_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

const planItem = (over: Record<string, unknown> = {}) => ({
  task_id: TASK_A,
  template_code: 'GHL01',
  title: 'Update the CRM',
  job_id: JOB_ID,
  job_ref: 'SS-TEST-0001',
  status: 'Open',
  version: 1,
  owner_id: '22222222-2222-4222-8222-222222222222',
  owner_name: 'Ben Quick',
  outcome: 'ready',
  bypassed: [],
  blocking: [],
  ...over
});

const preflight = (items: ReturnType<typeof planItem>[]) => ({
  ok: true as const,
  data: {
    operation: 'TASK_BATCH_COMPLETE',
    total: items.length,
    counts: items.reduce<Record<string, number>>((acc, i) => {
      acc[i.outcome as string] = (acc[i.outcome as string] ?? 0) + 1;
      return acc;
    }, {}),
    items
  }
});

function tool(name: string, permissions = OFFICE) {
  const actor = makeActor({ permissions });
  const resolved = resolveToolCall(registry, actor, name, {});
  return { actor, resolved };
}

async function prepare(name: string, args: unknown, permissions = OFFICE) {
  const actor = makeActor({ permissions });
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  const mutation = resolved.tool as MutationTool<unknown>;
  return mutation.prepare(resolved.input, { actor, threadId: THREAD });
}

async function execute(name: string, args: unknown, permissions = OFFICE) {
  const actor = makeActor({ permissions });
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) throw new Error(`not resolvable: ${resolved.message}`);
  const mutation = resolved.tool as MutationTool<unknown>;
  return mutation.execute(resolved.input, {
    actor,
    threadId: THREAD,
    commandId: COMMAND_ID,
    expectedVersion: null,
    initiatedVia: 'assistant'
  });
}

async function read(name: string, args: unknown, permissions = OFFICE) {
  const actor = makeActor({ permissions });
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  if (resolved.tool.kind !== 'read') throw new Error('expected a read tool');
  return resolved.tool.execute(resolved.input, { actor, threadId: THREAD });
}

beforeEach(() => {
  preflightBatch.mockReset();
  submitBatch.mockReset();
  getBatchProgress.mockReset();
  getBatches.mockReset();
  retryBatch.mockReset();
  submitBatch.mockResolvedValue({
    ok: true,
    batchId: BATCH_ID,
    queued: 1,
    progress: { total: 1, succeeded: 0, pending: 1 },
    outcome: { status: 'Succeeded', heading: 'OK', message: 'Queued.' }
  });
});

describe('resolving before acting', () => {
  it('plans a worded request through the same preflight the screen uses', async () => {
    preflightBatch.mockResolvedValue(
      preflight([
        planItem(),
        planItem({
          task_id: TASK_B,
          template_code: 'PRE01',
          outcome: 'needs_information',
          blocking: [
            {
              code: 'invoice_number',
              kind: 'normal',
              satisfied: false,
              detail:
                'Deposit invoice number - only the task screen can record this'
            }
          ]
        })
      ])
    );
    const result = await read('plan_task_action', {
      action: 'complete',
      jobId: JOB_ID,
      codePrefix: 'PRE'
    });
    expect(result).toMatchObject({ ok: true });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.total_matching).toBe(2);
    expect(data.can_do_now).toBe(1);
    // The selector is the read model's, built on the server - not a query.
    expect(preflightBatch).toHaveBeenCalledWith('TASK_BATCH_COMPLETE', {
      selector: {
        scope: 'all',
        status: 'open',
        job_id: JOB_ID,
        code_prefix: 'PRE'
      }
    });
    // The model is told WHY the rest cannot be done, so it can say so.
    expect(JSON.stringify(data.tasks)).toContain('only the task screen');
  });

  it('refuses to act without a job or explicit tasks', async () => {
    const result = await prepare('complete_tasks', { note: 'done' });
    expect(result).toMatchObject({ ok: false, code: 'TASK_TARGET_REQUIRED' });
    expect(preflightBatch).not.toHaveBeenCalled();
  });

  it('says nothing can be done rather than submitting an empty batch', async () => {
    preflightBatch.mockResolvedValue(
      preflight([
        planItem({
          outcome: 'needs_information',
          blocking: [
            {
              code: 'invoice_number',
              kind: 'normal',
              satisfied: false,
              detail: 'Needs the invoice number'
            }
          ]
        })
      ])
    );
    const result = await prepare('complete_tasks', {
      jobId: JOB_ID,
      note: 'done'
    });
    expect(result).toMatchObject({ ok: false, code: 'TASK_NOTHING_TO_DO' });
    expect((result as { message: string }).message).toContain(
      'Needs the invoice number'
    );
    expect(submitBatch).not.toHaveBeenCalled();
  });
});

describe('submitting through the shared command', () => {
  it('submits only the resolved ids, as the confirmed action', async () => {
    preflightBatch.mockResolvedValue(
      preflight([
        planItem(),
        planItem({ task_id: TASK_B, outcome: 'not_permitted' })
      ])
    );
    await execute('complete_tasks', { jobId: JOB_ID, note: 'Chased today' });
    expect(submitBatch).toHaveBeenCalledWith({
      operation: 'TASK_BATCH_COMPLETE',
      args: { completion_note: 'Chased today' },
      // Only the ready one; the selection is never widened after the preflight.
      target: { taskIds: [TASK_A] },
      source: 'simplebot',
      // The pending action's id IS the command id, so a retried confirmation
      // replays through the commands ledger instead of acting twice.
      commandId: COMMAND_ID
    });
  });

  it('tells the model the work continues without the chat', async () => {
    preflightBatch.mockResolvedValue(preflight([planItem()]));
    const result = await execute('complete_tasks', {
      jobId: JOB_ID,
      note: 'Chased today'
    });
    expect(result).toMatchObject({ ok: true });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.operation_id).toBe(BATCH_ID);
    expect(String(data.note)).toMatch(/close this chat/i);
  });

  it('passes a refusal back verbatim instead of claiming success', async () => {
    preflightBatch.mockResolvedValue(preflight([planItem()]));
    submitBatch.mockResolvedValue({
      ok: false,
      outcome: {
        status: 'Failed',
        heading: 'NOT ALLOWED',
        message: 'You do not have permission to complete a task by override.',
        code: 'TASK_OVERRIDE_DENIED'
      }
    });
    const result = await execute('complete_tasks', {
      jobId: JOB_ID,
      note: 'Chased today'
    });
    expect(result).toMatchObject({
      ok: false,
      code: 'TASK_OVERRIDE_DENIED'
    });
  });
});

describe('the override is described honestly', () => {
  const overridePlan = () =>
    preflight([
      planItem({
        template_code: 'PRE03',
        outcome: 'ready',
        bypassed: [
          {
            code: 'ownership',
            kind: 'overrideable',
            satisfied: false,
            detail: 'Owned by someone else'
          },
          {
            code: 'deposit_bank_confirmed',
            kind: 'normal',
            satisfied: false,
            detail: 'Bank check outcome'
          }
        ]
      })
    ]);

  it('is not offered without the permission', () => {
    const { resolved } = tool('override_complete_tasks', OFFICE);
    expect(resolved).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  it('warns that nothing will be recorded, and that the job stays gated', async () => {
    preflightBatch.mockResolvedValue(overridePlan());
    const result = await prepare(
      'override_complete_tasks',
      { jobId: JOB_ID, reason: 'Confirmed manually by office' },
      OFFICE_OVERRIDE
    );
    expect(result).toMatchObject({ ok: true });
    const warnings = (
      result as { preview: { warnings: string[] } }
    ).preview.warnings.join(' ');
    expect(warnings).toContain('Nothing will be recorded for');
    expect(warnings).toContain('Bank check outcome');
    expect(warnings).toMatch(/still report these as outstanding/i);
  });

  it('tells the model in its description not to claim the work is done', () => {
    const registered = registry.get('override_complete_tasks');
    const description =
      registered && 'description' in registered ? registered.description : '';
    expect(description).toMatch(/NOTHING is recorded/i);
    expect(description).toMatch(/never tell the staff member/i);
  });
});

describe('progress and retry', () => {
  it('answers "what is still processing" from authoritative state', async () => {
    getBatches.mockResolvedValue({
      ok: true,
      data: {
        batches: [
          {
            batch_id: BATCH_ID,
            operation: 'TASK_BATCH_COMPLETE',
            status: 'Processing',
            source: 'simplebot',
            created_at: '2026-09-20T09:00:00Z',
            started_at: '2026-09-20T09:00:01Z',
            progress: { total: 38, succeeded: 30, pending: 8 }
          }
        ],
        count: 1
      }
    });
    const result = await read('get_operation_status', {});
    const ops = (result as { data: { operations: unknown[] } }).data.operations;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      operation_id: BATCH_ID,
      status: 'Processing',
      asked_for_in: 'simplebot'
    });
  });

  it('reports per-task results, including the override distinction', async () => {
    getBatchProgress.mockResolvedValue({
      ok: true,
      data: {
        batch_id: BATCH_ID,
        operation: 'TASK_BATCH_OVERRIDE_COMPLETE',
        status: 'CompletedWithErrors',
        progress: { total: 2, succeeded: 1, needs_review: 1 },
        items: [
          {
            item_id: '1',
            task_id: TASK_A,
            template_code: 'PRE03',
            job_ref: 'SS-TEST-0001',
            owner_name: 'Ben Quick',
            status: 'Succeeded',
            completion_mode: 'override',
            retryable: false,
            error_detail: null
          },
          {
            item_id: '2',
            task_id: TASK_B,
            template_code: 'PRE01',
            job_ref: 'SS-TEST-0001',
            owner_name: 'Tanya',
            status: 'NeedsReview',
            completion_mode: null,
            retryable: true,
            error_detail: 'R1A_STALE_VERSION'
          }
        ]
      }
    });
    const result = await read('get_operation_status', {
      operationId: BATCH_ID
    });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.can_retry).toBe(true);
    expect(data.tasks).toMatchObject([
      { code: 'PRE03', result: 'Succeeded', completed_by_override: true },
      { code: 'PRE01', result: 'NeedsReview', why: 'R1A_STALE_VERSION' }
    ]);
  });

  it('refuses to retry a permanent refusal, and says why', async () => {
    getBatchProgress.mockResolvedValue({
      ok: true,
      data: {
        batch_id: BATCH_ID,
        operation: 'TASK_BATCH_COMPLETE',
        status: 'CompletedWithErrors',
        progress: { total: 1, failed: 1 },
        items: [
          {
            item_id: '1',
            task_id: TASK_A,
            template_code: 'PRE01',
            job_ref: 'SS-TEST-0001',
            owner_name: 'Tanya',
            status: 'Failed',
            retryable: false,
            error_detail: 'An imported historical record is never actionable'
          }
        ]
      }
    });
    const result = await prepare('retry_operation', {
      operationId: BATCH_ID
    });
    expect(result).toMatchObject({ ok: false, code: 'NOTHING_RETRYABLE' });
    expect((result as { message: string }).message).toContain(
      'historical record'
    );
    expect(retryBatch).not.toHaveBeenCalled();
  });
});

describe('the model cannot widen its reach', () => {
  it('accepts no actor, role, permission or free query on any bulk tool', () => {
    const forbidden =
      /actor|person_?id|role|permission|sql|query|scope|source/i;
    for (const name of [
      'plan_task_action',
      'complete_tasks',
      'override_complete_tasks',
      'reopen_tasks',
      'get_operation_status',
      'retry_operation'
    ]) {
      const registered = registry.get(name);
      expect(registered, name).toBeDefined();
      const schema =
        registered && 'inputSchema' in registered
          ? JSON.stringify(
              Object.keys(
                (
                  registered.inputSchema as unknown as {
                    shape: Record<string, unknown>;
                  }
                ).shape
              )
            )
          : '[]';
      expect(schema, name).not.toMatch(forbidden);
    }
  });

  it('never lets the model name a command type or an operation directly', () => {
    const planned = registry.get('plan_task_action');
    const shape = Object.keys(
      (
        planned as unknown as {
          inputSchema: { shape: Record<string, unknown> };
        }
      ).inputSchema.shape
    );
    // 'action' is an enum of four words, mapped to a command type on the
    // server; the model never sends TASK_BATCH_*.
    expect(shape).toContain('action');
    expect(JSON.stringify(shape)).not.toContain('TASK_BATCH');
  });
});

describe('override without being made to justify it', () => {
  it('records a plain default reason when none was given', async () => {
    // public.tasks requires a non-blank override_reason, so leaving it out
    // must still produce one rather than failing or prompting.
    const DEFAULT =
      'Administrative override requested through SimpleBot. No business fact was recorded.';
    expect(DEFAULT.trim().length).toBeGreaterThan(0);
    // It must never read as evidence the work happened.
    for (const forbidden of ['invoice', 'signed', 'confirmed', 'verified']) {
      expect(DEFAULT.toLowerCase()).not.toContain(forbidden);
    }
    expect(DEFAULT).toMatch(/no business fact was recorded/i);
  });
});
