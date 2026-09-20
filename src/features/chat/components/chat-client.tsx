'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { evidenceMimeType } from '@/features/operations/evidence-rules';
import {
  beginEvidenceUpload,
  completeEvidenceUpload
} from '@/features/operations/evidence-upload';
import { runCommand } from '@/lib/backend/command';
import { createClient } from '@/lib/supabase/client';
import {
  IconArrowBackUp,
  IconPaperclip,
  IconSend,
  IconX
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  conversationName,
  type ChatConversationRow,
  type ChatMessageRow
} from '../types';
import { Avatar, newCommandId } from './avatar';
import { MessageBody } from './message-body';
import { NewConversation } from './new-conversation';

// The chat surface.
//
// Messages arrive three ways and all three converge on the same list:
//   - you sent one: it appears IMMEDIATELY as a pending row, then the refetch
//     replaces it with the authoritative server row
//   - somebody else sent one: Realtime nudges us and we refetch
//   - you opened the conversation: we fetch
//
// A Realtime event is only ever a NUDGE. Nothing renders straight off the
// socket, because that payload has not been through the read's authorization
// or shaping. The read is the only thing that decides what you may see.

type Pending = {
  localId: string;
  body: string;
  replyToId: string | null;
  failed?: boolean;
};

export function ChatClient({
  viewerPersonId,
  viewerName,
  initialConversations,
  initialJobRefs
}: {
  viewerPersonId: string;
  viewerName: string;
  initialConversations: ChatConversationRow[];
  initialJobRefs: Record<string, string>;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  // Deliberately NOT auto-selecting the first conversation.
  //
  // Opening a conversation is what marks it read, so auto-selecting on load
  // marked Ben's unread message read before he had seen it - the badge
  // appeared and vanished within a second. Landing on the list means an unread
  // conversation stays unread until somebody actually opens it, which is what
  // the badge is claiming.
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [jobRefs, setJobRefs] = useState(initialJobRefs);
  const [pending, setPending] = useState<Pending[]>([]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessageRow | null>(null);
  const [filter, setFilter] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The subscription is created once; this is how its callback knows which
  // conversation is on screen without being torn down on every switch.
  const selectedRef = useRef<string | null>(selected);
  selectedRef.current = selected;

  const load = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/chat/${conversationId}`, {
      cache: 'no-store'
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: ChatMessageRow[];
      conversations: ChatConversationRow[];
      jobRefs: Record<string, string>;
    };
    setMessages(data.messages);
    setConversations(data.conversations);
    setJobRefs(data.jobRefs);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!selected) return;

    setLoaded(false);
    setPending([]);
    setReplyTo(null);
    void load(selected);
  }, [selected, load]);

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as {
      conversations: ChatConversationRow[];
    };
    setConversations(data.conversations);
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  // Live updates. RLS applies to the subscription, so a client only receives
  // rows for a conversation it is a member of.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      // THE REALTIME SOCKET NEEDS THE SESSION EXPLICITLY.
      //
      // The browser client restores its session from cookies, which is enough
      // for HTTP, but the websocket opens separately and starts out
      // unauthenticated. Row level security then hides every row from it, so
      // the subscription connects, reports SUBSCRIBED, and silently delivers
      // nothing. Passing the access token is what makes RLS evaluate the
      // subscription as the signed-in person.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      // No conversation filter, deliberately. RLS already limits this to
      // conversations the viewer is a member of, and a message in ANOTHER
      // conversation still has to move its unread count.
      channel = supabase
        .channel('chat')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_messages' },
          (payload) => {
            const row = (payload.new ?? payload.old) as {
              conversation_id?: string;
            } | null;
            void loadConversations();
            if (
              row?.conversation_id &&
              row.conversation_id === selectedRef.current
            )
              void load(row.conversation_id);
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [load, loadConversations]);

  // Opening a conversation is what marks it read.
  useEffect(() => {
    if (!selected || !loaded) return;
    void runCommand({
      command_id: newCommandId(),
      command_type: 'CHAT_MARK_READ',
      payload: { conversation_id: selected }
    }).then(() =>
      setConversations((prev) =>
        prev.map((c) => (c.id === selected ? { ...c, unread: 0 } : c))
      )
    );
  }, [selected, loaded, messages.length]);

  const send = async () => {
    const text = body.trim();
    if (!text || !selected) return;
    const localId = newCommandId();
    const replyToId = replyTo?.id ?? null;

    // Optimistic: the message is on screen before the round trip. The input
    // clears at once, because waiting for the server to empty it makes a chat
    // feel broken even when it is working.
    setPending((prev) => [...prev, { localId, body: text, replyToId }]);
    setBody('');
    setReplyTo(null);

    const result = await runCommand({
      command_id: localId,
      command_type: 'CHAT_SEND',
      payload: {
        conversation_id: selected,
        body: text,
        ...(replyToId ? { reply_to_id: replyToId } : {})
      }
    });

    if (!result.ok) {
      // Keep it on screen, marked failed, with the text recoverable.
      setPending((prev) =>
        prev.map((p) => (p.localId === localId ? { ...p, failed: true } : p))
      );
      toast.error(result.outcome.message);
      return;
    }
    // The authoritative row replaces the optimistic one.
    setPending((prev) => prev.filter((p) => p.localId !== localId));
    await load(selected);
  };

  const react = async (messageId: string, emoji: string, on: boolean) => {
    const result = await runCommand({
      command_id: newCommandId(),
      command_type: 'CHAT_REACT',
      payload: { message_id: messageId, emoji, on }
    });
    if (!result.ok) toast.error(result.outcome.message);
    else if (selected) await load(selected);
  };

  /**
   * Attach a file: upload it through the canonical evidence path as a
   * standalone document, then bind it to a message. No second storage system,
   * and the binding is what makes it readable by the conversation.
   */
  const attach = async (file: File) => {
    if (!selected) return;
    setAttaching(true);
    try {
      const sent = await runCommand({
        command_id: newCommandId(),
        command_type: 'CHAT_SEND',
        payload: { conversation_id: selected, body: file.name }
      });
      if (!sent.ok) {
        toast.error(sent.outcome.message);
        return;
      }
      const messageId = (sent.result as { message_id?: string }).message_id;
      const ticket = await beginEvidenceUpload({
        uploadId: newCommandId(),
        context: { type: 'Library' },
        file: { name: file.name, type: file.type, size: file.size }
      });
      if (!ticket.ok) {
        toast.error(ticket.message);
        return;
      }
      if (ticket.token) {
        // The same two steps the file manager uses: bytes to the signed URL,
        // then the server decides whether they actually arrived. An error here
        // is not final - the answer may have been lost, not the upload.
        await createClient()
          .storage.from('evidence')
          .uploadToSignedUrl(ticket.path, ticket.token, file, {
            contentType: evidenceMimeType(file) ?? undefined
          });
        const done = await completeEvidenceUpload(ticket.evidenceId);
        if (!done.ok) {
          toast.error(done.message);
          return;
        }
      }
      const bound = await runCommand({
        command_id: newCommandId(),
        command_type: 'CHAT_ATTACH',
        payload: { message_id: messageId, evidence_id: ticket.evidenceId }
      });
      if (!bound.ok) toast.error(bound.outcome.message);
      await load(selected);
    } finally {
      setAttaching(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const shown = conversations.filter((c) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      conversationName(c, viewerPersonId).toLowerCase().includes(q) ||
      (c.lastMessage?.body ?? '').toLowerCase().includes(q) ||
      c.members.some((m) => m.displayName.toLowerCase().includes(q))
    );
  });
  const current = conversations.find((c) => c.id === selected);

  return (
    <div className='flex min-h-[32rem] flex-col gap-3 xl:flex-row'>
      {/* Conversation list */}
      <div className='flex flex-col gap-2 xl:w-72 xl:shrink-0'>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder='Search conversations'
          aria-label='Search conversations'
          className='h-9'
        />
        <NewConversation
          onStarted={(id) => {
            setSelected(id);
            void load(id);
          }}
        />

        {conversations.length === 0 ? (
          <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
            <p className='font-medium'>No conversations yet</p>
            <p className='mt-1'>
              Start one with a colleague — nothing here leaves the company.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className='text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm'>
            Nothing matching “{filter.trim()}”.
          </div>
        ) : (
          <ul className='divide-y rounded-lg border'>
            {shown.map((c) => {
              const name = conversationName(c, viewerPersonId);
              return (
                <li key={c.id}>
                  <button
                    type='button'
                    onClick={() => setSelected(c.id)}
                    className={`hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left ${
                      c.id === selected ? 'bg-accent' : ''
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
                        {c.unread > 0 && (
                          <Badge variant='info'>{c.unread}</Badge>
                        )}
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

      {/* Conversation */}
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

            <div className='flex-1 overflow-y-auto px-4 py-3'>
              {messages.length === 0 && pending.length === 0 ? (
                <div className='text-muted-foreground flex h-full flex-col items-center justify-center text-center text-sm'>
                  <p className='font-medium'>No messages yet</p>
                  <p className='mt-1'>Say something to get started.</p>
                </div>
              ) : (
                <ul className='flex flex-col gap-3'>
                  {messages.map((m) => {
                    const mine = m.authorPersonId === viewerPersonId;
                    const parent = m.replyToId
                      ? messages.find((x) => x.id === m.replyToId)
                      : null;
                    const mineReaction = (emoji: string) =>
                      m.reactions.some(
                        (r) =>
                          r.emoji === emoji && r.personId === viewerPersonId
                      );
                    return (
                      <li key={m.id} className='group flex gap-2'>
                        <Avatar name={m.authorName} size='sm' />
                        <div className='min-w-0 flex-1'>
                          <p className='text-muted-foreground text-xs'>
                            <span className='text-foreground font-medium'>
                              {mine ? 'You' : m.authorName}
                            </span>{' '}
                            · {shortTime(m.createdAt)}
                            {m.editedAt && ' · edited'}
                          </p>

                          {parent && (
                            <p className='text-muted-foreground border-muted mt-1 border-l-2 pl-2 text-xs'>
                              Replying to {parent.authorName}:{' '}
                              {parent.deleted
                                ? 'deleted message'
                                : truncate(parent.body ?? '', 80)}
                            </p>
                          )}

                          {m.deleted ? (
                            <p className='text-muted-foreground text-sm italic'>
                              Message deleted
                            </p>
                          ) : (
                            <MessageBody
                              body={m.body ?? ''}
                              jobRefs={jobRefs}
                              mentioned={m.mentionedPersonIds.includes(
                                viewerPersonId
                              )}
                            />
                          )}

                          {m.attachments.length > 0 && (
                            <ul className='mt-1 flex flex-wrap gap-2'>
                              {m.attachments.map((a) => (
                                <li key={a.evidenceId}>
                                  <a
                                    href={`/api/evidence/${a.evidenceId}`}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    className='hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs'
                                  >
                                    <IconPaperclip className='size-3' />
                                    {a.name}
                                  </a>
                                </li>
                              ))}
                            </ul>
                          )}

                          <div className='mt-1 flex flex-wrap items-center gap-1'>
                            {['👍', '✅', '👀'].map((emoji) => {
                              const count = m.reactions.filter(
                                (r) => r.emoji === emoji
                              ).length;
                              if (m.deleted && count === 0) return null;
                              // A reaction somebody left is information about
                              // the message, so it stays. An empty one is an
                              // affordance, and affordances appear on hover.
                              const placed = count > 0;
                              return (
                                <button
                                  key={emoji}
                                  type='button'
                                  onClick={() =>
                                    react(m.id, emoji, !mineReaction(emoji))
                                  }
                                  className={`rounded-full border px-2 py-0.5 text-xs transition-opacity ${
                                    mineReaction(emoji) ? 'bg-accent' : ''
                                  } ${
                                    placed
                                      ? ''
                                      : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100'
                                  }`}
                                  aria-label={`React ${emoji}`}
                                >
                                  {emoji}
                                  {count > 0 && ` ${count}`}
                                </button>
                              );
                            })}
                            {!m.deleted && (
                              <button
                                type='button'
                                onClick={() => setReplyTo(m)}
                                className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100'
                              >
                                <IconArrowBackUp className='size-3' />
                                Reply
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}

                  {/* Optimistic rows: on screen before the server has spoken. */}
                  {pending.map((p) => (
                    <li key={p.localId} className='flex gap-2 opacity-70'>
                      <Avatar name={viewerName} size='sm' />
                      <div className='min-w-0 flex-1'>
                        <p className='text-muted-foreground text-xs'>
                          <span className='text-foreground font-medium'>
                            You
                          </span>{' '}
                          · {p.failed ? 'not sent' : 'sending…'}
                        </p>
                        <p className='text-sm break-words whitespace-pre-wrap'>
                          {p.body}
                        </p>
                        {p.failed && (
                          <button
                            type='button'
                            className='text-destructive text-xs underline'
                            onClick={() => {
                              setBody(p.body);
                              setPending((prev) =>
                                prev.filter((x) => x.localId !== p.localId)
                              );
                            }}
                          >
                            Put it back in the box
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div ref={bottom} />
            </div>

            {replyTo && (
              <div className='text-muted-foreground flex items-center justify-between gap-2 border-t px-4 py-1 text-xs'>
                <span className='truncate'>
                  Replying to {replyTo.authorName}:{' '}
                  {truncate(replyTo.body ?? '', 60)}
                </span>
                <button
                  type='button'
                  onClick={() => setReplyTo(null)}
                  aria-label='Cancel reply'
                >
                  <IconX className='size-3.5' />
                </button>
              </div>
            )}

            <form
              className='flex items-end gap-2 border-t p-2'
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <input
                ref={fileInput}
                type='file'
                className='hidden'
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void attach(file);
                }}
              />
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={attaching}
                onClick={() => fileInput.current?.click()}
                aria-label='Attach a file'
              >
                <IconPaperclip />
              </Button>
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
                placeholder={
                  attaching
                    ? 'Attaching…'
                    : 'Message (Shift+Enter for a new line)'
                }
                aria-label='Message'
                className='focus-visible:ring-ring min-h-10 flex-1 resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
              />
              <Button type='submit' size='sm' disabled={!body.trim()}>
                <IconSend />
                Send
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function shortTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
