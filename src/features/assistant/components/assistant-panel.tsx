'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  IconAlertTriangle,
  IconArrowUp,
  IconCheck,
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
import type { AssistantCapabilities } from '../protocol';
import { suggestionsFor, type AssistantSuggestion } from '../suggestions';
import { ActionCard } from './action-card';
import { FormattedText } from './formatted-text';
import { ResultCard } from './result-cards';

export interface AssistantPanelProps {
  conversation: ConversationState;
  page: AssistantPageContext;
  capabilities: AssistantCapabilities | null;
  capabilitiesError?: boolean;
  onSend(text: string): void;
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
}

/** The assistant surface. Presentational: every behaviour arrives through props. */
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
  headingId = 'assistant-heading'
}: AssistantPanelProps) {
  const [draft, setDraft] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const working = conversation.status === 'working';
  const unavailable = capabilities !== null && !capabilities.configured;
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

  // Follow the conversation while the reader is at the bottom; leave them be if they scrolled up.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log && pinnedRef.current) log.scrollTop = log.scrollHeight;
  }, [conversation.items, working]);

  const submit = () => {
    if (!draft.trim() || working || unavailable) return;
    pinnedRef.current = true;
    onSend(draft);
    setDraft('');
  };

  const choose = (suggestion: AssistantSuggestion) => {
    if (suggestion.mode === 'send') {
      pinnedRef.current = true;
      onSend(suggestion.prompt);
      return;
    }
    setDraft(suggestion.prompt);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
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
        <h2
          id={headingId}
          className='min-w-0 flex-1 truncate text-sm font-semibold'
        >
          Simple Solar Assistant
        </h2>
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground h-8 px-2'
          onClick={onReset}
          disabled={conversation.items.length === 0}
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
            <span className='sr-only'>Close assistant</span>
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
        {conversation.items.length === 0 ? (
          <Welcome
            capabilities={capabilities}
            capabilitiesError={capabilitiesError}
            suggestions={suggestions}
            onChoose={choose}
          />
        ) : (
          <ol className='flex flex-col gap-3'>
            {conversation.items.map((item) => (
              <li key={item.id}>
                <Item
                  item={item}
                  onRetry={onRetry}
                  onDecide={onDecide}
                  onNavigate={onNavigate}
                  busy={working}
                />
              </li>
            ))}
            {showThinking && (
              <li className='text-muted-foreground flex items-center gap-2 text-sm'>
                <IconLoader2 aria-hidden className='size-4 animate-spin' />
                Working…
              </li>
            )}
          </ol>
        )}
      </div>

      <footer className='shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'>
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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className='border-input focus-within:border-ring focus-within:ring-ring/40 bg-background flex items-end gap-2 rounded-lg border p-1.5 transition-shadow focus-within:ring-[3px]'
        >
          <label htmlFor='assistant-composer' className='sr-only'>
            Message the assistant
          </label>
          <textarea
            id='assistant-composer'
            ref={composerRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
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
            disabled={unavailable}
            placeholder={
              unavailable
                ? 'The assistant is not available yet'
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
              disabled={!draft.trim() || unavailable}
            >
              <IconArrowUp aria-hidden />
              <span className='sr-only'>Send</span>
            </Button>
          )}
        </form>
        <p className='text-muted-foreground mt-1.5 px-1 text-[11px] leading-snug'>
          Answers come from live job and task data you have access to. Changes
          always need your confirmation.
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
        The assistant could not load. Close and reopen it to try again.
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
          <span className='font-medium'>
            The assistant isn’t switched on yet.
          </span>{' '}
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
        What the assistant can do today
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
  busy
}: {
  item: ConversationItem;
  onRetry(errorId: string): void;
  onDecide(actionId: string, decision: 'confirm' | 'cancel'): void;
  onNavigate?: () => void;
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
          <span className='sr-only'>Assistant: </span>
          <FormattedText text={item.text} />
        </div>
      );

    case 'tool':
      if (item.state === 'done' && item.display) {
        return <ResultCard card={item.display} onNavigate={onNavigate} />;
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
