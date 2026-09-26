import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const queries = vi.hoisted(() => ({
  getReportSubscriptions: vi.fn(),
  getFormResponseReport: vi.fn(),
  getDailyReport: vi.fn(),
  getWeeklyReport: vi.fn()
}));
vi.mock('@/features/programmes/server/queries', () => queries);

const actions = vi.hoisted(() => ({
  setReportSubscriptionAction: vi.fn(),
  sendReportAction: vi.fn()
}));
vi.mock('@/features/programmes/server/actions', () => actions);

const people = vi.hoisted(() => ({
  listReportPeople: vi.fn(),
  listPeopleInRole: vi.fn(),
  groupRoleFor: vi.fn((_phrase: string): string | null => null),
  GROUP_ROLES: {}
}));
vi.mock('@/features/programmes/server/recipients', () => people);

const person = (id: string, displayName: string, email: string) => ({
  personId: id,
  displayName,
  email,
  roles: ['Office']
});

import {
  reportDeleteTool,
  reportPreviewTool,
  reportRecipientsTool,
  reportScheduleSetTool,
  reportScheduleTool,
  reportSendTool
} from '../tools/reports';

const SOURCE = '11111111-2222-4333-8444-555555555555';

const subscription = (over: Record<string, unknown> = {}) => ({
  id: 's',
  sourceKind: 'Programme',
  sourceId: SOURCE,
  reportType: 'Weekly',
  enabled: false,
  timezone: 'Europe/London',
  sendHour: 7,
  weekStartsOn: 1,
  recipients: [{ name: null, email: 'dan@example.test' }],
  lastPeriodEnd: null,
  version: 3,
  ...over
});

describe('reading a schedule', () => {
  it('says what is sent, when, and to whom', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ enabled: true, weekStartsOn: 5 })],
      runs: []
    });
    const result = await reportScheduleTool.execute(
      { source_kind: 'Programme', source_id: SOURCE },
      {} as never
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { schedules: { when: string }[] };
    expect(data.schedules[0].when).toContain('Friday to Thursday');
    expect(data.schedules[0].when).toContain('07:00');
  });
});

describe('a name is never turned into an email address', () => {
  it('refuses when nobody matches', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription()],
      runs: []
    });
    people.listReportPeople.mockResolvedValue({ people: [], unreachable: [] });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        recipients: ['Hannah']
      },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('REPORT_RECIPIENT_UNRESOLVED');
    expect(out.message).toMatch(/Hannah/);
  });

  it('refuses when a name is ambiguous, naming the candidates', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription()],
      runs: []
    });
    people.listReportPeople.mockResolvedValue({
      people: [
        person('1', 'Hannah Smith', 'hannah.smith@example.test'),
        person('2', 'Hannah Jones', 'hannah.jones@example.test')
      ],
      unreachable: []
    });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        recipients: ['Hannah']
      },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain('Hannah Smith');
    expect(out.message).toContain('Hannah Jones');
  });

  it('accepts an address that was actually given', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription()],
      runs: []
    });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        enabled: true,
        recipients: ['dan@example.test', 'ben@example.test']
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const line = out.preview.changes.find((c) => c.label === 'Recipients');
    expect(line?.to).toBe('dan@example.test, ben@example.test');
  });
});

describe('every change is a proposal, and says what it does not do', () => {
  it('warns that being listed is not permission to email', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription()],
      runs: []
    });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        enabled: true
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.warnings.join(' ')).toMatch(/not permission/i);
    expect(out.preview.expectedVersion).toBe(3);
  });

  it('warns when switching on with nobody to send to', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ recipients: [] })],
      runs: []
    });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        enabled: true
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.warnings.join(' ')).toMatch(/nothing will be sent/i);
  });
});

describe('sending by hand', () => {
  it('refuses when nothing is configured', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [],
      runs: []
    });
    const out = await reportSendTool.prepare(
      { source_kind: 'Programme', source_id: SOURCE, report_type: 'Daily' },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('REPORT_NOT_CONFIGURED');
  });

  it('refuses when there is nobody to send to', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ reportType: 'Daily', recipients: [] })],
      runs: []
    });
    const out = await reportSendTool.prepare(
      { source_kind: 'Programme', source_id: SOURCE, report_type: 'Daily' },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('REPORT_NO_RECIPIENTS');
  });

  it('says a repeated period is not sent again', async () => {
    actions.sendReportAction.mockResolvedValue({
      ok: true,
      outcome: { status: 'Succeeded', heading: 'OK', message: 'ok' },
      result: { already_reported: true, status: 'Built' },
      replayed: false
    });
    const out = await reportSendTool.execute(
      { source_kind: 'Programme', source_id: SOURCE, report_type: 'Daily' },
      { commandId: 'c0ffee00-0000-4000-8000-000000000001' } as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect((out.data as { note: string }).note).toMatch(
      /nothing was sent again/i
    );
  });
});

describe('a form report never carries the answers', () => {
  it('returns counts and says where the answers live', async () => {
    queries.getFormResponseReport.mockResolvedValue({
      form: { id: 'f', title: 'Survey', status: 'published' },
      from: '2026-09-20',
      to: '2026-09-20',
      responses: 4,
      versionsAnswered: 1,
      lines: []
    });
    const out = await reportPreviewTool.execute(
      {
        source_kind: 'Form',
        source_id: SOURCE,
        report_type: 'Daily'
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const data = out.data as Record<string, unknown>;
    expect(data.responses).toBe(4);
    expect(JSON.stringify(data)).not.toContain('answers":');
    expect(String(data.note)).toMatch(/read in the app/i);
  });
});

describe('a programme preview keeps attended apart from complete', () => {
  it('returns both and says they differ', async () => {
    queries.getDailyReport.mockResolvedValue({
      programme: { id: 'p', code: 'PCH', name: 'PCH', client_name: null },
      date: '2026-09-25',
      properties_attended: 9,
      complete_and_live: 3,
      sims_swapped: 7,
      no_access: 2,
      action_required: 1,
      meters_requiring_replacement: 0,
      portal_confirmed_live: 3,
      awaiting_review: 4,
      lines: []
    });
    const out = await reportPreviewTool.execute(
      { source_kind: 'Programme', source_id: SOURCE, report_type: 'Daily' },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const data = out.data as Record<string, unknown>;
    expect(data.properties_attended).toBe(9);
    expect(data.complete_and_live).toBe(3);
    expect(String(data.note)).toMatch(/Attended counts properties visited/);
  });
});

describe('a person with no address is refused by name, never guessed at', () => {
  it('says who, and why', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription()],
      runs: []
    });
    people.listReportPeople.mockResolvedValue({
      people: [],
      unreachable: [
        { personId: '9', displayName: 'Ben Quick', reason: 'no email on file' }
      ]
    });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        recipients: ['Ben']
      },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.message).toContain('Ben Quick');
    expect(out.message).toMatch(/no email address on file/i);
    // Never a constructed address.
    expect(out.message).not.toMatch(/@/);
  });
});

describe('"the office" expands to explicit people, and says so', () => {
  it('names them in the confirmation and stores them, not the group', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ recipients: [] })],
      runs: []
    });
    people.groupRoleFor.mockImplementation((v: string) =>
      v.trim().toLowerCase() === 'the office' ? 'Office' : null
    );
    people.listPeopleInRole.mockResolvedValue({
      people: [
        person('1', 'Hannah Harvey', 'hannah@example.test'),
        person('2', 'Lucy Ross', 'lucy@example.test'),
        person('3', 'Rosie Ashley', 'rosie@example.test')
      ],
      unreachable: []
    });

    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        enabled: true,
        recipients: ['the office']
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const line = out.preview.changes.find((c) => c.label === 'Recipients');
    expect(line?.to).toBe('Hannah Harvey, Lucy Ross, Rosie Ashley');

    const expansion = out.preview.changes.find((c) =>
      c.label.includes('the office')
    );
    expect(expansion?.to).toBe('Hannah Harvey, Lucy Ross, Rosie Ashley');

    // The whole point of choosing explicit people over a stored role.
    expect(out.preview.warnings.join(' ')).toMatch(
      /added to that group later will NOT start receiving/i
    );
  });

  it('leaves out a group member with no address, and says which', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ recipients: [] })],
      runs: []
    });
    people.groupRoleFor.mockImplementation((v: string) =>
      v.trim().toLowerCase() === 'the office' ? 'Office' : null
    );
    people.listPeopleInRole.mockResolvedValue({
      people: [person('1', 'Hannah Harvey', 'hannah@example.test')],
      unreachable: [
        { personId: '2', displayName: 'Ben Quick', reason: 'no email on file' }
      ]
    });
    const out = await reportScheduleSetTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        recipients: ['the office']
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const omitted = out.preview.changes.find((c) =>
      c.label.includes('no email on file')
    );
    expect(omitted?.to).toBe('Ben Quick');
  });
});

describe('adding and removing named recipients', () => {
  const withTwo = () =>
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [
        subscription({
          recipients: [
            { name: 'Dan Barnes', email: 'dan@example.test' },
            { name: 'Ben Quick', email: 'ben@example.test' }
          ]
        })
      ],
      runs: []
    });

  it('adds one person and leaves the rest in place', async () => {
    withTwo();
    people.listReportPeople.mockResolvedValue({
      people: [person('3', 'Hannah Harvey', 'hannah@example.test')],
      unreachable: []
    });
    const out = await reportRecipientsTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        add: ['Hannah']
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.changes.find((c) => c.label === 'Adding')?.to).toBe(
      'Hannah Harvey'
    );
    expect(out.preview.changes.find((c) => c.label === 'Will go to')?.to).toBe(
      'Dan Barnes, Ben Quick, Hannah Harvey'
    );
  });

  it('removes one by name, and says who is left', async () => {
    withTwo();
    const out = await reportRecipientsTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        remove: ['Ben']
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.changes.find((c) => c.label === 'Removing')?.to).toBe(
      'Ben Quick'
    );
    expect(out.preview.changes.find((c) => c.label === 'Will go to')?.to).toBe(
      'Dan Barnes'
    );
  });

  it('refuses to remove somebody who is not on the list, and says who is', async () => {
    withTwo();
    const out = await reportRecipientsTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        remove: ['Hannah']
      },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('REPORT_RECIPIENT_NOT_ON_LIST');
    expect(out.message).toContain('Dan Barnes, Ben Quick');
  });

  it('warns when a removal would leave nobody on an enabled report', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [
        subscription({
          enabled: true,
          recipients: [{ name: 'Dan Barnes', email: 'dan@example.test' }]
        })
      ],
      runs: []
    });
    const out = await reportRecipientsTool.prepare(
      {
        source_kind: 'Programme',
        source_id: SOURCE,
        report_type: 'Weekly',
        remove: ['Dan']
      },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.warnings.join(' ')).toMatch(/nobody would be left/i);
  });
});

describe('deleting a schedule', () => {
  it('proposes it, and promises the history survives', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ enabled: true })],
      runs: []
    });
    const out = await reportDeleteTool.prepare(
      { source_kind: 'Programme', source_id: SOURCE, report_type: 'Weekly' },
      {} as never
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.preview.confirmLabel).toBe('Delete it');
    expect(out.preview.warnings.join(' ')).toMatch(/stay in the history/i);
    expect(out.preview.expectedVersion).toBe(3);
  });

  it('refuses when there is nothing to delete', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [],
      runs: []
    });
    const out = await reportDeleteTool.prepare(
      { source_kind: 'Programme', source_id: SOURCE, report_type: 'Daily' },
      {} as never
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('REPORT_NOT_CONFIGURED');
  });
});

describe('every mutation is a proposal, never an action', () => {
  it('prepare writes nothing', async () => {
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription()],
      runs: []
    });
    actions.setReportSubscriptionAction.mockClear();
    actions.sendReportAction.mockClear();
    for (const tool of [
      reportScheduleSetTool,
      reportRecipientsTool,
      reportDeleteTool,
      reportSendTool
    ]) {
      await tool.prepare(
        {
          source_kind: 'Programme',
          source_id: SOURCE,
          report_type: 'Weekly',
          add: ['dan@example.test']
        } as never,
        {} as never
      );
    }
    expect(actions.setReportSubscriptionAction).not.toHaveBeenCalled();
    expect(actions.sendReportAction).not.toHaveBeenCalled();
  });

  it('hands the command only the fields its schema accepts', async () => {
    // The regression this exists for: resolveRecipients also returns
    // personId, the command's recipient schema is strict, and execute passed
    // the row through whole. Every confirmation of a schedule with recipients
    // died on the server's own zod parse - "Something about that request was
    // not valid. Nothing was changed." - and the proposal card said so with
    // no clue which field. prepare() is not enough to catch it: only
    // execute() builds the payload, and the action is mocked here, so assert
    // the SHAPE rather than trusting the call to have gone through.
    queries.getReportSubscriptions.mockResolvedValue({
      subscriptions: [subscription({ reportType: 'Weekly' })]
    });
    people.listReportPeople.mockResolvedValue([]);
    actions.setReportSubscriptionAction.mockResolvedValue({
      ok: true,
      result: {}
    });
    actions.setReportSubscriptionAction.mockClear();

    const out = await reportScheduleSetTool.execute(
      {
        source_kind: 'Form',
        source_id: SOURCE,
        report_type: 'Weekly',
        enabled: true,
        send_hour: 10,
        week_starts_on: 1,
        recipients: ['lenny@example.test', 'dan@example.test']
      } as never,
      {
        actor: { user: {}, permissions: new Set(['programme.manage']) },
        threadId: 't',
        commandId: '11111111-2222-4333-8444-666666666666',
        expectedVersion: null,
        initiatedVia: 'assistant'
      } as never
    );

    expect(out.ok).toBe(true);
    const [payload] = actions.setReportSubscriptionAction.mock.calls[0] as [
      { recipients: Record<string, unknown>[] }
    ];
    expect(payload.recipients).toHaveLength(2);
    for (const r of payload.recipients)
      expect(Object.keys(r).sort()).toEqual(['email', 'name']);
  });

  it('every mutation tool carries a confirmation label', () => {
    for (const tool of [
      reportScheduleSetTool,
      reportRecipientsTool,
      reportDeleteTool,
      reportSendTool
    ])
      expect(tool.kind).toBe('mutation');
  });
});
