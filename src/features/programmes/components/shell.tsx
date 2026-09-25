import { Heading } from '@/components/ui/heading';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ProgrammeAccess } from '../server/queries';
import type { ProgrammeSummary } from '../types';
import { SyntheticBadge } from './badges';

/** Where a programme's screens live. One place, so no route string is guessed. */
export const programmePath = (programmeId: string) =>
  `/dashboard/operations/programmes/${programmeId}`;

export const PROGRAMMES_PATH = '/dashboard/operations/programmes';

interface Tab {
  href: string;
  label: string;
  show: (access: ProgrammeAccess) => boolean;
}

/**
 * Six tabs, not eight.
 *
 * Every screen used to be a tab of equal weight, so "Import" - something done
 * once, by one role, at the start of a programme - sat beside "Board", which
 * the office lives in all day. Import is now an action on Properties, where the
 * properties it creates are, and Record a visit is offered as an action to the
 * people who actually do it rather than as a permanent office tab.
 *
 * The old routes still exist and still work; only the menu changed.
 */
const TABS: Tab[] = [
  { href: '', label: 'Overview', show: (a) => a.report || a.readAll },
  { href: '/review', label: 'Review', show: (a) => a.review },
  { href: '/board', label: 'Board', show: (a) => a.readAll },
  { href: '/visits', label: 'Visits', show: (a) => a.readAll },
  { href: '/properties', label: 'Properties', show: (a) => a.read },
  { href: '/report', label: 'Reports', show: (a) => a.report },
  // Field staff have no office tabs at all, so this is their only way in.
  {
    href: '/visit',
    label: 'Record a visit',
    show: (a) => a.submit && !a.readAll
  }
];

/**
 * The frame every programme screen shares: what this programme is, whether it is
 * test data, and the tabs this person may actually use.
 */
export function ProgrammeShell({
  programme,
  access,
  current,
  actions,
  description,
  children
}: {
  programme: ProgrammeSummary;
  access: ProgrammeAccess;
  /** The tab href, e.g. '/review'. '' is the overview. */
  current: string;
  actions?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}) {
  const base = programmePath(programme.id);
  const tabs = TABS.filter((t) => t.show(access));

  return (
    <div className='flex flex-1 flex-col gap-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div className='flex min-w-0 flex-col gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <Heading
              title={programme.name}
              description={
                description ??
                [
                  programme.clientName,
                  programme.code,
                  programme.status,
                  programme.startsOn && programme.endsOn
                    ? `${programme.startsOn} to ${programme.endsOn}`
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ')
              }
            />
          </div>
          {programme.synthetic && (
            <div className='flex items-center gap-2'>
              <SyntheticBadge />
              <span className='text-muted-foreground text-xs'>
                Development fixtures. Not real work, and kept apart from real
                programmes by the database.
              </span>
            </div>
          )}
        </div>
        {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
      </div>

      <nav aria-label='Programme sections'>
        <ul className='flex flex-wrap gap-1 border-b'>
          {tabs.map((tab) => {
            const active = current === tab.href;
            return (
              <li key={tab.href}>
                <Link
                  href={`${base}${tab.href}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'hover:text-foreground -mb-px flex min-h-11 items-center border-b-2 px-3 text-sm font-medium',
                    active
                      ? 'border-primary text-foreground'
                      : 'text-muted-foreground border-transparent'
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}

/** Shown when FN-22 is switched off, in the same words Forms uses. */
export function ProgrammesNotEnabled() {
  return (
    <div className='flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center'>
      <h1 className='text-xl font-semibold'>Programmes is switched off</h1>
      <p className='text-muted-foreground max-w-prose text-sm'>
        Operational programmes are not switched on for this system yet. An
        administrator can enable them by setting FN-22 to Manual in the release
        register.
      </p>
    </div>
  );
}
