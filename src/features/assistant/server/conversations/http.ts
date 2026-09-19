import 'server-only';

import { previewWriteBlock } from '@/lib/preview/guard';
import { z } from 'zod';
import { resolveAssistantActor } from '../actor';
import type { ToolActor } from '../registry';
import {
  ConversationStoreError,
  openConversationStore,
  type ConversationStore
} from './store';

export const errorResponse = (
  status: number,
  code: string,
  message: string,
  retryable = false
) =>
  Response.json(
    { error: { code, message, retryable } },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );

export const noStore = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export const notFound = () =>
  errorResponse(404, 'NOT_FOUND', 'That conversation could not be found.');

const idSchema = z.uuid();

/**
 * The signed-in staff member and their conversation store, or the response to
 * send instead. Identity comes from the session only: no route here accepts a
 * person, owner or role from the browser.
 */
export async function conversationRequest(options: {
  write: boolean;
}): Promise<
  | { ok: true; actor: ToolActor; store: ConversationStore }
  | { ok: false; response: Response }
> {
  const actor = await resolveAssistantActor();
  if (!actor) {
    return {
      ok: false,
      response: errorResponse(
        401,
        'NOT_AUTHENTICATED',
        'Sign in to use SimpleBot.'
      )
    };
  }
  if (options.write) {
    const blocked = await previewWriteBlock();
    if (blocked) {
      return {
        ok: false,
        response: errorResponse(403, 'PREVIEW_READ_ONLY', blocked)
      };
    }
  }
  let store: ConversationStore | null;
  try {
    store = await openConversationStore(actor);
  } catch (error) {
    return { ok: false, response: storeFailure(error) };
  }
  if (!store) {
    return {
      ok: false,
      response: errorResponse(
        409,
        'NOT_STORED',
        'Conversations are not saved in this environment.'
      )
    };
  }
  return { ok: true, actor, store };
}

export async function conversationId(
  params: Promise<{ id: string }>
): Promise<string | null> {
  const parsed = idSchema.safeParse((await params).id);
  return parsed.success ? parsed.data : null;
}

/** Store failures become safe wording; detail stays in the server log. */
export function storeFailure(error: unknown): Response {
  if (error instanceof ConversationStoreError && error.code === 'NOT_FOUND') {
    return notFound();
  }
  // eslint-disable-next-line no-console -- server-side diagnostics
  console.error('assistant conversation request failed', error);
  return errorResponse(
    500,
    'UNEXPECTED',
    'SimpleBot could not load your conversations. Try again.',
    true
  );
}
