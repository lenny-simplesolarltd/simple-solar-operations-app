import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { ToolCall } from '../../protocol';
import {
  AssistantProviderError,
  type AssistantModelProvider,
  type GenerateOptions,
  type ModelMessage,
  type ModelRequest,
  type ModelTurn
} from './types';

const PROVIDER_ID = 'anthropic';

// A hard ceiling on one reply. Drawer answers are short; this caps spend per
// request rather than shaping the answer.
const MAX_TOKENS = 16_000;

type RawAssistant = {
  provider: typeof PROVIDER_ID;
  content: Anthropic.ContentBlock[];
};

const isRaw = (value: unknown): value is RawAssistant =>
  typeof value === 'object' &&
  value !== null &&
  (value as RawAssistant).provider === PROVIDER_ID;

export function toAnthropicMessages(
  messages: ModelMessage[]
): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    switch (message.role) {
      case 'user': {
        const images = (message.attachments ?? []).filter(
          (a) => a.kind === 'image'
        );
        if (images.length === 0) {
          return { role: 'user', content: message.text };
        }
        // Image first, then the question about it. Text attachments are
        // already folded into message.text by the caller, in a marked
        // envelope, so they need nothing here.
        return {
          role: 'user',
          content: [
            ...images.map(
              (a): Anthropic.ImageBlockParam => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: a.mediaType,
                  data: a.data
                }
              })
            ),
            { type: 'text', text: message.text }
          ]
        };
      }
      case 'event':
        // Application events travel in the user channel, clearly marked. They
        // come back from the browser, so they get no operator authority.
        return {
          role: 'user',
          content: `<app_event>${message.text}</app_event>`
        };
      case 'tool':
        return {
          role: 'user',
          content: message.results.map(
            (r): Anthropic.ToolResultBlockParam => ({
              type: 'tool_result',
              tool_use_id: r.callId,
              content: r.content,
              is_error: !r.ok
            })
          )
        };
      case 'assistant': {
        // Within a turn, replay the model's own blocks unchanged (reasoning
        // blocks must accompany the tool calls they led to).
        if (isRaw(message.providerRaw)) {
          return { role: 'assistant', content: message.providerRaw.content };
        }
        const blocks: Anthropic.ContentBlockParam[] = [];
        if (message.text) blocks.push({ type: 'text', text: message.text });
        for (const call of message.toolCalls) {
          blocks.push({
            type: 'tool_use',
            id: call.id,
            name: call.name,
            input: call.args ?? {}
          });
        }
        return {
          role: 'assistant',
          content: blocks.length
            ? blocks
            : [{ type: 'text', text: '(no reply)' }]
        };
      }
    }
  });
}

function toProviderError(error: unknown): AssistantProviderError {
  if (error instanceof AssistantProviderError) return error;
  if (error instanceof Anthropic.APIUserAbortError) {
    return new AssistantProviderError(
      'ABORTED',
      'The request was cancelled.',
      false
    );
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new AssistantProviderError(
      'AUTH',
      'SimpleBot’s model credentials were rejected. Ask an administrator to check the configuration.',
      false,
      { cause: error }
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AssistantProviderError(
      'RATE_LIMITED',
      'SimpleBot is handling too many requests. Try again in a moment.',
      true,
      { cause: error }
    );
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AssistantProviderError(
      'BAD_REQUEST',
      'SimpleBot could not process that conversation. Start a new conversation and try again.',
      false,
      { cause: error }
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AssistantProviderError(
      'NETWORK',
      'SimpleBot could not reach its language model. Check the connection and try again.',
      true,
      { cause: error }
    );
  }
  if (error instanceof Anthropic.APIError) {
    const overloaded = typeof error.status === 'number' && error.status >= 500;
    return new AssistantProviderError(
      overloaded ? 'OVERLOADED' : 'UNKNOWN',
      overloaded
        ? 'SimpleBot’s language model is temporarily unavailable. Try again shortly.'
        : 'SimpleBot hit an unexpected error.',
      overloaded,
      { cause: error }
    );
  }
  return new AssistantProviderError(
    'UNKNOWN',
    'SimpleBot hit an unexpected error.',
    false,
    { cause: error }
  );
}

export class AnthropicProvider implements AssistantModelProvider {
  readonly id = PROVIDER_ID;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Anthropic
  ) {
    this.client = client ?? new Anthropic({ apiKey });
  }

  async generate(
    request: ModelRequest,
    options: GenerateOptions = {}
  ): Promise<ModelTurn> {
    try {
      const stream = this.client.messages.stream(
        {
          model: this.model,
          max_tokens: MAX_TOKENS,
          // Thinking is adaptive by default on current models; effort trades
          // depth for latency, and lookups in a drawer favour latency.
          output_config: { effort: 'medium' },
          system: [
            {
              type: 'text',
              text: request.system.stable,
              cache_control: { type: 'ephemeral' }
            },
            { type: 'text', text: request.system.volatile }
          ],
          // Inputs here are small identifiers and filters, so tool input is
          // left server-validated rather than eagerly streamed.
          tools: request.tools.map(
            (tool): Anthropic.Tool => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.inputSchema as Anthropic.Tool.InputSchema
            })
          ),
          messages: toAnthropicMessages(request.messages)
        },
        { signal: options.signal }
      );
      if (options.onTextDelta) stream.on('text', options.onTextDelta);

      const message = await stream.finalMessage();

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolCalls: ToolCall[] = message.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, args: b.input }));

      const stopReason: ModelTurn['stopReason'] =
        message.stop_reason === 'refusal'
          ? 'refusal'
          : message.stop_reason === 'max_tokens'
            ? 'max_tokens'
            : toolCalls.length > 0
              ? 'tool_use'
              : 'end';

      return {
        text,
        toolCalls,
        stopReason,
        providerRaw: {
          provider: PROVIDER_ID,
          content: message.content
        } satisfies RawAssistant,
        usage: {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens
        }
      };
    } catch (error) {
      throw toProviderError(error);
    }
  }
}
