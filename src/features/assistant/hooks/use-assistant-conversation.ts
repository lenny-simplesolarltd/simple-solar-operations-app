'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from 'react';
import type { AssistantContext } from '../context';
import type { ConversationState } from '../lib/conversation';
import {
  conversationsReducer,
  initialConversations,
  isBlank,
  type ConversationsAction
} from '../lib/conversations';
import {
  AssistantRequestError,
  streamAssistantTurn
} from '../lib/stream-client';
import type {
  ActionResponse,
  Attachment,
  ConversationDetail,
  ConversationListItem
} from '../protocol';

const newId = () => crypto.randomUUID();
const ACTIVE_KEY = 'simplebot.activeConversation';

/** The conversation on screen: what the panel renders and drives. */
export interface AssistantConversation {
  state: ConversationState;
  send(text: string, attachments?: Attachment[]): void;
  stop(): void;
  retry(errorId: string): void;
  /** Start a new conversation. The current one stays in history. */
  reset(): void;
  decide(actionId: string, decision: 'confirm' | 'cancel'): void;
}

export interface ConversationList {
  status: 'idle' | 'loading' | 'ready' | 'error';
  items: ConversationListItem[];
}

export interface AssistantConversations extends AssistantConversation {
  /** 'persistent' once the server confirms conversations are stored. */
  mode: 'persistent' | 'ephemeral';
  list: ConversationList;
  archived: ConversationList;
  /** Conversations with a reply in progress (any of them, not just the open one). */
  workingIds: string[];
  refreshList(options?: { archived?: boolean }): void;
  open(id: string): void;
  rename(id: string, title: string): Promise<boolean>;
  setArchived(id: string, archived: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** Start a new conversation from the open one, optionally carrying a summary. */
  handoff(withSummary: boolean): Promise<boolean>;
  dismissLong(): void;
}

const readStoredActive = (): string | null => {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};
const writeStoredActive = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Storage blocked: the conversation simply is not reopened after a reload.
  }
};

async function jsonOrNull<T>(response: Response): Promise<T | null> {
  return response.ok ? ((await response.json()) as T) : null;
}

/**
 * All of the staff member's SimpleBot conversations in this browser session.
 *
 * Stored conversations live on the server (owner-only). This hook keeps the
 * ones opened in this session in memory, keyed by id, with one request and one
 * AbortController per conversation - so a reply streams into the conversation
 * it was asked in, whichever one is on screen, and several conversations can
 * be answering at once. Where conversations are not stored ('ephemeral') it
 * behaves as before: the transcript lives here and is sent with each turn.
 */
export function useAssistantConversations(
  getContext: () => AssistantContext | undefined,
  mode: 'persistent' | 'ephemeral',
  /**
   * Read at send time, not captured once, so toggling the mode applies to the
   * next message rather than to whichever render installed the handler.
   */
  getOverrideMode: () => boolean = () => false
): AssistantConversations {
  const [state, dispatch] = useReducer(conversationsReducer, undefined, () =>
    initialConversations(newId())
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const aborts = useRef(new Map<string, AbortController>());
  const [list, setList] = useState<ConversationList>({
    status: 'idle',
    items: []
  });
  const [archived, setArchivedList] = useState<ConversationList>({
    status: 'idle',
    items: []
  });

  useEffect(() => {
    const running = aborts.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  const inConversation = useCallback(
    (conversationId: string) =>
      (
        action: Extract<ConversationsAction, { type: 'conversation' }>['action']
      ) =>
        dispatch({ type: 'conversation', conversationId, action }),
    []
  );

  const refreshList = useCallback(
    ({ archived: wantArchived = false } = {}) => {
      if (mode !== 'persistent') return;
      const set = wantArchived ? setArchivedList : setList;
      set((l) => ({ ...l, status: l.items.length ? l.status : 'loading' }));
      fetch(`/api/assistant/conversations${wantArchived ? '?archived=1' : ''}`)
        .then((r) => jsonOrNull<{ conversations: ConversationListItem[] }>(r))
        .then((data) =>
          set(
            data
              ? { status: 'ready', items: data.conversations }
              : (l) => ({ ...l, status: 'error' })
          )
        )
        .catch(() => set((l) => ({ ...l, status: 'error' })));
    },
    [mode]
  );

  /** `quiet`: a conversation remembered from before a reload; if it cannot be opened, start afresh without an error. */
  const load = useCallback((id: string, quiet = false) => {
    const failed = () => {
      if (!quiet) return dispatch({ type: 'load_failed', conversationId: id });
      writeStoredActive(null);
      dispatch({ type: 'forget', conversationId: id, replacementId: newId() });
    };
    fetch(`/api/assistant/conversations/${id}`)
      .then((r) => jsonOrNull<ConversationDetail>(r))
      .then((detail) =>
        detail ? dispatch({ type: 'loaded', detail }) : failed()
      )
      .catch(failed);
  }, []);

  const open = useCallback(
    (id: string, quiet = false) => {
      const known = stateRef.current.byId[id];
      const needsLoad =
        mode === 'persistent' && (!known || known.load === 'error');
      dispatch({ type: 'open', conversationId: id, loading: needsLoad });
      if (needsLoad) load(id, quiet);
      if (mode === 'persistent') writeStoredActive(id);
    },
    [mode, load]
  );

  // Reopen the conversation that was on screen before a reload.
  const restored = useRef(false);
  useEffect(() => {
    if (mode !== 'persistent' || restored.current) return;
    restored.current = true;
    const stored = readStoredActive();
    if (stored && isBlank(stateRef.current.byId[stateRef.current.activeId])) {
      open(stored, true);
    }
  }, [mode, open]);

  const run = useCallback(
    (raw: string, retryOf?: string, attachments?: Attachment[]) => {
      const text = raw.trim();
      const conversationId = stateRef.current.activeId;
      const current = stateRef.current.byId[conversationId];
      if (!text || !current || current.status === 'working') return;
      if (current.load === 'loading') return;

      const to = inConversation(conversationId);
      const runId = (retryOf && current.pendingRunId) || newId();
      const controller = new AbortController();
      aborts.current.set(conversationId, controller);
      to(
        retryOf
          ? { type: 'retry', errorId: retryOf, text }
          : {
              type: 'send',
              id: newId(),
              text,
              runId,
              // Names only. The bytes travel with the turn and are not kept, so
              // this is what lets the sent message show what went with it.
              ...(attachments?.length && {
                attachments: attachments.map((a) => ({
                  name: a.name,
                  kind:
                    a.kind === 'image' ? ('image' as const) : ('text' as const)
                }))
              })
            }
      );
      if (mode === 'persistent') writeStoredActive(conversationId);

      void (async () => {
        try {
          const events = streamAssistantTurn(
            {
              threadId: conversationId,
              runId,
              message: text,
              ...(attachments?.length && { attachments }),
              // Stored conversations are read from the server, not sent from here.
              ...(mode === 'ephemeral' && { transcript: current.transcript }),
              overrideMode: getOverrideMode(),
              context: getContext()
            },
            controller.signal
          );
          let finished = false;
          for await (const event of events) {
            if (controller.signal.aborted) return;
            to({ type: 'event', id: newId(), event });
            if (event.type === 'turn_end') {
              finished = true;
              if (event.conversation) refreshList();
            }
            if (event.type === 'error') finished = true;
          }
          if (!finished && !controller.signal.aborted) {
            to({
              type: 'request_failed',
              id: newId(),
              error: {
                code: 'INTERRUPTED',
                message:
                  'The reply was interrupted before it finished. Nothing was changed.',
                retryable: true
              }
            });
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          to({
            type: 'request_failed',
            id: newId(),
            error:
              error instanceof AssistantRequestError
                ? error.info
                : {
                    code: 'UNEXPECTED',
                    message:
                      'SimpleBot hit an unexpected error. Nothing was changed.',
                    retryable: true
                  }
          });
        } finally {
          if (aborts.current.get(conversationId) === controller) {
            aborts.current.delete(conversationId);
          }
        }
      })();
    },
    [getContext, inConversation, mode, refreshList]
  );

  const send = useCallback(
    (text: string, attachments?: Attachment[]) =>
      run(text, undefined, attachments),
    [run]
  );
  const retry = useCallback(
    (errorId: string) => {
      const current = stateRef.current.byId[stateRef.current.activeId];
      const item = current?.items.find((i) => i.id === errorId);
      if (item?.kind === 'error' && item.retryText)
        run(item.retryText, errorId);
    },
    [run]
  );

  const stop = useCallback(() => {
    const id = stateRef.current.activeId;
    if (stateRef.current.byId[id]?.status !== 'working') return;
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    inConversation(id)({ type: 'stopped', id: newId() });
    // The server stores what had arrived; show it in the list.
    setTimeout(() => refreshList(), 800);
  }, [inConversation, refreshList]);

  const reset = useCallback(() => {
    // The open conversation keeps running (if it is) and stays in history.
    dispatch({ type: 'new', conversationId: newId() });
    writeStoredActive(null);
  }, []);

  const decide = useCallback(
    (actionId: string, decision: 'confirm' | 'cancel') => {
      const conversationId = stateRef.current.activeId;
      const to = inConversation(conversationId);
      const item = stateRef.current.byId[conversationId]?.items.find(
        (i) => i.kind === 'proposal' && i.action.actionId === actionId
      );
      if (!item || item.kind !== 'proposal') return;
      if (
        item.state !== 'pending' &&
        !(item.state === 'failed' && item.retryable)
      )
        return;

      to({ type: 'proposal_state', actionId, state: 'working' });
      void (async () => {
        let result: ActionResponse;
        try {
          const response = await fetch('/api/assistant/actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Only the decision and the server-signed token: never the arguments.
            body: JSON.stringify({ decision, token: item.action.token })
          });
          result = (await response.json()) as ActionResponse;
        } catch {
          result = {
            ok: false,
            error: {
              code: 'NETWORK',
              message: 'SimpleBot could not be reached. Nothing was confirmed.',
              retryable: true
            }
          };
        }
        to(
          result.ok
            ? {
                type: 'proposal_state',
                actionId,
                state:
                  result.decision === 'confirm' ? 'confirmed' : 'cancelled',
                message: result.message,
                display: result.display,
                transcript: result.transcript
              }
            : {
                type: 'proposal_state',
                actionId,
                state: 'failed',
                message: result.error.message,
                retryable: result.error.retryable
              }
        );
      })();
    },
    [inConversation]
  );

  const rename = useCallback(async (id: string, title: string) => {
    const response = await fetch(`/api/assistant/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    }).catch(() => null);
    const updated = response
      ? await jsonOrNull<ConversationListItem>(response)
      : null;
    if (!updated) return false;
    dispatch({
      type: 'renamed',
      conversationId: id,
      title: updated.title ?? title
    });
    setList((l) => ({
      ...l,
      items: l.items.map((c) =>
        c.id === id ? { ...c, title: updated.title } : c
      )
    }));
    return true;
  }, []);

  const setArchived = useCallback(
    async (id: string, value: boolean) => {
      const response = await fetch(`/api/assistant/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: value })
      }).catch(() => null);
      if (!response?.ok) return false;
      if (value && stateRef.current.activeId === id) {
        dispatch({ type: 'new', conversationId: newId() });
        writeStoredActive(null);
      }
      refreshList();
      refreshList({ archived: true });
      return true;
    },
    [refreshList]
  );

  const remove = useCallback(async (id: string) => {
    const response = await fetch(`/api/assistant/conversations/${id}`, {
      method: 'DELETE'
    }).catch(() => null);
    if (!response?.ok) return false;
    aborts.current.get(id)?.abort();
    aborts.current.delete(id);
    dispatch({ type: 'forget', conversationId: id, replacementId: newId() });
    if (readStoredActive() === id) writeStoredActive(null);
    setList((l) => ({ ...l, items: l.items.filter((c) => c.id !== id) }));
    setArchivedList((l) => ({
      ...l,
      items: l.items.filter((c) => c.id !== id)
    }));
    return true;
  }, []);

  const handoff = useCallback(
    async (withSummary: boolean) => {
      const sourceId = stateRef.current.activeId;
      if (mode !== 'persistent') {
        dispatch({ type: 'new', conversationId: newId() });
        return true;
      }
      const response = await fetch(
        `/api/assistant/conversations/${sourceId}/handoff`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ withSummary })
        }
      ).catch(() => null);
      const created = response
        ? await jsonOrNull<{ id: string; summary: string | null }>(response)
        : null;
      if (!created) return false;
      dispatch({ type: 'open', conversationId: created.id, loading: false });
      dispatch({
        type: 'loaded',
        detail: {
          id: created.id,
          title: null,
          lastMessageAt: null,
          createdAt: new Date().toISOString(),
          archived: false,
          messageCount: 0,
          jobId: null,
          summary: created.summary,
          sourceConversationId: sourceId,
          contextState: { estimatedTokens: 0, level: 'ok' },
          items: []
        }
      });
      writeStoredActive(created.id);
      refreshList();
      return true;
    },
    [mode, refreshList]
  );

  const dismissLong = useCallback(
    () =>
      dispatch({
        type: 'dismiss_long',
        conversationId: stateRef.current.activeId
      }),
    []
  );

  const workingIds = useMemo(
    () =>
      Object.values(state.byId)
        .filter((c) => c.status === 'working')
        .map((c) => c.threadId),
    [state.byId]
  );

  return useMemo(
    () => ({
      state: state.byId[state.activeId],
      send,
      stop,
      retry,
      reset,
      decide,
      mode,
      list,
      archived,
      workingIds,
      refreshList,
      open,
      rename,
      setArchived,
      remove,
      handoff,
      dismissLong
    }),
    [
      state,
      send,
      stop,
      retry,
      reset,
      decide,
      mode,
      list,
      archived,
      workingIds,
      refreshList,
      open,
      rename,
      setArchived,
      remove,
      handoff,
      dismissLong
    ]
  );
}
