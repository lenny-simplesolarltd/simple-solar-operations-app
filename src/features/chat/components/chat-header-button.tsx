'use client';

import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip';
import { IconMessageCircle } from '@tabler/icons-react';
import { describeUnread, formatUnread } from '../unread';
import { useChat } from './chat-provider';

/**
 * The permanent way back to chat, next to Help in the header.
 *
 * The floating launcher can be dismissed with its × — that is the point of ×,
 * as against minimise — so there has to be somewhere that never goes away.
 * This is it, and it carries the unread count so a dismissed launcher never
 * means a hidden message.
 */
export function ChatHeaderButton() {
  const { enabled, unreadTotal, showChat } = useChat();
  if (!enabled) return null;

  const badge = formatUnread(unreadTotal);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon'
          className='relative size-9 md:size-8'
          onClick={showChat}
          aria-label={describeUnread(unreadTotal)}
        >
          <IconMessageCircle className='size-5' />
          {badge && (
            <span
              aria-hidden
              className='bg-destructive text-background absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-[10px] leading-4 font-medium'
            >
              {badge}
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Team chat</TooltipContent>
    </Tooltip>
  );
}
