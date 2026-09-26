'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { IconLoader2, IconSend, IconX } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sendAdhocEmailAction } from '../server/actions';
import type { EmailRecipient, EmailTemplate, MergeField } from '../types';

/** Whether a placeholder in this text can be filled by what the sender named. */
function unresolvable(
  text: string,
  fields: MergeField[],
  has: { job: boolean; customer: boolean }
): string[] {
  const used = Array.from(
    text.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g),
    (m) => m[1]
  );
  return Array.from(new Set(used)).filter((key) => {
    const field = fields.find((f) => f.key === key);
    if (!field) return true;
    if (field.needs === 'job') return !has.job;
    // A job supplies its own customer, so either one will do.
    if (field.needs === 'customer') return !has.customer && !has.job;
    return false;
  });
}

export function ComposeEmail({
  templates,
  mergeFields,
  sendingMailbox,
  replyTo,
  canSend,
  manageTemplates
}: {
  templates: EmailTemplate[];
  mergeFields: MergeField[];
  sendingMailbox: string | null;
  replyTo: string | null;
  canSend: boolean;
  /** Rendered beside the template picker, so wording is edited where it is used. */
  manageTemplates?: React.ReactNode;
}) {
  const router = useRouter();
  const [recipients, setRecipients] = useState<EmailRecipient[]>([]);
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [jobId, setJobId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const has = { job: jobId.trim() !== '', customer: customerId.trim() !== '' };
  // Checked here only so the sender finds out while typing. The command
  // refuses on the same grounds, and it is the one that decides.
  const missing = useMemo(
    () => unresolvable(`${subject} ${body}`, mergeFields, has),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, body, mergeFields, has.job, has.customer]
  );

  const addRecipient = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
      return toast.error(`"${raw.trim()}" is not an email address.`);
    if (recipients.some((r) => r.email === value)) return setDraft('');
    setRecipients([...recipients, { email: value }]);
    setDraft('');
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(t.subject);
    setBody(t.body);
  };

  const insertField = (key: string) => {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) return setBody(`${body}${token}`);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    // Put the caret after what was just inserted, not back at the top.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  async function send() {
    if (recipients.length === 0)
      return toast.error('Add at least one recipient.');
    if (!subject.trim() || !body.trim())
      return toast.error('A subject and a message are both needed.');
    if (missing.length > 0)
      return toast.error(
        `Nothing will be sent while ${missing.map((m) => `{{${m}}}`).join(', ')} cannot be filled in.`
      );

    setBusy(true);
    const result = await sendAdhocEmailAction(
      {
        recipients,
        subject: subject.trim(),
        body,
        ...(has.job ? { jobId: jobId.trim() } : {}),
        ...(has.customer ? { customerId: customerId.trim() } : {})
      },
      crypto.randomUUID()
    );
    setBusy(false);
    if (!result.ok) return toast.error(result.outcome.message);

    const r = result.result as {
      status?: string;
      detail?: string;
      delivery?: { sent: number; failed: number; reason?: string };
    };
    if (r.delivery?.sent) {
      toast.success('Sent.');
      setRecipients([]);
      setSubject('');
      setBody('');
      router.push('/dashboard/communications');
      return;
    }
    // Saved but not away. Say why, and keep what was typed: the message exists
    // on the Communications screen and can be queued again.
    toast.warning(
      r.delivery?.reason
        ? `Saved, not sent: ${r.delivery.reason}`
        : r.detail
          ? `Saved, not sent: ${r.detail}`
          : 'Saved. It is on the Communications screen, not yet away.'
    );
    router.refresh();
  }

  return (
    <div className='flex flex-col gap-5'>
      <div className='bg-muted/40 flex flex-col gap-1 rounded-md border px-3 py-2 text-sm'>
        <p>
          <span className='text-muted-foreground'>From</span>{' '}
          {sendingMailbox ? (
            <span className='font-medium'>{sendingMailbox}</span>
          ) : (
            <span className='text-warning font-medium'>
              no sending mailbox is configured
            </span>
          )}
        </p>
        <p className='text-muted-foreground'>
          {replyTo && replyTo !== sendingMailbox
            ? `Replies go to ${replyTo}.`
            : 'Replies come back to that mailbox, not to you.'}
        </p>
      </div>

      {!canSend ? (
        <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
          Sending is switched off (FN-24). You can write and save the message,
          but it will sit on this screen rather than going anywhere.
        </p>
      ) : null}

      <div className='flex flex-col gap-2'>
        <Label htmlFor='to'>To</Label>
        <div className='flex flex-wrap items-center gap-2 rounded-md border p-2'>
          {recipients.map((r) => (
            <span
              key={r.email}
              className='bg-muted flex items-center gap-1 rounded px-2 py-1 text-sm'
            >
              {r.email}
              <button
                type='button'
                aria-label={`Remove ${r.email}`}
                onClick={() =>
                  setRecipients(recipients.filter((x) => x.email !== r.email))
                }
                className='hover:text-destructive'
              >
                <IconX aria-hidden className='size-3.5' />
              </button>
            </span>
          ))}
          <Input
            id='to'
            value={draft}
            placeholder={
              recipients.length ? 'Add another…' : 'name@example.co.uk'
            }
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => addRecipient(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                addRecipient(draft);
              }
            }}
            className='h-8 flex-1 border-0 shadow-none focus-visible:ring-0'
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          Anyone you add here will be emailed for real.
        </p>
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='template'>Start from saved wording</Label>
        <div className='flex flex-wrap items-center gap-2'>
          <select
            id='template'
            defaultValue=''
            onChange={(e) => applyTemplate(e.target.value)}
            disabled={templates.length === 0}
            className='bg-background h-9 min-w-56 rounded-md border px-3 text-sm disabled:opacity-60'
          >
            <option value=''>
              {templates.length === 0 ? 'Nothing saved yet' : 'Write it myself'}
            </option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {manageTemplates}
        </div>
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='subject'>Subject</Label>
        <Input
          id='subject'
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={300}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='body'>Message</Label>
        <Textarea
          id='body'
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={12}
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Label>Fill in from a record</Label>
        <div className='grid gap-2 sm:grid-cols-2'>
          <Input
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            placeholder='Job id (optional)'
          />
          <Input
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            placeholder='Customer id (optional)'
          />
        </div>
        <div className='flex flex-wrap gap-1.5'>
          {mergeFields.map((f) => {
            const blocked = unresolvable(
              `{{${f.key}}}`,
              mergeFields,
              has
            ).length;
            return (
              <button
                key={f.key}
                type='button'
                title={
                  blocked
                    ? `${f.description} Name a ${f.needs} above to use it.`
                    : f.description
                }
                onClick={() => insertField(f.key)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  blocked
                    ? 'text-muted-foreground border-dashed'
                    : 'hover:bg-accent'
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {missing.length > 0 ? (
        <p className='bg-warning-soft text-warning rounded-md px-3 py-2 text-sm'>
          {missing.map((m) => `{{${m}}}`).join(', ')} cannot be filled in from
          what you have named, so nothing will be sent. Name a job or a customer
          above, or take the placeholder out.
        </p>
      ) : null}

      <div className='flex items-center gap-3'>
        <Button onClick={() => void send()} disabled={busy}>
          {busy ? (
            <IconLoader2 aria-hidden className='animate-spin' />
          ) : (
            <IconSend aria-hidden />
          )}
          Send
        </Button>
        <p className='text-muted-foreground text-sm'>
          {canSend
            ? 'There is no draft step: this sends.'
            : 'This will be saved, not sent.'}
        </p>
      </div>
    </div>
  );
}
