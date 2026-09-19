'use client';

import type { FormDefinition } from '@/features/forms/definition';
import { FormRenderer } from '@/features/forms/components/form-renderer';
import { PublicNotice } from '@/features/forms/components/public-shell';
import { submitPublicFormAction } from '@/features/forms/server/actions';
import { useRef, useState } from 'react';

export function PublicFormClient({
  token,
  title,
  description,
  definition
}: {
  token: string;
  title: string;
  description: string | null;
  definition: FormDefinition;
}) {
  // One id for this visit: a double-click or a retry after a dropped
  // connection is recognised by the database as the same submission.
  const submissionId = useRef<string>(crypto.randomUUID());
  const [done, setDone] = useState<null | 'sent' | 'already'>(null);

  if (done) {
    return (
      <PublicNotice title='Thank you'>
        {done === 'sent'
          ? 'Your answers have been sent to Simple Solar. You can close this page.'
          : 'A response has already been sent from this link. You can close this page.'}
      </PublicNotice>
    );
  }

  return (
    <FormRenderer
      title={title}
      description={description}
      definition={definition}
      mode='live'
      onSubmit={async (answers) => {
        const result = await submitPublicFormAction(
          token,
          submissionId.current,
          answers
        );
        if (result.ok) {
          setDone('sent');
          return { ok: true };
        }
        if (result.state === 'submitted') {
          setDone('already');
          return { ok: true };
        }
        return {
          ok: false,
          message: result.message,
          field: 'field' in result ? result.field : undefined
        };
      }}
    />
  );
}
