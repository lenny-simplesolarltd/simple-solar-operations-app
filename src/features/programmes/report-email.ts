import { DISPOSITION_LABEL, OUTCOME_LABEL, PORTAL_LABEL } from './labels';
import { readableDate, type ReportType } from './report-period';
import type { DailyReport } from './types';

/**
 * A programme report as an email somebody can act on without opening the app.
 *
 * It renders what the canonical report already decided. Nothing here counts,
 * classifies or infers: if a number is not in the report, it does not appear,
 * because a second implementation of "what counts as complete" is exactly how
 * a client report starts disagreeing with the board it came from.
 *
 * Two things are deliberately absent:
 *
 *   * evidence links and storage paths. A photograph of somebody's meter
 *     cupboard is not something to put behind a URL in an inbox.
 *   * anything about the occupant. The report is about meters and addresses;
 *     the tenant's name has no bearing on the work and no business travelling
 *     to a client.
 *
 * "Attended" is not "complete". A property can be visited, have its SIM
 * changed, and still not be live - so the headline separates them rather than
 * letting one number stand for the other.
 */

export interface ReportProgress {
  target: number | null;
  properties: number;
  attended: number;
  complete_and_live: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const n = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString('en-GB');

/** The period as a person would say it. */
function periodWords(
  reportType: ReportType,
  report: DailyReport & { from?: string; to?: string }
) {
  if (reportType === 'Daily') return readableDate(report.date);
  const from = report.from ?? report.date;
  const to = report.to ?? report.date;
  return `${readableDate(from)} to ${readableDate(to)}`;
}

/**
 * The counts that go at the top, in the order they answer the question
 * "what happened, and where are we".
 */
function activity(report: DailyReport) {
  return [
    ['Properties attended', report.properties_attended],
    ['SIMs changed', report.sims_swapped],
    ['No access', report.no_access],
    ['Action required', report.action_required],
    ['Meter requires changing', report.meters_requiring_replacement],
    ['Complete & working', report.complete_and_live],
    ['Portal confirmed live', report.portal_confirmed_live],
    ['Awaiting office review', report.awaiting_review]
  ] as const;
}

export function renderProgrammeReport(input: {
  reportType: ReportType;
  report: DailyReport & { from?: string; to?: string };
  progress: ReportProgress;
  /** Absolute link to the programme in the app. No token, no evidence. */
  programmeUrl?: string;
}): RenderedEmail {
  const { reportType, report, progress, programmeUrl } = input;
  const when = periodWords(reportType, report);
  const subject = `${report.programme.name} — ${reportType === 'Daily' ? 'daily' : 'weekly'} report, ${when}`;

  const rows = report.lines ?? [];
  const target = progress.target;
  const progressLine = target
    ? `${n(progress.complete_and_live)} of ${n(target)} complete and live`
    : `${n(progress.complete_and_live)} complete and live`;

  // -- HTML ---------------------------------------------------------------
  // Tables, inline styles and no external CSS: that is what survives Outlook
  // and Gmail alike. One column on a phone because the metric grid wraps.
  const metricCells = activity(report)
    .map(
      ([label, value]) => `
        <td style="padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;min-width:120px">
          <div style="font:600 22px/1.2 Helvetica,Arial,sans-serif;color:#111827">${n(value)}</div>
          <div style="font:400 12px/1.4 Helvetica,Arial,sans-serif;color:#6b7280">${esc(label)}</div>
        </td>`
    )
    .join('');

  const tableRows = rows
    .map(
      (line) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font:400 13px/1.4 Helvetica,Arial,sans-serif">
          ${esc(line.address)}${line.postcode ? `<br><span style="color:#6b7280">${esc(line.postcode)}</span>` : ''}
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font:400 13px/1.4 Helvetica,Arial,sans-serif">
          ${esc(line.outcome ? OUTCOME_LABEL[line.outcome] : '—')}
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font:400 13px/1.4 Helvetica,Arial,sans-serif">
          ${esc(line.disposition ? DISPOSITION_LABEL[line.disposition] : '—')}
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font:400 13px/1.4 Helvetica,Arial,sans-serif">
          ${esc(line.actual_meter_serial ?? '—')}${
            line.meter_serial_matches === false
              ? '<br><span style="color:#b91c1c;font-weight:600">serial mismatch</span>'
              : ''
          }
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font:400 13px/1.4 Helvetica,Arial,sans-serif">
          ${line.csq === null || line.csq === undefined ? '—' : esc(line.csq)}
        </td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;font:400 13px/1.4 Helvetica,Arial,sans-serif">
          ${esc(line.portal_verification ? PORTAL_LABEL[line.portal_verification] : '—')}
        </td>
      </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f9fafb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
  <tr><td style="padding:20px 24px;border-bottom:1px solid #e5e7eb">
    <div style="font:700 18px/1.3 Helvetica,Arial,sans-serif;color:#111827">${esc(report.programme.name)}</div>
    <div style="font:400 14px/1.5 Helvetica,Arial,sans-serif;color:#6b7280">
      ${reportType === 'Daily' ? 'Daily report' : 'Weekly report'} — ${esc(when)}
    </div>
  </td></tr>

  <tr><td style="padding:18px 24px 6px">
    <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Progress</div>
    <div style="font:700 20px/1.3 Helvetica,Arial,sans-serif;color:#111827;padding-top:4px">${esc(progressLine)}</div>
    <div style="font:400 13px/1.5 Helvetica,Arial,sans-serif;color:#6b7280">
      ${n(progress.properties)} properties in the imported workload · ${n(progress.attended)} attended so far
    </div>
  </td></tr>

  <tr><td style="padding:12px 18px">
    <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;padding:0 6px 8px">
      ${reportType === 'Daily' ? "That day's activity" : "That week's activity"}
    </div>
    <table role="presentation" cellpadding="0" cellspacing="6"><tr>${metricCells}</tr></table>
  </td></tr>

  <tr><td style="padding:12px 24px 20px">
    <div style="font:600 13px/1.4 Helvetica,Arial,sans-serif;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;padding-bottom:8px">
      Properties attended (${n(rows.length)})
    </div>
    ${
      rows.length === 0
        ? '<div style="font:400 14px/1.5 Helvetica,Arial,sans-serif;color:#6b7280">No visits were recorded in this period.</div>'
        : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        ${['Address', 'Outcome', 'Status', 'Meter found', 'CSQ', 'Portal']
          .map(
            (h) =>
              `<th align="left" style="padding:8px;border-bottom:2px solid #e5e7eb;font:600 12px/1.4 Helvetica,Arial,sans-serif;color:#6b7280">${h}</th>`
          )
          .join('')}
      </tr>${tableRows}</table>`
    }
  </td></tr>

  ${
    programmeUrl
      ? `<tr><td style="padding:0 24px 24px">
    <a href="${esc(programmeUrl)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#ffffff;border-radius:8px;font:600 14px/1 Helvetica,Arial,sans-serif;text-decoration:none">Open the programme</a>
  </td></tr>`
      : ''
  }

  <tr><td style="padding:14px 24px;border-top:1px solid #e5e7eb;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#6b7280">
    Sent automatically by Simple Solar Operations. Attended does not mean complete — a property can be visited and still not be live.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  // -- Plain text ---------------------------------------------------------
  const text = [
    report.programme.name,
    `${reportType === 'Daily' ? 'Daily report' : 'Weekly report'} — ${when}`,
    '',
    'PROGRESS',
    progressLine,
    `${n(progress.properties)} properties in the imported workload, ${n(progress.attended)} attended so far`,
    '',
    reportType === 'Daily' ? "THAT DAY'S ACTIVITY" : "THAT WEEK'S ACTIVITY",
    ...activity(report).map(([label, value]) => `  ${label}: ${n(value)}`),
    '',
    `PROPERTIES ATTENDED (${n(rows.length)})`,
    ...(rows.length === 0
      ? ['  No visits were recorded in this period.']
      : rows.map((line) =>
          [
            `  ${line.address}${line.postcode ? `, ${line.postcode}` : ''}`,
            `    ${line.outcome ? OUTCOME_LABEL[line.outcome] : 'No outcome'} · ${line.disposition ? DISPOSITION_LABEL[line.disposition] : 'No status'}`,
            line.actual_meter_serial
              ? `    Meter found: ${line.actual_meter_serial}${line.meter_serial_matches === false ? ' (serial mismatch)' : ''}`
              : null,
            line.csq === null || line.csq === undefined
              ? null
              : `    CSQ: ${line.csq}`,
            line.portal_verification
              ? `    Portal: ${PORTAL_LABEL[line.portal_verification]}`
              : null
          ]
            .filter(Boolean)
            .join('\n')
        )),
    '',
    ...(programmeUrl ? [`Open the programme: ${programmeUrl}`, ''] : []),
    'Sent automatically by Simple Solar Operations. Attended does not mean complete.'
  ].join('\n');

  return { subject, html, text };
}
