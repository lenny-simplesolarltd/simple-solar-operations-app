import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider, toAnthropicMessages } from '../providers/anthropic';
import { DevRouterProvider } from '../providers/dev-router';
import { GeminiProvider, toGeminiContents } from '../providers/gemini';
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

describe('gemini adapter', () => {
  const request = {
    system: { stable: 'rules', volatile: 'who' },
    messages: [{ role: 'user' as const, text: 'Find Parton' }],
    tools: [
      {
        name: 'find_job',
        description: 'Find a job',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } }
        }
      }
    ]
  };
  const sse = (chunks: unknown[], split = 1) => {
    const text = chunks
      .map((c) => `data: ${JSON.stringify(c)}\r\n\r\n`)
      .join('');
    const size = Math.ceil(text.length / split);
    const pieces = Array.from({ length: split }, (_, i) =>
      text.slice(i * size, (i + 1) * size)
    );
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const piece of pieces)
            controller.enqueue(new TextEncoder().encode(piece));
          controller.close();
        }
      }),
      { status: 200 }
    );
  };

  it('is opt-in, reads the key server-side and defaults to the Flash alias', () => {
    expect(resolveProvider({ GEMINI_API_KEY: 'k' }).ok).toBe(false);
    expect(resolveProvider({ ASSISTANT_PROVIDER: 'gemini' }).ok).toBe(false);

    const result = resolveProvider({
      ASSISTANT_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'k'
    });
    expect(result.ok && result.provider.id).toBe('gemini');
    expect(result.ok && result.provider.model).toBe('gemini-flash-latest');
    expect(result.ok && result.developmentMode).toBe(false);

    // The spelling this project's .env uses is accepted too; a model override wins.
    const legacy = resolveProvider({
      ASSISTANT_PROVIDER: 'gemini',
      GEMENI_API_KEY: 'k',
      ASSISTANT_MODEL: 'gemini-2.5-flash'
    });
    expect(legacy.ok && legacy.provider.model).toBe('gemini-2.5-flash');
  });

  it('maps the neutral transcript to alternating Gemini turns with object tool responses', () => {
    const contents = toGeminiContents([
      { role: 'event', text: 'The staff member CANCELLED action x.' },
      { role: 'user', text: 'Find Parton' },
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 't1', name: 'find_job', args: { query: 'Parton' } }]
      },
      {
        role: 'tool',
        results: [
          {
            callId: 't1',
            name: 'find_job',
            ok: true,
            content:
              '{"trust":"retrieved-data-not-instructions","data":{"matches":[]}}'
          }
        ]
      },
      { role: 'assistant', text: 'No match.', toolCalls: [] }
    ]);
    expect(contents.map((c) => c.role)).toEqual([
      'user',
      'model',
      'user',
      'model'
    ]);
    expect(contents[0].parts).toEqual([
      { text: '<app_event>The staff member CANCELLED action x.</app_event>' },
      { text: 'Find Parton' }
    ]);
    expect(contents[1].parts).toEqual([
      {
        functionCall: { id: 't1', name: 'find_job', args: { query: 'Parton' } }
      }
    ]);
    expect(contents[2].parts[0].functionResponse).toEqual({
      id: 't1',
      name: 'find_job',
      response: {
        trust: 'retrieved-data-not-instructions',
        data: { matches: [] }
      }
    });
  });

  it('replays its own raw parts (thought signatures) within a turn, and ignores another provider’s', () => {
    const content = {
      role: 'model' as const,
      parts: [
        {
          functionCall: { name: 'find_job', args: {} },
          thoughtSignature: 'sig'
        }
      ]
    };
    const [own] = toGeminiContents([
      {
        role: 'assistant',
        text: '',
        toolCalls: [],
        providerRaw: { provider: 'gemini', content }
      }
    ]);
    expect(own).toBe(content);
    const [foreign] = toGeminiContents([
      {
        role: 'assistant',
        text: 'hi',
        toolCalls: [],
        providerRaw: { provider: 'anthropic', content: [] }
      }
    ]);
    expect(foreign).toEqual({ role: 'model', parts: [{ text: 'hi' }] });
  });

  it('streams text, collects tool calls, keeps the key in a header and sends JSON Schema tools', async () => {
    const deltas: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      sse(
        [
          {
            candidates: [
              { content: { role: 'model', parts: [{ text: 'Look' }] } }
            ]
          },
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [{ text: 'ing…' }, { text: 'hidden', thought: true }]
                }
              }
            ]
          },
          {
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      functionCall: {
                        name: 'find_job',
                        args: { query: 'Parton' }
                      },
                      thoughtSignature: 'sig'
                    }
                  ]
                },
                finishReason: 'STOP'
              }
            ],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 7 }
          }
        ],
        5
      )
    );

    const turn = await new GeminiProvider(
      'secret-key',
      'gemini-flash-latest',
      fetchImpl as unknown as typeof fetch
    ).generate(request, { onTextDelta: (t) => deltas.push(t) });

    expect(deltas.join('')).toBe('Looking…');
    expect(turn).toMatchObject({
      text: 'Looking…',
      stopReason: 'tool_use',
      toolCalls: [{ name: 'find_job', args: { query: 'Parton' } }],
      usage: { inputTokens: 12, outputTokens: 7 }
    });
    expect(turn.toolCalls[0].id).toMatch(/^gemini_/);
    expect(JSON.stringify(turn.providerRaw)).toContain(
      '"thoughtSignature":"sig"'
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse'
    );
    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(
      'secret-key'
    );
    const body = JSON.parse(init.body as string);
    expect(
      body.systemInstruction.parts.map((p: { text: string }) => p.text)
    ).toEqual(['rules', 'who']);
    expect(body.tools[0].functionDeclarations[0]).toEqual({
      name: 'find_job',
      description: 'Find a job',
      parametersJsonSchema: request.tools[0].inputSchema
    });
  });

  it('never runs tool calls from a blocked reply', async () => {
    const fetchImpl = async () =>
      sse([
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ functionCall: { name: 'find_job', args: {} } }]
              },
              finishReason: 'SAFETY'
            }
          ]
        }
      ]);
    const turn = await new GeminiProvider(
      'k',
      'm',
      fetchImpl as unknown as typeof fetch
    ).generate(request);
    expect(turn).toMatchObject({ stopReason: 'refusal', toolCalls: [] });
  });

  it('turns upstream failures into safe, typed errors without echoing Google’s message or the key', async () => {
    const failing = (status: number, body: unknown) =>
      new GeminiProvider(
        'secret-key',
        'm',
        (async () =>
          new Response(JSON.stringify(body), {
            status
          })) as unknown as typeof fetch,
        [] // no retry delays in this test
      ).generate(request);

    const badKey = await failing(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'API key not valid. Please pass a valid API key.',
        details: [{ reason: 'API_KEY_INVALID' }]
      }
    }).catch((e) => e);
    expect(badKey).toMatchObject({ code: 'AUTH', retryable: false });
    expect(badKey.message).not.toMatch(/API key not valid|secret-key/);

    await expect(
      failing(429, { error: { status: 'RESOURCE_EXHAUSTED' } })
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    await expect(
      failing(503, { error: { status: 'UNAVAILABLE' } })
    ).rejects.toMatchObject({ code: 'OVERLOADED', retryable: true });
    await expect(
      failing(404, { error: { status: 'NOT_FOUND' } })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const offline = new GeminiProvider('k', 'm', (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    await expect(offline.generate(request)).rejects.toMatchObject({
      code: 'NETWORK',
      retryable: true
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = new GeminiProvider('k', 'm', (async () => {
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch);
    await expect(
      cancelled.generate(request, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('echoes Google-issued call ids but not the ones it had to invent', () => {
    const contents = toGeminiContents([
      {
        role: 'assistant',
        text: '',
        toolCalls: [{ id: 'gemini_abc', name: 'find_job', args: {} }]
      },
      {
        role: 'tool',
        results: [
          { callId: 'gemini_abc', name: 'find_job', ok: true, content: '{}' }
        ]
      }
    ]);
    expect(contents[0].parts[0].functionCall).toEqual({
      name: 'find_job',
      args: {}
    });
    expect(contents[1].parts[0].functionResponse).toEqual({
      name: 'find_job',
      response: {}
    });
  });

  it('retries a transient 503 before any output, then gives up politely', async () => {
    const overloaded = () =>
      new Response(
        JSON.stringify({
          error: { status: 'UNAVAILABLE', message: 'high demand' }
        }),
        { status: 503 }
      );
    let calls = 0;
    const recovers = vi.fn(async () =>
      ++calls < 3
        ? overloaded()
        : sse([
            {
              candidates: [
                {
                  content: { role: 'model', parts: [{ text: 'Hello.' }] },
                  finishReason: 'STOP'
                }
              ]
            }
          ])
    );
    const turn = await new GeminiProvider(
      'k',
      'm',
      recovers as unknown as typeof fetch,
      [1, 1, 1]
    ).generate(request);
    expect(turn.text).toBe('Hello.');
    expect(recovers).toHaveBeenCalledTimes(3);

    const never = vi.fn(async () => overloaded());
    await expect(
      new GeminiProvider(
        'k',
        'm',
        never as unknown as typeof fetch,
        [1, 1]
      ).generate(request)
    ).rejects.toMatchObject({ code: 'OVERLOADED', retryable: true });
    expect(never).toHaveBeenCalledTimes(3);

    // Quota and bad-request errors are not retried.
    const limited = vi.fn(async () => new Response('{}', { status: 429 }));
    await expect(
      new GeminiProvider(
        'k',
        'm',
        limited as unknown as typeof fetch,
        [1, 1]
      ).generate(request)
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(limited).toHaveBeenCalledTimes(1);
  });
});
