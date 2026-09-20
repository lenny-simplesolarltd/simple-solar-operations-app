import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/**
 * Proves the SERVER refuses every class of change while a preview is active -
 * at the choke points, before any database or storage call - and that reads
 * still work. Nothing here depends on a button being hidden or disabled.
 */
const state = { previewing: true };
const rpc = vi.fn();
const storageUpload = vi.fn();

vi.mock('@/lib/preview/context', () => ({
  getActivePreview: async () =>
    state.previewing
      ? {
          targetPersonId: 't',
          realAuthUserId: 'r',
          mode: 'hosted' as const,
          header: 'v1.t.1.sig'
        }
      : null
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser: rpc },
    storage: { from: () => ({ createSignedUploadUrl: storageUpload }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: rpc }) }) })
  })
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers()
}));

import { resolvePendingAction } from '@/features/assistant/server/confirm';
import { submitPublicFormAction } from '@/features/forms/server/actions';
import {
  beginEvidenceUpload,
  completeEvidenceUpload
} from '@/features/operations/evidence-upload';
import { runCommand } from '@/lib/backend/command';
import { PREVIEW_READ_ONLY_MESSAGE } from '../config';
import { previewWriteBlock } from '../guard';

const COMMAND = '3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11';

beforeEach(() => {
  state.previewing = true;
  rpc.mockReset();
  storageUpload.mockReset();
});

describe('12/15. operational commands are refused at the command boundary', () => {
  // runCommand is the single funnel every operational screen uses, so this one
  // gate covers job creation/update, booking changes, task completion, issue
  // resolution/reassignment, people & role administration and release control.
  const COMMANDS = [
    'JOB_CREATE',
    'JOB_UPDATE',
    'BOOKING_SET',
    'TASK_COMPLETE',
    'ISSUE_RESOLVE',
    'ISSUE_REASSIGN',
    'PERSON_ROLE_SET',
    'RELEASE_MODE_SET'
  ];

  for (const command_type of COMMANDS) {
    it(`${command_type} never reaches the database`, async () => {
      const response = await runCommand({
        command_id: COMMAND,
        command_type
      } as never);
      expect(response.ok).toBe(false);
      expect(response.outcome).toMatchObject({
        code: 'PREVIEW_MODE_READ_ONLY',
        message: PREVIEW_READ_ONLY_MESSAGE
      });
      expect(rpc).not.toHaveBeenCalled();
    });
  }

  it('the very same command runs once the preview ends', async () => {
    state.previewing = false;
    rpc.mockResolvedValue({
      data: { status: 'Succeeded', heading: 'Done', message: 'ok' },
      error: null
    });
    const response = await runCommand({
      command_id: COMMAND,
      command_type: 'RELEASE_MODE_SET'
    } as never);
    expect(rpc.mock.calls[0][0]).toBe('execute_command');
    expect(response.ok).toBe(true);
  });
});

describe('14. evidence, file and storage changes are refused', () => {
  it('no signed upload URL is ever minted while previewing', async () => {
    const ticket = await beginEvidenceUpload({
      uploadId: COMMAND,
      context: { type: 'job', id: COMMAND } as never,
      file: { name: 'a.pdf', type: 'application/pdf', size: 1000 }
    });
    expect(ticket).toEqual({ ok: false, message: PREVIEW_READ_ONLY_MESSAGE });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('an upload cannot be registered afterwards either', async () => {
    const result = await completeEvidenceUpload({
      uploadId: COMMAND
    } as never);
    expect(result).toMatchObject({
      ok: false,
      message: PREVIEW_READ_ONLY_MESSAGE
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('13. assistant changes are refused', () => {
  it('a pending action cannot be confirmed, whoever calls the resolver', async () => {
    const response = await resolvePendingAction({
      actor: { personId: 't', roles: [], permissions: [] } as never,
      decision: 'confirm',
      token: 'anything',
      registry: {} as never,
      pendingActions: null
    });
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'PREVIEW_MODE_READ_ONLY',
        message: PREVIEW_READ_ONLY_MESSAGE
      }
    });
  });

  it('the durable pending-action store refuses to register or claim anything', async () => {
    const { SupabasePendingActionStore } = await import(
      '@/features/assistant/server/pending-actions-db'
    );
    const store = new SupabasePendingActionStore();
    await expect(
      store.register(
        {
          id: COMMAND,
          threadId: 'thread',
          tool: 'create_form',
          args: {},
          argsHash: 'hash',
          expectedVersion: 1,
          expiresAt: Date.now() + 60_000
        } as never,
        {}
      )
    ).rejects.toThrow(PREVIEW_READ_ONLY_MESSAGE);
    await expect(store.claim(COMMAND, 'confirm')).rejects.toThrow(
      PREVIEW_READ_ONLY_MESSAGE
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('forms submissions are refused', () => {
  it('even a valid recipient token cannot write a response while previewing', async () => {
    const result = await submitPublicFormAction('token', COMMAND, { a: 1 });
    expect(result).toMatchObject({
      ok: false,
      message: PREVIEW_READ_ONLY_MESSAGE
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('11. reads are not blocked', () => {
  it('the guard is silent when no preview is active, and speaks when one is', async () => {
    expect(await previewWriteBlock()).toBe(PREVIEW_READ_ONLY_MESSAGE);
    state.previewing = false;
    expect(await previewWriteBlock()).toBeNull();
  });

  it('the hosted read client selects and calls read RPCs, but cannot write', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      'https://ocpwrrajskywpqpatwea.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    const { createDataReadClient } = await import('@/lib/supabase/data');
    const client = await createDataReadClient({
      targetPersonId: 't',
      realAuthUserId: 'r',
      mode: 'hosted',
      header: 'v1.t.1.sig'
    });
    // reads: available
    expect(typeof client.from('jobs').select).toBe('function');
    // writes: physically unavailable, whatever calls them
    for (const method of ['insert', 'update', 'upsert', 'delete'] as const) {
      expect(() =>
        (
          client.from('jobs') as unknown as Record<
            string,
            (v: unknown) => unknown
          >
        )[method]({})
      ).toThrow(PREVIEW_READ_ONLY_MESSAGE);
    }
    expect(() => client.rpc('execute_command', {} as never)).toThrow(
      PREVIEW_READ_ONLY_MESSAGE
    );
    expect(() => client.storage).toThrow(PREVIEW_READ_ONLY_MESSAGE);
    expect(() => client.auth).toThrow(PREVIEW_READ_ONLY_MESSAGE);
  });
});
