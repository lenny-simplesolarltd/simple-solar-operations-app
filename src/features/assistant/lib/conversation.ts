// Conversation state for the drawer: a pure reducer, so the streaming
// behaviour can be tested without a browser.
import type {
  AssistantErrorInfo,
  AssistantStreamEvent,
  ContextState,
  DisplayCard,
  PendingActionView,
  TranscriptMessage
} from '../protocol';

export type ProposalState =
  | 'pending'
  | 'working'
  | 'confirmed'
  | 'cancelled'
  | 'failed';

export type ConversationItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; streaming: boolean }
  | {
      id: string;
      kind: 'tool';
      callId: string;
      tool: string;
      label: string;
      state: 'running' | 'done' | 'error';
      display?: DisplayCard;
      error?: { code: string; message: string };
    }
  | {
      id: string;
      kind: 'proposal';
      action: PendingActionView;
      state: ProposalState;
      message?: string;
      retryable?: boolean;
      display?: DisplayCard;
    }
  | { id: string; kind: 'error'; error: AssistantErrorInfo; retryText: string }
  /** A decision recorded in the app (e.g. a proposal confirmed or cancelled). */
  | { id: string; kind: 'note'; text: string }
  | { id: string; kind: 'stopped' };

export interface ConversationState {
  threadId: string;
  items: ConversationItem[];
  /**
   * What the model is sent next time. Only completed turns are committed, so a
   * failed or cancelled turn never leaves half an exchange behind.
   */
  transcript: TranscriptMessage[];
  status: 'idle' | 'working';
  /** The message being answered, kept for Retry. */
  pendingText: string | null;
  /** The turn being answered. Kept after a failure so Retry re-uses it and a turn is never stored twice. */
  pendingRunId: string | null;
  /** Development diagnostics: the concrete model that answered the last turn. */
  servedBy?: string;
  /** Stored conversations: 'new' has nothing stored yet; 'loading'/'error' while opening one. */
  load: 'new' | 'loading' | 'ready' | 'error';
  title: string | null;
  /** Background carried in from an earlier conversation. */
  summary: string | null;
  sourceConversationId: string | null;
  contextState: ContextState | null;
  /** The staff member chose "Keep going" on the long-conversation prompt. */
  longDismissed: boolean;
}

export type ConversationAction =
  | { type: 'send'; id: string; text: string; runId: string }
  /** Re-runs the message behind an error row, replacing that row instead of repeating the staff message. */
  | { type: 'retry'; errorId: string; text: string }
  | { type: 'event'; id: string; event: AssistantStreamEvent }
  | { type: 'request_failed'; id: string; error: AssistantErrorInfo }
  | { type: 'stopped'; id: string }
  | {
      type: 'proposal_state';
      actionId: string;
      state: ProposalState;
      message?: string;
      retryable?: boolean;
      display?: DisplayCard;
      transcript?: TranscriptMessage[];
    }
  | { type: 'reset'; threadId: string };

export const initialConversation = (threadId: string): ConversationState => ({
  threadId,
  items: [],
  transcript: [],
  status: 'idle',
  pendingText: null,
  pendingRunId: null,
  load: 'new',
  title: null,
  summary: null,
  sourceConversationId: null,
  contextState: null,
  longDismissed: false
});

/** Keeps the browser-held transcript inside what the server accepts, cutting at a staff message so tool calls stay paired with their results. */
export function trimTranscript(
  transcript: TranscriptMessage[],
  max = 60
): TranscriptMessage[] {
  if (transcript.length <= max) return transcript;
  const tail = transcript.slice(-max);
  const firstUser = tail.findIndex((m) => m.role === 'user');
  return firstUser > 0 ? tail.slice(firstUser) : tail;
}

const settle = (items: ConversationItem[]): ConversationItem[] =>
  items
    .map((item): ConversationItem => {
      if (item.kind === 'assistant' && item.streaming) {
        return { ...item, streaming: false };
      }
      if (item.kind === 'tool' && item.state === 'running') {
        return {
          ...item,
          state: 'error',
          error: { code: 'INTERRUPTED', message: 'Interrupted.' }
        };
      }
      return item;
    })
    .filter((item) => !(item.kind === 'assistant' && item.text.trim() === ''));

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction
): ConversationState {
  switch (action.type) {
    case 'reset':
      return initialConversation(action.threadId);

    case 'send':
      return {
        ...state,
        status: 'working',
        pendingText: action.text,
        pendingRunId: action.runId,
        items: [
          ...state.items,
          { id: action.id, kind: 'user', text: action.text }
        ]
      };

    case 'retry':
      return {
        ...state,
        status: 'working',
        pendingText: action.text,
        items: state.items.filter((item) => item.id !== action.errorId)
      };

    case 'request_failed':
      return {
        ...state,
        status: 'idle',
        items: [
          ...settle(state.items),
          {
            id: action.id,
            kind: 'error',
            error: action.error,
            retryText: state.pendingText ?? ''
          }
        ]
      };

    case 'stopped':
      return {
        ...state,
        status: 'idle',
        pendingText: null,
        pendingRunId: null,
        items: [...settle(state.items), { id: action.id, kind: 'stopped' }]
      };

    case 'proposal_state':
      return {
        ...state,
        transcript: action.transcript
          ? trimTranscript([...state.transcript, ...action.transcript])
          : state.transcript,
        items: state.items.map((item) =>
          item.kind === 'proposal' && item.action.actionId === action.actionId
            ? {
                ...item,
                state: action.state,
                message: action.message,
                retryable: action.retryable,
                display: action.display
              }
            : item
        )
      };

    case 'event':
      return applyEvent(state, action.id, action.event);
  }
}

function applyEvent(
  state: ConversationState,
  id: string,
  event: AssistantStreamEvent
): ConversationState {
  const items = state.items;
  switch (event.type) {
    case 'turn_start':
      return state;

    case 'text_delta': {
      const last = items[items.length - 1];
      if (last?.kind === 'assistant' && last.streaming) {
        return {
          ...state,
          items: [
            ...items.slice(0, -1),
            { ...last, text: last.text + event.text }
          ]
        };
      }
      return {
        ...state,
        items: [
          ...items,
          { id, kind: 'assistant', text: event.text, streaming: true }
        ]
      };
    }

    case 'tool_start':
      return {
        ...state,
        items: [
          ...items.map((item) =>
            item.kind === 'assistant' && item.streaming
              ? { ...item, streaming: false }
              : item
          ),
          {
            id,
            kind: 'tool',
            callId: event.callId,
            tool: event.tool,
            label: event.label,
            state: 'running'
          }
        ]
      };

    case 'tool_result':
      return {
        ...state,
        items: items.map((item) =>
          item.kind === 'tool' && item.callId === event.callId
            ? {
                ...item,
                state: event.ok ? 'done' : 'error',
                display: event.display,
                error: event.error
              }
            : item
        )
      };

    case 'proposal':
      return {
        ...state,
        items: [
          // The proposal card replaces the "working" row for the same call.
          ...items.filter(
            (item) => !(item.kind === 'tool' && item.callId === event.callId)
          ),
          { id, kind: 'proposal', action: event.action, state: 'pending' }
        ]
      };

    // Override mode ran it already: the same card, but settled on arrival, so
    // there is nothing to press and no way to run it twice.
    case 'action_settled':
      return {
        ...state,
        items: [
          ...items.filter(
            (item) => !(item.kind === 'tool' && item.callId === event.callId)
          ),
          {
            id,
            kind: 'proposal',
            action: event.action,
            state: event.result.ok ? 'confirmed' : 'failed',
            message: event.result.ok
              ? 'Done · override mode'
              : event.result.error.message,
            display: event.result.ok ? event.result.display : undefined
          }
        ]
      };

    case 'turn_end':
      return {
        ...state,
        status: 'idle',
        pendingText: null,
        pendingRunId: null,
        items: settle(items),
        servedBy: event.servedBy ?? state.servedBy,
        transcript: trimTranscript([...state.transcript, ...event.transcript]),
        ...(event.conversation && {
          load: 'ready' as const,
          title: event.conversation.title ?? state.title,
          contextState: event.conversation.contextState
        })
      };

    case 'error': {
      const error = {
        code: event.code,
        message: event.message,
        retryable: event.retryable
      };
      return {
        ...state,
        status: 'idle',
        items: [
          ...settle(items),
          { id, kind: 'error', error, retryText: state.pendingText ?? '' }
        ]
      };
    }
  }
}
