import { formsEnabled } from '@/features/forms/server/service';
import { FormsNotEnabled } from '@/features/forms/components/forms-not-enabled';
import PageContainer from '@/components/layout/page-container';
import { Heading } from '@/components/ui/heading';
import { AssistantPageContext } from '@/features/assistant/components/page-context';
import {
  FormStatusBadge,
  LinkStatusBadge
} from '@/features/forms/components/badges';
import { NewFormDialog } from '@/features/forms/components/new-form-dialog';
import {
  listForms,
  listInvitations,
  type ResponseFilters
} from '@/features/forms/server/service';
import {
  RECIPIENT_LABEL,
  type FormLinkStatus,
  type FormSummary,
  type InvitationSummary
} from '@/features/forms/types';
import { ListFilters } from '@/features/operations/list-filters';
import { MyFormsList } from '@/features/forms/components/my-forms-list';
import { listMyForms } from '@/features/forms/server/my-forms';
import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Forms | Simple Solar Operations'
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

// "Complete" is first because it is the only view every role can use. The
// three after it are Forms ADMINISTRATION and appear only for managers.
const VIEWS = [
  { value: 'complete', label: 'To complete' },
  { value: 'forms', label: 'Forms' },
  { value: 'templates', label: 'Templates' },
  { value: 'responses', label: 'Responses' }
] as const;
type View = (typeof VIEWS)[number]['value'];

export default async function FormsPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');
  if (!(await formsEnabled())) return <FormsNotEnabled />;
  const permissions = await getPermissions(user);
  // No forms.read is no longer a dead end: it means this person manages no
  // forms, not that they have no business here. They get the completion view.
  const canManage = permissions.has('forms.read');

  const params = await searchParams;
  const requested = first(params.view);
  const view: View = !canManage
    ? 'complete'
    : VIEWS.some((v) => v.value === requested)
      ? (requested as View)
      : 'forms';
  const archived = first(params.show) === 'archived';

  const templates = canManage ? await listForms({ kind: 'template' }) : [];
  const myForms = await listMyForms();

  return (
    <PageContainer>
      <AssistantPageContext page={{ kind: 'forms', view }} />
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title='Forms'
            description={
              canManage
                ? 'Forms you are asked to complete, and the forms you manage: build them, send secure links, and read the responses.'
                : 'Forms you are asked to complete.'
            }
          />
          {view === 'forms' && permissions.has('forms.create') && (
            <NewFormDialog
              kind='form'
              templates={templates.map((t) => ({ id: t.id, title: t.title }))}
            />
          )}
          {view === 'templates' &&
            permissions.has('forms.templates.manage') && (
              <NewFormDialog kind='template' templates={[]} />
            )}
        </div>

        {view === 'complete' ? (
          <>
            {canManage && (
              <ListFilters
                defaults={{ view: 'forms', show: 'current' }}
                tabs={{ key: 'view', label: 'Forms view', options: [...VIEWS] }}
              />
            )}
            <MyFormsList forms={myForms} />
          </>
        ) : view === 'responses' ? (
          <Responses
            params={params}
            canReadResponses={permissions.has('forms.responses.read')}
          />
        ) : (
          <>
            <ListFilters
              defaults={{ view: 'forms', show: 'current' }}
              tabs={{ key: 'view', label: 'Forms view', options: [...VIEWS] }}
              selects={[
                {
                  key: 'show',
                  label: 'Show',
                  options: [
                    { value: 'current', label: 'Current' },
                    { value: 'archived', label: 'Archived' }
                  ]
                }
              ]}
            />
            <FormList
              forms={
                view === 'templates'
                  ? archived
                    ? await listForms({ kind: 'template', archived: true })
                    : templates
                  : await listForms({ kind: 'form', archived })
              }
              kind={view === 'templates' ? 'template' : 'form'}
            />
          </>
        )}
      </div>
    </PageContainer>
  );
}

function FormList({
  forms,
  kind
}: {
  forms: FormSummary[];
  kind: 'form' | 'template';
}) {
  if (forms.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
        {kind === 'form' ? 'No forms here yet.' : 'No templates here yet.'}
      </div>
    );
  }
  return (
    <ul className='divide-y rounded-lg border'>
      {forms.map((f) => (
        <li key={f.id}>
          <Link
            href={`/dashboard/forms/${f.id}`}
            className='hover:bg-accent/50 focus-visible:ring-ring flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset'
          >
            <span className='min-w-0 flex-1 basis-60'>
              <span className='block truncate font-medium'>{f.title}</span>
              <span className='text-muted-foreground block text-xs'>
                {f.questionCount}{' '}
                {f.questionCount === 1 ? 'question' : 'questions'}
                {f.revision > 0 && ` · v${f.revision}`}
                {f.hasUnpublishedChanges &&
                  f.revision > 0 &&
                  ' · unpublished changes'}
                {f.jobRef && ` · ${f.jobRef}`}
              </span>
            </span>
            <FormStatusBadge status={f.status} />
            <span className='text-muted-foreground w-28 text-right text-xs tabular-nums'>
              Updated {formatDate(f.updatedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const STATUS_OPTIONS: { value: FormLinkStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Any status' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'ready', label: 'Awaiting response' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'closed', label: 'Form closed' }
];

async function Responses({
  params,
  canReadResponses
}: {
  params: Record<string, string | string[] | undefined>;
  canReadResponses: boolean;
}) {
  const period = first(params.period);
  const days =
    period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : null;
  const filters: ResponseFilters = {
    formId: /^[0-9a-f-]{36}$/i.test(first(params.form))
      ? first(params.form)
      : undefined,
    status: (STATUS_OPTIONS.some((o) => o.value === first(params.status))
      ? first(params.status)
      : 'all') as ResponseFilters['status'],
    recipientType: ['customer', 'surveyor', 'other'].includes(
      first(params.recipient)
    )
      ? (first(params.recipient) as InvitationSummary['recipientType'])
      : undefined,
    jobRef: first(params.q) || undefined,
    from: days ? daysAgo(days) : undefined
  };
  const [links, forms] = await Promise.all([
    listInvitations(filters),
    listForms({ kind: 'form' })
  ]);
  const counts = {
    total: links.length,
    submitted: links.filter((l) => l.status === 'submitted').length,
    waiting: links.filter((l) => l.status === 'ready').length
  };

  return (
    <>
      <ListFilters
        defaults={{
          view: 'forms',
          status: 'all',
          recipient: 'all',
          period: 'all',
          form: 'all'
        }}
        tabs={{ key: 'view', label: 'Forms view', options: [...VIEWS] }}
        selects={[
          {
            key: 'form',
            label: 'Form',
            options: [
              { value: 'all', label: 'All forms' },
              ...forms.map((f) => ({ value: f.id, label: f.title }))
            ]
          },
          { key: 'status', label: 'Status', options: STATUS_OPTIONS },
          {
            key: 'recipient',
            label: 'Recipient',
            options: [
              { value: 'all', label: 'Anyone' },
              { value: 'customer', label: 'Customers' },
              { value: 'surveyor', label: 'Surveyors' },
              { value: 'other', label: 'Others' }
            ]
          },
          {
            key: 'period',
            label: 'Created',
            options: [
              { value: 'all', label: 'Any time' },
              { value: '7d', label: 'Last 7 days' },
              { value: '30d', label: 'Last 30 days' },
              { value: '90d', label: 'Last 90 days' }
            ]
          }
        ]}
        searchPlaceholder='Job reference'
      />
      <p className='text-muted-foreground text-sm'>
        {counts.total} {counts.total === 1 ? 'link' : 'links'} ·{' '}
        {counts.submitted} submitted · {counts.waiting} awaiting a response
      </p>
      {links.length === 0 ? (
        <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
          No links match these filters.
        </div>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {links.map((l) => {
            const body = (
              <>
                <span className='min-w-0 flex-1 basis-60'>
                  <span className='block truncate font-medium'>
                    {l.formTitle}
                  </span>
                  <span className='text-muted-foreground block text-xs'>
                    {RECIPIENT_LABEL[l.recipientType]}: {l.recipientName}
                    {l.jobRef && ` · ${l.jobRef}`} · v{l.revision}
                  </span>
                </span>
                <LinkStatusBadge status={l.status} />
                <span className='text-muted-foreground w-32 text-right text-xs tabular-nums'>
                  {l.submittedAt
                    ? `Submitted ${formatDate(l.submittedAt)}`
                    : `Created ${formatDate(l.createdAt)}`}
                </span>
              </>
            );
            const className =
              'flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3';
            return (
              <li key={l.id}>
                {l.submissionId && canReadResponses ? (
                  <Link
                    href={`/dashboard/forms/responses/${l.submissionId}`}
                    className={`${className} hover:bg-accent/50 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset`}
                  >
                    {body}
                  </Link>
                ) : (
                  <Link
                    href={`/dashboard/forms/${l.formId}#links`}
                    className={`${className} hover:bg-accent/50 focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-inset`}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
