import {
  PublicNotice,
  PublicShell
} from '@/features/forms/components/public-shell';
import { openPublicForm } from '@/features/forms/server/public';
import type { Metadata } from 'next';
import { PublicFormClient } from './public-form-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Simple Solar',
  // Recipient links are private: keep them out of search engines and caches.
  robots: { index: false, follow: false }
};

/**
 * A recipient's form. No staff account is needed: the link's token is the
 * only credential, and the database decides what it may see - the exact
 * revision the link was made for, and nothing else.
 */
export default async function PublicFormPage({
  params
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const form = await openPublicForm(token);

  if (form.state === 'open' && form.definition) {
    return (
      <PublicShell>
        <PublicFormClient
          token={token}
          title={form.title ?? 'Form'}
          description={form.description ?? null}
          definition={form.definition}
        />
      </PublicShell>
    );
  }

  const notice = {
    submitted: [
      'Thank you',
      'Your answers have already been sent. There is nothing more to do.'
    ],
    revoked: [
      'This link is no longer active',
      'Please contact Simple Solar if you still need to send this form.'
    ],
    expired: [
      'This link has expired',
      'Please contact Simple Solar for a new link.'
    ],
    closed: [
      'This form is closed',
      'It is no longer accepting answers. Please contact Simple Solar if you need help.'
    ],
    not_found: [
      'Link not recognised',
      'Check you have the whole link from your message, or contact Simple Solar.'
    ],
    open: [
      'Link not recognised',
      'Check you have the whole link from your message, or contact Simple Solar.'
    ]
  }[form.state];
  return (
    <PublicShell>
      <PublicNotice title={notice[0]}>{notice[1]}</PublicNotice>
    </PublicShell>
  );
}
