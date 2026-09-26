import { formatDate } from '@/lib/format';
import Link from 'next/link';
import type { InboundEmail } from '../types';

/**
 * What came back.
 *
 * Deliberately not merged into the sent list: these are somebody else's words,
 * arriving unbidden, and the states that matter about them (who sent it, what
 * it replies to, how sure that link is) are not the states that matter about
 * a message this system sent.
 */
export function InboundList({ emails }: { emails: InboundEmail[] }) {
  if (emails.length === 0)
    return (
      <p className='text-muted-foreground rounded-md border px-3 py-6 text-center text-sm'>
        Nothing received yet. Replies to email sent from the office mailbox
        appear here once receiving is switched on.
      </p>
    );

  return (
    <ul className='flex flex-col divide-y rounded-lg border'>
      {emails.map((m) => (
        <li key={m.id} className='flex flex-col gap-1 px-3 py-3'>
          <div className='flex flex-wrap items-baseline justify-between gap-2'>
            <p className='font-medium'>
              {m.subject ?? <span className='italic'>No subject</span>}
            </p>
            <span className='text-muted-foreground text-xs'>
              {formatDate(m.receivedAt)}
            </span>
          </div>
          <p className='text-muted-foreground text-sm'>
            From{' '}
            {m.fromName ? `${m.fromName} (${m.fromAddress})` : m.fromAddress}
            {m.attachmentCount > 0
              ? ` · ${m.attachmentCount} attachment${m.attachmentCount === 1 ? '' : 's'}`
              : ''}
          </p>
          {m.preview ? (
            <p className='line-clamp-2 text-sm'>{m.preview}</p>
          ) : null}
          {/* How the link was made, not just that there is one: a sender match
              is a good guess, and saying so is the difference between evidence
              and a claim. */}
          {m.communicationId ? (
            <p className='text-muted-foreground text-xs'>
              <Link
                href={`/dashboard/communications/${m.communicationId}`}
                className='underline underline-offset-4'
              >
                {m.matchedBy === 'Tag'
                  ? 'Reply to a message we sent'
                  : 'Probably a reply to a message we sent'}
              </Link>
              {m.matchedBy === 'Sender'
                ? ' — matched on the sender, not a quoted reference.'
                : ''}
            </p>
          ) : (
            <p className='text-muted-foreground text-xs'>
              Not a reply to anything this system sent.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
