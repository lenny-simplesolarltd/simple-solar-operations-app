import PageContainer from '@/components/layout/page-container';
import { Input } from '@/components/ui/input';
import {
  ProgrammeShell,
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import {
  currentAccess,
  getProgramme,
  programmesEnabled,
  searchProperties,
  visitedPropertyIds
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../filters';

export const metadata: Metadata = {
  title: 'Programme properties | Simple Solar Operations'
};

const one = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

/**
 * The property list: searchable by address, postcode, the client's reference and
 * the expected meter serial. A field worker starts a visit from here.
 */
export default async function PropertiesPage({
  params,
  searchParams
}: {
  params: Promise<{ programmeId: string }>;
  searchParams: SearchParams;
}) {
  const session = await currentAccess();
  if (!session) redirect('/auth/sign-in');
  if (!(await programmesEnabled()))
    return (
      <PageContainer>
        <ProgrammesNotEnabled />
      </PageContainer>
    );

  const { programmeId } = await params;
  const programme = await getProgramme(programmeId);
  if (!programme) notFound();
  if (!session.access.read) redirect('/dashboard');

  const sp = await searchParams;
  const query = one(sp.q).slice(0, 80);
  const outstanding = one(sp.show) === 'outstanding';
  const properties = await searchProperties(programmeId, {
    query,
    only: outstanding ? 'outstanding' : 'all',
    limit: 200
  });
  const visited = await visitedPropertyIds(
    programmeId,
    properties.map((p) => p.id)
  );
  const base = programmePath(programmeId);

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/properties'
        description='Search by address, postcode, property ID or meter serial.'
      >
        <form
          className='flex flex-wrap items-end gap-3'
          action={`${base}/properties`}
        >
          <label
            className='flex flex-1 flex-col gap-1'
            style={{ minWidth: '16rem' }}
          >
            <span className='text-muted-foreground text-xs font-medium'>
              Search
            </span>
            <Input
              name='q'
              type='search'
              defaultValue={query}
              placeholder='Address, postcode, property ID or meter serial'
              className='h-11'
            />
          </label>
          <label className='flex min-h-11 items-center gap-2 text-sm'>
            <input
              type='checkbox'
              name='show'
              value='outstanding'
              defaultChecked={outstanding}
              className='accent-foreground size-4'
            />
            Not yet visited only
          </label>
          <button
            type='submit'
            className='bg-primary text-primary-foreground h-11 rounded-md px-4 text-sm font-medium'
          >
            Search
          </button>
        </form>

        {properties.length === 0 ? (
          <p className='text-muted-foreground py-8 text-sm'>
            {query
              ? `No property matches “${query}”.`
              : 'This programme has no properties yet. Import the property list to get started.'}
          </p>
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <table className='w-full text-sm'>
              <thead className='bg-muted/50'>
                <tr className='text-left'>
                  {[
                    'Property ID',
                    'Address',
                    'Postcode',
                    'Expected meter serial',
                    'Existing SIM',
                    'Visited'
                  ].map((h) => (
                    <th key={h} scope='col' className='px-3 py-2 font-medium'>
                      {h}
                    </th>
                  ))}
                  {session.access.submit && (
                    <th scope='col' className='px-3 py-2' />
                  )}
                </tr>
              </thead>
              <tbody>
                {properties.map((p) => (
                  <tr key={p.id} className='hover:bg-muted/30 border-t'>
                    <td className='px-3 py-2 tabular-nums'>{p.externalRef}</td>
                    <td className='px-3 py-2'>
                      {[p.addressLine1, p.addressLine2, p.town]
                        .filter(Boolean)
                        .join(', ')}
                    </td>
                    <td className='px-3 py-2'>{p.postcode ?? '—'}</td>
                    <td className='px-3 py-2'>
                      {p.expectedMeterSerial ?? '—'}
                    </td>
                    <td className='px-3 py-2'>{p.existingSimSerial ?? '—'}</td>
                    <td className='px-3 py-2'>
                      {visited.has(p.id) ? (
                        <span className='text-success'>Yes</span>
                      ) : (
                        <span className='text-muted-foreground'>Not yet</span>
                      )}
                    </td>
                    {session.access.submit && (
                      <td className='px-3 py-2'>
                        <Link
                          href={`${base}/visit?property=${p.id}`}
                          className='min-h-11 font-medium underline'
                        >
                          Record a visit
                        </Link>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className='text-muted-foreground border-t px-3 py-2 text-xs'>
              Showing {properties.length}
              {properties.length === 200
                ? ' (the first 200 — narrow the search)'
                : ''}
              .
            </p>
          </div>
        )}
      </ProgrammeShell>
    </PageContainer>
  );
}
