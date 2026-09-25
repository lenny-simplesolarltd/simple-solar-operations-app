'use client';

import { Button } from '@/components/ui/button';
import { IconCheck } from '@tabler/icons-react';
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { AnswerValue, FormDefinition } from '../definition';
import { completeFormAction } from '../server/actions';
import { FormRenderer } from './form-renderer';

/**
 * Completing a form in the app, for a person the form's own access model
 * entitles - no recipient link, and no Forms administration.
 *
 * It is the EXISTING FormRenderer, the same component the recipient and the
 * preview use, so there is no second rendering of a form to drift. The photo
 * and lookup controls are deliberately not injected: those questions belong to
 * a workflow that knows what is being photographed and what may be looked up,
 * and the page refuses to open a form that uses them rather than showing a
 * question nobody can answer.
 */
export function FillForm({
  form
}: {
  form: {
    formId: string;
    revisionId: string;
    revision: number;
    title: string;
    description: string | null;
    definition: FormDefinition;
  };
}) {
  const [sent, setSent] = useState(false);
  // One command id per attempt, kept until it succeeds, so a retry after a lost
  // response is replayed by the server rather than recorded twice.
  const commandId = useRef(crypto.randomUUID());
  const submissionId = useRef(crypto.randomUUID());

  const submit = useCallback(
    async (answers: Record<string, AnswerValue>) => {
      const result = await completeFormAction(
        {
          formId: form.formId,
          revisionId: form.revisionId,
          submissionId: submissionId.current,
          answers
        },
        commandId.current
      );
      if (result.ok) {
        setSent(true);
        return { ok: true as const };
      }
      // A refusal wrote nothing, and the answers are still on screen. The
      // command id is spent for this payload, so the next attempt needs its own;
      // the submission id is kept, so a retry that reaches the database after a
      // lost response is still recognised as the same submission.
      commandId.current = crypto.randomUUID();
      return { ok: false as const, message: result.message };
    },
    [form.formId, form.revisionId]
  );

  if (sent)
    return (
      <div className='flex flex-col items-center gap-3 py-10 text-center'>
        <IconCheck aria-hidden className='text-success size-10' />
        <p className='text-lg font-semibold'>Your answers were sent</p>
        <p className='text-muted-foreground text-sm'>
          They are recorded against version {form.revision} of this form.
        </p>
        <Button asChild variant='outline' className='min-h-11'>
          <Link href='/dashboard/forms'>Back to your forms</Link>
        </Button>
      </div>
    );

  return (
    <FormRenderer
      title={form.title}
      description={form.description}
      definition={form.definition}
      mode='live'
      onSubmit={submit}
      // Kept per revision, so a republished form never restores answers keyed by
      // questions that no longer exist.
      draftKey={`form-fill:${form.formId}:${form.revisionId}`}
      footer={
        <p className='bg-muted/50 text-muted-foreground rounded-lg px-3 py-2 text-xs'>
          Your answers go to the Simple Solar team, recorded against your name
          and version {form.revision} of this form.
        </p>
      }
    />
  );
}
