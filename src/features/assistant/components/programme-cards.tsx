'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime } from '@/features/jobs/format';
import { DISPOSITION_LABEL, PORTAL_LABEL } from '@/features/programmes/labels';
import type {
  ProgrammeCandidate,
  ProgrammePropertyCardData,
  ProgrammeSummaryCardData,
  ProgrammeVisitCardData
} from '../protocol';

// Programme results in the drawer. SimpleBot orchestrates; the programme
// screens remain where the work is done, so these cards only show what the
// programme tools already read under this person's own access.
//
// Two rules shape every row below. Nothing prints a canonical id: staff say
// "24 King Street" and the client's property reference to each other, and a
// UUID in a sentence is noise somebody would have to copy by hand. And nothing
// is invented to fill a gap - a field the tool did not return is left out,
// because "not recorded" and "no" are different answers and blurring them is
// how a card starts lying.
//
// The layout is built for a phone held one-handed on a doorstep: every row
// wraps, nothing sets a width, and the only minimum is min-w-0 so long
// addresses truncate rather than pushing the card sideways.

/** The state badge takes its colour from what the state means for the office. */
function StateBadge({ state }: { state: string }) {
  // Compared against the module's own labels rather than retyped strings, so a
  // reworded state keeps its colour instead of quietly going grey.
  const variant =
    state === DISPOSITION_LABEL.CompleteAndWorking
      ? 'success'
      : state === DISPOSITION_LABEL.ActionRequired
        ? 'danger'
        : state === DISPOSITION_LABEL.AwaitingReview
          ? 'warning'
          : 'secondary';
  return <Badge variant={variant}>{state}</Badge>;
}

/** Address, then the identifiers staff quote. Wraps rather than overflowing. */
function Where({
  reference,
  postcode
}: {
  reference: string;
  postcode: string | null;
}) {
  return (
    <p className='text-muted-foreground text-xs'>
      {reference}
      {postcode && ` · ${postcode}`}
    </p>
  );
}

export function ProgrammeSummaryBody({
  programme
}: {
  programme: ProgrammeSummaryCardData;
}) {
  // Percentages are only honest against something agreed. With no target, the
  // card says the counts and stops - it does not quietly measure progress
  // against however many properties happen to have been imported so far.
  const progress =
    programme.target && programme.target > 0
      ? Math.round((programme.completedAndLive / programme.target) * 100)
      : null;
  return (
    <div className='flex flex-col gap-2 px-3 py-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>
          {programme.name}
        </span>
        <Badge variant='secondary'>{programme.status}</Badge>
        {programme.testData && <Badge variant='warning'>Test data</Badge>}
      </div>
      <p className='text-muted-foreground text-xs'>
        {programme.code}
        {programme.client && ` · ${programme.client}`}
      </p>
      {progress !== null && (
        <p className='text-sm'>
          {progress}% of target
          <span className='text-muted-foreground'>
            {' '}
            · {programme.completedAndLive} of {programme.target} complete and
            live
          </span>
        </p>
      )}
      <dl className='grid grid-cols-2 gap-x-4 gap-y-1 text-xs'>
        <div className='contents'>
          <dt className='text-muted-foreground'>Attended</dt>
          <dd className='text-right font-medium'>{programme.attended}</dd>
        </div>
        <div className='contents'>
          <dt className='text-muted-foreground'>Remaining</dt>
          <dd className='text-right font-medium'>{programme.remaining}</dd>
        </div>
        <div className='contents'>
          <dt className='text-muted-foreground'>Complete &amp; live</dt>
          <dd className='text-right font-medium'>
            {programme.completedAndLive}
          </dd>
        </div>
        {programme.target !== null && (
          <div className='contents'>
            <dt className='text-muted-foreground'>Target</dt>
            <dd className='text-right font-medium'>{programme.target}</dd>
          </div>
        )}
        {programme.runRate !== null && (
          <div className='contents'>
            <dt className='text-muted-foreground'>Run rate</dt>
            <dd className='text-right font-medium'>
              {programme.runRate} a day
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function ProgrammePropertyBody({
  property
}: {
  property: ProgrammePropertyCardData;
}) {
  return (
    <div className='flex flex-col gap-1.5 px-3 py-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>
          {property.address}
        </span>
        {property.state ? (
          <StateBadge state={property.state} />
        ) : (
          <Badge variant='secondary'>
            {property.visited ? 'Visited' : 'Not visited yet'}
          </Badge>
        )}
      </div>
      <Where reference={property.reference} postcode={property.postcode} />
      {/* PCH's record of the site, named as theirs. Omitted entirely rather
          than shown blank when the register did not carry it. */}
      {(property.expectedMeterSerial ||
        property.existingSimType ||
        property.existingSimSerial) && (
        <p className='text-muted-foreground text-xs'>
          PCH baseline:{' '}
          {[
            property.expectedMeterSerial &&
              `meter ${property.expectedMeterSerial}`,
            property.existingSimType && `SIM ${property.existingSimType}`,
            property.existingSimSerial && `ICCID ${property.existingSimSerial}`
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {property.state && (
        <p className='text-muted-foreground text-xs'>
          {property.visited ? 'Visited' : 'Not visited yet'}
        </p>
      )}
    </div>
  );
}

export function ProgrammeVisitBody({
  visit
}: {
  visit: ProgrammeVisitCardData;
}) {
  return (
    <div className='flex flex-col gap-1.5 px-3 py-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-sm font-semibold'>
          {visit.address}
        </span>
        <StateBadge state={visit.disposition} />
      </div>
      <Where reference={visit.reference} postcode={visit.postcode} />
      <p className='text-muted-foreground flex flex-wrap gap-x-2 text-xs'>
        {visit.installer && <span>{visit.installer}</span>}
        {visit.visitDate && <span>· {formatDate(visit.visitDate)}</span>}
        {visit.submittedAt && (
          <span>· submitted {formatDateTime(visit.submittedAt)}</span>
        )}
      </p>
      <div className='flex flex-wrap gap-1.5'>
        {visit.outcome && <Badge variant='secondary'>{visit.outcome}</Badge>}
        {visit.portalVerification && (
          <Badge
            variant={
              visit.portalVerification === PORTAL_LABEL.ConfirmedLive
                ? 'success'
                : 'secondary'
            }
          >
            Portal: {visit.portalVerification}
          </Badge>
        )}
        {visit.csq !== null && (
          <Badge variant='secondary'>
            CSQ {visit.csq}
            {visit.csqBand && ` · ${visit.csqBand}`}
          </Badge>
        )}
      </div>
      {/* The single most common reason a visit needs a person: the meter on
          site was not the one the client's list said would be there. */}
      {visit.serialMismatch && (
        <p className='text-destructive text-xs'>
          The meter serial recorded is not the one expected here.
        </p>
      )}
    </div>
  );
}

export function ProgrammeReviewBody({
  visit,
  reviewStatus,
  evidenceCount,
  reviewReasons
}: {
  visit: ProgrammeVisitCardData;
  reviewStatus: string;
  evidenceCount?: number;
  reviewReasons?: string[];
}) {
  return (
    <div className='flex flex-col'>
      <ProgrammeVisitBody visit={visit} />
      <div className='flex flex-col gap-1.5 border-t px-3 py-2'>
        <div className='flex flex-wrap items-center gap-1.5'>
          <Badge
            variant={reviewStatus === 'Reviewed' ? 'success' : 'secondary'}
          >
            {reviewStatus}
          </Badge>
          {/* Absent means the surface that built this card did not read the
              evidence. Only a number it actually returned is shown. */}
          {evidenceCount !== undefined && (
            <Badge variant='secondary'>
              {evidenceCount === 0
                ? 'No evidence attached'
                : `${evidenceCount} ${evidenceCount === 1 ? 'file' : 'files'} attached`}
            </Badge>
          )}
        </div>
        {reviewReasons && reviewReasons.length > 0 && (
          <ul className='text-muted-foreground flex flex-col gap-0.5 text-xs'>
            {reviewReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * What choosing a candidate puts in the composer.
 *
 * Deliberately a sentence a person could have typed: the address, postcode and
 * the client's reference, which the read tools can resolve on their own. The
 * canonical id stays in the card's props. A card therefore carries an identity
 * and an intent, never authority - anything that writes still goes through the
 * ordinary proposal the person confirms.
 */
export function candidatePrompt(
  candidate: ProgrammeCandidate,
  target: 'property' | 'visit'
): string {
  const where = [candidate.address, candidate.postcode]
    .filter(Boolean)
    .join(', ');
  return target === 'visit'
    ? `Show me the visit at ${where} (property ${candidate.reference}).`
    : `Show me ${where} (property ${candidate.reference}).`;
}

export function ProgrammeCandidateRow({
  candidate,
  target,
  onSelect
}: {
  candidate: ProgrammeCandidate;
  target: 'property' | 'visit';
  onSelect?: (candidate: ProgrammeCandidate, prompt: string) => void;
}) {
  return (
    <li className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium'>{candidate.address}</p>
        <p className='text-muted-foreground text-xs'>
          {candidate.reference}
          {candidate.postcode && ` · ${candidate.postcode}`}
        </p>
        {candidate.detail && (
          <p className='text-muted-foreground text-xs'>{candidate.detail}</p>
        )}
      </div>
      {onSelect && (
        <Button
          size='sm'
          variant='outline'
          className='h-7 shrink-0'
          onClick={() =>
            onSelect(candidate, candidatePrompt(candidate, target))
          }
        >
          Choose
          <span className='sr-only'>
            {' '}
            {candidate.address} {candidate.reference}
          </span>
        </Button>
      )}
    </li>
  );
}
