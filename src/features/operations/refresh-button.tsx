'use client';

import { Button } from '@/components/ui/button';
import { IconRefresh } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Re-runs the server read behind the current page.
 *
 * These lists are server-rendered, so they are as fresh as the last
 * navigation. Somebody completing a task in another tab, or a colleague
 * reassigning one, does not move this screen — and the alternative people
 * reach for is a browser reload, which throws away the whole page to refetch
 * one list. router.refresh() re-runs the server component and swaps the result
 * in, keeping scroll position and any open dialog.
 */
export function RefreshButton({
  label = 'Refresh',
  className
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant='ghost'
      size='sm'
      className={className}
      disabled={pending}
      // aria-live is on the label below rather than here, so a screen reader
      // hears "Refreshing" once rather than on every re-render.
      aria-label={pending ? 'Refreshing' : label}
      onClick={() => startTransition(() => router.refresh())}
    >
      <IconRefresh className={pending ? 'animate-spin' : undefined} />
      {pending ? 'Refreshing…' : label}
    </Button>
  );
}
