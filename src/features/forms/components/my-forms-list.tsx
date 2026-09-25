import { Badge } from '@/components/ui/badge';
import { IconChevronRight, IconClipboardText } from '@tabler/icons-react';
import Link from 'next/link';
import type { CompletableForm } from '../server/my-forms';

/**
 * The forms a person is expected to complete.
 *
 * Each one links into the workflow that OWNS it rather than to a generic
 * submit page: a PCH visit means nothing without a programme and a property,
 * so "start it" has to mean "start it there".
 */
export function MyFormsList({ forms }: { forms: CompletableForm[] }) {
  if (forms.length === 0)
    return (
      <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
        <p className='font-medium'>Nothing to complete</p>
        <p className='mt-1'>
          Forms you are asked to fill in appear here. Nothing is waiting for you
          at the moment.
        </p>
      </div>
    );

  return (
    <ul className='divide-y rounded-lg border'>
      {forms.map((form) => {
        const href = form.route?.href ?? '#';
        return (
          <li key={form.formId}>
            <Link
              href={href}
              className='hover:bg-accent flex items-center gap-3 px-4 py-3'
            >
              <IconClipboardText aria-hidden className='size-5 shrink-0' />
              <span className='min-w-0 flex-1'>
                <span className='flex flex-wrap items-center gap-2'>
                  <span className='font-medium'>{form.title}</span>
                  {form.route?.programmeName && (
                    <Badge variant='info'>{form.route.programmeName}</Badge>
                  )}
                </span>
                {form.description && (
                  <span className='text-muted-foreground mt-0.5 block text-sm'>
                    {form.description}
                  </span>
                )}
                {form.route?.context && (
                  <span className='text-muted-foreground mt-0.5 block text-xs'>
                    {form.route.context}
                  </span>
                )}
              </span>
              <IconChevronRight aria-hidden className='size-4 shrink-0' />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
