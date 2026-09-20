import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/features/jobs/format';
import Link from 'next/link';
import {
  describeStatus,
  whyNotDispatchable,
  type StatusNote
} from '../explain';
import type { CommunicationRow } from '../types';
import { CommunicationActions } from './communication-actions';

// The list. Every row says, in words, what has actually happened to the
// message - because "Sent" here can mean a person sent it from their own
// mailbox, and the screen must never let that read as the system having
// delivered something.

const TONE: Record<
  StatusNote['tone'],
  'secondary' | 'info' | 'success' | 'warning'
> = {
  neutral: 'secondary',
  progress: 'info',
  done: 'success',
  attention: 'warning'
};

export function CommunicationStatusBadge({ comm }: { comm: CommunicationRow }) {
  const note = describeStatus(comm);
  return <Badge variant={TONE[note.tone]}>{note.label}</Badge>;
}

export function CommunicationsList({
  communications,
  can
}: {
  communications: CommunicationRow[];
  can: { approve: boolean; send: boolean; recordSend: boolean };
}) {
  if (communications.length === 0) {
    return (
      <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
        No messages here.
      </div>
    );
  }
  return (
    <ul className='divide-y rounded-lg border'>
      {communications.map((c) => {
        const note = describeStatus(c);
        const blocked = whyNotDispatchable(c);
        return (
          <li key={c.id} className='flex flex-col gap-2 px-4 py-3'>
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div className='min-w-0 flex-1'>
                <Link
                  href={`/dashboard/communications/${c.id}`}
                  className='font-medium hover:underline'
                >
                  {c.subject}
                </Link>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {c.type}
                  {c.revision > 1 && ` · rev ${c.revision}`}
                  {c.createdAt && ` · captured ${formatDateTime(c.createdAt)}`}
                  {c.sentAt && ` · ${formatDateTime(c.sentAt)}`}
                </p>
              </div>
              <CommunicationStatusBadge comm={c} />
            </div>

            <p className='text-muted-foreground text-xs'>{note.detail}</p>

            {/* Say why the system will not send this, rather than silently
                offering no button. */}
            {blocked && c.status !== 'Sent' && (
              <p className='text-muted-foreground text-xs italic'>{blocked}</p>
            )}

            {c.outboxSummary && (
              <p className='text-muted-foreground text-xs'>
                Worker: {c.outboxSummary}
              </p>
            )}

            <CommunicationActions comm={c} can={can} />
          </li>
        );
      })}
    </ul>
  );
}
