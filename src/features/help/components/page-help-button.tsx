'use client';

import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isHelpRoute, routePatternFor } from '../routes';

/**
 * "Help with this page": one reusable contextual-help entry point in the
 * header. It maps the current address to its screen (route pattern) and opens
 * the Help Center filtered to the articles written for that screen, so pages
 * need no per-page wiring and editors attach articles to screens in the editor.
 */
export function PageHelpButton() {
  const pathname = usePathname();
  const route = routePatternFor(pathname ?? '');
  const href =
    route && !isHelpRoute(route)
      ? `/dashboard/help?route=${encodeURIComponent(route)}`
      : '/dashboard/help';
  const label =
    route && !isHelpRoute(route) ? 'Help with this page' : 'Help Center';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant='ghost'
          size='icon'
          className='size-9 md:size-8'
        >
          <Link href={href} aria-label={label}>
            <Icons.help className='size-5' />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
