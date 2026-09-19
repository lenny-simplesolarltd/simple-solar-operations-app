import 'server-only';

import type { TranscriptMessage } from '../../protocol';
import { jobRefsIn } from './context-window';

/**
 * A conversation title from its first meaningful exchange, without a model
 * request: the staff member's question, tidied, prefixed with the job it is
 * about when that is clear. Returns null for small talk ("hi", "thanks"), so
 * a later turn can title the conversation instead.
 *
 * Titles are labels for the history list only: they are never sent to the
 * model and never affect what anyone may see or do.
 */

const POLITE_OPENERS =
  /^(hi|hello|hey|ok(ay)?|please|thanks|thank you|simplebot)[,!.\s]+/i;
const REQUEST_OPENERS =
  /^(can|could|would|will) you (please )?|^(please )?(show|tell|give|find|get|list) me (the |a |an |all )?|^i (need|want) (to know |to see )?|^please /i;
const SMALL_TALK =
  /^(hi|hello|hey|thanks|thank you|ok|okay|cheers|yes|no|test)[\s!.?]*$/i;

const MAX_LENGTH = 60;

function tidy(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) {
    const next = t.replace(POLITE_OPENERS, '').replace(REQUEST_OPENERS, '');
    if (next === t) break;
    t = next.trim();
  }
  t = t.replace(/[?!.…]+$/, '').trim();
  if (t.length > MAX_LENGTH) {
    const cut = t.slice(0, MAX_LENGTH);
    const space = cut.lastIndexOf(' ');
    t = `${(space > 30 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`;
  }
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export function deriveTitle(turn: TranscriptMessage[]): string | null {
  const user = turn.find((m) => m.role === 'user');
  if (!user || user.role !== 'user') return null;
  const text = user.text.trim();
  if (!text || SMALL_TALK.test(text)) return null;

  const title = tidy(text);
  if (title.length < 3) return null;

  // Mentioned in the question: already part of the title.
  if (jobRefsIn(text).length > 0) return title;

  // Otherwise, if the turn looked up exactly one job, lead with its reference.
  const found = new Set<string>();
  for (const message of turn) {
    if (message.role === 'tool') {
      for (const r of message.results) {
        if (r.ok && (r.name === 'get_job' || r.name === 'get_job_tasks')) {
          jobRefsIn(r.content).forEach((ref) => found.add(ref));
        }
      }
    }
  }
  if (found.size === 1) {
    const [ref] = Array.from(found);
    const combined = `${ref} · ${title}`;
    return combined.length > MAX_LENGTH + 16
      ? `${ref} · ${tidy(title.slice(0, 40))}`
      : combined;
  }
  return title;
}
