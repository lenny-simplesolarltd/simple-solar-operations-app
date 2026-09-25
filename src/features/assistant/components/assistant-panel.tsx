'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconArrowUp,
  IconFileText,
  IconPaperclip,
  IconPhoto,
  IconCheck,
  IconHistory,
  IconInfoCircle,
  IconLoader2,
  IconPlayerStopFilled,
  IconPlus,
  IconSunElectricity,
  IconX
} from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { describeContext, type AssistantPageContext } from '../context';
import type { ConversationItem, ConversationState } from '../lib/conversation';
import {
  ACCEPT_ATTRIBUTE,
  filesFrom,
  readAttachments,
  type AttachmentRejection
} from '../lib/attachments';
import { MAX_ATTACHMENTS, type Attachment } from '../protocol';
import type {
  AssistantCapabilities,
  HelpCardArticle,
  ProgrammeCandidate
} from '../protocol';
import { suggestionsFor, type AssistantSuggestion } from '../suggestions';
import { ActionCard } from './action-card';
import {
  ConversationHistory,
  type ConversationHistoryProps
} from './conversation-history';
import { FormattedText } from './formatted-text';
import { ResultCard } from './result-cards';
import { SourcesStrip } from './sources-strip';

export interface AssistantPanelProps {
  /** Off unless the person turned it on this session; never remembered. */
  overrideMode?: boolean;
  /** Absent when the shell does not offer the mode, which also hides the control. */
  onOverrideModeChange?: (on: boolean) => void;
  conversation: ConversationState;
  page: AssistantPageContext;
  capabilities: AssistantCapabilities | null;
  capabilitiesError?: boolean;
  onSend(text: string, attachments?: Attachment[]): void;
  onStop(): void;
  onRetry(errorId: string): void;
  onReset(): void;
  onDecide(actionId: string, decision: 'confirm' | 'cancel'): void;
  /** Omit to hide the panel's own close button (the mobile sheet has one). */
  onClose?: () => void;
  /** Called when a result link is followed. */
  onNavigate?: () => void;
  /** Focus the composer when this becomes true. */
  active?: boolean;
  headingId?: string;
  /** Saved conversations. Omit to hide history (e.g. in isolated previews). */
  history?: Omit<ConversationHistoryProps, 'activeId' | 'onNew'>;
  /** Start a new conversation from this one, optionally carrying a summary. */
  onHandoff?(withSummary: boolean): Promise<boolean>;
  /** "Keep going" on the long-conversation prompt. */
  onDismissLong?(): void;
}

/** The assistant surface. Presentational: every behaviour arrives through props. */
/**
 * Consecutive Help Centre results become one sources row.
 *
 * Several searches in a row is normal while SimpleBot works something out, and
 * each one used to render its own card. They say the same thing - here is what
 * I read - so they are folded together and shown once, in order, above
 * whatever the turn goes on to say.
 */
type RenderEntry =
  | { kind: 'item'; item: ConversationItem }
  | { kind: 'sources'; id: string; articles: HelpCardArticle[] };

function helpArticlesOf(item: ConversationItem): HelpCardArticle[] | null {
  if (item.kind !== 'tool' || item.state !== 'done' || !item.display) {
    return null;
  }
  if (item.display.kind === 'help_articles') return item.display.articles;
  if (item.display.kind === 'help_article') {
    return [item.display.article, ...item.display.related];
  }
  return null;
}

export function groupSources(items: ConversationItem[]): RenderEntry[] {
  const out: RenderEntry[] = [];
  for (const item of items) {
    const articles = helpArticlesOf(item);
    if (!articles) {
      out.push({ kind: 'item', item });
      continue;
    }
    const last = out.at(-1);
    if (last?.kind === 'sources') {
      last.articles = [...last.articles, ...articles];
    } else {
      out.push({ kind: 'sources', id: `sources-${item.id}`, articles });
    }
  }
  return out;
}

export function AssistantPanel({
  conversation,
  page,
  capabilities,
  capabilitiesError,
  onSend,
  onStop,
  onRetry,
  onReset,
  onDecide,
  onClose,
  onNavigate,
  active,
  headingId = 'assistant-heading',
  history,
  onHandoff,
  onDismissLong,
  overrideMode = false,
  onOverrideModeChange
}: AssistantPanelProps) {
  const [draft, setDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const working = conversation.status === 'working';
  const unavailable = capabilities !== null && !capabilities.configured;
  // A stored conversation is still loading: sending now would be dropped.
  const opening = conversation.load === 'loading';
  const context = describeContext(page);
  const suggestions = capabilities?.configured
    ? suggestionsFor(
        page.kind,
        capabilities.tools.map((t) => t.name)
      )
    : [];

  useEffect(() => {
    if (active) composerRef.current?.focus({ preventScroll: true });
  }, [active]);

  // Another conversation was opened (or started): show it from the bottom.
  useEffect(() => {
    pinnedRef.current = true;
  }, [conversation.threadId]);

  // Follow the conversation while the reader is at the bottom; leave them be if they scrolled up.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && pinnedRef.current) log.scrollTop = log.scrollHeight;
  }, [conversation.items, working]);

  // -- Attachments ---------------------------------------------------------
  // A screenshot or a row of data, attached to THIS message. They are read in
  // the browser, travel with the turn, and are not kept afterwards - so the
  // chips clear on send, and nothing here persists.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [rejected, setRejected] = useState<AttachmentRejection[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Whether this person may stage a property import. `apply_programme_import`
  // is the right signal because it already requires programme.manage, so the
  // client offer and the server's answer cannot drift apart. It is only an
  // offer: the route re-checks the session, the release gate and the permission
  // before it reads a single row of somebody's property register.
  const canImportProperties = Boolean(
    capabilities?.configured &&
      capabilities.tools.some((t) => t.name === 'apply_programme_import')
  );

  const take = async (files: File[]) => {
    if (files.length === 0) return;
    // A property list is far too big to travel through the model, so its bytes
    // go straight to the import pipeline and only a bounded summary comes back.
    const result = await readAttachments(files, attachments.length, {
      programmeImport: canImportProperties ? {} : undefined
    });
    if (result.attachments.length > 0) {
      setAttachments((current) =>
        [...current, ...result.attachments].slice(0, MAX_ATTACHMENTS)
      );
    }
    // Say what was not read, rather than dropping it quietly.
    setRejected(result.rejected);
  };

  const submit = () => {
    if (
      (!draft.trim() && attachments.length === 0) ||
      working ||
      unavailable ||
      opening
    )
      return;
    pinnedRef.current = true;
    onSend(
      draft.trim() ||
        // A bare attachment is still a question: say the obvious one.
        'Read the attached file and tell me what is in it.',
      attachments.length > 0 ? attachments : undefined
    );
    setDraft('');
    setAttachments([]);
    setRejected([]);
  };

  /** Put words in the composer and leave the sending to the person. */
  const prefill = (prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const choose = (suggestion: AssistantSuggestion) => {
    if (suggestion.mode === 'send') {
      pinnedRef.current = true;
      onSend(suggestion.prompt);
      return;
    }
    prefill(suggestion.prompt);
  };

  const blank =
    conversation.items.length === 0 &&
    !conversation.summary &&
    conversation.load === 'new';
  const startNew = () => {
    setShowHistory(false);
    onReset();
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const last = conversation.items[conversation.items.length - 1];
  const showThinking =
    working &&
    !(last?.kind === 'assistant' && last.streaming) &&
    !(last?.kind === 'tool' && last.state === 'running');

  return (
    <section
      aria-labelledby={headingId}
      className='bg-card text-card-foreground flex h-full min-h-0 w-full flex-col'
    >
      {/* Without its own close button the panel sits in the sheet, whose close button occupies the top-right corner. */}
      <header
        className={cn(
          'flex h-14 shrink-0 items-center gap-2.5 border-b pl-4',
          onClose ? 'pr-4' : 'pr-12'
        )}
      >
        <span
          aria-hidden
          className='bg-brand text-brand-ink flex size-7 shrink-0 items-center justify-center rounded-full'
        >
          <IconSunElectricity className='size-4' />
        </span>
        <div className='min-w-0 flex-1'>
          <h2 id={headingId} className='truncate text-sm font-semibold'>
            SimpleBot
          </h2>
          {conversation.title && !showHistory && (
            <p
              className='text-muted-foreground truncate text-xs leading-tight'
              title={conversation.title}
            >
              {conversation.title}
            </p>
          )}
        </div>
        {history && (
          <Button
            variant={showHistory ? 'secondary' : 'ghost'}
            size='icon'
            className='text-muted-foreground size-8'
            aria-pressed={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            <IconHistory aria-hidden />
            <span className='sr-only'>Conversation history</span>
          </Button>
        )}
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground h-8 px-2'
          onClick={startNew}
          disabled={blank && !showHistory}
        >
          <IconPlus aria-hidden />
          New
          <span className='sr-only'> conversation</span>
        </Button>
        {onClose && (
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            onClick={onClose}
          >
            <IconX aria-hidden />
            <span className='sr-only'>Close SimpleBot</span>
          </Button>
        )}
      </header>

      <div className='bg-muted/60 flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-xs'>
        <span className='text-muted-foreground shrink-0'>Viewing</span>
        <span
          className={cn(
            'shrink-0 font-semibold',
            page.kind === 'job' && 'font-mono'
          )}
        >
          {context.label}
        </span>
        {context.detail && (
          <span className='text-muted-foreground min-w-0 truncate'>
            {context.detail}
          </span>
        )}
      </div>

      {showHistory && history ? (
        <div
          role='region'
          aria-label='Conversation history'
          className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4'
        >
          <ConversationHistory
            {...history}
            activeId={conversation.threadId}
            onNew={startNew}
            onOpen={(id) => {
              setShowHistory(false);
              history.onOpen(id);
            }}
          />
        </div>
      ) : (
        <div
          ref={logRef}
          role='log'
          aria-label='Conversation'
          aria-live='polite'
          aria-relevant='additions'
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedRef.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className='focus-visible:ring-ring min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset'
        >
          {conversation.summary && (
            <details className='bg-muted/60 mb-3 rounded-lg px-3 py-2 text-sm'>
              <summary className='focus-visible:ring-ring cursor-pointer rounded text-xs font-medium outline-none focus-visible:ring-2'>
                Continuing from an earlier conversation
              </summary>
              <p className='text-muted-foreground mt-2 text-xs break-words whitespace-pre-wrap'>
                {conversation.summary}
              </p>
              <p className='text-muted-foreground/80 mt-2 text-[11px]'>
                Background only: SimpleBot checks live data again before relying
                on it.
              </p>
            </details>
          )}
          {conversation.load === 'loading' ? (
            <p className='text-muted-foreground flex items-center gap-2 text-sm'>
              <IconLoader2 aria-hidden className='size-4 animate-spin' />
              Opening conversation…
            </p>
          ) : conversation.load === 'error' ? (
            <Notice
              tone='error'
              action={
                <Button
                  size='sm'
                  variant='outline'
                  className='text-foreground h-7 shrink-0'
                  onClick={startNew}
                >
                  New
                </Button>
              }
            >
              This conversation could not be opened.
            </Notice>
          ) : conversation.items.length === 0 ? (
            conversation.summary ? (
              <p className='text-muted-foreground text-sm'>
                Ask your next question. The background above came with you; the
                original conversation is still in your history.
              </p>
            ) : (
              <Welcome
                capabilities={capabilities}
                capabilitiesError={capabilitiesError}
                suggestions={suggestions}
                onChoose={choose}
              />
            )
          ) : (
            <ol className='flex flex-col gap-3'>
              {groupSources(conversation.items).map((entry) =>
                entry.kind === 'sources' ? (
                  <li key={entry.id}>
                    <SourcesStrip
                      articles={entry.articles}
                      onNavigate={onNavigate}
                    />
                  </li>
                ) : (
                  <li key={entry.item.id}>
                    <Item
                      item={entry.item}
                      onRetry={onRetry}
                      onDecide={onDecide}
                      onNavigate={onNavigate}
                      // Picking a candidate only drafts the message naming it:
                      // the person still sends it, so a card can never start a
                      // turn - let alone a change - on its own.
                      onSelectCandidate={(_candidate, prompt) =>
                        prefill(prompt)
                      }
                      busy={working}
                    />
                  </li>
                )
              )}
              {showThinking && (
                <li className='text-muted-foreground flex items-center gap-2 text-sm'>
                  <IconLoader2 aria-hidden className='size-4 animate-spin' />
                  Working…
                </li>
              )}
            </ol>
          )}
        </div>
      )}

      <footer
        hidden={showHistory}
        className='shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
      >
        {conversation.contextState?.level === 'long' &&
          !conversation.longDismissed &&
          !working &&
          onHandoff && (
            <LongConversationPrompt
              onHandoff={onHandoff}
              onKeepGoing={() => onDismissLong?.()}
            />
          )}
        {conversation.items.length > 0 &&
          suggestions.length > 0 &&
          !working && (
            <div className='-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1'>
              {suggestions.slice(0, 3).map((s) => (
                <SuggestionChip
                  key={s.label}
                  suggestion={s}
                  onChoose={choose}
                  compact
                />
              ))}
            </div>
          )}
        {(attachments.length > 0 || rejected.length > 0) && (
          <div className='mb-1.5 flex flex-wrap gap-1.5'>
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className='bg-muted text-muted-foreground flex max-w-56 items-center gap-1.5 rounded-md py-1 pr-1 pl-2 text-xs'
              >
                {a.kind === 'image' ? (
                  <IconPhoto className='size-3.5 shrink-0' aria-hidden />
                ) : (
                  <IconFileText className='size-3.5 shrink-0' aria-hidden />
                )}
                <span className='truncate'>{a.name}</span>
                <button
                  type='button'
                  onClick={() =>
                    setAttachments((c) => c.filter((_, n) => n !== i))
                  }
                  className='hover:text-foreground rounded p-0.5'
                >
                  <IconX className='size-3.5' aria-hidden />
                  <span className='sr-only'>Remove {a.name}</span>
                </button>
              </span>
            ))}
            {rejected.map((r) => (
              <span
                key={r.name}
                className='text-muted-foreground flex items-center gap-1 text-xs'
              >
                <IconAlertTriangle className='size-3.5 shrink-0' aria-hidden />
                {r.name}: {r.reason}
              </span>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          onDragOver={(e) => {
            if (unavailable || opening) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            if (unavailable || opening) return;
            e.preventDefault();
            setDragging(false);
            void take(filesFrom(e.dataTransfer));
          }}
          className={cn(
            'border-input focus-within:border-ring focus-within:ring-ring/40 bg-background flex items-end gap-2 rounded-lg border p-1.5 transition-shadow focus-within:ring-[3px]',
            dragging && 'border-ring ring-ring/40 ring-[3px]'
          )}
        >
          <input
            ref={fileRef}
            type='file'
            multiple
            accept={ACCEPT_ATTRIBUTE}
            className='sr-only'
            onChange={(e) => {
              void take(Array.from(e.target.files ?? []));
              // Let the same file be chosen again after removing it.
              e.target.value = '';
            }}
          />
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='size-9 shrink-0 rounded-md'
            disabled={
              unavailable || opening || attachments.length >= MAX_ATTACHMENTS
            }
            onClick={() => fileRef.current?.click()}
          >
            <IconPaperclip aria-hidden />
            <span className='sr-only'>Attach a screenshot or file</span>
          </Button>
          <label htmlFor='assistant-composer' className='sr-only'>
            Message SimpleBot
          </label>
          <textarea
            id='assistant-composer'
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              // Screenshot straight from the clipboard, the way people expect.
              const files = filesFrom(e.clipboardData);
              if (files.length > 0) {
                e.preventDefault();
                void take(files);
              }
            }}
            onKeyDown={(e) => {
              // Shift+Tab cycles the mode without leaving the keyboard, and
              // without stealing plain Tab, which still moves focus.
              if (e.key === 'Tab' && e.shiftKey && onOverrideModeChange) {
                e.preventDefault();
                onOverrideModeChange(!overrideMode);
                return;
              }
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={4000}
            disabled={unavailable || opening}
            placeholder={
              unavailable
                ? 'SimpleBot is not available yet'
                : opening
                  ? 'Opening conversation…'
                  : 'Ask about a job, a customer or your tasks'
            }
            className='placeholder:text-muted-foreground field-sizing-content max-h-36 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none disabled:cursor-not-allowed md:text-sm'
          />
          {working ? (
            <Button
              type='button'
              size='icon'
              variant='secondary'
              className='size-9 shrink-0 rounded-md'
              onClick={onStop}
            >
              <IconPlayerStopFilled aria-hidden />
              <span className='sr-only'>Stop</span>
            </Button>
          ) : (
            <Button
              type='submit'
              size='icon'
              className='size-9 shrink-0 rounded-md'
              disabled={
                (!draft.trim() && attachments.length === 0) ||
                unavailable ||
                opening
              }
            >
              <IconArrowUp aria-hidden />
              <span className='sr-only'>Send</span>
            </Button>
          )}
        </form>
        {onOverrideModeChange && (
          <button
            type='button'
            onClick={() => onOverrideModeChange(!overrideMode)}
            aria-pressed={overrideMode}
            className={cn(
              'mt-1.5 flex w-full items-center gap-1.5 rounded px-1 text-left text-[11px] leading-snug',
              overrideMode
                ? 'text-destructive'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span
              className={cn(
                'inline-block size-1.5 rounded-full',
                overrideMode ? 'bg-destructive' : 'bg-muted-foreground/40'
              )}
              aria-hidden
            />
            {overrideMode
              ? 'Override mode on · task overrides run without asking'
              : 'Override mode off'}
            <span className='text-muted-foreground/70 ml-auto font-mono'>
              shift+tab
            </span>
          </button>
        )}
        <p className='text-muted-foreground mt-1.5 px-1 text-[11px] leading-snug'>
          {overrideMode
            ? 'Answers come from live job and task data you have access to. Task overrides run straight away; everything else still asks.'
            : 'Answers come from live job and task data you have access to. Changes always need your confirmation.'}
        </p>
        {capabilities?.diagnostics && (
          <p className='text-muted-foreground/80 mt-1 px-1 font-mono text-[10px]'>
            dev · {capabilities.diagnostics.provider} ·{' '}
            {capabilities.diagnostics.model}
            {conversation.servedBy &&
              conversation.servedBy !== capabilities.diagnostics.model &&
              ` → ${conversation.servedBy}`}
          </p>
        )}
      </footer>
    </section>
  );
}

/**
 * Shown when a conversation has grown large enough that answers may suffer.
 * Never blocks: the staff member can keep going.
 */
function LongConversationPrompt({
  onHandoff,
  onKeepGoing
}: {
  onHandoff(withSummary: boolean): Promise<boolean>;
  onKeepGoing(): void;
}) {
  const [withSummary, setWithSummary] = useState(true);
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');
  return (
    <div
      role='status'
      className='bg-info-soft text-info mb-2 rounded-lg px-3 py-2.5 text-sm'
    >
      <p className='font-medium'>This conversation is getting long</p>
      <p className='mt-0.5 text-xs'>
        Starting a fresh conversation gives SimpleBot more room to work. You can
        carry a summary of this conversation into the new one.
      </p>
      <label className='mt-2 flex items-center gap-2 text-xs'>
        <input
          type='checkbox'
          checked={withSummary}
          onChange={(e) => setWithSummary(e.target.checked)}
          className='size-3.5 accent-current'
        />
        Carry a summary into the new conversation
      </label>
      {state === 'failed' && (
        <p className='text-destructive mt-1 text-xs' role='alert'>
          A new conversation could not be started. Try again.
        </p>
      )}
      <div className='mt-2 flex flex-wrap gap-2'>
        <Button
          size='sm'
          className='h-7'
          disabled={state === 'working'}
          onClick={async () => {
            setState('working');
            setState((await onHandoff(withSummary)) ? 'idle' : 'failed');
          }}
        >
          {state === 'working' && (
            <IconLoader2 aria-hidden className='animate-spin' />
          )}
          Start new conversation
        </Button>
        <Button
          size='sm'
          variant='outline'
          className='text-foreground h-7'
          disabled={state === 'working'}
          onClick={onKeepGoing}
        >
          Keep going
        </Button>
      </div>
    </div>
  );
}

function SuggestionChip({
  suggestion,
  onChoose,
  compact
}: {
  suggestion: AssistantSuggestion;
  onChoose(s: AssistantSuggestion): void;
  compact?: boolean;
}) {
  return (
    <button
      type='button'
      onClick={() => onChoose(suggestion)}
      className={cn(
        'hover:bg-accent hover:border-brand focus-visible:ring-ring bg-background rounded-md border text-left text-sm transition-colors outline-none focus-visible:ring-2',
        compact ? 'shrink-0 px-2.5 py-1 text-xs whitespace-nowrap' : 'px-3 py-2'
      )}
    >
      {suggestion.label}
      {suggestion.mode === 'prefill' && (
        <span className='text-muted-foreground'>…</span>
      )}
    </button>
  );
}

function Welcome({
  capabilities,
  capabilitiesError,
  suggestions,
  onChoose
}: {
  capabilities: AssistantCapabilities | null;
  capabilitiesError?: boolean;
  suggestions: AssistantSuggestion[];
  onChoose(s: AssistantSuggestion): void;
}) {
  if (capabilitiesError) {
    return (
      <Notice tone='error'>
        SimpleBot could not load. Close and reopen it to try again.
      </Notice>
    );
  }
  if (!capabilities) {
    return (
      <p className='text-muted-foreground flex items-center gap-2 text-sm'>
        <IconLoader2 aria-hidden className='size-4 animate-spin' />
        Getting ready…
      </p>
    );
  }
  if (!capabilities.configured) {
    return (
      <div className='flex flex-col gap-3'>
        <Notice tone='info'>
          <span className='font-medium'>SimpleBot isn’t switched on yet.</span>{' '}
          {capabilities.notice}
        </Notice>
        <CapabilityList capabilities={capabilities} />
      </div>
    );
  }
  return (
    <div className='flex flex-col gap-4'>
      {capabilities.developmentMode && (
        <Notice tone='warning'>
          Development router: no language model is configured, so only a few set
          phrases work. Results still come from the real application.
        </Notice>
      )}
      <p className='text-sm'>
        Ask in plain English. I look things up in Simple Solar Operations with
        your access, and show you what I found.
      </p>
      {suggestions.length > 0 && (
        <div className='flex flex-col gap-1.5'>
          <p className='text-muted-foreground text-xs font-medium'>
            Try from here
          </p>
          {suggestions.map((s) => (
            <SuggestionChip key={s.label} suggestion={s} onChoose={onChoose} />
          ))}
        </div>
      )}
      <CapabilityList capabilities={capabilities} />
    </div>
  );
}

function CapabilityList({
  capabilities
}: {
  capabilities: AssistantCapabilities;
}) {
  return (
    <details className='group text-sm'>
      <summary className='text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer rounded text-xs font-medium outline-none focus-visible:ring-2'>
        What SimpleBot can do today
      </summary>
      <ul className='mt-2 flex flex-col gap-1'>
        {capabilities.tools.map((tool) => (
          <li key={tool.name} className='flex gap-2 text-xs'>
            <IconCheck
              aria-hidden
              className='text-success mt-px size-3.5 shrink-0'
            />
            {tool.summary}
          </li>
        ))}
      </ul>
      <p className='text-muted-foreground mt-3 text-xs font-medium'>
        Not available yet
      </p>
      <ul className='text-muted-foreground mt-1 flex flex-col gap-1'>
        {capabilities.planned.map((tool) => (
          <li key={tool.name} className='text-xs'>
            {tool.summary}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Notice({
  tone,
  children,
  action
}: {
  tone: 'info' | 'warning' | 'error';
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = tone === 'info' ? IconInfoCircle : IconAlertTriangle;
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm',
        tone === 'info' && 'bg-info-soft text-info',
        tone === 'warning' && 'bg-warning-soft text-warning',
        tone === 'error' && 'bg-destructive-soft text-destructive'
      )}
    >
      <Icon aria-hidden className='mt-0.5 size-4 shrink-0' />
      <div className='min-w-0 flex-1'>{children}</div>
      {action}
    </div>
  );
}

function Item({
  item,
  onRetry,
  onDecide,
  onNavigate,
  onSelectCandidate,
  busy
}: {
  item: ConversationItem;
  onRetry(errorId: string): void;
  onDecide(actionId: string, decision: 'confirm' | 'cancel'): void;
  onNavigate?: () => void;
  onSelectCandidate?: (candidate: ProgrammeCandidate, prompt: string) => void;
  busy: boolean;
}) {
  switch (item.kind) {
    case 'user':
      return (
        <div className='flex justify-end'>
          <p className='bg-secondary text-secondary-foreground max-w-[88%] rounded-lg rounded-br-sm px-3 py-2 text-sm break-words whitespace-pre-wrap'>
            <span className='sr-only'>You: </span>
            {item.text}
          </p>
        </div>
      );

    case 'assistant':
      return (
        <div>
          <span className='sr-only'>SimpleBot: </span>
          <FormattedText text={item.text} />
        </div>
      );

    case 'tool':
      if (item.state === 'done' && item.display) {
        return (
          <ResultCard
            card={item.display}
            onNavigate={onNavigate}
            onSelectCandidate={onSelectCandidate}
          />
        );
      }
      return (
        <p
          className={cn(
            'flex items-center gap-2 text-xs',
            item.state === 'error'
              ? 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          {item.state === 'running' ? (
            <IconLoader2 aria-hidden className='size-3.5 animate-spin' />
          ) : item.state === 'error' ? (
            <IconAlertTriangle aria-hidden className='size-3.5' />
          ) : (
            <IconCheck aria-hidden className='size-3.5' />
          )}
          {item.state === 'error'
            ? `${item.label} didn’t work`
            : `${item.label}${item.state === 'running' ? '…' : ''}`}
        </p>
      );

    case 'proposal':
      return (
        <ActionCard item={item} onDecide={onDecide} onNavigate={onNavigate} />
      );

    case 'stopped':
      return <p className='text-muted-foreground text-xs'>Stopped.</p>;

    case 'note':
      return (
        <p className='text-muted-foreground flex items-center gap-2 text-xs'>
          <IconCheck aria-hidden className='size-3.5' />
          {item.text}
        </p>
      );

    case 'error':
      return (
        <Notice
          tone={item.error.code === 'NOT_CONFIGURED' ? 'info' : 'error'}
          action={
            item.error.retryable &&
            item.retryText && (
              <Button
                size='sm'
                variant='outline'
                className='text-foreground h-7 shrink-0'
                disabled={busy}
                onClick={() => onRetry(item.id)}
              >
                Retry
              </Button>
            )
          }
        >
          {item.error.message}
        </Notice>
      );
  }
}
