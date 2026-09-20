'use client';

import { useEffect } from 'react';
import { useChat } from './chat-provider';
import { ConversationList } from './conversation-list';
import { MessageThread } from './message-thread';
import { Avatar } from './avatar';
import { conversationName } from '../types';

/**
 * The full-screen presentation. It renders the SAME list and thread components
 * the floating panel does, from the SAME provider — no second implementation,
 * no second realtime subscription, no second unread count.
 */
export function ChatFullScreen({
  initialConversationId
}: {
  /** From ?conversation=<id>, so expanding the panel lands on what you were reading. */
  initialConversationId?: string;
}) {
  const { conversations, selected, openConversation, viewerPersonId } =
    useChat();

  // Adopt the conversation named in the URL, once it is one we can see.
  useEffect(() => {
    if (!initialConversationId || selected === initialConversationId) return;
    if (!conversations.some((c) => c.id === initialConversationId)) return;
    openConversation(initialConversationId);
  }, [initialConversationId, selected, conversations, openConversation]);

  const current = conversations.find((c) => c.id === selected);

  return (
    <div className='flex min-h-[32rem] flex-col gap-3 xl:flex-row'>
      <div className='flex min-h-0 flex-col gap-2 xl:w-72 xl:shrink-0'>
        <ConversationList />
      </div>

      <div className='flex min-h-[28rem] min-w-0 flex-1 flex-col rounded-lg border'>
        {!current ? (
          <div className='text-muted-foreground flex flex-1 items-center justify-center p-8 text-center text-sm'>
            Pick a conversation, or start a new one.
          </div>
        ) : (
          <>
            <div className='flex items-center gap-2 border-b px-4 py-2'>
              <Avatar name={conversationName(current, viewerPersonId)} />
              <div className='min-w-0'>
                <p className='truncate text-sm font-medium'>
                  {conversationName(current, viewerPersonId)}
                </p>
                <p className='text-muted-foreground truncate text-xs'>
                  {current.members.map((m) => m.displayName).join(', ')}
                </p>
              </div>
            </div>
            <MessageThread />
          </>
        )}
      </div>
    </div>
  );
}
