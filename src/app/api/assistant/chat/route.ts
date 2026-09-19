import {
  chatRequestSchema,
  type AssistantStreamEvent
} from '@/features/assistant/protocol';
import { resolveAssistantActor } from '@/features/assistant/server/actor';
import { openConversationStore } from '@/features/assistant/server/conversations/store';
import { runConversationTurn } from '@/features/assistant/server/conversations/turn';
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
 * conversation id, the message and a page hint - all validated, none of them
 * trusted for authorization. A stored conversation's history is read from the
 * database as this user (owner-only RLS); the browser's transcript is used
 * only where conversations are not stored.
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
  const runId = parsed.data.runId ?? crypto.randomUUID();
  const store = await openConversationStore(actor).catch((error: unknown) => {
    // eslint-disable-next-line no-console -- server-side diagnostics; chat still works for this session
    console.error('assistant conversation store unavailable', error);
    return null;
  });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: AssistantStreamEvent) => {
        if (closed || request.signal.aborted) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        await runConversationTurn({
          actor,
          store,
          threadId,
          runId,
          message,
          transcript,
          context,
          provider: resolved.provider,
          registry: createToolRegistry(),
          pendingActions: resolvePendingActions(),
          signal: request.signal,
          emit
        });
      } catch (error) {
        // eslint-disable-next-line no-console -- server-side diagnostics
        console.error('assistant turn failed', error);
        emit({
          type: 'error',
          code: 'UNEXPECTED',
          message: 'SimpleBot hit an unexpected error. Nothing was changed.',
          retryable: true
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
