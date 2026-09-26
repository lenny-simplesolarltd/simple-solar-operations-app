'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { IconLoader2, IconPlus, IconUserOff } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { assignAction, unassignAction } from '../server/actions';
import type { ProgrammeAssignee } from '../server/queries';

/**
 * Who is working on this programme.
 *
 * This screen existed only in the database. PROGRAMME_ASSIGN and
 * PROGRAMME_UNASSIGN were written, tested and reachable, and nothing in the
 * app called them - so a programme could be set up completely, with its
 * property list loaded and its visit form published, and still no installer
 * could open it.
 *
 * That failure is silent in a way worth naming: an installer who is not
 * assigned does not see the form under "To complete" and cannot open the visit
 * screen, and the office sees no warning, because from the office's side
 * everything is configured. The only visible symptom is installers saying they
 * cannot find the job. Hence the empty state here says what it blocks, rather
 * than "No one assigned".
 */
export function AssigneesPanel({
  programmeId,
  assignees,
  assignable,
  canManage
}: {
  programmeId: string;
  assignees: ProgrammeAssignee[];
  /** Active staff whose role may record a visit - the command refuses anyone else. */
  assignable: { id: string; name: string; roles: string[] }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const assigned = new Set(assignees.map((a) => a.personId));
  const text = query.trim().toLowerCase();
  const candidates = assignable
    .filter((p) => !assigned.has(p.id))
    .filter((p) => !text || p.name.toLowerCase().includes(text));

  async function add(personId: string, name: string) {
    setBusy(personId);
    const result = await assignAction(
      { programmeId, personId },
      crypto.randomUUID()
    );
    setBusy(null);
    if (!result.ok) return toast.error(result.outcome.message);
    toast.success(`${name} can now record visits on this programme.`);
    setQuery('');
    setAdding(false);
    router.refresh();
  }

  async function remove(assignee: ProgrammeAssignee) {
    setBusy(assignee.assignmentId);
    const result = await unassignAction(
      { assignmentId: assignee.assignmentId, programmeId },
      crypto.randomUUID()
    );
    setBusy(null);
    if (!result.ok) return toast.error(result.outcome.message);
    toast.success(`${assignee.name} removed from this programme.`);
    router.refresh();
  }

  return (
    <section
      aria-labelledby='assignees-heading'
      className='flex flex-col gap-3 rounded-lg border p-4'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='min-w-0'>
          <h2 id='assignees-heading' className='font-semibold'>
            Installers on this programme
          </h2>
          <p className='text-muted-foreground text-sm'>
            Only the people listed here can open the visit form and record a
            visit.
          </p>
        </div>
        {canManage && !adding && (
          <Button variant='outline' onClick={() => setAdding(true)}>
            <IconPlus aria-hidden />
            Assign someone
          </Button>
        )}
      </div>

      {assignees.length === 0 ? (
        <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
          Nobody is assigned yet, so no installer can record a visit on this
          programme. The form is published and the properties are loaded;
          assigning someone is what makes it reachable for them.
        </p>
      ) : (
        <ul className='flex flex-col divide-y rounded-md border'>
          {assignees.map((a) => (
            <li
              key={a.assignmentId}
              className='flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm'
            >
              <span className='font-medium'>{a.name}</span>
              {a.propertyId && (
                <Badge variant='outline'>One property only</Badge>
              )}
              {a.note && (
                <span className='text-muted-foreground min-w-0 flex-1 truncate'>
                  {a.note}
                </span>
              )}
              {canManage && (
                <Button
                  size='sm'
                  variant='ghost'
                  className='text-destructive ml-auto'
                  disabled={busy === a.assignmentId}
                  onClick={() => remove(a)}
                >
                  {busy === a.assignmentId ? (
                    <IconLoader2 aria-hidden className='animate-spin' />
                  ) : (
                    <IconUserOff aria-hidden />
                  )}
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && adding && (
        <div className='flex flex-col gap-2'>
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search by name'
            aria-label='Search staff to assign'
          />
          {candidates.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              {assignable.length === 0
                ? 'Nobody holds a role that may record a visit. An administrator sets that.'
                : 'Everybody who could be assigned already is.'}
            </p>
          ) : (
            <ul className='max-h-64 divide-y overflow-y-auto rounded-md border'>
              {candidates.slice(0, 50).map((p) => (
                <li
                  key={p.id}
                  className='flex items-center gap-3 px-3 py-2 text-sm'
                >
                  <span className='font-medium'>{p.name}</span>
                  <span className='text-muted-foreground text-xs'>
                    {p.roles.join(', ')}
                  </span>
                  <Button
                    size='sm'
                    variant='outline'
                    className='ml-auto'
                    disabled={busy === p.id}
                    onClick={() => add(p.id, p.name)}
                  >
                    {busy === p.id && (
                      <IconLoader2 aria-hidden className='animate-spin' />
                    )}
                    Assign
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant='ghost'
            className='self-start'
            onClick={() => {
              setAdding(false);
              setQuery('');
            }}
          >
            Done
          </Button>
        </div>
      )}
    </section>
  );
}
