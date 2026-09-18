import { Badge } from '@/components/ui/badge';
import type { ComponentProps } from 'react';

type Variant = ComponentProps<typeof Badge>['variant'];

// Presentation only: known open statuses get a semantic colour, anything else
// falls back to a neutral outline so new statuses never break the table.
const VARIANT: Record<string, Variant> = {
  Open: 'secondary',
  InProgress: 'info',
  Waiting: 'warning',
  Blocked: 'danger',
  Complete: 'success'
};

const LABEL: Record<string, string> = {
  InProgress: 'In progress',
  NotRequired: 'Not required'
};

export function TaskStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={VARIANT[status] ?? 'outline'}>
      {LABEL[status] ?? status}
    </Badge>
  );
}
