'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { IconExternalLink } from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * A visit opened from the board, over the board.
 *
 * The board is a working surface: reviewing a card used to mean navigating away
 * and coming back to a board scrolled somewhere else, with every "Load more"
 * page gone. This keeps the board underneath, so a person can work a column
 * without losing their place.
 *
 * It is an interception, not a copy: /visits/[visitId] is still the real page,
 * and it is what a refresh, a bookmark or a shared URL gets. The full-page link
 * below is the same route without the interception.
 */
export function VisitModal({
  title,
  subtitle,
  fullPageHref,
  children
}: {
  title: string;
  subtitle: string;
  fullPageHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <Dialog open onOpenChange={(open) => !open && router.back()}>
      <DialogContent
        className='max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl'
        // The card underneath is draggable; a drag starting inside the dialog
        // would otherwise be handed to the board behind it.
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className='bg-background sticky top-0 z-10 border-b p-6 pr-14'>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{subtitle}</DialogDescription>
          <Link
            href={fullPageHref}
            className='text-muted-foreground mt-1 inline-flex w-fit items-center gap-1.5 text-xs hover:underline'
          >
            <IconExternalLink aria-hidden className='size-3.5' />
            Open the full page
          </Link>
        </DialogHeader>
        <div className='p-6'>{children}</div>
      </DialogContent>
    </Dialog>
  );
}
