import { EmptyState } from '@/components/empty-state';
import type { ReadFailure } from '@/lib/backend/types';

const TITLES: Record<ReadFailure['kind'], string> = {
  forbidden: 'No access',
  not_enabled: 'Not switched on yet',
  not_found: 'Not found',
  invalid: 'Filters not valid',
  error: 'Could not load',
  unavailable: 'Not available yet'
};

/** The state shown when a backend read refuses or fails; never an empty list. */
export function ReadFailureState({
  failure,
  action,
  className
}: {
  failure: ReadFailure;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      title={TITLES[failure.kind]}
      description={failure.message}
      action={action}
    />
  );
}
