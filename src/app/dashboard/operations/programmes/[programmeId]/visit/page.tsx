import PageContainer from '@/components/layout/page-container';
import {
  ProgrammesNotEnabled,
  programmePath
} from '@/features/programmes/components/shell';
import { VisitForm } from '@/features/programmes/components/visit-form';
import {
  currentAccess,
  getProgramme,
  getProperty,
  programmesEnabled,
  visitForm
} from '@/features/programmes/server/queries';
import type { FormDefinition } from '@/features/forms/definition';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { SearchParams } from '../filters';

export const metadata: Metadata = {
  title: 'Record a visit | Simple Solar Operations'
};

const one = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The installer's screen. A field workflow, so it is built for a phone held in
 * one hand on a doorstep:
 *
 *   * no sidebar, no tabs, no table - one column, full width;
 *   * every target at least 44px, most of them 48;
 *   * the camera opens straight from the photo button;
 *   * photographs upload as they are taken, so losing signal at the end does not
 *     lose them;
 *   * unsent answers are kept on the device and restored;
 *   * the questions that do not apply are not shown at all.
 */
export default async function RecordVisitPage({
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
  if (!session.access.submit) redirect('/dashboard');

  const form = await visitForm(programmeId);
  const propertyId = one((await searchParams).property);
  const property = UUID.test(propertyId) ? await getProperty(propertyId) : null;
  const base = programmePath(programmeId);

  return (
    // scrollable={false}: the form is the page, and a nested scroll area on a
    // phone fights the browser's own scrolling.
    <PageContainer scrollable={false}>
      <div className='mx-auto flex w-full max-w-xl flex-col gap-4'>
        <header className='flex flex-col gap-1'>
          <p className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
            {programme.name}
            {programme.synthetic ? ' · TEST DATA' : ''}
          </p>
          <Link
            href={`${base}/properties`}
            className='text-muted-foreground min-h-11 self-start text-sm underline'
          >
            ← Property list
          </Link>
        </header>

        {form.state !== 'open' ? (
          <p className='bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm'>
            {form.state === 'unavailable'
              ? 'This programme has no published visit form yet, so visits cannot be recorded. Tell the office.'
              : 'The visit form could not be loaded. Try again, or tell the office.'}
          </p>
        ) : (
          <VisitForm
            programmeId={programmeId}
            form={{
              formId: form.formId,
              revisionId: form.revisionId,
              revision: form.revision,
              title: form.title,
              description: form.description,
              definition: form.definition as unknown as FormDefinition,
              signalConfig: form.signalConfig
            }}
            // The field map comes back with the definition, from the same
            // server read, so the form and its mapping are always in step.
            fieldMap={form.fieldMap}
            property={property}
            doneHref={`${base}/properties?show=outstanding`}
          />
        )}
      </div>
    </PageContainer>
  );
}
