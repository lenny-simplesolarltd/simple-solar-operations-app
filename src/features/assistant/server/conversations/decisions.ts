import 'server-only';

import type { ActionResponse } from '../../protocol';
import type { ToolActor } from '../registry';
import { estimateTokens } from './context-window';
import { openConversationStore } from './store';

/**
 * Records a confirmed or cancelled proposal in the stored conversation it was
 * proposed in, so the next turn's history knows the outcome (otherwise the
 * model would still see a proposal "awaiting confirmation" after a reload).
 *
 * The conversation id and tool come from the server-signed proposal, the
 * store is owner-only, and the append is idempotent on the action id, so a
 * repeated confirmation is recorded once. Failure to record never changes the
 * outcome the staff member sees.
 */
export async function recordDecision(
  actor: ToolActor,
  result: Extract<ActionResponse, { ok: true }>
): Promise<void> {
  if (!result.threadId) return;
  try {
    const store = await openConversationStore(actor);
    if (!store || !(await store.get(result.threadId))) return;
    const text =
      result.decision === 'confirm'
        ? `Confirmed in the app (${result.tool ?? 'action'}).`
        : `Cancelled in the app (${result.tool ?? 'action'}). Nothing was changed.`;
    const marker = { role: 'user' as const, text: `[${text}]` };
    await store.append({
      conversationId: result.threadId,
      runId: result.commandId,
      messages: [
        {
          content: marker,
          ui: {
            decision: {
              text,
              ...(result.display && { display: result.display })
            }
          },
          estimatedTokens: estimateTokens(marker)
        },
        ...result.transcript.map((content) => ({
          content,
          estimatedTokens: estimateTokens(content)
        }))
      ]
    });
  } catch (error) {
    // eslint-disable-next-line no-console -- server-side diagnostics; the decision itself stands
    console.error(
      'assistant decision could not be recorded in the conversation',
      error
    );
  }
}
