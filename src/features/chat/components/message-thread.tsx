'use client';

import { Button } from '@/components/ui/button';
import { EVIDENCE_ACCEPT } from '@/features/operations/evidence-rules';
import Link from 'next/link';
import {
  activeMentionQuery,
  applyMention,
  moveHighlight
} from '../mention-input';
import type { MentionSuggestion } from '../server/mention-types';
import {
  IconArrowBackUp,
  IconBriefcase,
  IconChecklist,
  IconPaperclip,
  IconSend,
  IconUser,
  IconX
} from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Avatar } from './avatar';
import { useChat } from './chat-provider';
import { shortTime, truncate } from './format';
import { MessageBody } from './message-body';

/**
 * The message list and composer. ONE implementation: the floating panel and the
 * full-screen page render this same component, so a reply, a reaction, an
 * attachment or a job link behaves identically in both.
 */
export function MessageThread() {
  const {
    messages,
    pending,
    jobRefs,
    viewerPersonId,
    viewerName,
    draft,
    replyTo,
    attaching,
    loadingThread,
    setDraft,
    setReplyTo,
    send,
    react,
    attach,
    recoverPending,
    addTag
  } = useChat();
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [mention, setMention] = useState<{
    start: number;
    query: string;
  } | null>(null);

  // Ask the server what "@" should offer. Every source applies this person's
  // own visibility, so the menu can only suggest what they could already find.
  useEffect(() => {
    if (!mention) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the menu when the mention ends is the whole point of this effect
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/chat/mentions?q=${encodeURIComponent(mention.query)}`,
        { cache: 'no-store' }
      );
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as { suggestions: MentionSuggestion[] };
      setSuggestions(data.suggestions);
      setHighlight(0);
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mention]);

  const onDraftChange = (value: string, caret: number) => {
    setDraft(value);
    setMention(activeMentionQuery(value, caret));
  };

  const choose = useCallback(
    (suggestion: MentionSuggestion) => {
      if (!mention) return;
      const caret = composer.current?.selectionStart ?? draft.length;
      const next = applyMention(draft, caret, mention, suggestion.insert);
      setDraft(next.text);
      setMention(null);
      setSuggestions([]);
      // A job goes in as its reference, which links itself. A colleague or a
      // task needs its id to travel beside the message.
      if (suggestion.kind === 'person') addTag('person', suggestion.id);
      if (suggestion.kind === 'task') addTag('task', suggestion.id);
      requestAnimationFrame(() => {
        composer.current?.focus();
        composer.current?.setSelectionRange(next.caret, next.caret);
      });
    },
    [mention, draft, setDraft, addTag]
  );

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages, pending]);

  return (
    <>
      <div className='min-h-0 flex-1 overflow-y-auto px-4 py-3'>
        {loadingThread ? (
          <p className='text-muted-foreground text-sm'>Loading…</p>
        ) : messages.length === 0 && pending.length === 0 ? (
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
                  (r) => r.emoji === emoji && r.personId === viewerPersonId
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

                    {m.tasks.length > 0 && (
                      <ul className='mt-1 flex flex-wrap gap-2'>
                        {m.tasks.map((t) => (
                          <li key={t.taskId}>
                            <Link
                              href={`/dashboard/tasks/${t.taskId}`}
                              className='hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs'
                            >
                              <IconChecklist className='size-3' />
                              <span className='font-medium'>
                                {t.templateCode ?? 'Task'}
                              </span>
                              {t.title}
                              {t.jobRef && (
                                <span className='text-muted-foreground'>
                                  · {t.jobRef}
                                </span>
                              )}
                            </Link>
                          </li>
                        ))}
                      </ul>
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
                        // A reaction somebody left is information about the
                        // message, so it stays. An empty one is an affordance,
                        // and affordances appear on hover.
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
                    <span className='text-foreground font-medium'>You</span> ·{' '}
                    {p.failed ? 'not sent' : 'sending…'}
                  </p>
                  <p className='text-sm break-words whitespace-pre-wrap'>
                    {p.body}
                  </p>
                  {p.failed && (
                    <button
                      type='button'
                      className='text-destructive text-xs underline'
                      onClick={() => recoverPending(p.localId)}
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
            Replying to {replyTo.authorName}: {truncate(replyTo.body ?? '', 60)}
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

      {mention && suggestions.length > 0 && (
        <ul
          role='listbox'
          aria-label='Mention suggestions'
          className='bg-popover mx-2 max-h-56 overflow-y-auto rounded-md border shadow-md'
        >
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.id}`}>
              <button
                type='button'
                role='option'
                aria-selected={i === highlight}
                onMouseEnter={() => setHighlight(i)}
                // Mouse down, not click: the textarea must not lose focus
                // before the choice is applied.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-accent' : ''
                }`}
              >
                {s.kind === 'person' ? (
                  <IconUser className='size-3.5 shrink-0' />
                ) : s.kind === 'job' ? (
                  <IconBriefcase className='size-3.5 shrink-0' />
                ) : (
                  <IconChecklist className='size-3.5 shrink-0' />
                )}
                <span className='min-w-0 flex-1'>
                  <span className='block truncate'>{s.label}</span>
                  {s.detail && (
                    <span className='text-muted-foreground block truncate text-xs'>
                      {s.detail}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
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
          // Offer only what evidence accepts, so the refusal happens in the
          // picker rather than after the attempt.
          accept={EVIDENCE_ACCEPT}
          className='hidden'
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void attach(file);
              e.target.value = '';
            }
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
          ref={composer}
          value={draft}
          onChange={(e) =>
            onDraftChange(e.target.value, e.target.selectionStart ?? 0)
          }
          onClick={(e) =>
            setMention(
              activeMentionQuery(draft, e.currentTarget.selectionStart ?? 0)
            )
          }
          onBlur={() => setMention(null)}
          onKeyDown={(e) => {
            const menuOpen = mention && suggestions.length > 0;
            if (menuOpen) {
              // While the menu is open it owns these keys, so Enter picks a
              // suggestion rather than sending a half-typed mention.
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) =>
                  moveHighlight(
                    h,
                    e.key === 'ArrowDown' ? 1 : -1,
                    suggestions.length
                  )
                );
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                choose(suggestions[highlight]);
                return;
              }
              if (e.key === 'Escape') {
                // Close the menu without closing the panel behind it.
                e.preventDefault();
                e.stopPropagation();
                setMention(null);
                return;
              }
            }
            // Enter sends; Shift+Enter is a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder={
            attaching ? 'Attaching…' : 'Message (Shift+Enter for a new line)'
          }
          aria-label='Message'
          className='focus-visible:ring-ring min-h-10 flex-1 resize-none rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
        />
        <Button type='submit' size='sm' disabled={!draft.trim()}>
          <IconSend />
          <span className='sr-only sm:not-sr-only'>Send</span>
        </Button>
      </form>
    </>
  );
}
