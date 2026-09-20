import Link from 'next/link';
import { linkifyMessage } from '../linkify';

// Renders a message as React elements. There is deliberately no
// dangerouslySetInnerHTML anywhere near this: a message is text somebody
// typed, and every piece of it is rendered as a text node or an element this
// file chose.

export function MessageBody({
  body,
  jobRefs,
  mentioned = false
}: {
  body: string;
  /** Job references the SERVER resolved for this reader. Others stay plain. */
  jobRefs: Record<string, string>;
  /** True when the SERVER put this reader in mentioned_person_ids. */
  mentioned?: boolean;
}) {
  const segments = linkifyMessage(body, new Set(Object.keys(jobRefs)));
  return (
    <p
      className={`text-sm break-words whitespace-pre-wrap ${
        mentioned ? 'bg-info-soft rounded-md px-2 py-1' : ''
      }`}
    >
      {segments.map((seg, i) => {
        if (seg.kind === 'job') {
          const jobId = jobRefs[seg.jobRef];
          return (
            <Link
              key={i}
              href={`/dashboard/jobs/${jobId}`}
              className='text-primary font-medium hover:underline'
            >
              {seg.text}
            </Link>
          );
        }
        if (seg.kind === 'link')
          return (
            <a
              key={i}
              href={seg.href}
              target='_blank'
              // noopener stops the opened page reaching back through
              // window.opener; noreferrer keeps our URLs out of its logs.
              rel='noopener noreferrer'
              className='text-primary hover:underline'
            >
              {seg.text}
            </a>
          );
        return <span key={i}>{seg.text}</span>;
      })}
    </p>
  );
}
