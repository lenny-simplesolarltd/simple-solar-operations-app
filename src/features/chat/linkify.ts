// Turning a message body into renderable pieces WITHOUT producing HTML.
//
// This codebase never renders user-authored HTML - the Help viewer parses to
// typed nodes and renders React elements, and chat does the same. A message is
// text somebody typed; treating it as markup is how an internal chat becomes a
// cross-site-scripting hole.
//
// So this returns a list of segments and the caller renders each as a React
// element. There is no escaping step because nothing is ever interpolated into
// markup in the first place.
//
// A job reference is only linked when the SERVER resolved it for this reader
// (chat_messages.mentioned_job_ids). An unresolved SS-XXXX-0000 stays plain
// text: it either does not exist, or the reader may not open it, and a dead
// link that reveals which is worse than no link.

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'job'; text: string; jobRef: string }
  | { kind: 'link'; text: string; href: string };

// Case-insensitive, matching app.chat_job_refs: people type ss-abcd-1234.
const JOB_REF = /SS-[A-Za-z]{4}-[0-9]{4}/gi;
// Deliberately narrow: http(s) only. A bare "javascript:" or "data:" must
// never become a clickable link, so nothing else is recognised at all.
const URL_RE = /https?:\/\/[^\s<>()[\]]+/g;

export function linkifyMessage(
  body: string,
  resolvedJobRefs: ReadonlySet<string>
): Segment[] {
  const marks: { start: number; end: number; seg: Segment }[] = [];

  for (const m of Array.from(body.matchAll(JOB_REF))) {
    const text = m[0];
    const ref = text.toUpperCase();
    if (!resolvedJobRefs.has(ref)) continue;
    marks.push({
      start: m.index,
      end: m.index + text.length,
      seg: { kind: 'job', text, jobRef: ref }
    });
  }

  for (const m of Array.from(body.matchAll(URL_RE))) {
    // Trailing punctuation belongs to the sentence, not the address.
    const raw = m[0].replace(/[.,;:!?]+$/, '');
    marks.push({
      start: m.index,
      end: m.index + raw.length,
      seg: { kind: 'link', text: raw, href: raw }
    });
  }

  marks.sort((a, b) => a.start - b.start);

  const out: Segment[] = [];
  let at = 0;
  for (const mark of marks) {
    // A URL containing something that looks like a job reference would overlap;
    // the first match wins and the second is dropped.
    if (mark.start < at) continue;
    if (mark.start > at)
      out.push({ kind: 'text', text: body.slice(at, mark.start) });
    out.push(mark.seg);
    at = mark.end;
  }
  if (at < body.length) out.push({ kind: 'text', text: body.slice(at) });
  return out;
}
