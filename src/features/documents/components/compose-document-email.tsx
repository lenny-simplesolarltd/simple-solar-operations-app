'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { IconPaperclip } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

// Compose, not send.
//
// This screen makes a DRAFT in the communications spine and hands over to it.
// Nothing here talks to a mail transport, holds a recipient allow-list or
// decides a release gate - all of that already exists one module over, and
// duplicating it is exactly how a system ends up with two ways to send email
// and only one of them audited.
//
// The attachment is fixed. The person may edit the recipient, the subject and
// the words; they cannot swap the revision, because the whole point of the
// chain is that this message provably carried THAT file.

export interface ComposeDocumentEmailProps {
  jobId: string;
  jobReference: string;
  revisionId: string;
  documentLabel: string;
  revisionNumber: number;
  filename: string;
  defaultTo: string | null;
  defaultSubject: string;
  defaultBody: string;
  composeAction: (
    commandId: string,
    jobId: string,
    revisionId: string,
    fields: { to: string; subject: string; body: string }
  ) => Promise<{ ok: boolean; communicationId?: string; message?: string }>;
}

export function ComposeDocumentEmail({
  jobId,
  jobReference,
  revisionId,
  documentLabel,
  revisionNumber,
  filename,
  defaultTo,
  defaultSubject,
  defaultBody,
  composeAction
}: ComposeDocumentEmailProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [to, setTo] = useState(defaultTo ?? '');
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  // Minted once per mounted form: a double submit is a replay, not two drafts.
  const [commandId] = useState(() => crypto.randomUUID());

  const submit = () =>
    start(async () => {
      const result = await composeAction(commandId, jobId, revisionId, {
        to,
        subject,
        body
      });
      if (!result.ok || !result.communicationId) {
        toast.error(result.message ?? 'That draft could not be created.');
        return;
      }
      toast.success('Draft created. Nothing has been sent yet.');
      router.push(`/dashboard/communications/${result.communicationId}`);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-base'>
          Email {documentLabel} · {jobReference}
        </CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='compose-to'>To</Label>
          <Input
            id='compose-to'
            type='email'
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder='customer@example.com'
          />
          {!defaultTo && (
            <p className='text-muted-foreground text-xs'>
              This customer has no email address on record. Enter one, or close
              this and send the document another way.
            </p>
          )}
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='compose-subject'>Subject</Label>
          <Input
            id='compose-subject'
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label htmlFor='compose-body'>Message</Label>
          <Textarea
            id='compose-body'
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <div className='bg-muted/40 flex items-center gap-2 rounded-md px-3 py-2 text-sm'>
          <IconPaperclip className='size-4 shrink-0' aria-hidden />
          <span className='min-w-0 flex-1 truncate font-mono text-xs'>
            {filename}
          </span>
          <span className='text-muted-foreground text-xs'>
            Revision {revisionNumber}
          </span>
        </div>
        <p className='text-muted-foreground -mt-2 text-xs'>
          This exact revision is attached. Generating a newer one later will not
          change what this message carries.
        </p>

        <div className='flex items-center justify-end gap-2'>
          <Button variant='outline' asChild>
            <a href={`/dashboard/jobs/${jobId}`}>Cancel</a>
          </Button>
          <Button onClick={submit} disabled={pending || !to.trim()}>
            {pending ? 'Creating…' : 'Create draft'}
          </Button>
        </div>
        <p className='text-muted-foreground text-xs'>
          Creating a draft sends nothing. It appears in Communications, where it
          is approved and sent.
        </p>
      </CardContent>
    </Card>
  );
}
