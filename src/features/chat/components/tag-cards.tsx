import {
  IconBriefcase,
  IconCalendarEvent,
  IconChecklist,
  IconFileCheck,
  IconForms,
  IconLadder
} from '@tabler/icons-react';
import Link from 'next/link';
import {
  TAG_KIND_LABEL,
  tagHref,
  type ChatTag,
  type ChatTagKind
} from '../types';

// The cards under a message: what it points at, as something you can open.
//
// There is one renderer for all six kinds rather than one per kind, because a
// chip says the same four things whatever it names - what it is, what it is
// called, which job it belongs to and where it stands. The database already
// decided which of these this reader may see; nothing here filters anything.

const ICONS: Record<ChatTagKind, typeof IconBriefcase> = {
  job: IconBriefcase,
  task: IconChecklist,
  form: IconForms,
  form_submission: IconFileCheck,
  work_package: IconCalendarEvent,
  scaffold_booking: IconLadder
};

export function TagCards({ tags }: { tags: ChatTag[] }) {
  if (tags.length === 0) return null;
  return (
    <ul className='mt-1.5 flex flex-wrap gap-2'>
      {tags.map((tag) => {
        const Icon = ICONS[tag.kind];
        return (
          <li key={`${tag.kind}-${tag.id}`}>
            <Link
              href={tagHref(tag)}
              className='hover:bg-accent flex max-w-72 items-start gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors'
            >
              <Icon
                className='text-muted-foreground mt-0.5 size-3.5 shrink-0'
                aria-hidden
              />
              <span className='min-w-0'>
                <span className='block truncate font-medium'>
                  <span className='sr-only'>{TAG_KIND_LABEL[tag.kind]}: </span>
                  {tag.title}
                </span>
                {(tag.detail || tag.status) && (
                  <span className='text-muted-foreground block truncate'>
                    {[tag.detail, tag.status].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
