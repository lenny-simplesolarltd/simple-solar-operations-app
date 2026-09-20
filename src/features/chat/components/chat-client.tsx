'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { runCommand } from '@/lib/backend/command';
import { createClient } from '@/lib/supabase/client';
import { IconSend } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  conversationName,
  type ChatConversationRow,
  type ChatMessageRow
} from '../types';
import { MessageBody } from './message-body';

// The chat surface. Three columns collapse to one on a phone: pick a
// conversation, read it, reply.
//
// Messages arrive two ways and both must converge on the same list:
//   - you sent one, so the command returned and we refetch
//   - somebody else sent one, so Realtime told us and we refetch
//
// The refetch goes through the normal read, which re-checks membership. The
// Realtime event is only ever a NUDGE - we never render a row straight off the
// socket, because the socket payload has not been through the read's
// authorization or shaping.

const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

export function ChatClient({
  viewerPersonId,
  initialConversations,
  jobRefs
}: {
  viewerPersonId: string;
  initialConversations: ChatConversationRow[];
  /** SS-XXXX-0000 -> job id, for every reference the server resolved. */
  jobRefs: Record<string, string>;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selected, setSelected] = useState<string | null>(
    initialConversations[0]?.id ?? null
  );
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/chat/${conversationId}`, {
      cache: 'no-store'
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: ChatMessageRow[];
      conversations: ChatConversationRow[];
    };
    setMessages(data.messages);
    setConversations(data.conversations);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loadMessages is async; the state lands in a later tick, after a fetch the rule cannot see
    if (selected) void loadMessages(selected);
  }, [selected, loadMessages]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Live updates. RLS applies to the subscription too, so a client only ever
  // receives rows for a conversation it is a member of.
  useEffect(() => {
    if (!selected) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`chat:${selected}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_messages',
          filter: `conversation_id=eq.${selected}`
        },
        () => void loadMessages(selected)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selected, loadMessages]);

  // Reading a conversation marks it read, which is what clears the badge.
  useEffect(() => {
    if (!selected || messages.length === 0) return;
    void runCommand({
      command_id: uuid(),
      command_type: 'CHAT_MARK_READ',
      payload: { conversation_id: selected }
    }).then(() => {
      setConversations((prev) =>
        prev.map((c) => (c.id === selected ? { ...c, unread: 0 } : c))
      );
    });
  }, [selected, messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    // Clear immediately: waiting for the round trip to empty the box makes a
    // chat feel broken even when it is working.
    setBody('');
    const result = await runCommand({
      command_id: uuid(),
      command_type: 'CHAT_SEND',
      payload: { conversation_id: selected, body: text }
    });
    setSending(false);
    if (!result.ok) {
      toast.error(result.outcome.message);
      setBody(text);
      return;
    }
    await loadMessages(selected);
  };

  const react = async (messageId: string, emoji: string, on: boolean) => {
    const result = await runCommand({
      command_id: uuid(),
      command_type: 'CHAT_REACT',
      payload: { message_id: messageId, emoji, on }
    });
    if (!result.ok) toast.error(result.outcome.message);
    else if (selected) await loadMessages(selected);
  };

  if (conversations.length === 0)
    return (
      <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
        No conversations yet.
      </div>
    );

  const current = conversations.find((c) => c.id === selected);

  return (
    <div className='flex min-h-[28rem] flex-col gap-4 lg:flex-row'>
      <ul className='divide-y rounded-lg border lg:w-72 lg:shrink-0'>
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              type='button'
              onClick={() => setSelected(c.id)}
              className={`hover:bg-accent flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                c.id === selected ? 'bg-accent' : ''
              }`}
            >
              <span className='flex w-full items-center justify-between gap-2'>
                <span className='truncate text-sm font-medium'>
                  {conversationName(c, viewerPersonId)}
                </span>
                {c.unread > 0 && <Badge variant='info'>{c.unread}</Badge>}
              </span>
              {c.lastMessage && (
                <span className='text-muted-foreground truncate text-xs'>
                  {c.lastMessage.deleted
                    ? 'Message deleted'
                    : c.lastMessage.body}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      <div className='flex min-w-0 flex-1 flex-col rounded-lg border'>
        <div className='border-b px-4 py-2 text-sm font-medium'>
          {current ? conversationName(current, viewerPersonId) : 'Conversation'}
        </div>

        <div className='flex-1 overflow-y-auto px-4 py-3'>
          {messages.length === 0 ? (
            <p className='text-muted-foreground text-sm'>
              Nothing here yet. Say something.
            </p>
          ) : (
            <ul className='flex flex-col gap-3'>
              {messages.map((m) => {
                const mine = m.authorPersonId === viewerPersonId;
                const myReaction = (emoji: string) =>
                  m.reactions.some(
                    (r) => r.emoji === emoji && r.personId === viewerPersonId
                  );
                return (
                  <li key={m.id} className='flex flex-col gap-1'>
                    <span className='text-muted-foreground text-xs'>
                      {mine ? 'You' : m.authorName} ·{' '}
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                      {m.editedAt && ' · edited'}
                    </span>
                    {m.deleted ? (
                      <p className='text-muted-foreground text-sm italic'>
                        Message deleted
                      </p>
                    ) : (
                      <MessageBody body={m.body ?? ''} jobRefs={jobRefs} />
                    )}
                    <span className='flex flex-wrap items-center gap-1'>
                      {['👍', '✅', '👀'].map((emoji) => {
                        const count = m.reactions.filter(
                          (r) => r.emoji === emoji
                        ).length;
                        if (count === 0 && m.deleted) return null;
                        return (
                          <button
                            key={emoji}
                            type='button'
                            onClick={() =>
                              react(m.id, emoji, !myReaction(emoji))
                            }
                            className={`rounded-full border px-2 py-0.5 text-xs ${
                              myReaction(emoji) ? 'bg-accent' : ''
                            }`}
                            aria-label={`React ${emoji}`}
                          >
                            {emoji}
                            {count > 0 && ` ${count}`}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div ref={bottom} />
        </div>

        <form
          className='flex items-end gap-2 border-t p-2'
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder='Message'
            className='focus-visible:ring-ring min-h-10 flex-1 resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
          />
          <Button type='submit' size='sm' disabled={!body.trim() || sending}>
            <IconSend />
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
