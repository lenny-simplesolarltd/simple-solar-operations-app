import { beforeEach, describe, expect, it, vi } from 'vitest';

// The command boundary must refuse in preview WITHOUT relying on any UI state,
// and before it touches the database or the service-role client.
const state = { previewing: true };
const rpc = vi.fn();
const adminInvite = vi.fn();

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
    auth: { updateUser: rpc, signOut: vi.fn() },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) })
      })
    })
  })
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { inviteUserByEmail: adminInvite } }
  })
}));
vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => ({
    id: 'p',
    email: 'a@b.c',
    fullName: 'A',
    roles: ['Admin']
  })
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ delete: vi.fn(), get: vi.fn() }),
  headers: async () => new Map()
}));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { updatePassword } from '@/app/auth/actions';
import { inviteStaff } from '@/features/people/server/invite-staff';
import { submitPresale } from '@/features/presale/server/submit-presale';
import type { PresaleSubmission } from '@/features/presale/contract';
import { PREVIEW_READ_ONLY_MESSAGE } from '../config';
import { createPreviewReadClient } from '@/lib/supabase/data';

const COMMAND = '3f0c1f4e-7a53-4a52-9d53-6f1f0e0b8a11';

describe('operational commands refuse while previewing (server-side, not by disabled buttons)', () => {
  beforeEach(() => {
    state.previewing = true;
    rpc.mockReset();
    adminInvite.mockReset();
  });

  it('Submit sale is refused before any database call', async () => {
    const result = await submitPresale(COMMAND, {} as PresaleSubmission);
    expect(result).toEqual({
      ok: false,
      code: 'PREVIEW_MODE_READ_ONLY',
      message: PREVIEW_READ_ONLY_MESSAGE
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('Invite staff is refused before the service-role client is created', async () => {
    expect(await inviteStaff(COMMAND)).toEqual({
      ok: false,
      message: PREVIEW_READ_ONLY_MESSAGE
    });
    expect(adminInvite).not.toHaveBeenCalled();
  });

  it('Change password is refused', async () => {
    const form = new FormData();
    form.set('password', 'a-long-enough-password');
    form.set('confirm', 'a-long-enough-password');
    expect(await updatePassword({ error: null }, form)).toEqual({
      error: PREVIEW_READ_ONLY_MESSAGE
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('the same command reaches the database again once preview ends', async () => {
    state.previewing = false;
    rpc.mockResolvedValue({ data: { job_ref: 'SS-TEST-0001' }, error: null });
    const result = await submitPresale(COMMAND, {} as PresaleSubmission);
    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
  });
});

describe('the preview data client cannot write', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });

  it('refuses insert / update / upsert / delete, non-read RPCs, auth and storage', () => {
    const client = createPreviewReadClient('jwt');
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
    expect(() =>
      client.rpc('submit_presale', { p_command_id: COMMAND, p_payload: {} })
    ).toThrow(PREVIEW_READ_ONLY_MESSAGE);
    expect(() => client.auth).toThrow(PREVIEW_READ_ONLY_MESSAGE);
    expect(() => client.storage).toThrow(PREVIEW_READ_ONLY_MESSAGE);
    expect(typeof client.from('jobs').select).toBe('function');
  });
});
