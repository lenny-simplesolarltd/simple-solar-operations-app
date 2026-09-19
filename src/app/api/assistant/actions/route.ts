import {
  actionRequestSchema,
  type ActionResponse
} from '@/features/assistant/protocol';
import { resolveAssistantActor } from '@/features/assistant/server/actor';
import { resolvePendingAction } from '@/features/assistant/server/confirm';
import { recordDecision } from '@/features/assistant/server/conversations/decisions';
import { resolvePendingActions } from '@/features/assistant/server/pending-actions-config';
import { createRequestToolRegistry } from '@/features/assistant/server/tools';
import { PREVIEW_READ_ONLY_MESSAGE } from '@/lib/preview/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fail = (status: number, code: string, message: string) =>
  Response.json(
    {
      ok: false,
      error: { code, message, retryable: false }
    } satisfies ActionResponse,
    { status }
  );

/** Confirm or cancel a proposed action. The body is only a decision and the server-signed token. */
export async function POST(request: Request) {
  const actor = await resolveAssistantActor();
  if (!actor)
    return fail(401, 'NOT_AUTHENTICATED', 'Sign in to use SimpleBot.');
  // The confirm endpoint is the assistant's write boundary: refuse outright in preview.
  if (actor.previewing)
    return fail(403, 'PREVIEW_MODE_READ_ONLY', PREVIEW_READ_ONLY_MESSAGE);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'INVALID_REQUEST', 'The request was not valid JSON.');
  }
  const parsed = actionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      400,
      'INVALID_REQUEST',
      'The confirmation request was not valid.'
    );
  }

  const result = await resolvePendingAction({
    actor,
    decision: parsed.data.decision,
    token: parsed.data.token,
    registry: await createRequestToolRegistry(),
    pendingActions: resolvePendingActions()
  });
  if (result.ok) await recordDecision(actor, result);
  return Response.json(result, { status: result.ok ? 200 : 409 });
}
