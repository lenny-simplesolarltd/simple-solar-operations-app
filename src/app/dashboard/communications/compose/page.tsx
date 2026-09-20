import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { ComposeDocumentEmail } from '@/features/documents/components/compose-document-email';
import { composeDocumentEmail } from '@/features/documents/server/actions';
import { getJobDocuments } from '@/features/documents/server/queries';
import { getJobDetail } from '@/features/jobs/server/queries';
import { DOCUMENT_TYPE_LABELS } from '@/features/documents/types';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Compose | Simple Solar Operations'
};

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Compose a customer email carrying one generated document revision.
 *
 * Reached from the Documents card's Email action. Everything it needs comes
 * from the revision itself, so a link that names a revision the person may not
 * see simply does not resolve.
 */
export default async function ComposePage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const jobId = typeof query.job === 'string' ? query.job : '';
  const revisionId = typeof query.revision === 'string' ? query.revision : '';
  if (!UUID.test(jobId) || !UUID.test(revisionId)) notFound();

  const [detail, documents] = await Promise.all([
    getJobDetail(jobId),
    getJobDocuments(jobId)
  ]);
  if (!detail || !documents.ok) notFound();

  const revision = documents.data.documents
    .flatMap((d) => d.history)
    .find((r) => r.revision_id === revisionId);
  if (
    !revision ||
    revision.status === 'Queued' ||
    revision.status === 'Generating'
  )
    notFound();

  const customer = detail.job.customers;
  const label = DOCUMENT_TYPE_LABELS[revision.document_type];
  const reference = documents.data.job_reference;

  return (
    <PageContainer>
      <div className='flex w-full max-w-3xl flex-col gap-4'>
        <Heading
          title='Compose email'
          description='This creates a draft in Communications. Nothing is sent from here.'
        />
        <ComposeDocumentEmail
          jobId={jobId}
          jobReference={reference}
          revisionId={revisionId}
          documentLabel={label}
          revisionNumber={revision.revision_number}
          filename={revision.filename ?? ''}
          defaultTo={customer?.email ?? null}
          defaultSubject={
            revision.document_type === 'QuotationContract'
              ? `Your Simple Solar quotation — ${reference}`
              : `Your Simple Solar savings report — ${reference}`
          }
          defaultBody={[
            `Dear ${customer?.first_name ?? ''},`.trim(),
            '',
            `Please find your ${
              revision.document_type === 'QuotationContract'
                ? 'quotation and contract'
                : 'savings and return report'
            } attached, for ${reference}.`,
            '',
            'If anything looks wrong, or you have any questions, reply to this email and we will pick it up.',
            '',
            'Simple Solar (SW) Ltd'
          ].join('\n')}
          composeAction={composeDocumentEmail}
        />
      </div>
    </PageContainer>
  );
}
