import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider, toAnthropicMessages } from '../providers/anthropic';
import { DevRouterProvider } from '../providers/dev-router';
import { resolveProvider } from '../providers';

describe('provider configuration', () => {
  it('is off, with a staff-readable notice, when nothing is configured', () => {
    const result = resolveProvider({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.notice).toMatch(/not switched on/);
  });

  it('does not turn on paid usage just because a key exists', () => {
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'sk-test' }).ok).toBe(false);
  });

  it('needs a key for anthropic and defaults the model', () => {
    expect(resolveProvider({ ASSISTANT_PROVIDER: 'anthropic' }).ok).toBe(false);
    const result = resolveProvider({
      ASSISTANT_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test'
    });
    expect(result.ok && result.provider.id).toBe('anthropic');
    expect(result.ok && result.provider.model).toBe('claude-opus-5');
    expect(result.ok && result.developmentMode).toBe(false);
  });

  it('refuses the development router in production', () => {
    expect(
      resolveProvider({
        ASSISTANT_PROVIDER: 'dev-router',
        NODE_ENV: 'production'
      }).ok
    ).toBe(false);
    const dev = resolveProvider({
      ASSISTANT_PROVIDER: 'dev-router',
      NODE_ENV: 'development'
    });
    expect(dev.ok && dev.developmentMode).toBe(true);
  });

  it('rejects unknown providers', () => {
    expect(resolveProvider({ ASSISTANT_PROVIDER: 'mystery' }).ok).toBe(false);
  });
});

describe('anthropic adapter', () => {
  it('maps the neutral transcript, keeping tool results paired and events in the user channel', () => {
    const messages = toAnthropicMessages([
      { role: 'user', text: 'Find Parton' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 't1', name: 'find_job', args: { query: 'Parton' } }]
      },
      {
        role: 'tool',
        results: [
          { callId: 't1', name: 'find_job', ok: false, content: '{"error":{}}' }
        ]
      },
      { role: 'event', text: 'The staff member CANCELLED proposed action x.' }
    ]);
    expect(messages).toEqual([
      { role: 'user', content: 'Find Parton' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'find_job',
            input: { query: 'Parton' }
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: '{"error":{}}',
            is_error: true
          }
        ]
      },
      {
        role: 'user',
        content:
          '<app_event>The staff member CANCELLED proposed action x.</app_event>'
      }
    ]);
    expect(messages.some((m) => (m.role as string) === 'system')).toBe(false);
  });

  it('replays its own raw blocks within a turn, and ignores raw blocks from elsewhere', () => {
    const content = [
      { type: 'text', text: 'hi', citations: null }
    ] as Anthropic.ContentBlock[];
    const [own] = toAnthropicMessages([
      {
        role: 'assistant',
        text: 'hi',
        toolCalls: [],
        providerRaw: { provider: 'anthropic', content }
      }
    ]);
    expect(own.content).toBe(content);
    const [foreign] = toAnthropicMessages([
      {
        role: 'assistant',
        text: 'hi',
        toolCalls: [],
        providerRaw: { provider: 'other', content: 'x' }
      }
    ]);
    expect(foreign.content).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('turns SDK failures into safe, typed errors', async () => {
    const failing = (error: unknown) =>
      ({
        messages: {
          stream: () => ({
            on: () => {},
            finalMessage: () => Promise.reject(error)
          })
        }
      }) as unknown as Anthropic;
    const request = {
      system: { stable: 's', volatile: 'v' },
      messages: [],
      tools: []
    };

    const rate = new Anthropic.RateLimitError(
      429,
      undefined,
      'slow down',
      new Headers()
    );
    await expect(
      new AnthropicProvider('k', 'claude-opus-5', failing(rate)).generate(
        request
      )
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });

    const auth = new Anthropic.AuthenticationError(
      401,
      undefined,
      'bad key sk-ant-xyz',
      new Headers()
    );
    const rejected = await new AnthropicProvider(
      'k',
      'claude-opus-5',
      failing(auth)
    )
      .generate(request)
      .catch((e) => e);
    expect(rejected).toMatchObject({ code: 'AUTH', retryable: false });
    expect(rejected.message).not.toContain('sk-ant');

    await expect(
      new AnthropicProvider(
        'k',
        'claude-opus-5',
        failing(new Anthropic.APIUserAbortError())
      ).generate(request)
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('reads text, tool calls and stop reason from the final message', async () => {
    const deltas: string[] = [];
    const client = {
      messages: {
        stream: (_params: unknown, options: { signal?: AbortSignal }) => {
          expect(options).toHaveProperty('signal');
          return {
            on: (event: string, cb: (t: string) => void) =>
              event === 'text' && cb('Looking…'),
            finalMessage: async () => ({
              stop_reason: 'tool_use',
              content: [
                { type: 'thinking', thinking: '', signature: 'sig' },
                { type: 'text', text: 'Looking…' },
                {
                  type: 'tool_use',
                  id: 't1',
                  name: 'find_job',
                  input: { query: 'Parton' }
                }
              ],
              usage: { input_tokens: 10, output_tokens: 5 }
            })
          };
        }
      }
    } as unknown as Anthropic;

    const turn = await new AnthropicProvider(
      'k',
      'claude-opus-5',
      client
    ).generate(
      {
        system: { stable: 's', volatile: 'v' },
        messages: [{ role: 'user', text: 'hi' }],
        tools: []
      },
      { onTextDelta: (t) => deltas.push(t) }
    );
    expect(turn).toMatchObject({
      text: 'Looking…',
      stopReason: 'tool_use',
      toolCalls: [{ id: 't1', name: 'find_job', args: { query: 'Parton' } }]
    });
    expect(deltas).toEqual(['Looking…']);
  });
});

describe('development router', () => {
  it('only requests tools that were offered for this user', async () => {
    const router = new DevRouterProvider();
    const base = {
      system: { stable: '', volatile: '' },
      messages: [{ role: 'user' as const, text: 'show team tasks' }]
    };
    const denied = await router.generate({ ...base, tools: [] });
    expect(denied.toolCalls).toEqual([]);
    const allowed = await router.generate({
      ...base,
      tools: [{ name: 'get_team_tasks', description: '', inputSchema: {} }]
    });
    expect(allowed.toolCalls[0]).toMatchObject({ name: 'get_team_tasks' });
  });
});
