import { vi } from 'vitest';
import { z } from 'zod';
import type { AssistantStreamEvent } from '../../protocol';
import type { AssistantAuditRecord } from '../audit';
import {
  MemoryPendingActionStore,
  PendingActionSigner,
  type PendingActionService
} from '../pending-actions';
import type {
  AssistantModelProvider,
  ModelRequest,
  ModelTurn
} from '../providers/types';
import type { MutationTool, ReadTool, ToolActor } from '../registry';

export const THREAD = '3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11';
export const JOB_ID = '9b2f6c1e-0d54-4c8e-a3f7-2f6d1b0c9e77';

export function makeActor(
  overrides: { id?: string; roles?: string[]; permissions?: string[] } = {}
): ToolActor {
  return {
    user: {
      id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
      email: 'tanya@example.test',
      fullName: 'Tanya Office',
      roles: (overrides.roles ?? ['Office']) as ToolActor['user']['roles']
    },
    permissions: new Set(overrides.permissions ?? [])
  };
}

export const OTHER_PERSON = '22222222-2222-4222-8222-222222222222';

/** A provider that replays scripted turns and records what it was sent. */
export function scriptedProvider(turns: Array<Partial<ModelTurn> | Error>) {
  const requests: ModelRequest[] = [];
  const provider: AssistantModelProvider = {
    id: 'test',
    model: 'scripted',
    async generate(request, options) {
      requests.push(structuredClone(request));
      const next = turns.shift();
      if (!next) throw new Error('scripted provider ran out of turns');
      if (next instanceof Error) throw next;
      if (next.text) options?.onTextDelta?.(next.text);
      return {
        text: next.text ?? '',
        toolCalls: next.toolCalls ?? [],
        stopReason:
          next.stopReason ?? (next.toolCalls?.length ? 'tool_use' : 'end')
      };
    }
  };
  return { provider, requests };
}

export function collector() {
  const events: AssistantStreamEvent[] = [];
  return {
    events,
    emit: (event: AssistantStreamEvent) => void events.push(event),
    ofType<T extends AssistantStreamEvent['type']>(type: T) {
      return events.filter(
        (e): e is Extract<AssistantStreamEvent, { type: T }> => e.type === type
      );
    }
  };
}

export function makePendingActions(): PendingActionService {
  return {
    signer: new PendingActionSigner('test-secret-test-secret-test-secret-123'),
    store: new MemoryPendingActionStore()
  };
}

export function silentAudit() {
  const records: AssistantAuditRecord[] = [];
  return {
    records,
    sink: { record: (r: AssistantAuditRecord) => void records.push(r) }
  };
}

/**
 * A stand-in mutation. The production registry has no available mutation yet
 * (the backend exposes none), so the confirmation machinery is exercised with
 * this test-only tool.
 */
export function fakeCompleteTask(permissions: string[] = []) {
  const prepare = vi.fn(async () => ({
    ok: true as const,
    preview: {
      title: 'Mark PRE02 complete',
      summary: 'Completes PRE02 on SS-TEST-0001.',
      changes: [{ label: 'Status', from: 'Open', to: 'Completed' }],
      warnings: [],
      confirmLabel: 'Confirm completion',
      expectedVersion: 7
    }
  }));
  const execute = vi.fn(async () => ({
    ok: true as const,
    data: { status: 'Completed' }
  }));
  const tool: MutationTool<{ taskId: string; note?: string }> = {
    name: 'test_complete_task',
    summary: 'Mark a task complete',
    description: 'Test-only mutation.',
    domain: 'tasks',
    kind: 'mutation',
    status: 'available',
    inputSchema: z.strictObject({
      taskId: z.uuid(),
      note: z.string().max(200).optional()
    }),
    authorization: { permissions, enforcedBy: 'test' },
    prepare,
    execute
  };
  return { tool, prepare, execute };
}

export function fakeReadTool(name = 'test_lookup') {
  const execute = vi.fn(async () => ({
    ok: true as const,
    data: { found: true }
  }));
  const tool: ReadTool<{ query: string }> = {
    name,
    summary: 'Look something up',
    description: 'Test-only read.',
    domain: 'jobs',
    kind: 'read',
    status: 'available',
    inputSchema: z.strictObject({ query: z.string().min(2) }),
    authorization: { permissions: [], enforcedBy: 'test' },
    execute
  };
  return { tool, execute };
}
