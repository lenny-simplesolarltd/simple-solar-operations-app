'use client';

import { cn } from '@/lib/utils';
import {
  IconArchive,
  IconBook,
  IconCalendarEvent,
  IconCheckbox,
  IconClipboardText,
  IconFileText,
  IconForms,
  IconHammer,
  IconHelpCircle,
  IconMessageCircle,
  IconPackage,
  IconSettings,
  IconTag,
  IconTool,
  type Icon
} from '@tabler/icons-react';
import Link from 'next/link';
import type { HelpCardArticle } from '../protocol';

/**
 * The guides SimpleBot consulted, on one line.
 *
 * Reference material should say what was looked at without taking the room an
 * answer needs. Several searches in a row used to stack several cards; they
 * collapse here into one row of overlapping category icons, a count, and a
 * chevron. Opening it lists every guide individually.
 */

/** One icon per Help Centre category, so a guide is recognisable at a glance. */
const CATEGORY_ICON: Record<string, Icon> = {
  administration: IconSettings,
  booking: IconCalendarEvent,
  cancellations: IconArchive,
  commissioning: IconClipboardText,
  files: IconFileText,
  forms: IconForms,
  'getting-started': IconBook,
  installation: IconTool,
  jobs: IconHammer,
  materials: IconPackage,
  planning: IconCalendarEvent,
  sales: IconTag,
  simplebot: IconMessageCircle,
  tasks: IconCheckbox
};

/** Anything uncategorised still gets a mark rather than a gap. */
export function categoryIcon(category?: string): Icon {
  return (category && CATEGORY_ICON[category]) || IconHelpCircle;
}

export function SourcesStrip({
  articles,
  onNavigate
}: {
  articles: HelpCardArticle[];
  onNavigate?: () => void;
}) {
  if (articles.length === 0) return null;
  // De-duplicate: the same guide often turns up in more than one search.
  const seen = new Set<string>();
  const unique = articles.filter((a) =>
    seen.has(a.href) ? false : (seen.add(a.href), true)
  );
  const shown = unique.slice(0, 5);
  const more = unique.length - shown.length;

  return (
    <details className='bg-background group/sources overflow-hidden rounded-lg border'>
      <summary className='hover:bg-muted/50 flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden'>
        <span className='flex shrink-0 items-center'>
          {shown.map((a, i) => {
            const Glyph = categoryIcon(a.category);
            return (
              <span
                key={a.href}
                className={cn(
                  'bg-muted ring-background flex size-5 items-center justify-center rounded-full ring-2',
                  i > 0 && '-ml-1.5'
                )}
                // The row already names the count; the icons are decoration.
                aria-hidden
              >
                <Glyph className='size-3' />
              </span>
            );
          })}
          {more > 0 && (
            <span
              className='bg-muted ring-background text-muted-foreground -ml-1.5 flex size-5 items-center justify-center rounded-full text-[9px] font-medium ring-2'
              aria-hidden
            >
              +{more}
            </span>
          )}
        </span>
        <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
          {unique.length === 1
            ? unique[0].title
            : `${unique.length} guides · ${unique[0].title}`}
        </span>
        <IconHelpCircle className='sr-only' aria-hidden />
        <span className='text-muted-foreground shrink-0 text-xs group-open/sources:hidden'>
          Show
        </span>
        <span className='text-muted-foreground hidden shrink-0 text-xs group-open/sources:inline'>
          Hide
        </span>
      </summary>
      <ul className='divide-y border-t'>
        {unique.map((a) => {
          const Glyph = categoryIcon(a.category);
          return (
            <li key={a.href}>
              <Link
                href={a.href}
                onClick={onNavigate}
                className='hover:bg-muted/50 flex items-center gap-2 px-3 py-2'
              >
                <Glyph
                  className='text-muted-foreground size-4 shrink-0'
                  aria-hidden
                />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {a.title}
                  </span>
                  {a.summary && (
                    <span className='text-muted-foreground block truncate text-xs'>
                      {a.summary}
                    </span>
                  )}
                </span>
                {!a.switchedOn && (
                  <span className='text-muted-foreground shrink-0 text-[10px]'>
                    not switched on
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
