import { Badge } from '@/components/ui/badge';
import {
  LINK_STATUS_LABEL,
  STATUS_LABEL,
  type FormLinkStatus,
  type FormStatus
} from '../types';

const FORM_VARIANT: Record<
  FormStatus,
  'secondary' | 'success' | 'warning' | 'outline' | 'info'
> = {
  draft: 'secondary',
  published: 'success',
  closed: 'warning',
  archived: 'outline',
  active: 'info'
};

export function FormStatusBadge({ status }: { status: FormStatus }) {
  return <Badge variant={FORM_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

const LINK_VARIANT: Record<
  FormLinkStatus,
  'secondary' | 'success' | 'warning' | 'outline' | 'info' | 'danger'
> = {
  ready: 'info',
  submitted: 'success',
  revoked: 'danger',
  expired: 'warning',
  closed: 'outline'
};

export function LinkStatusBadge({ status }: { status: FormLinkStatus }) {
  return (
    <Badge variant={LINK_VARIANT[status]}>{LINK_STATUS_LABEL[status]}</Badge>
  );
}
