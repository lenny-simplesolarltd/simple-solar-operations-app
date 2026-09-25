'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { IconAlertTriangle, IconLoader2 } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  DISPOSITION_HINT,
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  propertyAddress,
  reviewReason,
  signalBandsSentence
} from '../labels';
import { reviewVisitAction } from '../server/actions';
import {
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  type Disposition,
  type PortalVerification,
  type ProgrammeVisit,
  type SignalConfig,
  type VisitEvidence
} from '../types';
import { OutcomeBadge, PortalBadge, SerialMatch, SignalBadge } from './badges';
import { EvidenceStrip } from './photo-field';

/**
 * The office review of one visit.
 *
 * Everything the reviewer has to weigh is on the screen at once - the property
 * and its expected serial, what the installer found, the mismatch warning, the
 * CSQ and its band, and every photograph - because the decision is a comparison
 * and a reviewer should not have to remember half of it.
 *
 * Two rules the screen makes visible rather than merely obeying:
 *
 *   * the portal check is a SEPARATE question from the CSQ. A good signal is
 *     shown as a good signal and nothing more.
 *   * "Complete & working" cannot be chosen until "Confirmed live/reporting" has
 *     been chosen. The button is disabled to say so early; the command refuses it
 *     and the table constraint makes it impossible, so the disabled button is a
 *     courtesy, not the control.
 */
export function ReviewPanel({
  visit,
  evidence,
  signalConfig,
  canReview
}: {
  visit: ProgrammeVisit;
  evidence: VisitEvidence[];
  signalConfig: SignalConfig;
  canReview: boolean;
}) {
  const router = useRouter();
  const [portal, setPortal] = useState<PortalVerification | null>(
    visit.portalVerification
  );
  const [disposition, setDisposition] = useState<Disposition | null>(
    visit.reviewStatus === 'AwaitingReview'
      ? visit.recommendedDisposition
      : visit.disposition
  );
  const [note, setNote] = useState(visit.actionNote ?? '');
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  const completeBlocked = portal !== 'ConfirmedLive';

  function save(target: Disposition, reopen = false) {
    setProblem(null);
    startTransition(async () => {
      const response = await reviewVisitAction(
        {
          visitId: visit.id,
          programmeId: visit.programmeId,
          disposition: target,
          portalVerification: portal,
          actionNote: note,
          reopen,
          expectedVersion: visit.version
        },
        commandId
      );
      if (response.ok) {
        setCommandId(crypto.randomUUID());
        toast.success(response.outcome.message);
        router.refresh();
      } else {
        setProblem(response.outcome.message);
      }
    });
  }

  return (
    <div className='flex flex-col gap-6'>
      <section className='grid gap-4 lg:grid-cols-2'>
        <div className='flex flex-col gap-3 rounded-lg border p-4'>
          {/* The client's record of what is there, and the installer's record of
              what was found, are two different claims about the world. They are
              kept apart so a reviewer is never reading one for the other. */}
          <h3 className='text-sm font-semibold tracking-wide uppercase'>
            Property · what PCH gave us
          </h3>
          <dl className='grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm'>
            <dt className='text-muted-foreground'>Address</dt>
            <dd className='font-medium'>{propertyAddress(visit.property)}</dd>
            {visit.property.externalRef && (
              <>
                <dt className='text-muted-foreground'>PCH property ID</dt>
                <dd className='font-medium tabular-nums'>
                  {visit.property.externalRef}
                </dd>
              </>
            )}
            <dt className='text-muted-foreground'>Expected meter serial</dt>
            <dd className='font-medium'>
              {visit.property.expectedMeterSerial ?? 'Not recorded'}
            </dd>
            <dt className='text-muted-foreground'>Existing SIM type</dt>
            <dd className='font-medium'>
              {visit.property.existingSimType ?? 'Not recorded'}
            </dd>
            <dt className='text-muted-foreground'>Existing SIM ICCID</dt>
            <dd className='font-medium break-all'>
              {visit.property.existingSimSerial ?? 'Not recorded'}
            </dd>
          </dl>
          <h3 className='mt-2 text-sm font-semibold tracking-wide uppercase'>
            What the installer found
          </h3>
          <dl className='grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm'>
            <dt className='text-muted-foreground'>Actual meter serial</dt>
            <dd className='font-medium'>
              {visit.actualMeterSerial ?? 'Not recorded'}
            </dd>
            <dt className='text-muted-foreground'>Meter reading</dt>
            <dd className='font-medium tabular-nums'>
              {visit.meterReading ?? 'Not recorded'}
            </dd>
          </dl>
          {/* The canonical comparison, derived server-side. Not repeated here. */}
          <SerialMatch
            matches={visit.meterSerialMatches}
            expected={visit.property.expectedMeterSerial}
            actual={visit.actualMeterSerial}
          />
        </div>

        <div className='flex flex-col gap-3 rounded-lg border p-4'>
          <h3 className='text-sm font-semibold tracking-wide uppercase'>
            The visit
          </h3>
          <dl className='grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm'>
            <dt className='text-muted-foreground'>Installer</dt>
            <dd className='font-medium'>{visit.installerName ?? 'Unknown'}</dd>
            <dt className='text-muted-foreground'>Date</dt>
            <dd className='font-medium tabular-nums'>
              {visit.visitDate ?? '—'}
            </dd>
            <dt className='text-muted-foreground'>Outcome</dt>
            <dd>
              {visit.outcome ? (
                OUTCOME_LABEL[visit.outcome]
              ) : (
                <OutcomeBadge outcome={null} />
              )}
            </dd>
            <dt className='text-muted-foreground'>New SIM serial</dt>
            <dd className='font-medium break-all'>
              {visit.newSimSerial ?? '—'}
            </dd>
            <dt className='text-muted-foreground'>CSQ</dt>
            <dd>
              <SignalBadge
                signal={visit.signalClassification}
                csq={visit.csq}
              />
            </dd>
          </dl>
          <p className='text-muted-foreground text-xs'>
            {signalBandsSentence(signalConfig)}
            {signalConfig.boundary_unresolved && (
              <span className='text-warning block font-medium'>
                The bad/advisory boundary is not yet confirmed with the client.
              </span>
            )}
          </p>
          {visit.installerComments && (
            <div>
              <p className='text-muted-foreground text-xs font-medium'>
                Installer comments
              </p>
              <p className='text-sm whitespace-pre-wrap'>
                {visit.installerComments}
              </p>
            </div>
          )}
        </div>
      </section>

      {visit.reviewReasons.length > 0 && (
        <section className='bg-info-soft rounded-lg p-4'>
          <h3 className='text-info flex items-center gap-2 text-sm font-semibold'>
            <IconAlertTriangle aria-hidden className='size-4' />
            Why this needs a look
          </h3>
          <ul className='mt-2 list-inside list-disc text-sm'>
            {visit.reviewReasons.map((code) => (
              <li key={code}>{reviewReason(code)}</li>
            ))}
          </ul>
        </section>
      )}

      <section className='flex flex-col gap-3'>
        <h3 className='text-sm font-semibold tracking-wide uppercase'>
          Evidence
        </h3>
        <EvidenceStrip evidence={evidence} />
      </section>

      {!canReview ? (
        <p className='text-muted-foreground text-sm'>
          You can see this visit but not review it.
        </p>
      ) : (
        <section className='flex flex-col gap-5 rounded-lg border p-4'>
          <div className='flex flex-col gap-2'>
            <h3 className='text-sm font-semibold tracking-wide uppercase'>
              1. Portal verification
            </h3>
            {visit.portalCheckRequired ? (
              <>
                <p className='text-muted-foreground text-sm'>
                  Check the PCH portal yourself. A good CSQ does not mean the
                  meter has gone live.
                </p>
                <div className='flex flex-wrap gap-2'>
                  {PORTAL_VERIFICATIONS.map((v) => (
                    <label
                      key={v}
                      className={cn(
                        'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm',
                        portal === v &&
                          'border-foreground bg-accent font-medium'
                      )}
                    >
                      <input
                        type='radio'
                        name='portal'
                        className='accent-foreground size-4'
                        checked={portal === v}
                        onChange={() => setPortal(v)}
                      />
                      {PORTAL_LABEL[v]}
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <p className='text-muted-foreground text-sm'>
                No SIM was changed at this visit, so there is nothing to check
                in the portal.
              </p>
            )}
          </div>

          <div className='flex flex-col gap-2'>
            <h3 className='text-sm font-semibold tracking-wide uppercase'>
              2. Final disposition
            </h3>
            {visit.recommendedDisposition &&
              visit.reviewStatus === 'AwaitingReview' && (
                <p className='text-muted-foreground text-sm'>
                  Recommended from what the installer recorded:{' '}
                  <span className='text-foreground font-medium'>
                    {DISPOSITION_LABEL[visit.recommendedDisposition]}
                  </span>
                  .
                </p>
              )}
            <div className='flex flex-col gap-2'>
              {DISPOSITIONS.filter((d) => d !== 'AwaitingReview').map((d) => {
                const blocked = d === 'CompleteAndWorking' && completeBlocked;
                return (
                  <label
                    key={d}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm',
                      disposition === d && 'border-foreground bg-accent',
                      blocked && 'cursor-not-allowed opacity-60'
                    )}
                  >
                    <input
                      type='radio'
                      name='disposition'
                      className='accent-foreground mt-0.5 size-4'
                      checked={disposition === d}
                      disabled={blocked}
                      onChange={() => setDisposition(d)}
                    />
                    <span>
                      <span className='font-medium'>
                        {DISPOSITION_LABEL[d]}
                      </span>
                      <span className='text-muted-foreground block text-xs'>
                        {blocked
                          ? 'Confirm the meter is live/reporting in the portal first.'
                          : DISPOSITION_HINT[d]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='action-note'>Office note (optional)</Label>
            <Textarea
              id='action-note'
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder='What needs doing, or what you checked.'
            />
          </div>

          {problem && (
            <p
              role='alert'
              className='bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm font-medium'
            >
              {problem}
            </p>
          )}

          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              disabled={!disposition || pending}
              onClick={() => disposition && save(disposition)}
            >
              {pending && <IconLoader2 aria-hidden className='animate-spin' />}
              Record review
            </Button>
            {visit.reviewStatus === 'Reviewed' && (
              <Button
                type='button'
                variant='outline'
                disabled={pending}
                onClick={() => save('AwaitingReview', true)}
              >
                Reopen for review
              </Button>
            )}
          </div>
          {visit.reviewedAt && (
            <p className='text-muted-foreground text-xs'>
              Last reviewed by {visit.reviewedByName ?? 'someone'} on{' '}
              {new Date(visit.reviewedAt).toLocaleString('en-GB')}. Every change
              is recorded in the audit trail.
            </p>
          )}
        </section>
      )}

      <p className='text-muted-foreground text-xs'>
        Current status: {DISPOSITION_LABEL[visit.disposition]} ·{' '}
        <PortalBadge
          verification={visit.portalVerification}
          required={visit.portalCheckRequired}
        />
      </p>
    </div>
  );
}
