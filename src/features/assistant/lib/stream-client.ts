import type {
  AssistantErrorInfo,
  AssistantStreamEvent,
  ChatRequest
} from '../protocol';

export class AssistantRequestError extends Error {
  constructor(readonly info: AssistantErrorInfo) {
    super(info.message);
  }
}

const NETWORK_ERROR: AssistantErrorInfo = {
  code: 'NETWORK',
  message:
    'SimpleBot could not be reached. Check your connection and try again.',
  retryable: true
};

/** POSTs one turn and yields the server's newline-delimited events as they arrive. */
export async function* streamAssistantTurn(
  body: ChatRequest,
  signal: AbortSignal
): AsyncGenerator<AssistantStreamEvent> {
  let response: Response;
  try {
    response = await fetch('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AssistantRequestError(NETWORK_ERROR);
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new AssistantRequestError({
      code: payload?.error?.code ?? 'UNEXPECTED',
      message:
        payload?.error?.message ??
        (response.status === 401
          ? 'Your session has ended. Sign in again to use SimpleBot.'
          : 'SimpleBot hit an unexpected error. Nothing was changed.'),
      retryable: response.status >= 500 && response.status !== 503
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as AssistantStreamEvent;
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AssistantRequestError(NETWORK_ERROR);
  }
}
