'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { AssistantContext } from '../context';
import {
  conversationReducer,
  initialConversation,
  type ConversationState
} from '../lib/conversation';
import {
  AssistantRequestError,
  streamAssistantTurn
} from '../lib/stream-client';
import type { ActionResponse } from '../protocol';

const newId = () => crypto.randomUUID();

export interface AssistantConversation {
  state: ConversationState;
  send(text: string): void;
  stop(): void;
  retry(errorId: string): void;
  reset(): void;
  decide(actionId: string, decision: 'confirm' | 'cancel'): void;
}

/**
 * v1 conversations are ephemeral: they live in this hook (mounted in the
 * dashboard layout, so they survive navigation) and are gone on reload.
 * Persistent threads can replace the reducer's storage without touching the UI:
 * everything already carries a threadId.
 */
export function useAssistantConversation(
  getContext: () => AssistantContext | undefined
): AssistantConversation {
  const [state, dispatch] = useReducer(conversationReducer, undefined, () =>
    initialConversation(newId())
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(
    (raw: string, retryOf?: string) => {
      const text = raw.trim();
      const current = stateRef.current;
      if (!text || current.status === 'working') return;

      const controller = new AbortController();
      abortRef.current = controller;
      dispatch(
        retryOf
          ? { type: 'retry', errorId: retryOf, text }
          : { type: 'send', id: newId(), text }
      );

      void (async () => {
        try {
          const events = streamAssistantTurn(
            {
              threadId: current.threadId,
              message: text,
              transcript: current.transcript,
              context: getContext()
            },
            controller.signal
          );
          let finished = false;
          for await (const event of events) {
            if (controller.signal.aborted) return;
            dispatch({ type: 'event', id: newId(), event });
            if (event.type === 'turn_end' || event.type === 'error')
              finished = true;
          }
          if (!finished && !controller.signal.aborted) {
            dispatch({
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
          dispatch({
            type: 'request_failed',
            id: newId(),
            error:
              error instanceof AssistantRequestError
                ? error.info
                : {
                    code: 'UNEXPECTED',
                    message:
                      'The assistant hit an unexpected error. Nothing was changed.',
                    retryable: true
                  }
          });
        }
      })();
    },
    [getContext]
  );

  const send = useCallback((text: string) => run(text), [run]);
  const retry = useCallback(
    (errorId: string) => {
      const item = stateRef.current.items.find((i) => i.id === errorId);
      if (item?.kind === 'error' && item.retryText)
        run(item.retryText, errorId);
    },
    [run]
  );

  const stop = useCallback(() => {
    if (stateRef.current.status !== 'working') return;
    abortRef.current?.abort();
    dispatch({ type: 'stopped', id: newId() });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    dispatch({ type: 'reset', threadId: newId() });
  }, []);

  const decide = useCallback(
    (actionId: string, decision: 'confirm' | 'cancel') => {
      const item = stateRef.current.items.find(
        (i) => i.kind === 'proposal' && i.action.actionId === actionId
      );
      if (!item || item.kind !== 'proposal') return;
      if (
        item.state !== 'pending' &&
        !(item.state === 'failed' && item.retryable)
      )
        return;

      dispatch({ type: 'proposal_state', actionId, state: 'working' });
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
              message:
                'The assistant could not be reached. Nothing was confirmed.',
              retryable: true
            }
          };
        }
        dispatch(
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
    []
  );

  return useMemo(
    () => ({ state, send, stop, retry, reset, decide }),
    [state, send, stop, retry, reset, decide]
  );
}
