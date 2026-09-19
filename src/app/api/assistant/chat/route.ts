import {
  chatRequestSchema,
  type AssistantStreamEvent
} from '@/features/assistant/protocol';
import { resolveAssistantActor } from '@/features/assistant/server/actor';
import { runAssistantTurn } from '@/features/assistant/server/orchestrator';
import { resolvePendingActions } from '@/features/assistant/server/pending-actions-config';
import { resolveProvider } from '@/features/assistant/server/providers';
import { createToolRegistry } from '@/features/assistant/server/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message, retryable: false } }, { status });

/**
 * One assistant turn, streamed as newline-delimited JSON events.
 *
 * Identity comes from the Supabase session cookie alone. The body carries the
 * message, the browser-held transcript and a page hint - all validated, none
 * of them trusted for authorization.
 */
export async function POST(request: Request) {
  const actor = await resolveAssistantActor();
  if (!actor)
    return json(401, 'NOT_AUTHENTICATED', 'Sign in to use SimpleBot.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, 'INVALID_REQUEST', 'The request was not valid JSON.');
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      400,
      'INVALID_REQUEST',
      'That request to SimpleBot was not valid.'
    );
  }

  const resolved = resolveProvider();
  if (!resolved.ok) return json(503, 'NOT_CONFIGURED', resolved.notice);

  const { threadId, message, transcript, context } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: AssistantStreamEvent) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runAssistantTurn({
          actor,
          threadId,
          message,
          transcript,
          context,
          provider: resolved.provider,
          registry: createToolRegistry(),
          pendingActions: resolvePendingActions(),
          signal: request.signal,
          emit
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by a client disconnect.
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no'
    }
  });
}
