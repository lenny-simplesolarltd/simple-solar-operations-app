import type { AssistantCapabilities } from '@/features/assistant/protocol';
import { resolveAssistantActor } from '@/features/assistant/server/actor';
import { resolveProvider } from '@/features/assistant/server/providers';
import { createToolRegistry } from '@/features/assistant/server/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What the assistant can do for THIS staff member right now. Drives the drawer's suggestions and notices. */
export async function GET() {
  const actor = await resolveAssistantActor();
  if (!actor) {
    return Response.json(
      {
        error: {
          code: 'NOT_AUTHENTICATED',
          message: 'Sign in to use the assistant.'
        }
      },
      { status: 401 }
    );
  }

  const registry = createToolRegistry();
  const provider = resolveProvider();
  const capabilities: AssistantCapabilities = {
    configured: provider.ok,
    developmentMode: provider.ok && provider.developmentMode,
    notice: provider.ok ? undefined : provider.notice,
    preview: actor.previewing
      ? { name: actor.user.fullName ?? 'Staff member', roles: actor.user.roles }
      : undefined,
    tools: registry
      .availableFor(actor)
      .map(({ name, kind, summary }) => ({ name, kind, summary })),
    planned: registry
      .planned()
      .map(({ name, kind, summary }) => ({ name, kind, summary })),
    // Development diagnostics: which provider/model is really answering.
    // Identifiers only - never a key - and never sent in production.
    ...(process.env.NODE_ENV !== 'production' &&
      provider.ok && {
        diagnostics: {
          provider: provider.provider.id,
          model: provider.provider.model,
          pendingActions: 'memory'
        }
      })
  };
  return Response.json(capabilities, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
