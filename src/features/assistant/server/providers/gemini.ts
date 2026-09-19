import 'server-only';

import { randomUUID } from 'node:crypto';
import type { ToolCall } from '../../protocol';
import {
  AssistantProviderError,
  type AssistantModelProvider,
  type GenerateOptions,
  type ModelMessage,
  type ModelRequest,
  type ModelTurn
} from './types';

const PROVIDER_ID = 'gemini';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

// A hard ceiling on one reply, as in the other adapters: it caps spend per
// request rather than shaping the answer.
const MAX_OUTPUT_TOKENS = 16_000;

// -- Wire types (Gemini API, generateContent) -----------------------------------

interface GeminiPart {
  text?: string;
  /** True on reasoning summaries; never shown to staff. */
  thought?: boolean;
  /** Opaque reasoning state. Must be returned unchanged with the part it came on. */
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: {
    id?: string;
    name: string;
    response: Record<string, unknown>;
  };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiChunk {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  /** The concrete model behind an alias such as gemini-flash-latest. */
  modelVersion?: string;
}

type RawAssistant = { provider: typeof PROVIDER_ID; content: GeminiContent };

const isRaw = (value: unknown): value is RawAssistant =>
  typeof value === 'object' &&
  value !== null &&
  (value as RawAssistant).provider === PROVIDER_ID;

const BLOCKED = new Set([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY'
]);

/** Tool output is a JSON envelope; Gemini wants a JSON object, not a string. */
function toResponseObject(content: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { result: parsed };
  } catch {
    return { result: content };
  }
}

const SYNTHETIC_ID = 'gemini_';

/**
 * Gemini pairs a functionResponse with its functionCall by id when the call
 * had one. Ids this adapter had to invent (the API sent none) are not echoed.
 */
const callId = (id: string) => (id.startsWith(SYNTHETIC_ID) ? {} : { id });

export function toGeminiContents(messages: ModelMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];
  const push = (role: GeminiContent['role'], parts: GeminiPart[]) => {
    const last = contents[contents.length - 1];
    // Gemini expects alternating turns: fold consecutive same-role messages
    // (an app event followed by the staff message) into one.
    if (
      last &&
      last.role === role &&
      !last.parts.some((p) => p.functionResponse)
    ) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };

  for (const message of messages) {
    switch (message.role) {
      case 'user':
        push('user', [{ text: message.text }]);
        break;
      case 'event':
        // Application events travel in the user channel, clearly marked. They
        // come back from the browser, so they get no operator authority.
        push('user', [{ text: `<app_event>${message.text}</app_event>` }]);
        break;
      case 'tool':
        contents.push({
          role: 'user',
          parts: message.results.map((r) => ({
            functionResponse: {
              ...callId(r.callId),
              name: r.name,
              response: toResponseObject(r.content)
            }
          }))
        });
        break;
      case 'assistant': {
        // Within a turn, replay the model's own parts unchanged: current
        // Gemini models reject a tool loop whose thought signatures are missing.
        if (isRaw(message.providerRaw)) {
          contents.push(message.providerRaw.content);
          break;
        }
        const parts: GeminiPart[] = [];
        if (message.text) parts.push({ text: message.text });
        for (const call of message.toolCalls) {
          parts.push({
            functionCall: {
              ...callId(call.id),
              name: call.name,
              args: (call.args ?? {}) as Record<string, unknown>
            }
          });
        }
        contents.push({
          role: 'model',
          parts: parts.length ? parts : [{ text: '(no reply)' }]
        });
        break;
      }
    }
  }
  return contents;
}

function errorFromResponse(
  status: number,
  body: unknown
): AssistantProviderError {
  const error = (
    body as {
      error?: {
        status?: string;
        message?: string;
        details?: { reason?: string }[];
      };
    }
  )?.error;
  const reasons = (error?.details ?? []).map((d) => d.reason);
  // Kept for server logs only; the browser only ever sees the safe wording below.
  const cause = new Error(
    `gemini ${status} ${error?.status ?? ''} ${error?.message ?? ''}`.trim()
  );
  // Google reports a bad key as 400 INVALID_ARGUMENT with reason API_KEY_INVALID.
  const badKey =
    status === 401 ||
    status === 403 ||
    reasons.includes('API_KEY_INVALID') ||
    /api key/i.test(error?.message ?? '');

  if (badKey) {
    return new AssistantProviderError(
      'AUTH',
      'SimpleBot’s model credentials were rejected. Ask an administrator to check the configuration.',
      false,
      { cause }
    );
  }
  if (status === 429) {
    return new AssistantProviderError(
      'RATE_LIMITED',
      'SimpleBot has reached its usage limit for the moment. Try again shortly.',
      true,
      { cause }
    );
  }
  if (status === 404) {
    return new AssistantProviderError(
      'BAD_REQUEST',
      'SimpleBot’s configured model was not found. Ask an administrator to check GEMINI_MODEL.',
      false,
      { cause }
    );
  }
  if (status >= 500) {
    return new AssistantProviderError(
      'OVERLOADED',
      'SimpleBot’s language model is temporarily unavailable. Try again shortly.',
      true,
      { cause }
    );
  }
  return new AssistantProviderError(
    'BAD_REQUEST',
    'SimpleBot could not process that conversation. Start a new conversation and try again.',
    false,
    { cause }
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(
        new AssistantProviderError(
          'ABORTED',
          'The request was cancelled.',
          false
        )
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Yields the JSON payload of each server-sent event. */
async function* sseEvents(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<GeminiChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('');
      if (data) yield JSON.parse(data) as GeminiChunk;
    }
  }
}

export class GeminiProvider implements AssistantModelProvider {
  readonly id = PROVIDER_ID;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly retryDelaysMs: readonly number[] = [800, 2000, 4000]
  ) {}

  async generate(
    request: ModelRequest,
    options: GenerateOptions = {}
  ): Promise<ModelTurn> {
    const url = `${ENDPOINT}/models/${encodeURIComponent(this.model)}:streamGenerateContent?alt=sse`;
    const init: RequestInit = {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        // In a header, never the URL, so the key cannot end up in request logs.
        'x-goog-api-key': this.apiKey
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            { text: request.system.stable },
            { text: request.system.volatile }
          ]
        },
        contents: toGeminiContents(request.messages),
        ...(request.tools.length > 0 && {
          tools: [
            {
              functionDeclarations: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.inputSchema
              }))
            }
          ],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } }
        }),
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS }
      })
    };

    // "Model is experiencing high demand" (503) is routine and brief. It is
    // reported before any output, so retrying cannot duplicate text or tools.
    let response: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetchImpl(url, init);
      } catch (error) {
        if (options.signal?.aborted) {
          throw new AssistantProviderError(
            'ABORTED',
            'The request was cancelled.',
            false
          );
        }
        throw new AssistantProviderError(
          'NETWORK',
          'SimpleBot could not reach its language model. Check the connection and try again.',
          true,
          { cause: error }
        );
      }
      if (response.status < 500 || attempt >= this.retryDelaysMs.length) break;
      await response.body?.cancel().catch(() => {});
      await sleep(this.retryDelaysMs[attempt], options.signal);
    }

    if (!response.ok || !response.body) {
      throw errorFromResponse(
        response.status,
        await response.json().catch(() => null)
      );
    }

    const parts: GeminiPart[] = [];
    let text = '';
    let finishReason: string | undefined;
    let blockReason: string | undefined;
    let usage: GeminiChunk['usageMetadata'];
    let servedBy: string | undefined;

    try {
      for await (const chunk of sseEvents(response.body)) {
        blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
        usage = chunk.usageMetadata ?? usage;
        servedBy = chunk.modelVersion ?? servedBy;
        const candidate = chunk.candidates?.[0];
        finishReason = candidate?.finishReason ?? finishReason;
        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && !part.thought) {
            text += part.text;
            options.onTextDelta?.(part.text);
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw new AssistantProviderError(
          'ABORTED',
          'The request was cancelled.',
          false
        );
      }
      throw new AssistantProviderError(
        'NETWORK',
        'The reply from SimpleBot’s language model was interrupted. Try again.',
        true,
        { cause: error }
      );
    }

    const refused = !!blockReason || BLOCKED.has(finishReason ?? '');
    if (finishReason === 'MALFORMED_FUNCTION_CALL' && !text) {
      throw new AssistantProviderError(
        'UNKNOWN',
        'SimpleBot produced a reply it could not use. Try again.',
        true
      );
    }

    // Gemini does not always supply call ids; the orchestrator needs one per
    // call to pair results, and responses are matched back by order and name.
    const toolCalls: ToolCall[] = refused
      ? []
      : parts
          .filter((p) => p.functionCall)
          .map((p) => ({
            id: p.functionCall!.id ?? `${SYNTHETIC_ID}${randomUUID()}`,
            name: p.functionCall!.name,
            args: p.functionCall!.args ?? {}
          }));

    return {
      text,
      toolCalls,
      stopReason: refused
        ? 'refusal'
        : finishReason === 'MAX_TOKENS'
          ? 'max_tokens'
          : toolCalls.length > 0
            ? 'tool_use'
            : 'end',
      providerRaw: {
        provider: PROVIDER_ID,
        content: { role: 'model', parts }
      } satisfies RawAssistant,
      servedBy,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0
      }
    };
  }
}
