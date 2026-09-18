import 'server-only';

import type { ToolCall, TranscriptMessage } from '../../protocol';

/**
 * The seam between the assistant and whichever language model answers.
 *
 * The orchestrator owns the conversation loop, tool execution and every safety
 * rule; a provider only turns "conversation + tool definitions" into "text
 * and/or tool requests". Swapping vendors means writing one adapter - nothing
 * else in the application imports a vendor SDK.
 */

export interface ModelToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's input. */
  inputSchema: Record<string, unknown>;
}

/** A transcript message, plus (within one server turn only) the provider's own raw form of an assistant message. */
export type ModelMessage = TranscriptMessage & { providerRaw?: unknown };

export interface ModelRequest {
  system: {
    /** Identical across requests for the same tool set - cacheable. */
    stable: string;
    /** Per-request facts (who is signed in, page hint, date). */
    volatile: string;
  };
  messages: ModelMessage[];
  tools: ModelToolSpec[];
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
  /** Echoed back on the next request of the same turn (e.g. reasoning blocks some vendors require). Never sent to the browser. */
  providerRaw?: unknown;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface GenerateOptions {
  signal?: AbortSignal;
  /** Called with text as it is produced, when the provider streams. */
  onTextDelta?: (text: string) => void;
}

export interface AssistantModelProvider {
  /** Stable identifier, e.g. 'anthropic'. Recorded in assistant audit metadata. */
  readonly id: string;
  readonly model: string;
  generate(
    request: ModelRequest,
    options?: GenerateOptions
  ): Promise<ModelTurn>;
}

export type ProviderErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH'
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'BAD_REQUEST'
  | 'NETWORK'
  | 'ABORTED'
  | 'UNKNOWN';

export class AssistantProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'AssistantProviderError';
  }
}
