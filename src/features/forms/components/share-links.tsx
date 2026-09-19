'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDate } from '@/lib/format';
import {
  IconCheck,
  IconCopy,
  IconLink,
  IconLoader2
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  createInvitationAction,
  invitationLinkAction,
  listSurveyorsAction,
  revokeInvitationAction,
  searchJobsAction
} from '../server/actions';
import {
  RECIPIENT_LABEL,
  type InvitationSummary,
  type RecipientType
} from '../types';
import { LinkStatusBadge } from './badges';

/**
 * Recipient links for one published form. There is no email or SMS sender
 * yet, so a link is created, copied and shared by the staff member - the
 * screen never claims a message was delivered.
 */
export function ShareLinks({
  formId,
  formStatus,
  revision,
  links,
  canSend,
  canReadResponses,
  defaultJob
}: {
  formId: string;
  formStatus: string;
  revision: number;
  links: InvitationSummary[];
  canSend: boolean;
  canReadResponses: boolean;
  defaultJob?: { id: string; jobRef: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [revoking, setRevoking] = useState<InvitationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <section
      id='links'
      aria-labelledby='links-heading'
      className='flex flex-col gap-3'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <h2 id='links-heading' className='text-lg font-semibold'>
            Recipient links
          </h2>
          <p className='text-muted-foreground text-sm'>
            Each link is for one recipient and keeps the version it was created
            with.
          </p>
        </div>
        {canSend && (
          <Button
            onClick={() => setOpen(true)}
            disabled={formStatus !== 'published'}
          >
            <IconLink aria-hidden />
            Create link{revision > 0 ? ` (v${revision})` : ''}
          </Button>
        )}
      </div>
      {formStatus !== 'published' && (
        <p className='text-muted-foreground text-sm'>
          {formStatus === 'draft'
            ? 'Publish the form to create links.'
            : 'This form is not accepting responses, so new links cannot be created.'}
        </p>
      )}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {links.length === 0 ? (
        <p className='text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm'>
          No links yet.
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {links.map((l) => (
            <li
              key={l.id}
              className='flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3'
            >
              <span className='min-w-0 flex-1 basis-56'>
                <span className='block truncate text-sm font-medium'>
                  {RECIPIENT_LABEL[l.recipientType]}: {l.recipientName}
                </span>
                <span className='text-muted-foreground block text-xs'>
                  v{l.revision}
                  {l.jobRef && ` · ${l.jobRef}`} · created{' '}
                  {formatDate(l.createdAt)}
                  {l.expiresAt && ` · expires ${formatDate(l.expiresAt)}`}
                </span>
              </span>
              <LinkStatusBadge status={l.status} />
              <div className='flex items-center gap-1'>
                {l.status === 'ready' && canSend && (
                  <CopyLinkButton invitationId={l.id} />
                )}
                {l.submissionId && canReadResponses && (
                  <Button asChild size='sm' variant='outline'>
                    <Link href={`/dashboard/forms/responses/${l.submissionId}`}>
                      View response
                    </Link>
                  </Button>
                )}
                {l.status === 'ready' && canSend && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-destructive'
                    onClick={() => setRevoking(l)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <CreateLinkDialog
          formId={formId}
          revision={revision}
          defaultJob={defaultJob ?? null}
          onClose={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      )}
      <AlertDialog
        open={revoking !== null}
        onOpenChange={(o) => !o && setRevoking(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this link?</AlertDialogTitle>
            <AlertDialogDescription>
              {revoking &&
                `${RECIPIENT_LABEL[revoking.recipientType]}: ${revoking.recipientName}. `}
              The link stops working immediately. You can create a new one
              afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={async () => {
                if (!revoking) return;
                const result = await revokeInvitationAction(
                  revoking.id,
                  null,
                  crypto.randomUUID()
                );
                setRevoking(null);
                if (!result.ok) setError(result.message);
                router.refresh();
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Fetches the link only when asked, so it never sits in the page. */
export function CopyLinkButton({
  invitationId,
  label = 'Copy link'
}: {
  invitationId: string;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'copied' | 'error'>(
    'idle'
  );
  return (
    <Button
      size='sm'
      variant='outline'
      disabled={state === 'busy'}
      onClick={async () => {
        setState('busy');
        const result = await invitationLinkAction(invitationId);
        if (!result.ok) return setState('error');
        try {
          await navigator.clipboard.writeText(result.result.url);
          setState('copied');
        } catch {
          window.prompt('Copy this link:', result.result.url);
          setState('idle');
        }
      }}
    >
      {state === 'copied' ? (
        <IconCheck aria-hidden />
      ) : (
        <IconCopy aria-hidden />
      )}
      {state === 'copied'
        ? 'Copied'
        : state === 'error'
          ? 'Could not copy'
          : label}
    </Button>
  );
}

const EXPIRY = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: 'none', label: 'No expiry' }
];

function CreateLinkDialog({
  formId,
  revision,
  defaultJob,
  onClose
}: {
  formId: string;
  revision: number;
  defaultJob: { id: string; jobRef: string } | null;
  onClose(): void;
}) {
  const [commandId] = useState(() => crypto.randomUUID());
  const [type, setType] = useState<RecipientType>('customer');
  const [job, setJob] = useState<{
    id: string;
    jobRef: string;
    customerName?: string;
  } | null>(defaultJob);
  const [jobQuery, setJobQuery] = useState('');
  const [jobs, setJobs] = useState<
    { id: string; jobRef: string; customerName: string }[]
  >([]);
  const [surveyors, setSurveyors] = useState<{ id: string; name: string }[]>(
    []
  );
  const [surveyorId, setSurveyorId] = useState('');
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    url: string | null;
    id: string;
  } | null>(null);

  useEffect(() => {
    if (type === 'surveyor' && surveyors.length === 0)
      void listSurveyorsAction().then(setSurveyors);
  }, [type, surveyors.length]);
  useEffect(() => {
    const t = setTimeout(
      () => void searchJobsAction(jobQuery).then(setJobs),
      250
    );
    return () => clearTimeout(t);
  }, [jobQuery]);

  const submit = async () => {
    setError(null);
    setBusy(true);
    const result = await createInvitationAction(
      {
        formId,
        recipientType: type,
        jobId: job?.id ?? null,
        personId: type === 'surveyor' ? surveyorId || null : null,
        recipientLabel: type === 'other' ? label.trim() || null : null,
        expiresAt:
          expiry === 'none'
            ? null
            : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString()
      },
      commandId
    );
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setCreated({
      url: 'url' in result ? result.url : null,
      id: result.result.invitation_id
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {created
              ? 'Link ready to send'
              : `Create a link for version ${revision}`}
          </DialogTitle>
          <DialogDescription>
            {created
              ? 'Simple Solar does not send email or SMS from here yet. Copy the link and send it to the recipient yourself.'
              : 'Only someone with this link can open the form. It works once: after they submit, it closes.'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <div className='flex flex-col gap-3'>
            {created.url ? (
              <div className='flex gap-2'>
                <Input
                  readOnly
                  value={created.url}
                  aria-label='Recipient link'
                  onFocus={(e) => e.target.select()}
                />
                <CopyLinkButton invitationId={created.id} label='Copy' />
              </div>
            ) : (
              <p className='text-sm'>
                The link was created. Copy it from the list.
              </p>
            )}
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className='flex flex-col gap-4'
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset className='flex flex-col gap-2'>
              <legend className='mb-1 text-sm font-medium'>
                Who is it for?
              </legend>
              <div className='flex flex-wrap gap-2'>
                {(['customer', 'surveyor', 'other'] as const).map((t) => (
                  <label
                    key={t}
                    className='has-[:checked]:border-foreground has-[:checked]:bg-foreground has-[:checked]:text-background has-[:focus-visible]:ring-ring/50 flex h-9 cursor-pointer items-center rounded-md border px-3 text-sm has-[:focus-visible]:ring-[3px]'
                  >
                    <input
                      type='radio'
                      name='recipient'
                      className='sr-only'
                      checked={type === t}
                      onChange={() => setType(t)}
                    />
                    {RECIPIENT_LABEL[t]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className='flex flex-col gap-2'>
              <Label htmlFor='link-job'>
                Job{' '}
                {type === 'customer'
                  ? '(the customer on this job)'
                  : '(optional)'}
              </Label>
              {job ? (
                <div className='flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'>
                  <span>
                    <span className='font-mono font-medium'>{job.jobRef}</span>
                    {job.customerName && (
                      <span className='text-muted-foreground'>
                        {' '}
                        · {job.customerName}
                      </span>
                    )}
                  </span>
                  <Button
                    type='button'
                    size='sm'
                    variant='ghost'
                    onClick={() => setJob(null)}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    id='link-job'
                    placeholder='Search by job reference'
                    value={jobQuery}
                    onChange={(e) => setJobQuery(e.target.value)}
                  />
                  <ul className='max-h-40 overflow-y-auto rounded-md border'>
                    {jobs.map((j) => (
                      <li key={j.id}>
                        <button
                          type='button'
                          onClick={() => setJob(j)}
                          className='hover:bg-accent focus-visible:bg-accent w-full px-3 py-2 text-left text-sm outline-none'
                        >
                          <span className='font-mono'>{j.jobRef}</span>
                          <span className='text-muted-foreground'>
                            {' '}
                            · {j.customerName}
                          </span>
                        </button>
                      </li>
                    ))}
                    {jobs.length === 0 && (
                      <li className='text-muted-foreground px-3 py-2 text-sm'>
                        No matching jobs.
                      </li>
                    )}
                  </ul>
                </>
              )}
            </div>

            {type === 'surveyor' && (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='link-surveyor'>Surveyor</Label>
                <select
                  id='link-surveyor'
                  value={surveyorId}
                  onChange={(e) => setSurveyorId(e.target.value)}
                  className='border-input bg-background h-9 rounded-md border px-3 text-sm'
                >
                  <option value=''>Choose a surveyor…</option>
                  {surveyors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {type === 'other' && (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='link-label'>Recipient name</Label>
                <Input
                  id='link-label'
                  maxLength={200}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
            )}
            <div className='flex flex-col gap-2'>
              <Label htmlFor='link-expiry'>Link expires after</Label>
              <select
                id='link-expiry'
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                className='border-input bg-background h-9 rounded-md border px-3 text-sm'
              >
                {EXPIRY.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {error && (
              <p role='alert' className='text-destructive text-sm'>
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type='button' variant='outline' onClick={onClose}>
                Cancel
              </Button>
              <Button type='submit' disabled={busy}>
                {busy && <IconLoader2 aria-hidden className='animate-spin' />}
                Create link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
