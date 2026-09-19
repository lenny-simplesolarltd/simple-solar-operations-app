import PageContainer from '@/components/layout/page-container';
import { ReadFailureState } from '@/components/read-failure';
import { Badge } from '@/components/ui/badge';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import { formatDateTime } from '@/features/jobs/format';
import { ReadinessCard } from '@/features/release/readiness-card';
import {
  SwitchOffButton,
  SwitchOnButton
} from '@/features/release/release-actions';
import { getCurrentUser } from '@/lib/auth';
import type {
  ReleaseControlRead,
  ReleaseFunction
} from '@/lib/backend/admin-models';
import { readOps } from '@/lib/backend/read';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Release control | Simple Solar Operations'
};

// Release control: which parts of the system are switched on, and the only
// place to change that (RELEASE_MODE_SET). Admin / Manager change; Director
// (go-live approver) sees the same page read-only. The database enforces all
// of it; this page only offers what would be accepted.

const MODE: Record<string, 'success' | 'warning' | 'outline'> = {
  Automated: 'success',
  Manual: 'warning',
  Disabled: 'outline'
};

function whyNotOn(fn: ReleaseFunction, canChange: boolean) {
  if (!canChange) return 'Only an Admin or Manager can switch functions.';
  if (fn.blocked_by.length)
    return `Switch on ${fn.blocked_by.join(', ')} first.`;
  return undefined;
}

function whyNotOff(fn: ReleaseFunction, canChange: boolean) {
  if (!canChange) return 'Only an Admin or Manager can switch functions.';
  if (fn.required_by.length)
    return `${fn.required_by.join(', ')} depend on it: switch them off first.`;
  return undefined;
}

export default async function ReleasePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  const result = await readOps<ReleaseControlRead>('RELEASE_CONTROL');

  return (
    <PageContainer>
      <AssistantPageContext
        page={{
          kind: 'operations',
          surface: 'system',
          view: 'Release control'
        }}
      />
      <div className='flex w-full flex-col gap-5'>
        <Heading
          title='Release control'
          description='Which parts of the system are switched on. A function runs only in its planned mode, only after the functions it depends on, and every change records who made it and why.'
        />
        {!result.ok ? (
          <ReadFailureState failure={result.error} />
        ) : (
          <>
            <ReadinessCard readiness={result.data.readiness} />
            {['R1', 'R2', 'R3', 'R4'].map((release) => {
              const fns = result.data.functions.filter(
                (f) => f.target_release === release
              );
              if (!fns.length) return null;
              return (
                <section key={release} className='flex flex-col gap-3'>
                  <h2 className='text-base font-semibold'>Release {release}</h2>
                  <ul className='flex flex-col gap-3'>
                    {fns.map((fn) => (
                      <li
                        key={fn.function_id}
                        className='bg-card flex flex-col gap-2 rounded-lg border p-4 text-sm'
                      >
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                          <span className='font-medium'>
                            {fn.function_id} · {fn.name}
                          </span>
                          <span className='flex flex-wrap items-center gap-2'>
                            <Badge variant={MODE[fn.mode] ?? 'outline'}>
                              {fn.mode === 'Disabled'
                                ? 'Off'
                                : `${fn.mode} · ${fn.scope}`}
                            </Badge>
                            {fn.mode === 'Disabled' ? (
                              <SwitchOnButton
                                fn={fn}
                                disabledReason={whyNotOn(
                                  fn,
                                  result.data.can_change
                                )}
                              />
                            ) : (
                              <SwitchOffButton
                                fn={fn}
                                disabledReason={whyNotOff(
                                  fn,
                                  result.data.can_change
                                )}
                              />
                            )}
                          </span>
                        </div>
                        <p className='text-muted-foreground text-xs'>
                          Planned mode {fn.planned_mode}
                          {fn.requires.length > 0 &&
                            ` · needs ${fn.requires.join(', ')}`}
                          {fn.works_with.length > 0 &&
                            ` · works with ${fn.works_with.join(', ')}`}
                          {fn.current_system &&
                            ` · until then: ${fn.current_system}`}
                        </p>
                        {fn.last_change && (
                          <p className='text-muted-foreground text-xs'>
                            Last change {formatDateTime(fn.last_change.at)}
                            {fn.last_change.by
                              ? ` by ${fn.last_change.by}`
                              : ' (migration or system)'}
                            {fn.last_change.from &&
                              fn.last_change.to &&
                              fn.last_change.from !== fn.last_change.to &&
                              ` · ${fn.last_change.from} → ${fn.last_change.to}`}
                            {fn.last_change.reason &&
                              ` · "${fn.last_change.reason}"`}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </PageContainer>
  );
}
