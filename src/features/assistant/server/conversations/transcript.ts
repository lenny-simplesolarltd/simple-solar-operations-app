import 'server-only';

import type { TranscriptMessage } from '../../protocol';
import type { ConversationStore } from './store';

/**
 * A SimpleBot conversation as something a person can keep or pass on.
 *
 * Conversations were readable only inside the drawer by the one person who had
 * them. An answer worth acting on - what the importer decided, why a visit
 * cannot be completed - had no way out except a screenshot.
 *
 * Built from the stored record rather than from whatever the browser happens to
 * be showing, so what leaves is what actually happened, including turns from
 * sessions that have long since closed.
 *
 * Tool calls are named, never expanded. A tool result can carry rows of
 * somebody's job or property data that the reply itself did not quote, and a
 * transcript is a thing people paste into other places; it says which tools ran
 * and leaves their contents where they already are, behind the permissions that
 * decided who could see them.
 */

const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const when = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : TIME.format(at);
};

/** One stored turn as Markdown, or null for a turn with nothing to read. */
function line(content: TranscriptMessage): string | null {
  if (content.role === 'user') {
    const text = content.text.trim();
    return text ? `**You:** ${text}` : null;
  }
  if (content.role === 'assistant') {
    const text = content.text.trim();
    return text ? `**SimpleBot:** ${text}` : null;
  }
  // Tool turns: what ran, never what came back.
  const name = (content as { name?: string }).name;
  return name ? `_SimpleBot used ${name}_` : null;
}

export interface Transcript {
  title: string;
  markdown: string;
  /** Turns that produced a readable line. Not the stored message count. */
  lines: number;
}

export async function conversationTranscript(
  store: ConversationStore,
  id: string
): Promise<Transcript | null> {
  const record = await store.get(id);
  if (!record) return null;
  const messages = await store.messages(id);

  const title = record.title?.trim() || 'SimpleBot conversation';
  const body: string[] = [];
  for (const message of messages) {
    const rendered = line(message.content);
    if (rendered) body.push(rendered);
  }

  const markdown = [
    `# ${title}`,
    '',
    `SimpleBot conversation · ${when(record.createdAt)}`,
    '',
    ...body.flatMap((entry) => [entry, '']),
    '---',
    'Exported from Simple Solar Operations. SimpleBot can be wrong; check anything you act on.'
  ]
    .join('\n')
    .trimEnd();

  return { title, markdown, lines: body.length };
}
