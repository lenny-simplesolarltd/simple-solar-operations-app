import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  DISPOSITION_LABEL,
  OUTCOME_SHORT,
  PORTAL_LABEL,
  SIGNAL_LABEL
} from '../labels';
import type {
  Disposition,
  PortalVerification,
  SignalClass,
  VisitOutcome
} from '../types';

// Status colour carries meaning, so it is stated once, here, and every screen
// reads the same badge. Text always says what the colour says.

const DISPOSITION_TONE: Record<Disposition, string> = {
  AwaitingReview: 'bg-info-soft text-info border-info/30',
  NoAccessRebook: 'bg-warning-soft text-warning border-warning/30',
  ActionRequired: 'bg-destructive-soft text-destructive border-destructive/30',
  MeterRequiresChanging:
    'bg-destructive-soft text-destructive border-destructive/30',
  CompleteAndWorking: 'bg-success-soft text-success border-success/30'
};

export function DispositionBadge({
  disposition,
  className
}: {
  disposition: Disposition;
  className?: string;
}) {
  return (
    <Badge
      variant='outline'
      className={cn(DISPOSITION_TONE[disposition], className)}
    >
      {DISPOSITION_LABEL[disposition]}
    </Badge>
  );
}

const SIGNAL_TONE: Record<SignalClass, string> = {
  Good: 'bg-success-soft text-success border-success/30',
  Advisory: 'bg-warning-soft text-warning border-warning/30',
  Bad: 'bg-destructive-soft text-destructive border-destructive/30'
};

export function SignalBadge({
  signal,
  csq,
  className
}: {
  signal: SignalClass | null;
  csq?: number | null;
  className?: string;
}) {
  if (!signal)
    return (
      <span className='text-muted-foreground text-xs'>No CSQ recorded</span>
    );
  return (
    <Badge variant='outline' className={cn(SIGNAL_TONE[signal], className)}>
      {csq !== null && csq !== undefined ? `CSQ ${csq} · ` : ''}
      {SIGNAL_LABEL[signal]}
    </Badge>
  );
}

const PORTAL_TONE: Record<PortalVerification, string> = {
  ConfirmedLive: 'bg-success-soft text-success border-success/30',
  NotLive: 'bg-destructive-soft text-destructive border-destructive/30',
  UnableToVerify: 'bg-warning-soft text-warning border-warning/30'
};

export function PortalBadge({
  verification,
  required
}: {
  verification: PortalVerification | null;
  required: boolean;
}) {
  if (!verification)
    return required ? (
      <Badge variant='outline' className='bg-muted text-muted-foreground'>
        Portal not checked
      </Badge>
    ) : (
      <span className='text-muted-foreground text-xs'>No portal check</span>
    );
  return (
    <Badge variant='outline' className={PORTAL_TONE[verification]}>
      {PORTAL_LABEL[verification]}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: VisitOutcome | null }) {
  if (!outcome)
    return <span className='text-muted-foreground text-xs'>Not submitted</span>;
  return (
    <Badge variant='secondary' className='font-normal'>
      {OUTCOME_SHORT[outcome]}
    </Badge>
  );
}

/**
 * The mismatch warning. Says which of the three things is true - matches,
 * does not match, or cannot be compared - because "no warning" and "nothing to
 * compare against" are not the same thing.
 */
export function SerialMatch({
  matches,
  expected,
  actual
}: {
  matches: boolean | null;
  expected: string | null;
  actual: string | null;
}) {
  if (matches === true)
    return (
      <span className='text-success text-xs font-medium'>Serial matches</span>
    );
  if (matches === false)
    return (
      <span className='text-destructive text-xs font-semibold'>
        Serial MISMATCH — expected {expected ?? 'unknown'}, found{' '}
        {actual ?? 'nothing'}
      </span>
    );
  return (
    <span className='text-warning text-xs'>
      {expected ? 'Not compared' : 'No expected serial on record'}
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <Badge
      variant='outline'
      className='border-warning/40 bg-warning-soft text-warning'
    >
      SYNTHETIC TEST DATA
    </Badge>
  );
}
