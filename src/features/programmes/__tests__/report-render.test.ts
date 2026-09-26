import { describe, expect, it } from 'vitest';
import { renderStoredReport } from '../report-render';

// The exact payload a recipient received, before anything rendered it.
const REAL_EMPTY_WEEK = JSON.stringify({
  to: '2026-09-25',
  form: {
    id: 'f273f899-d52c-4699-ae2d-ae789e972edd',
    title: 'Survey Test',
    status: 'published'
  },
  from: '2026-09-19',
  lines: [],
  versions: [],
  responses: 0,
  report_type: 'Weekly',
  source_kind: 'Form',
  versions_answered: 0
});

describe('a stored form report', () => {
  it('reads as words, not as the JSON somebody actually received', () => {
    const out = renderStoredReport(REAL_EMPTY_WEEK);
    expect(out).not.toBeNull();
    // The same wording the app uses everywhere else, weekday included.
    expect(out!.subject).toBe(
      'Survey Test — weekly report, Sat 19 Sep 2026 to Fri 25 Sep 2026'
    );
    // The failure this exists to prevent: raw payload reaching a recipient.
    expect(out!.text).not.toContain('source_kind');
    expect(out!.text).not.toContain('f273f899');
    expect(out!.html).not.toContain('"responses"');
    // An empty week says so plainly rather than looking broken.
    expect(out!.text).toMatch(/Nobody answered this form/);
  });

  it('shows the answers, and warns when the wording moved mid-period', () => {
    const out = renderStoredReport(
      JSON.stringify({
        source_kind: 'Form',
        report_type: 'Weekly',
        form: { title: 'Survey Test' },
        from: '2026-09-19',
        to: '2026-09-25',
        responses: 2,
        versions: [1, 2],
        versions_answered: 2,
        lines: [
          {
            submitted_at: '2026-09-20T09:30:00Z',
            version: 1,
            job_ref: 'SS-0001',
            fields: [{ label: 'Battery Size (kWh)', value: '5' }]
          },
          {
            submitted_at: '2026-09-24T14:00:00Z',
            version: 2,
            recipient_type: 'customer',
            fields: [{ label: 'Battery Size (kWh)', value: '10' }]
          }
        ]
      })
    )!;
    expect(out.text).toContain('Battery Size (kWh): 5');
    expect(out.text).toContain('SS-0001');
    // Two people answered different questions. Saying so beats averaging.
    expect(out.text).toMatch(/form was edited during this period/i);
    expect(out.html).toContain('1, 2');
  });

  it('refuses to guess at a payload it does not recognise', () => {
    expect(renderStoredReport('not json at all')).toBeNull();
    expect(renderStoredReport(JSON.stringify({ hello: 'world' }))).toBeNull();
  });
});
