import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { SyntheticBadge } from '@/features/programmes/components/badges';
import {
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import {
  currentAccess,
  listProgrammes,
  programmesEnabled
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Programmes | Simple Solar Operations'
};

/** Every programme this person may see. */
export default async function ProgrammesPage() {
  const session = await currentAccess();
  if (!session) redirect('/auth/sign-in');
  if (!(await programmesEnabled())) {
    return (
      <PageContainer>
        <ProgrammesNotEnabled />
      </PageContainer>
    );
  }
  if (!session.access.read) redirect('/dashboard');

  const programmes = await listProgrammes();

  return (
    <PageContainer>
      <div className='flex flex-1 flex-col gap-5'>
        <Heading
          title='Programmes'
          description='Contracts covering many properties and field visits.'
        />
        {programmes.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            There are no programmes you can see.
          </p>
        ) : (
          <ul className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {programmes.map((p) => (
              <li key={p.id}>
                <Link
                  href={programmePath(p.id)}
                  className='hover:bg-accent/50 flex h-full flex-col gap-2 rounded-lg border p-4'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <span className='font-semibold'>{p.name}</span>
                    <span className='text-muted-foreground shrink-0 text-xs'>
                      {p.status}
                    </span>
                  </div>
                  <p className='text-muted-foreground text-sm'>
                    {[p.clientName, p.code].filter(Boolean).join(' · ')}
                  </p>
                  {p.startsOn && (
                    <p className='text-muted-foreground text-xs tabular-nums'>
                      {p.startsOn}
                      {p.endsOn ? ` to ${p.endsOn}` : ''}
                    </p>
                  )}
                  {p.synthetic && <SyntheticBadge />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
