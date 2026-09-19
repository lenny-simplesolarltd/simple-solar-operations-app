// Turns stored conversation messages back into what the drawer shows. Pure and
// safe to import anywhere (the server uses it to answer "open conversation").
import type { DisplayCard, TranscriptMessage } from '../protocol';
import type { ConversationItem } from './conversation';

/** Drawer-only detail stored beside a message. Never sent to the model. */
export interface StoredUi {
  /** A staff decision recorded outside a chat turn (confirm/cancel), with the card it produced. */
  decision?: { text: string; display?: DisplayCard };
  /** Per tool call: the label shown while it ran and the card it produced. */
  tools?: Record<
    string,
    {
      label: string;
      ok: boolean;
      display?: DisplayCard;
      error?: { code: string; message: string };
    }
  >;
}

export interface HistoryRow {
  id: string;
  content: TranscriptMessage;
  ui: StoredUi | null;
  status: 'complete' | 'stopped';
}

export function itemsFromHistory(rows: HistoryRow[]): ConversationItem[] {
  const tools: NonNullable<StoredUi['tools']> = {};
  for (const row of rows) Object.assign(tools, row.ui?.tools ?? {});

  const items: ConversationItem[] = [];
  for (const row of rows) {
    const message = row.content;
    if (message.role === 'user' && row.ui?.decision) {
      items.push({ id: row.id, kind: 'note', text: row.ui.decision.text });
      if (row.ui.decision.display) {
        items.push({
          id: `${row.id}:result`,
          kind: 'tool',
          callId: row.id,
          tool: 'decision',
          label: row.ui.decision.text,
          state: 'done',
          display: row.ui.decision.display
        });
      }
    } else if (message.role === 'user') {
      items.push({ id: row.id, kind: 'user', text: message.text });
    } else if (message.role === 'assistant') {
      if (message.text.trim()) {
        items.push({
          id: `${row.id}:text`,
          kind: 'assistant',
          text: message.text,
          streaming: false
        });
      }
      for (const call of message.toolCalls) {
        const shown = tools[call.id];
        items.push({
          id: `${row.id}:${call.id}`,
          kind: 'tool',
          callId: call.id,
          tool: call.name,
          label: shown?.label ?? 'Working',
          state: shown?.ok ? 'done' : 'error',
          display: shown?.display,
          error:
            shown?.error ??
            (shown
              ? undefined
              : { code: 'INTERRUPTED', message: 'Interrupted.' })
        });
      }
      if (row.status === 'stopped') {
        items.push({ id: `${row.id}:stopped`, kind: 'stopped' });
      }
    }
    // Tool results are shown through their calls; app events are not shown.
  }
  return items;
}
