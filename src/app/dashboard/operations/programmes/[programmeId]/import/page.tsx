import PageContainer from '@/components/layout/page-container';
import { ImportWizard } from '@/features/programmes/components/import-wizard';
import {
  ProgrammeShell,
  ProgrammesNotEnabled
} from '@/features/programmes/components/shell';
import {
  currentAccess,
  getProgramme,
  importRows,
  listImports,
  programmesEnabled
} from '@/features/programmes/server/queries';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Import properties | Simple Solar Operations'
};

/** Property import: upload, parse, map, validate, preview, import. */
export default async function ImportPage({
  params
}: {
  params: Promise<{ programmeId: string }>;
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
  if (!session.access.manage) redirect('/dashboard');

  const imports = await listImports(programmeId);
  // An import left part-way through is picked up where it was, so a reload does
  // not lose staged rows.
  const open = imports.find((i) => i.status !== 'Applied') ?? null;
  const openRows =
    open && open.status === 'Mapped'
      ? await importRows(open.id, { limit: 200 })
      : [];

  return (
    <PageContainer>
      <ProgrammeShell
        programme={programme}
        access={session.access}
        current='/properties'
        description='Bring in the property list. Nothing is imported until you have seen exactly what will happen.'
      >
        <ImportWizard
          programmeId={programmeId}
          existing={open}
          existingRows={openRows}
        />

        {imports.filter((i) => i.status === 'Applied').length > 0 && (
          <section className='flex flex-col gap-2'>
            <h3 className='text-sm font-semibold tracking-wide uppercase'>
              Previous imports
            </h3>
            <ul className='divide-y rounded-lg border text-sm'>
              {imports
                .filter((i) => i.status === 'Applied')
                .map((i) => (
                  <li key={i.id} className='flex flex-wrap gap-x-4 px-3 py-2'>
                    <span className='font-medium'>{i.filename}</span>
                    <span className='text-muted-foreground'>
                      {i.createdCount ?? 0} added, {i.updatedCount ?? 0}{' '}
                      updated, {i.invalidRows ?? 0} skipped
                    </span>
                    <span className='text-muted-foreground tabular-nums'>
                      {i.appliedAt?.slice(0, 16).replace('T', ' ')}
                    </span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </ProgrammeShell>
    </PageContainer>
  );
}
