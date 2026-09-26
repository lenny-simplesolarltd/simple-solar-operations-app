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
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import {
  IconCalendarClock,
  IconLoader2,
  IconMail,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconSend,
  IconTrash,
  IconX
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  deleteReportSubscriptionAction,
  sendReportAction,
  setReportSubscriptionAction
} from '../server/actions';
import { reportLifecycle, type ReportState } from '../report-status';
import { nextDue } from '../report-period';
import type { ReportRun, ReportSourceKind, ReportSubscription } from '../types';

/**
 * Automated reports for one thing: a programme, or a form.
 *
 * The same screen either way, because the question is the same - what gets
 * sent, how often, and to whom. What differs is only which canonical report is
 * built, and that is decided in the database by the subscription's source.
 *
 * Nothing here can send to anybody the server has not been told to allow.
 * Adding an address to this list is a standing instruction, not permission:
 * outbound.allowed_recipients still decides, and every schedule starts off.
 */

/** A colleague the directory can name, offered under the address box. */
interface Person {
  name: string;
  email: string;
  roles: string[];
}

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

// Tone follows the truthful delivery state, not the run's own optimism.
const STATE_TONE: Record<ReportState, string> = {
  Built: 'bg-muted text-muted-foreground',
  'Ready to send': 'bg-info-soft text-info',
  Queued: 'bg-info-soft text-info',
  Sending: 'bg-info-soft text-info',
  Sent: 'bg-success-soft text-success',
  'Not sent': 'bg-warning-soft text-warning',
  Unconfirmed: 'bg-warning-soft text-warning',
  Failed: 'bg-destructive/10 text-destructive'
};

export function ReportSchedules({
  sourceKind,
  sourceId,
  subscriptions,
  runs,
  canManage,
  previewHrefs
}: {
  sourceKind: ReportSourceKind;
  sourceId: string;
  subscriptions: ReportSubscription[];
  runs: ReportRun[];
  /** programme.manage for a programme, forms.send for a form. */
  canManage: boolean;
  /**
   * Where "Preview" goes, per report type. Omitted when the source has no
   * preview screen.
   *
   * A plain map rather than a function of the type: this is a client
   * component, and both callers are server components, so a function prop
   * cannot cross that boundary - React refuses to serialise it and the page
   * throws before it renders.
   */
  previewHrefs?: { Daily: string; Weekly: string };
}) {
  const [editing, setEditing] = useState<'Daily' | 'Weekly' | null>(null);
  const [deleting, setDeleting] = useState<'Daily' | 'Weekly' | null>(null);
  const router = useRouter();

  const find = (type: 'Daily' | 'Weekly') =>
    subscriptions.find((s) => s.reportType === type);

  return (
    <section
      id='automated-reports'
      aria-labelledby='reports-heading'
      className='flex flex-col gap-3'
    >
      <div>
        <h2 id='reports-heading' className='text-lg font-semibold'>
          Automated reports
        </h2>
        <p className='text-muted-foreground text-sm'>
          Emailed once the period has finished. Nothing is sent until sending is
          switched on for this server and every recipient is allow-listed.
        </p>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        {(['Daily', 'Weekly'] as const).map((type) => {
          const sub = find(type);
          return (
            <div
              key={type}
              className='flex flex-col gap-2 rounded-lg border p-4'
            >
              <div className='flex items-center justify-between gap-2'>
                <h3 className='font-medium'>{type} report</h3>
                <Badge variant={sub?.enabled ? 'default' : 'secondary'}>
                  {sub?.enabled ? 'On' : 'Off'}
                </Badge>
              </div>

              {sub ? (
                <dl className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm'>
                  <dt className='text-muted-foreground'>Sends</dt>
                  <dd>
                    {type === 'Daily'
                      ? `Every day at ${hour(sub.sendHour)}`
                      : `Weekly, ${DAYS[sub.weekStartsOn - 1]} to ${DAYS[(sub.weekStartsOn + 5) % 7]}, at ${hour(sub.sendHour)}`}
                  </dd>
                  <dt className='text-muted-foreground'>Timezone</dt>
                  <dd>{sub.timezone}</dd>
                  <dt className='text-muted-foreground'>To</dt>
                  <dd className='break-words'>
                    {sub.recipients.length === 0 ? (
                      <span className='text-warning font-medium'>
                        Nobody yet — nothing will be sent
                      </span>
                    ) : (
                      sub.recipients
                        .map((r) => r.name?.trim() || r.email)
                        .join(', ')
                    )}
                  </dd>
                  {sub.lastPeriodEnd && (
                    <>
                      <dt className='text-muted-foreground'>Last covered</dt>
                      <dd>{formatDate(sub.lastPeriodEnd)}</dd>
                    </>
                  )}
                  {sub.enabled && (
                    <>
                      <dt className='text-muted-foreground'>Next due</dt>
                      <dd>
                        {nextDue(sub.reportType, sub.sendHour, new Date(), {
                          timeZone: sub.timezone,
                          weekStartsOn: sub.weekStartsOn
                        })}
                      </dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className='text-muted-foreground text-sm'>
                  Not set up. Nothing is sent.
                </p>
              )}

              {canManage && (
                <div className='mt-1 flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setEditing(type)}
                  >
                    {sub ? (
                      <IconCalendarClock aria-hidden />
                    ) : (
                      <IconPlus aria-hidden />
                    )}
                    {sub ? 'Change' : 'Set up'}
                  </Button>
                  {previewHrefs && (
                    <Button size='sm' variant='outline' asChild>
                      <a href={previewHrefs[type]}>Preview</a>
                    </Button>
                  )}
                  {sub && (
                    <>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={async () => {
                          const result = await setReportSubscriptionAction(
                            {
                              sourceKind,
                              sourceId,
                              reportType: type,
                              enabled: !sub.enabled
                            },
                            crypto.randomUUID()
                          );
                          if (!result.ok)
                            return toast.error(result.outcome.message);
                          toast.success(
                            sub.enabled
                              ? `${type} report paused.`
                              : `${type} report switched on.`
                          );
                          router.refresh();
                        }}
                      >
                        {sub.enabled ? (
                          <IconPlayerPause aria-hidden />
                        ) : (
                          <IconPlayerPlay aria-hidden />
                        )}
                        {sub.enabled ? 'Pause' : 'Enable'}
                      </Button>
                      <SendNow
                        sourceKind={sourceKind}
                        sourceId={sourceId}
                        reportType={type}
                        onDone={() => router.refresh()}
                      />
                      <Button
                        size='sm'
                        variant='outline'
                        className='text-destructive'
                        onClick={() => setDeleting(type)}
                      >
                        <IconTrash aria-hidden />
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h3 className='mt-2 text-sm font-semibold'>Recent reports</h3>
      {runs.length === 0 ? (
        <p className='text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm'>
          Nothing has been reported yet.
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {runs.map((run) => (
            <li
              key={run.id}
              className='flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm'
            >
              <span className='min-w-0 flex-1 basis-56'>
                <span className='block font-medium'>
                  {run.reportType} ·{' '}
                  {run.periodStart === run.periodEnd
                    ? formatDate(run.periodStart)
                    : `${formatDate(run.periodStart)} – ${formatDate(run.periodEnd)}`}
                </span>
                <span className='text-muted-foreground block text-xs'>
                  {run.manual ? 'Sent by hand' : 'Scheduled'} ·{' '}
                  {formatDate(run.createdAt)}
                  {/* run.detail records what happened when the report was
                      BUILT. Once it has moved on, saying "queued for the
                      email worker; nothing sent yet" beside a Sent badge
                      contradicts it, so the lifecycle has the last word. */}
                  {run.detail &&
                    reportLifecycle(run).state !== 'Sent' &&
                    ` · ${run.detail}`}
                </span>
              </span>
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-xs font-medium',
                  STATE_TONE[reportLifecycle(run).state]
                )}
              >
                {reportLifecycle(run).state}
              </span>
              <span className='text-muted-foreground w-full text-xs sm:w-auto'>
                {reportLifecycle(run).detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      {deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Delete the {deleting.toLowerCase()} report?
              </DialogTitle>
              <DialogDescription>
                It stops being sent. The reports already made stay in the
                history below — what was reported, and to whom, is a record of
                something that happened.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant='outline' onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={async () => {
                  const result = await deleteReportSubscriptionAction(
                    { sourceKind, sourceId, reportType: deleting },
                    crypto.randomUUID()
                  );
                  setDeleting(null);
                  if (!result.ok) return toast.error(result.outcome.message);
                  toast.success(`${deleting} report deleted.`);
                  router.refresh();
                }}
              >
                Delete it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {editing && (
        <ScheduleDialog
          sourceKind={sourceKind}
          sourceId={sourceId}
          reportType={editing}
          existing={find(editing)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/**
 * Builds, queues and sends the last closed period, through the canonical path.
 *
 * A period that already went is a refusal, not a dead end: the database says
 * so, and the person who pressed the button is offered the one thing they
 * actually wanted - send it again. Forcing is never automatic. It costs a
 * second, deliberate press, because the only thing standing between a client
 * and two copies of Monday's figures is that press.
 */
function SendNow({
  sourceKind,
  sourceId,
  reportType,
  onDone
}: {
  sourceKind: ReportSourceKind;
  sourceId: string;
  reportType: 'Daily' | 'Weekly';
  onDone(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmResend, setConfirmResend] = useState(false);

  type SendResult = {
    status?: string;
    already_reported?: boolean;
    delivered?: boolean;
    can_force?: boolean;
    resent?: boolean;
    detail?: string;
    delivery?: { sent: number; failed: number; reason?: string };
  };

  async function send(force: boolean) {
    setBusy(true);
    const result = await sendReportAction(
      { sourceKind, sourceId, reportType, ...(force ? { force: true } : {}) },
      crypto.randomUUID()
    );
    setBusy(false);
    if (!result.ok) {
      toast.error(result.outcome.message);
      return;
    }
    const r = result.result as SendResult;

    if (r.already_reported) {
      // Offer the way out rather than only naming the wall. Without can_force
      // the server would refuse a second time, so do not promise otherwise.
      if (r.can_force) {
        setConfirmResend(true);
        return;
      }
      toast.success(
        r.delivered
          ? 'That period has already been sent. Nothing was sent again.'
          : 'That period is already on its way. Nothing was sent again.'
      );
    } else if (r.status === 'Refused') {
      // The gate, or the missing recipients, in the words the database used.
      toast.error(
        r.detail
          ? `Not sent: ${r.detail}`
          : 'The report was built, but nothing was queued.'
      );
    } else if (r.delivery?.sent) {
      toast.success(r.resent ? 'Sent again.' : 'Sent.');
    } else {
      // Queued but not away: say why, rather than leaving it looking sent.
      toast.warning(
        r.delivery?.reason
          ? `Queued, not sent: ${r.delivery.reason}`
          : 'Queued. It will go with the next scheduled send.'
      );
    }
    onDone();
  }

  return (
    <>
      <Button
        size='sm'
        variant='outline'
        disabled={busy}
        onClick={() => void send(false)}
      >
        {busy ? (
          <IconLoader2 aria-hidden className='animate-spin' />
        ) : (
          <IconSend aria-hidden />
        )}
        Send now
      </Button>
      <AlertDialog open={confirmResend} onOpenChange={setConfirmResend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this period again?</AlertDialogTitle>
            <AlertDialogDescription>
              The {reportType.toLowerCase()} report for that period has already
              gone to its recipients. Sending again delivers a second copy of
              the same figures, marked “(re-sent)” in the subject. The schedule
              itself never repeats a period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Leave it</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                // The dialog closes itself on action; keep it open while the
                // send runs so the spinner has somewhere to live.
                event.preventDefault();
                void send(true).then(() => setConfirmResend(false));
              }}
            >
              {busy ? (
                <IconLoader2 aria-hidden className='animate-spin' />
              ) : (
                <IconSend aria-hidden />
              )}
              Send it again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ScheduleDialog({
  sourceKind,
  sourceId,
  reportType,
  existing,
  onClose,
  onSaved
}: {
  sourceKind: ReportSourceKind;
  sourceId: string;
  reportType: 'Daily' | 'Weekly';
  existing?: ReportSubscription;
  onClose(): void;
  onSaved(): void;
}) {
  const [enabled, setEnabled] = useState(existing?.enabled ?? false);
  const [sendHour, setSendHour] = useState(existing?.sendHour ?? 7);
  const [weekStartsOn, setWeekStartsOn] = useState(existing?.weekStartsOn ?? 1);
  const [recipients, setRecipients] = useState(existing?.recipients ?? []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Colleagues whose address the directory already knows. Typing one from
  // memory is how a report goes to nobody: one wrong character is accepted,
  // sent, and never arrives.
  const [staff, setStaff] = useState<Person[]>([]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void fetch(`/api/reports/people?q=${encodeURIComponent(draft.trim())}`)
        .then((r) => r.json())
        .then((body) => live && setStaff(body?.people ?? []))
        // No suggestions is a perfectly good state: the box still takes any
        // address, so a failed lookup must not block adding one.
        .catch(() => live && setStaff([]));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft]);

  const add = (email: string, name: string | null = null) => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean))
      return setProblem(`"${email.trim()}" is not an email address.`);
    if (recipients.some((r) => r.email === clean))
      return setProblem('That address is already on the list.');
    setProblem(null);
    setRecipients((current) => [...current, { name, email: clean }]);
    setDraft('');
  };

  const addRecipient = () => add(draft);

  const chosen = new Set(recipients.map((r) => r.email));
  const suggestions = staff.filter((p) => !chosen.has(p.email)).slice(0, 6);

  const save = async () => {
    setProblem(null);
    setBusy(true);
    const result = await setReportSubscriptionAction(
      {
        sourceKind,
        sourceId,
        reportType,
        enabled,
        sendHour,
        weekStartsOn,
        recipients
      },
      crypto.randomUUID()
    );
    setBusy(false);
    if (!result.ok) return setProblem(result.outcome.message);
    toast.success(
      enabled
        ? `${reportType} report is on.`
        : `${reportType} report saved, and left off.`
    );
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reportType} report</DialogTitle>
          <DialogDescription>
            Sent once the period has finished, in UK time. Adding somebody here
            is an instruction, not permission — the server still decides whether
            it may email them.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className='accent-foreground size-4'
            />
            Send this report automatically
          </label>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='send-hour'>Send at (UK time)</Label>
              <select
                id='send-hour'
                value={sendHour}
                onChange={(e) => setSendHour(Number(e.target.value))}
                className='border-input bg-background h-9 rounded-md border px-3 text-sm'
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {hour(h)}
                  </option>
                ))}
              </select>
            </div>
            {reportType === 'Weekly' && (
              <div className='flex flex-col gap-1.5'>
                <Label htmlFor='week-start'>Week starts on</Label>
                <select
                  id='week-start'
                  value={weekStartsOn}
                  onChange={(e) => setWeekStartsOn(Number(e.target.value))}
                  className='border-input bg-background h-9 rounded-md border px-3 text-sm'
                >
                  {DAYS.map((day, i) => (
                    <option key={day} value={i + 1}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='recipient'>Send to</Label>
            <div className='flex gap-2'>
              <Input
                id='recipient'
                type='email'
                placeholder='name@example.com'
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addRecipient();
                  }
                }}
              />
              <Button type='button' variant='outline' onClick={addRecipient}>
                Add
              </Button>
            </div>
            {suggestions.length > 0 && (
              <ul className='flex flex-wrap gap-1.5'>
                {suggestions.map((p) => (
                  <li key={p.email}>
                    <button
                      type='button'
                      onClick={() => add(p.email, p.name)}
                      className='hover:bg-accent flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs'
                    >
                      <IconPlus aria-hidden className='size-3' />
                      <span className='font-medium'>{p.name}</span>
                      <span className='text-muted-foreground'>{p.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {recipients.length > 0 && (
              <ul className='flex flex-wrap gap-1.5'>
                {recipients.map((r) => (
                  <li
                    key={r.email}
                    className='bg-muted flex items-center gap-1.5 rounded-md px-2 py-1 text-xs'
                  >
                    <IconMail aria-hidden className='size-3.5' />
                    {r.name?.trim() || r.email}
                    <button
                      type='button'
                      onClick={() =>
                        setRecipients((c) =>
                          c.filter((x) => x.email !== r.email)
                        )
                      }
                      className='hover:text-foreground'
                    >
                      <IconX aria-hidden className='size-3.5' />
                      <span className='sr-only'>Remove {r.email}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {problem && (
            <p role='alert' className='text-destructive text-sm'>
              {problem}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
          <Button type='button' disabled={busy} onClick={() => void save()}>
            {busy && <IconLoader2 aria-hidden className='animate-spin' />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
