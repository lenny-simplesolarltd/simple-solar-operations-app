'use client';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useState } from 'react';
import { conversationName } from '../types';
import { Avatar } from './avatar';
import { useChat } from './chat-provider';
import { NewConversation } from './new-conversation';
import { shortTime } from './format';

/**
 * The conversation list. One implementation, rendered by both the floating
 * panel and the full-screen page — the only difference is how much room it has.
 */
export function ConversationList({ compact = false }: { compact?: boolean }) {
  const { conversations, selected, openConversation, viewerPersonId } =
    useChat();
  const [filter, setFilter] = useState('');

  const query = filter.trim().toLowerCase();
  const shown = conversations.filter((c) => {
    if (!query) return true;
    return (
      conversationName(c, viewerPersonId).toLowerCase().includes(query) ||
      (c.lastMessage?.body ?? '').toLowerCase().includes(query) ||
      c.members.some((m) => m.displayName.toLowerCase().includes(query))
    );
  });

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      <div className='flex flex-col gap-2 px-1'>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='Search conversations'
          aria-label='Search conversations'
          className='h-9'
        />
        <NewConversation onStarted={openConversation} />
      </div>

      {conversations.length === 0 ? (
        <div className='text-muted-foreground mx-1 rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
          <p className='font-medium'>No conversations yet</p>
          <p className='mt-1'>
            Start one with a colleague — nothing here leaves the company.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className='text-muted-foreground mx-1 rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
          Nothing matching “{filter.trim()}”.
        </div>
      ) : (
        <ul
          className={`min-h-0 flex-1 divide-y overflow-y-auto ${
            compact ? '' : 'rounded-lg border'
          }`}
        >
          {shown.map((c) => {
            const name = conversationName(c, viewerPersonId);
            return (
              <li key={c.id}>
                <button
                  type='button'
                  onClick={() => openConversation(c.id)}
                  aria-label={
                    c.unread > 0
                      ? `${name}, ${c.unread} unread`
                      : `${name}, no unread messages`
                  }
                  className={`hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-2 px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none ${
                    c.id === selected && !compact ? 'bg-accent' : ''
                  }`}
                >
                  <Avatar name={name} />
                  <span className='min-w-0 flex-1'>
                    <span className='flex items-center justify-between gap-2'>
                      <span className='truncate text-sm font-medium'>
                        {name}
                      </span>
                      {c.lastMessageAt && (
                        <span className='text-muted-foreground shrink-0 text-[11px]'>
                          {shortTime(c.lastMessageAt)}
                        </span>
                      )}
                    </span>
                    <span className='flex items-center justify-between gap-2'>
                      <span className='text-muted-foreground truncate text-xs'>
                        {c.lastMessage
                          ? c.lastMessage.deleted
                            ? 'Message deleted'
                            : c.lastMessage.body
                          : 'No messages yet'}
                      </span>
                      {c.unread > 0 && <Badge variant='info'>{c.unread}</Badge>}
                    </span>
                    {c.kind === 'Group' && (
                      <span className='text-muted-foreground block truncate text-[11px]'>
                        {c.members.map((m) => m.displayName).join(', ')}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
