import 'server-only';

import type { AssistantContext } from '../../context';
import type { StoredUi } from '../../lib/history';
import type {
  AssistantStreamEvent,
  ConversationTurnInfo,
  TranscriptMessage
} from '../../protocol';
import type { AssistantAuditSink } from '../audit';
import { runAssistantTurn } from '../orchestrator';
import type { PendingActionService } from '../pending-actions';
import type { AssistantModelProvider } from '../providers/types';
import type { ToolActor, ToolRegistry } from '../registry';
import {
  buildHistory,
  contextProfileFor,
  contextStateFor,
  estimateTokens
} from './context-window';
import type { ConversationStore, NewMessage } from './store';
import { deriveTitle } from './titles';

type TurnEnd = Extract<AssistantStreamEvent, { type: 'turn_end' }>;

export interface ConversationTurnInput {
  actor: ToolActor;
  /** Null: conversations are not stored here; `transcript` from the browser is used. */
  store: ConversationStore | null;
  threadId: string;
  runId: string;
  message: string;
  transcript?: TranscriptMessage[];
  context?: AssistantContext;
  provider: AssistantModelProvider;
  registry: ToolRegistry;
  pendingActions: PendingActionService | null;
  /** Passed straight through: see runTurn for what it does and does not change. */
  overrideMode?: boolean;
  audit?: AssistantAuditSink;
  signal?: AbortSignal;
  emit: (event: AssistantStreamEvent) => void;
}

/**
 * One staff turn in a (possibly stored) conversation.
 *
 * Lifecycle: history is read from the database (never from the browser), the
 * turn streams as before, and only when it has finished is it written - in one
 * atomic append, idempotent per run - after which `turn_end` is released with
 * the conversation's new state. So streaming never writes partial rows, and:
 *   completed -> stored;
 *   stopped   -> the question and whatever text had arrived, marked stopped;
 *   failed    -> nothing stored; Retry re-sends the same run.
 */
export async function runConversationTurn(
  input: ConversationTurnInput
): Promise<void> {
  const { store, threadId, provider, emit } = input;
  const profile = contextProfileFor(provider.id);

  let history: TranscriptMessage[] = input.transcript ?? [];
  let hadTitle = false;
  let summaryTokens = 0;
  if (store) {
    const record = await store.ensure(threadId);
    if (!record) {
      emit({
        type: 'error',
        code: 'NOT_FOUND',
        message:
          'That conversation could not be found. Start a new conversation.',
        retryable: false
      });
      return;
    }
    hadTitle = record.title !== null;
    summaryTokens = estimateTokens(record.summary ?? '');
    history = buildHistory({
      messages: await store.messages(threadId),
      summary: record.summary,
      profile
    }).history;
  }

  let turnEnd: TurnEnd | null = null;
  let failed = false;
  let streamedText = '';
  let promptTokens: number | undefined;
  const tools: NonNullable<StoredUi['tools']> = {};

  await runAssistantTurn({
    actor: input.actor,
    threadId,
    message: input.message,
    transcript: history,
    context: input.context,
    provider,
    registry: input.registry,
    pendingActions: input.pendingActions,
    overrideMode: input.overrideMode,
    audit: input.audit,
    signal: input.signal,
    onUsage: (tokens) => {
      promptTokens = tokens;
    },
    emit: (event) => {
      switch (event.type) {
        case 'turn_end':
          // Held back until the turn is stored.
          turnEnd = event;
          return;
        case 'error':
          failed = true;
          break;
        case 'text_delta':
          streamedText += event.text;
          break;
        case 'tool_start':
          tools[event.callId] = { label: event.label, ok: false };
          break;
        case 'tool_result':
          tools[event.callId] = {
            label: tools[event.callId]?.label ?? 'Working',
            ok: event.ok,
            ...(event.display && { display: event.display }),
            ...(event.error && { error: event.error })
          };
          break;
        case 'proposal':
          tools[event.callId] = { label: event.action.title, ok: true };
          break;
      }
      emit(event);
    }
  });

  const finished = turnEnd as TurnEnd | null;
  if (finished) {
    let conversation: ConversationTurnInfo | undefined;
    if (store) {
      conversation = await save(finished.transcript, 'complete').catch(
        (error: unknown) => {
          // eslint-disable-next-line no-console -- server-side diagnostics; the reply was still shown
          console.error('assistant conversation save failed', error);
          return undefined;
        }
      );
    }
    emit({ ...finished, ...(conversation && { conversation }) });
    return;
  }

  if (!failed && input.signal?.aborted && store) {
    // Stopped by the staff member: keep the question and what had arrived, as
    // a plain exchange (no half-finished tool calls), so history stays valid.
    await save(
      [
        { role: 'user', text: input.message },
        { role: 'assistant', text: streamedText, toolCalls: [] }
      ],
      'stopped'
    ).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- server-side diagnostics
      console.error('assistant conversation save (stopped) failed', error);
    });
  }

  async function save(
    turn: TranscriptMessage[],
    status: 'complete' | 'stopped'
  ): Promise<ConversationTurnInfo> {
    const rows: NewMessage[] = turn.map((content, index) => {
      const ui: StoredUi | null =
        content.role === 'tool'
          ? {
              tools: Object.fromEntries(
                content.results
                  .filter((r) => tools[r.callId])
                  .map((r) => [r.callId, tools[r.callId]])
              )
            }
          : null;
      return {
        content,
        ui,
        pageContext: index === 0 ? (input.context ?? null) : null,
        status: content.role === 'assistant' ? status : 'complete',
        estimatedTokens: estimateTokens(content)
      };
    });
    const result = await store!.append({
      conversationId: threadId,
      runId: input.runId,
      messages: rows,
      provider: provider.id,
      model: provider.model,
      title: hadTitle ? null : deriveTitle(turn),
      jobId: subjectJob(),
      promptTokens
    });
    return {
      id: threadId,
      title: result.title,
      contextState: contextStateFor(
        result.estimatedTokens + summaryTokens,
        profile
      )
    };
  }

  /**
   * The job this turn was about, when a tool read exactly one job. Only ids a
   * tool returned under the staff member's own access qualify - never the
   * page hint - and the link grants nothing: reading the job later goes
   * through its own access rules again.
   */
  function subjectJob(): string | null {
    const ids = new Set<string>();
    for (const shown of Object.values(tools)) {
      const card = shown.ok ? shown.display : undefined;
      if (card?.kind === 'job_summary') ids.add(card.job.id);
      if (card?.kind === 'job_list' && card.jobs.length === 1) {
        ids.add(card.jobs[0].id);
      }
    }
    return ids.size === 1 ? Array.from(ids)[0] : null;
  }
}
