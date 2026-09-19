'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyLinkButton } from '@/features/forms/components/share-links';
import {
  LINK_STATUS_LABEL,
  STATUS_LABEL,
  type FormLinkStatus,
  type FormStatus
} from '@/features/forms/types';
import Link from 'next/link';
import type { FormCardData, FormLinkCardData } from '../protocol';

// Forms results in the drawer. SimpleBot orchestrates; detailed editing and
// preview happen in Forms, so the cards link there. A card shows the form as
// it was when SimpleBot read it; the buttons always open its current state.

const statusLabel = (status: string) =>
  STATUS_LABEL[status as FormStatus] ?? status;

export function FormCardBody({
  form,
  note,
  onNavigate
}: {
  form: FormCardData;
  note?: string;
  onNavigate?: () => void;
}) {
  const go = { onClick: onNavigate };
  return (
    <div className='flex flex-col gap-2 px-3 py-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>
          {form.title}
        </span>
        <Badge variant={form.status === 'published' ? 'success' : 'secondary'}>
          {form.kind === 'template' ? 'Template' : statusLabel(form.status)}
          {form.revision > 0 && ` · v${form.revision}`}
        </Badge>
      </div>
      <p className='text-muted-foreground text-xs'>
        {form.questionCount}{' '}
        {form.questionCount === 1 ? 'question' : 'questions'}
        {form.jobRef && ` · ${form.jobRef}`}
        {form.hasUnpublishedChanges &&
          form.revision > 0 &&
          ' · draft has unpublished changes'}
        {note && ` · ${note}`}
      </p>
      <div className='flex flex-wrap gap-1.5'>
        <Button asChild size='sm' variant='outline' className='h-7'>
          <Link href={`/dashboard/forms/${form.id}/preview`} {...go}>
            Preview
          </Link>
        </Button>
        <Button asChild size='sm' variant='outline' className='h-7'>
          <Link href={`/dashboard/forms/${form.id}`} {...go}>
            {form.kind === 'template' ? 'Open template' : 'Edit'}
          </Link>
        </Button>
        {form.kind === 'form' && form.revision > 0 && (
          <Button asChild size='sm' variant='outline' className='h-7'>
            <Link
              href={`/dashboard/forms?view=responses&form=${form.id}`}
              {...go}
            >
              Responses
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

export function FormLinkRow({
  link,
  onNavigate
}: {
  link: FormLinkCardData;
  onNavigate?: () => void;
}) {
  return (
    <li className='flex flex-col gap-1.5 px-3 py-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>
          {link.formTitle}
        </span>
        <Badge
          variant={
            link.status === 'submitted'
              ? 'success'
              : link.status === 'ready'
                ? 'info'
                : 'secondary'
          }
        >
          {LINK_STATUS_LABEL[link.status as FormLinkStatus] ?? link.status}
        </Badge>
      </div>
      <p className='text-muted-foreground text-xs'>
        {link.recipient}
        {link.jobRef && ` · ${link.jobRef}`} · v{link.revision}
      </p>
      <div className='flex flex-wrap gap-1.5'>
        {link.status === 'ready' && (
          <CopyLinkButton invitationId={link.invitationId} />
        )}
        {link.submissionId && (
          <Button asChild size='sm' variant='outline' className='h-8'>
            <Link
              href={`/dashboard/forms/responses/${link.submissionId}`}
              onClick={onNavigate}
            >
              View response
            </Link>
          </Button>
        )}
        <Button asChild size='sm' variant='ghost' className='h-8'>
          <Link
            href={`/dashboard/forms/${link.formId}#links`}
            onClick={onNavigate}
          >
            Open form
          </Link>
        </Button>
      </div>
    </li>
  );
}
