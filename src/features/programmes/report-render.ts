import { renderProgrammeReport, type RenderedEmail } from './report-email';
import { readableDate, type ReportType } from './report-period';

/**
 * Turn a stored report into an email a person can read.
 *
 * The database builds every report as DATA and keeps it on the communication;
 * this is what turns that into words. Until it was wired in, the worker sent
 * the JSON itself, so a client's weekly report arrived as
 * `{"to":"2026-09-25","form":{"id":"f273f899-...` and a row of braces.
 *
 * Nothing here counts or classifies. Every number shown was decided by the
 * canonical report, because a second implementation of "what counts" is how a
 * report starts disagreeing with the screen it came from.
 *
 * Unknown shapes are not guessed at: an unrecognised report renders as a plain
 * statement that it cannot be displayed, with a link to the app, rather than
 * as a wall of JSON.
 */

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const n = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString('en-GB');

const FONT = 'Helvetica,Arial,sans-serif';

interface FormLine {
  submitted_at?: string;
  version?: number;
  recipient_type?: string | null;
  recipient?: string | null;
  job_ref?: string | null;
  fields?: { label?: string; value?: string | null }[];
}

interface FormReport {
  source_kind?: string;
  report_type?: ReportType;
  form?: { id?: string; title?: string; status?: string };
  from?: string;
  to?: string;
  responses?: number;
  versions?: number[];
  versions_answered?: number;
  lines?: FormLine[];
}

/** "25 Sep 2026", or "19 Sep 2026 to 25 Sep 2026". */
const periodWords = (type: ReportType, from?: string, to?: string) =>
  type === 'Daily' || !from || from === to
    ? readableDate(to ?? from ?? '')
    : `${readableDate(from)} to ${readableDate(to ?? from)}`;

/** The time of day a response arrived, in UK terms. */
function timeWords(iso?: string) {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(at);
}

/** Who answered, in the words the form used. */
function whoWords(line: FormLine) {
  if (line.job_ref) return line.job_ref;
  if (line.recipient) return line.recipient;
  if (line.recipient_type === 'customer') return 'A customer';
  if (line.recipient_type === 'surveyor') return 'A surveyor';
  return 'Not specified';
}

/**
 * A form's responses for a period.
 *
 * The counts answer "did anything come in, and can I trust it to be
 * comparable": responses, how many days of the period saw one, and whether the
 * wording moved underneath them. That last one matters and is easy to miss - a
 * form edited mid-period means two people answered different questions, so the
 * report says so rather than averaging over it.
 */
export function renderFormReport(report: FormReport): RenderedEmail {
  const type: ReportType = report.report_type === 'Daily' ? 'Daily' : 'Weekly';
  const title = report.form?.title ?? 'Form';
  const when = periodWords(type, report.from, report.to);
  const subject = `${title} — ${type === 'Daily' ? 'daily' : 'weekly'} report, ${when}`;

  const lines = report.lines ?? [];
  const responses = report.responses ?? lines.length;
  const versions = report.versions ?? [];
  const days = new Set(
    lines.map((l) => (l.submitted_at ?? '').slice(0, 10)).filter(Boolean)
  ).size;

  const metrics: [string, string][] = [
    ['Responses', n(responses)],
    ['Days with a response', n(days)],
    ['Form versions answered', n(report.versions_answered ?? versions.length)]
  ];

  const mixedVersions = (report.versions_answered ?? versions.length) > 1;

  const metricCells = metrics
    .map(
      ([label, value]) => `
        <td style="padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;min-width:120px">
          <div style="font:600 22px/1.2 ${FONT};color:#111827">${esc(value)}</div>
          <div style="font:400 12px/1.4 ${FONT};color:#6b7280">${esc(label)}</div>
        </td>`
    )
    .join('');

  const answerBlocks = lines
    .map((line) => {
      const fields = (line.fields ?? [])
        .map(
          (f) => `
          <tr>
            <td style="padding:4px 10px 4px 0;font:400 13px/1.5 ${FONT};color:#6b7280;vertical-align:top;white-space:nowrap">${esc(f.label ?? '')}</td>
            <td style="padding:4px 0;font:400 13px/1.5 ${FONT};color:#111827">${esc(f.value ?? '—')}</td>
          </tr>`
        )
        .join('');
      return `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 10px">
        <div style="font:600 13px/1.4 ${FONT};color:#111827">${esc(whoWords(line))}</div>
        <div style="font:400 12px/1.4 ${FONT};color:#6b7280;margin:0 0 8px">
          ${esc(timeWords(line.submitted_at))}${line.version ? ` · version ${esc(line.version)}` : ''}
        </div>
        ${fields ? `<table role="presentation" cellpadding="0" cellspacing="0">${fields}</table>` : `<div style="font:400 13px/1.5 ${FONT};color:#6b7280">No answers recorded.</div>`}
      </div>`;
    })
    .join('');

  const empty = `<p style="font:400 14px/1.6 ${FONT};color:#6b7280;margin:0">
      Nobody answered this form during this period. That is the whole report -
      it does not mean anything failed.
    </p>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:24px 16px;background:#f9fafb">
  <div style="max-width:680px;margin:0 auto">
    <h1 style="font:700 20px/1.3 ${FONT};color:#111827;margin:0 0 4px">${esc(title)}</h1>
    <p style="font:400 14px/1.5 ${FONT};color:#6b7280;margin:0 0 18px">
      ${esc(type === 'Daily' ? 'Daily' : 'Weekly')} report · ${esc(when)}
    </p>

    <table role="presentation" cellpadding="0" cellspacing="6" style="border-collapse:separate;margin:0 0 18px">
      <tr>${metricCells}</tr>
    </table>

    ${
      mixedVersions
        ? `<p style="font:400 13px/1.5 ${FONT};color:#92400e;background:#fef3c7;border-radius:6px;padding:10px 12px;margin:0 0 18px">
             The form was edited during this period, so responses below answer
             different versions (${esc(versions.join(', '))}). Compare them with care.
           </p>`
        : ''
    }

    <h2 style="font:600 15px/1.3 ${FONT};color:#111827;margin:0 0 10px">Responses</h2>
    ${lines.length ? answerBlocks : empty}

    <p style="font:400 12px/1.5 ${FONT};color:#9ca3af;margin:18px 0 0">
      Photographs and signatures are not included in this email; they stay in the app.
    </p>
  </div>
</body></html>`;

  const textLines = [
    title,
    `${type === 'Daily' ? 'Daily' : 'Weekly'} report · ${when}`,
    '',
    ...metrics.map(([label, value]) => `  ${label}: ${value}`),
    ''
  ];
  if (mixedVersions)
    textLines.push(
      `  NOTE: the form was edited during this period (versions ${versions.join(', ')}).`,
      ''
    );
  if (!lines.length) {
    textLines.push('Nobody answered this form during this period.');
  } else {
    textLines.push('Responses');
    for (const line of lines) {
      textLines.push(
        `- ${whoWords(line)} · ${timeWords(line.submitted_at)}${line.version ? ` · version ${line.version}` : ''}`
      );
      for (const f of line.fields ?? [])
        textLines.push(`    ${f.label ?? ''}: ${f.value ?? '—'}`);
    }
  }
  textLines.push(
    '',
    'Photographs and signatures are not included in this email; they stay in the app.'
  );

  return { subject, html, text: textLines.join('\n') };
}

/**
 * Render whatever the database stored, by what it says it is.
 *
 * Returns null when the payload is not a report this knows how to draw, so the
 * caller can fall back rather than this inventing a shape.
 */
export function renderStoredReport(body: string): RenderedEmail | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;

  if (payload.source_kind === 'Form') return renderFormReport(payload);
  if (payload.source_kind === 'Programme') {
    const progress = (payload.progress ?? {}) as {
      target: number | null;
      properties: number;
      attended: number;
      complete_and_live: number;
    };
    return renderProgrammeReport({
      reportType: payload.report_type === 'Daily' ? 'Daily' : 'Weekly',
      report: payload as never,
      progress: {
        target: progress.target ?? null,
        properties: progress.properties ?? 0,
        attended: progress.attended ?? 0,
        complete_and_live: progress.complete_and_live ?? 0
      }
    });
  }
  return null;
}
