// Several conversations at once: a pure reducer keyed by conversation id.
//
// Every in-flight turn dispatches with the id of the conversation it started
// in, so a reply can only ever land in that conversation - switching, starting
// a new one or deleting another cannot redirect it. A turn for a conversation
// that has since been forgotten (deleted) is dropped.
import type { ConversationDetail } from '../protocol';
import {
  conversationReducer,
  initialConversation,
  type ConversationAction,
  type ConversationState
} from './conversation';

export interface ConversationsState {
  activeId: string;
  byId: Record<string, ConversationState>;
}

export type ConversationsAction =
  | { type: 'conversation'; conversationId: string; action: ConversationAction }
  /** Start (or switch to) a blank conversation. */
  | { type: 'new'; conversationId: string }
  /** Switch to a conversation; `loading` when it must be fetched first. */
  | { type: 'open'; conversationId: string; loading: boolean }
  | { type: 'loaded'; detail: ConversationDetail }
  | { type: 'load_failed'; conversationId: string }
  | { type: 'renamed'; conversationId: string; title: string }
  | { type: 'dismiss_long'; conversationId: string }
  /** Deleted: drop it, and move to a blank conversation if it was open. */
  | { type: 'forget'; conversationId: string; replacementId: string };

export const initialConversations = (id: string): ConversationsState => ({
  activeId: id,
  byId: { [id]: initialConversation(id) }
});

const update = (
  state: ConversationsState,
  id: string,
  change: (c: ConversationState) => ConversationState
): ConversationsState => {
  const current = state.byId[id];
  return current
    ? { ...state, byId: { ...state.byId, [id]: change(current) } }
    : state;
};

/** A conversation with nothing in it and nothing stored: safe to reuse for "New". */
export const isBlank = (c: ConversationState | undefined) =>
  !!c &&
  c.load === 'new' &&
  c.items.length === 0 &&
  c.status === 'idle' &&
  !c.summary;

export function conversationsReducer(
  state: ConversationsState,
  action: ConversationsAction
): ConversationsState {
  switch (action.type) {
    case 'conversation':
      return update(state, action.conversationId, (c) =>
        conversationReducer(c, action.action)
      );

    case 'new': {
      // Pressing New repeatedly does not pile up empty conversations.
      if (isBlank(state.byId[state.activeId])) return state;
      return {
        activeId: action.conversationId,
        byId: {
          ...state.byId,
          [action.conversationId]: initialConversation(action.conversationId)
        }
      };
    }

    case 'open': {
      const existing = state.byId[action.conversationId];
      if (existing) {
        return {
          activeId: action.conversationId,
          byId: action.loading
            ? {
                ...state.byId,
                [action.conversationId]: { ...existing, load: 'loading' }
              }
            : state.byId
        };
      }
      return {
        activeId: action.conversationId,
        byId: {
          ...state.byId,
          [action.conversationId]: {
            ...initialConversation(action.conversationId),
            load: action.loading ? 'loading' : 'new'
          }
        }
      };
    }

    case 'loaded':
      return update(state, action.detail.id, (c) =>
        // Never overwrite a conversation that is answering right now: what is
        // in memory is newer than what was stored.
        c.status === 'working'
          ? c
          : {
              ...c,
              load: 'ready',
              items: action.detail.items,
              transcript: [],
              title: action.detail.title,
              summary: action.detail.summary,
              sourceConversationId: action.detail.sourceConversationId,
              contextState: action.detail.contextState
            }
      );

    case 'load_failed':
      return update(state, action.conversationId, (c) =>
        c.load === 'loading' ? { ...c, load: 'error' } : c
      );

    case 'renamed':
      return update(state, action.conversationId, (c) => ({
        ...c,
        title: action.title
      }));

    case 'dismiss_long':
      return update(state, action.conversationId, (c) => ({
        ...c,
        longDismissed: true
      }));

    case 'forget': {
      const byId = { ...state.byId };
      delete byId[action.conversationId];
      if (state.activeId !== action.conversationId) return { ...state, byId };
      byId[action.replacementId] = initialConversation(action.replacementId);
      return { activeId: action.replacementId, byId };
    }
  }
}
