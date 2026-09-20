'use client';

import { Button } from '@/components/ui/button';
import {
  IconArrowLeft,
  IconArrowsDiagonal,
  IconMessageCircle,
  IconMinus,
  IconX
} from '@tabler/icons-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { conversationName } from '../types';
import { describeUnread, escapeFrom, formatUnread } from '../unread';
import { Avatar } from './avatar';
import { useChat } from './chat-provider';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';

// The floating presentation: a launcher that is always there, and a panel over
// whatever page you are on. The point is that answering a colleague should not
// cost you your place in a job, a task or a planner week.
//
// On a phone the panel is a near-full-screen sheet rather than a small window
// squeezed into a corner, but it is the SAME components inside.

const FULL_SCREEN_PATH = '/dashboard/communications/chat';

export function ChatDock() {
  const {
    enabled,
    surface,
    setSurface,
    dismissLauncher,
    selected,
    conversations,
    unreadTotal,
    launcherVisible,
    viewerPersonId,
    backToList
  } = useChat();
  const router = useRouter();
  const pathname = usePathname();
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Where to send them back to when they minimise the full-screen page.
  const cameFrom = useRef<string>('/dashboard');

  const onFullScreen = pathname === FULL_SCREEN_PATH;

  useEffect(() => {
    if (!onFullScreen && pathname) cameFrom.current = pathname;
  }, [pathname, onFullScreen]);

  // Escape leaves one layer at a time: a thread returns to the list, the list
  // minimises. Losing the whole panel because you wanted to leave one
  // conversation is how people learn not to press Escape.
  useEffect(() => {
    if (surface === 'minimised') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const next = escapeFrom(surface);
      setSurface(next);
      if (next === 'minimised')
        requestAnimationFrame(() => launcher.current?.focus());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [surface, setSurface]);

  // Move focus into the panel when it opens, so a keyboard user is not left
  // behind on the launcher.
  useEffect(() => {
    if (surface !== 'minimised') panel.current?.focus();
  }, [surface]);

  // No launcher without the permission, and never alongside the full-screen
  // page: they are two presentations of the same thing.
  if (!enabled || onFullScreen) return null;
  // Dismissed with ×. The header control brings it back.
  if (!launcherVisible) return null;

  const badge = formatUnread(unreadTotal);
  const current = conversations.find((c) => c.id === selected);

  if (surface === 'minimised')
    return (
      <button
        ref={launcher}
        type='button'
        // Reopening returns you to the conversation you were in. Minimising to
        // answer a colleague and coming back to a list, having lost your place,
        // is the thing a dock exists to avoid.
        onClick={() => setSurface(selected ? 'thread' : 'list')}
        title='Team chat'
        aria-label={describeUnread(unreadTotal)}
        className='bg-primary text-primary-foreground focus-visible:ring-ring fixed right-4 bottom-4 z-40 flex size-12 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none'
      >
        <IconMessageCircle className='size-6' />
        {badge && (
          <span
            aria-hidden
            className='bg-destructive text-background absolute -top-0.5 -right-0.5 min-w-5 rounded-full px-1 text-[11px] leading-5 font-medium'
          >
            {badge}
          </span>
        )}
      </button>
    );

  return (
    <div
      ref={panel}
      tabIndex={-1}
      role='dialog'
      aria-label='Team chat'
      className='bg-background fixed inset-x-0 top-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-none border shadow-xl outline-none sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:h-[min(42rem,calc(100vh-6rem))] sm:w-[26rem] sm:rounded-xl lg:w-[27rem]'
    >
      <header className='flex items-center gap-2 border-b px-3 py-2'>
        {surface === 'thread' && (
          <button
            type='button'
            onClick={backToList}
            aria-label='Back to conversations'
            className='hover:bg-accent focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none'
          >
            <IconArrowLeft className='size-4' />
          </button>
        )}
        {surface === 'thread' && current ? (
          <>
            <Avatar
              name={conversationName(current, viewerPersonId)}
              size='sm'
            />
            <div className='min-w-0 flex-1'>
              <p className='truncate text-sm font-medium'>
                {conversationName(current, viewerPersonId)}
              </p>
              <p className='text-muted-foreground truncate text-[11px]'>
                {current.members.map((m) => m.displayName).join(', ')}
              </p>
            </div>
          </>
        ) : (
          <p className='flex-1 text-sm font-medium'>
            Team chat
            {badge && (
              <span className='text-muted-foreground ml-2 text-xs font-normal'>
                {badge} unread
              </span>
            )}
          </p>
        )}

        <button
          type='button'
          onClick={() =>
            router.push(
              selected
                ? `${FULL_SCREEN_PATH}?conversation=${selected}`
                : FULL_SCREEN_PATH
            )
          }
          aria-label='Open full screen'
          title='Open full screen'
          className='hover:bg-accent focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none'
        >
          <IconArrowsDiagonal className='size-4' />
        </button>
        <button
          type='button'
          onClick={() => {
            setSurface('minimised');
            requestAnimationFrame(() => launcher.current?.focus());
          }}
          aria-label='Minimise team chat'
          title='Minimise'
          className='hover:bg-accent focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none'
        >
          <IconMinus className='size-4' />
        </button>
        <button
          type='button'
          // × is not a louder minimise: it puts the floating messenger away
          // entirely, launcher included. Chat then lives only in the header,
          // which still carries the unread count.
          onClick={dismissLauncher}
          aria-label='Close team chat'
          title='Close — reopen from the header'
          className='hover:bg-accent focus-visible:ring-ring rounded-md p-1 focus-visible:ring-2 focus-visible:outline-none'
        >
          <IconX className='size-4' />
        </button>
      </header>

      <div className='flex min-h-0 flex-1 flex-col'>
        {surface === 'thread' && selected ? (
          <MessageThread />
        ) : (
          <div className='flex min-h-0 flex-1 flex-col py-2'>
            <ConversationList compact />
          </div>
        )}
      </div>
    </div>
  );
}

/** The control the full-screen page uses to hand the conversation back. */
export function MinimiseToPanel() {
  const { setSurface, selected } = useChat();
  const router = useRouter();
  return (
    <Button
      variant='outline'
      size='sm'
      onClick={() => {
        setSurface(selected ? 'thread' : 'list');
        router.back();
      }}
      aria-label='Minimise to the floating panel'
    >
      <IconMinus />
      Minimise
    </Button>
  );
}
