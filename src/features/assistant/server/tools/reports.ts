import 'server-only';

import {
  groupRoleFor,
  listPeopleInRole,
  listReportPeople
} from '@/features/programmes/server/recipients';
import {
  deleteReportSubscriptionAction,
  sendReportAction,
  setReportSubscriptionAction
} from '@/features/programmes/server/actions';
import {
  getFormResponseReport,
  getReportSubscriptions,
  getDailyReport,
  getWeeklyReport
} from '@/features/programmes/server/queries';
import { z } from 'zod';
import type {
  ActionPreview,
  MutationContext,
  MutationTool,
  ReadTool
} from '../registry';

/**
 * SimpleBot's automated-report tools.
 *
 * "Every Friday send the PCH weekly report to Hannah, Dan and Ben" is a
 * schedule, and these are adapters over the SAME reads and commands the screen
 * uses - REPORT_SUBSCRIPTIONS, REPORT_SUBSCRIPTION_SET, REPORT_SEND. There is
 * no SimpleBot-side state and no second path to sending: the database still
 * decides who may schedule what, and every gate between a built report and a
 * delivered one is untouched.
 *
 * Two rules the model cannot talk its way past:
 *
 *   * A name is never an email address. "Add Hannah" resolves through People,
 *     and an ambiguous or unknown name is a question for the person, not a
 *     guess - sending a client report to the wrong Hannah is not recoverable.
 *   * Every change is a proposal. Turning a schedule on, changing who receives
 *     it, and sending one by hand all go through the confirmation card.
 */

const DOMAIN = 'reporting' as const;
const uuid = z.uuid();

const ENFORCED =
  'programme.manage / forms.send in REPORT_SUBSCRIPTION_SET and REPORT_SEND (execute_command), and RLS on report_subscriptions';

const fail = (code: string, message: string) =>
  ({ ok: false, code, message }) as const;

const SOURCE = z
  .enum(['Programme', 'Form'])
  .describe('Whether the report is about a programme or a form');
const TYPE = z.enum(['Daily', 'Weekly']).describe('Daily or Weekly');

const DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];
const at = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** How a schedule reads to a person, used in answers and in confirmations. */
function describe(sub: {
  reportType: string;
  enabled: boolean;
  sendHour: number;
  weekStartsOn: number;
  timezone: string;
  recipients: { name: string | null; email: string }[];
}) {
  const when =
    sub.reportType === 'Daily'
      ? `every day at ${at(sub.sendHour)}`
      : `every week, ${DAYS[sub.weekStartsOn - 1]} to ${DAYS[(sub.weekStartsOn + 5) % 7]}, sent at ${at(sub.sendHour)}`;
  return {
    report_type: sub.reportType,
    enabled: sub.enabled,
    when: `${when} (${sub.timezone})`,
    recipients: sub.recipients.map((r) => r.name ?? r.email),
    recipient_count: sub.recipients.length
  };
}

// -- Reads ----------------------------------------------------------------------

interface ScheduleInput {
  source_kind: 'Programme' | 'Form';
  source_id: string;
}

export const reportScheduleTool: ReadTool<ScheduleInput> = {
  name: 'report_schedule',
  summary: 'What is scheduled to be emailed, to whom, and what has run',
  description:
    'Read the automated report schedules for one programme or one form: whether the daily and weekly reports are switched on, when they send, who receives them, and the recent report runs with their status. Use this to answer "who gets this form\'s daily report", "is the PCH weekly report on", or "when did the last one go".',
  domain: DOMAIN,
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ source_kind: SOURCE, source_id: uuid }),
  authorization: {
    permissions: ['programme.report'],
    enforcedBy: ENFORCED
  },
  async execute({ source_kind, source_id }) {
    const data = await getReportSubscriptions(source_kind, source_id);
    if (!data)
      return fail(
        'REPORT_SOURCE_NOT_FOUND',
        'That programme or form could not be read, or its reporting is not visible to this staff member.'
      );
    return {
      ok: true,
      data: {
        schedules: data.subscriptions.map(describe),
        // Nothing is sent by reading this. Say so, so the model does not imply it.
        nothing_scheduled: data.subscriptions.length === 0,
        recent_runs: data.runs.slice(0, 10).map((run) => ({
          report_type: run.reportType,
          period:
            run.periodStart === run.periodEnd
              ? run.periodStart
              : `${run.periodStart} to ${run.periodEnd}`,
          status: run.status,
          detail: run.detail,
          sent_by_hand: run.manual,
          email_status: run.communicationStatus
        }))
      }
    };
  }
};

interface PreviewInput {
  source_kind: 'Programme' | 'Form';
  source_id: string;
  report_type: 'Daily' | 'Weekly';
  from?: string;
  to?: string;
}

export const reportPreviewTool: ReadTool<PreviewInput> = {
  name: 'report_preview',
  summary: 'The report itself, for a period, without sending anything',
  description:
    'Build and read a programme or form report for a period, exactly as the emailed version would be, without sending it. Use for "show me the PCH daily report", "preview today\'s report" or "what did last week look like". For a programme this is the operational numbers and the properties attended; for a form it is how many responses arrived, never the answers themselves.',
  domain: DOMAIN,
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    source_kind: SOURCE,
    source_id: uuid,
    report_type: TYPE,
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
  }),
  authorization: {
    permissions: ['programme.report'],
    enforcedBy: ENFORCED
  },
  async execute(input) {
    if (input.source_kind === 'Form') {
      const report = await getFormResponseReport(input.source_id, {
        from: input.from,
        to: input.to
      });
      if (!report)
        return fail('REPORT_NOT_AVAILABLE', 'That form could not be read.');
      return {
        ok: true,
        data: {
          form: report.form.title,
          period: `${report.from} to ${report.to}`,
          responses: report.responses,
          // Deliberately absent: what anybody answered.
          note: 'Counts and the fact of each response only; the answers are read in the app.'
        }
      };
    }
    const report =
      input.report_type === 'Weekly'
        ? await getWeeklyReport(input.source_id, {
            from: input.from,
            to: input.to
          })
        : await getDailyReport(input.source_id, input.to);
    if (!report)
      return fail(
        'REPORT_NOT_AVAILABLE',
        'That programme could not be read, or its reporting is not visible to this staff member.'
      );
    return {
      ok: true,
      data: {
        programme: report.programme.name,
        period: report.from ? `${report.from} to ${report.to}` : report.date,
        properties_attended: report.properties_attended,
        sims_changed: report.sims_swapped,
        no_access: report.no_access,
        action_required: report.action_required,
        meters_requiring_replacement: report.meters_requiring_replacement,
        complete_and_live: report.complete_and_live,
        portal_confirmed_live: report.portal_confirmed_live,
        awaiting_review: report.awaiting_review,
        // Attended is not complete, and the model must not merge them.
        note: 'Attended counts properties visited; complete_and_live counts those finished and confirmed live.',
        properties: report.lines.slice(0, 50).map((line) => ({
          address: line.address,
          postcode: line.postcode,
          outcome: line.outcome,
          status: line.disposition,
          meter_found: line.actual_meter_serial,
          serial_mismatch: line.meter_serial_matches === false,
          csq: line.csq,
          portal: line.portal_verification
        })),
        properties_shown: Math.min(report.lines.length, 50),
        properties_total: report.lines.length
      }
    };
  }
};

// -- Recipient resolution --------------------------------------------------------

/**
 * Turns what somebody said into explicit people, or refuses.
 *
 * Three kinds of thing can be said, and only one of them is a guess:
 *
 *   * an address, taken as given and marked external
 *   * a NAME, looked up in People - exactly one active match with an address,
 *     or it comes back as a question. "Which Hannah?" is a far better answer
 *     than a client report sent to the wrong one, and there is no rule that
 *     turns a name into an address.
 *   * a GROUP, "the office", which EXPANDS to the people in that role right
 *     now. What gets saved is those people. A stored role would mean the next
 *     person given the Office role quietly starts receiving a client's report,
 *     and nobody would have decided that.
 */
async function resolveRecipients(wanted: string[]): Promise<
  | {
      ok: true;
      recipients: {
        personId: string | null;
        name: string | null;
        email: string;
      }[];
      expandedGroups: { phrase: string; people: string[] }[];
    }
  | { ok: false; problem: string }
> {
  const recipients: {
    personId: string | null;
    name: string | null;
    email: string;
  }[] = [];
  const expandedGroups: { phrase: string; people: string[] }[] = [];
  const seen = new Set<string>();

  const add = (r: {
    personId: string | null;
    name: string | null;
    email: string;
  }) => {
    if (seen.has(r.email)) return;
    seen.add(r.email);
    recipients.push(r);
  };

  for (const raw of wanted) {
    const value = raw.trim();
    if (!value) continue;

    if (value.includes('@')) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))
        return { ok: false, problem: `"${value}" is not an email address.` };
      add({ personId: null, name: null, email: value.toLowerCase() });
      continue;
    }

    const role = groupRoleFor(value);
    if (role) {
      const { people, unreachable } = await listPeopleInRole(role);
      if (people.length === 0)
        return {
          ok: false,
          problem: `Nobody in the ${role} group has an email address on file, so "${value}" cannot be turned into recipients.`
        };
      for (const person of people)
        add({
          personId: person.personId,
          name: person.displayName,
          email: person.email
        });
      expandedGroups.push({
        phrase: value,
        people: people.map((p) => p.displayName)
      });
      if (unreachable.length)
        expandedGroups.push({
          phrase: `${value} (left out, no email on file)`,
          people: unreachable.map((p) => p.displayName)
        });
      continue;
    }

    const { people, unreachable } = await listReportPeople(value);
    const lower = value.toLowerCase();
    const matches = people.filter((p) =>
      p.displayName.toLowerCase().includes(lower)
    );
    const blocked = unreachable.filter((p) =>
      p.displayName.toLowerCase().includes(lower)
    );

    if (matches.length === 0 && blocked.length === 1)
      return {
        ok: false,
        problem: `${blocked[0].displayName} has no email address on file, so they cannot be sent a report. Ask for the address to use.`
      };
    if (matches.length === 0)
      return {
        ok: false,
        problem: `Nobody called "${value}" was found. Ask for their full name as it appears in People, or the email address to use.`
      };
    if (matches.length > 1)
      return {
        ok: false,
        problem: `"${value}" matches ${matches.length} people (${matches.map((m) => m.displayName).join(', ')}). Ask which one they mean.`
      };
    add({
      personId: matches[0].personId,
      name: matches[0].displayName,
      email: matches[0].email
    });
  }

  return { ok: true, recipients, expandedGroups };
}

// -- Mutations -------------------------------------------------------------------

interface ScheduleSetInput {
  source_kind: 'Programme' | 'Form';
  source_id: string;
  report_type: 'Daily' | 'Weekly';
  enabled?: boolean;
  send_hour?: number;
  week_starts_on?: number;
  recipients?: string[];
}

export const reportScheduleSetTool: MutationTool<ScheduleSetInput> = {
  name: 'report_schedule_set',
  summary: 'Propose changing when a report is emailed, and to whom',
  description:
    'Set up, change, pause or resume an automated report for a programme or a form: whether it is on, what hour it sends (UK time), which weekday a weekly period starts, and the full list of recipients. Recipients REPLACE the existing list, so to add somebody read the schedule first and send the existing addresses back with the new one. Use email addresses; a name is only accepted when it resolves to exactly one person. Nothing is sent by this - it changes the instruction, and the report still only leaves if sending is switched on for this server.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    source_kind: SOURCE,
    source_id: uuid,
    report_type: TYPE,
    enabled: z
      .boolean()
      .optional()
      .describe('True to switch the report on, false to pause it'),
    send_hour: z
      .number()
      .int()
      .min(0)
      .max(23)
      .optional()
      .describe('The hour it sends, UK time, 0-23'),
    week_starts_on: z
      .number()
      .int()
      .min(1)
      .max(7)
      .optional()
      .describe(
        'Weekly only: ISO weekday the reporting week starts, 1 = Monday'
      ),
    recipients: z
      .array(z.string().trim().min(1).max(320))
      .max(50)
      .optional()
      .describe('The FULL list of recipients after the change, as addresses')
  }),
  authorization: {
    permissions: ['programme.manage'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    const current = await getReportSubscriptions(
      input.source_kind,
      input.source_id
    );
    if (!current)
      return fail(
        'REPORT_SOURCE_NOT_FOUND',
        'That programme or form could not be read.'
      );
    const existing = current.subscriptions.find(
      (s) => s.reportType === input.report_type
    );

    let recipients: { name: string | null; email: string }[] =
      existing?.recipients ?? [];
    let expanded: { phrase: string; people: string[] }[] = [];
    if (input.recipients) {
      const resolved = await resolveRecipients(input.recipients);
      if (!resolved.ok)
        return fail('REPORT_RECIPIENT_UNRESOLVED', resolved.problem);
      recipients = resolved.recipients;
      expanded = resolved.expandedGroups;
    }

    const enabled = input.enabled ?? existing?.enabled ?? false;
    const sendHour = input.send_hour ?? existing?.sendHour ?? 7;
    const weekStartsOn = input.week_starts_on ?? existing?.weekStartsOn ?? 1;

    const changes: ActionPreview['changes'] = [
      { label: 'Report', to: `${input.report_type} report` },
      {
        label: 'Switched on',
        from: existing ? String(existing.enabled) : 'not set up',
        to: String(enabled)
      },
      {
        label: 'Sends at',
        from: existing ? at(existing.sendHour) : undefined,
        to: `${at(sendHour)} UK time`
      },
      ...(input.report_type === 'Weekly'
        ? [
            {
              label: 'Week starts',
              from: existing ? DAYS[existing.weekStartsOn - 1] : undefined,
              to: DAYS[weekStartsOn - 1]
            }
          ]
        : []),
      {
        label: 'Recipients',
        from: existing?.recipients.length
          ? existing.recipients.map((r) => r.name ?? r.email).join(', ')
          : 'nobody',
        // Named, so the person confirms PEOPLE rather than a list of addresses.
        to: recipients.length
          ? recipients.map((r) => r.name ?? r.email).join(', ')
          : 'nobody'
      },
      // Said out loud: "the office" became these people, and it is those people
      // that get saved - not the group.
      ...expanded.map((group) => ({
        label: `"${group.phrase}" is`,
        to: group.people.join(', ')
      }))
    ];

    const preview: ActionPreview = {
      title: 'Change an automated report',
      summary: enabled
        ? `Send the ${input.report_type.toLowerCase()} report to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}, ${input.report_type === 'Daily' ? `every day at ${at(sendHour)}` : `every week at ${at(sendHour)}`}.`
        : `Leave the ${input.report_type.toLowerCase()} report switched off.`,
      changes,
      warnings: [
        ...(enabled && recipients.length === 0
          ? ['Nobody is on the list, so nothing will be sent.']
          : []),
        ...(input.recipients
          ? ['This replaces the whole recipient list.']
          : []),
        // The whole reason "the office" is expanded rather than stored: what is
        // saved is these people, and membership changes will not reach them.
        ...(expanded.length
          ? [
              'A group was expanded to the people in it now. Somebody added to that group later will NOT start receiving this report.'
            ]
          : []),
        'Being on this list is not permission: the server still has to be allowed to email each address.'
      ],
      confirmLabel: enabled ? 'Switch it on' : 'Save the schedule',
      // Null, not undefined: a schedule that does not exist yet has no version
      // to be stale against, and the preview type says so explicitly.
      expectedVersion: existing?.version ?? null
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    let recipients: { name: string | null; email: string }[] | undefined;
    if (input.recipients) {
      // Re-resolved on the way out: the directory could have changed between
      // the proposal and the confirmation.
      const resolved = await resolveRecipients(input.recipients);
      if (!resolved.ok)
        return fail('REPORT_RECIPIENT_UNRESOLVED', resolved.problem);
      // Name and address only. resolveRecipients also returns personId, which
      // the command has no column for and its strict schema rejects outright -
      // so passing the row through whole failed the whole confirmation with
      // "Something about that request was not valid".
      recipients = resolved.recipients.map(({ name, email }) => ({
        name,
        email
      }));
    }

    const response = await setReportSubscriptionAction(
      {
        sourceKind: input.source_kind,
        sourceId: input.source_id,
        reportType: input.report_type,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.send_hour !== undefined ? { sendHour: input.send_hour } : {}),
        ...(input.week_starts_on !== undefined
          ? { weekStartsOn: input.week_starts_on }
          : {}),
        ...(recipients ? { recipients } : {})
      },
      ctx.commandId
    );
    if (!response.ok)
      return fail(
        response.outcome.code ?? 'REPORT_SCHEDULE_FAILED',
        response.outcome.message
      );
    return { ok: true, data: { saved: true } };
  }
};

interface SendInput {
  source_kind: 'Programme' | 'Form';
  source_id: string;
  report_type: 'Daily' | 'Weekly';
  to?: string;
}

export const reportSendTool: MutationTool<SendInput> = {
  name: 'report_send',
  summary: 'Propose building and queueing a report for a finished period',
  description:
    'Build a report for a period that has finished and queue it to the schedule\'s recipients, through the same path the automatic send uses. Use for "send today\'s report now". A period that has already been reported is not sent a second time - it says so instead. Queueing is not delivery: the report only leaves if sending is switched on for this server and every recipient is allow-listed.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    source_kind: SOURCE,
    source_id: uuid,
    report_type: TYPE,
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('The last day of the period. Defaults to yesterday, UK time.')
  }),
  authorization: {
    permissions: ['programme.report'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    const current = await getReportSubscriptions(
      input.source_kind,
      input.source_id
    );
    if (!current)
      return fail(
        'REPORT_SOURCE_NOT_FOUND',
        'That programme or form could not be read.'
      );
    const existing = current.subscriptions.find(
      (s) => s.reportType === input.report_type
    );
    if (!existing)
      return fail(
        'REPORT_NOT_CONFIGURED',
        `There is no ${input.report_type.toLowerCase()} report set up for this, so there are no recipients to send it to. Set the schedule up first.`
      );
    if (existing.recipients.length === 0)
      return fail(
        'REPORT_NO_RECIPIENTS',
        'That report has nobody on its recipient list, so there is nothing to send it to.'
      );

    const preview: ActionPreview = {
      title: 'Send a report now',
      summary: `Build the ${input.report_type.toLowerCase()} report${input.to ? ` for the period ending ${input.to}` : ' for the last finished period'} and queue it to ${existing.recipients.length} ${existing.recipients.length === 1 ? 'recipient' : 'recipients'}.`,
      changes: [
        { label: 'Report', to: `${input.report_type} report` },
        {
          label: 'Recipients',
          to: existing.recipients.map((r) => r.name ?? r.email).join(', ')
        },
        ...(input.to ? [{ label: 'Period ends', to: input.to }] : [])
      ],
      warnings: [
        'If this period has already been reported, nothing is sent again.',
        'Queueing is not delivery: the email gates still decide.'
      ],
      confirmLabel: 'Build and queue it',
      // Building a report reads; there is no row whose version could go stale.
      expectedVersion: null
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const response = await sendReportAction(
      {
        sourceKind: input.source_kind,
        sourceId: input.source_id,
        reportType: input.report_type,
        ...(input.to ? { to: input.to } : {})
      },
      ctx.commandId
    );
    if (!response.ok)
      return fail(
        response.outcome.code ?? 'REPORT_SEND_FAILED',
        response.outcome.message
      );
    const result = response.result as {
      status?: string;
      already_reported?: boolean;
    };
    return {
      ok: true,
      data: {
        already_reported: result.already_reported ?? false,
        status: result.status ?? 'Built',
        note: result.already_reported
          ? 'That period had already been reported, so nothing was sent again.'
          : 'The report was built and queued. Whether it leaves depends on the email gates.'
      }
    };
  }
};

// -- Changing who receives a report ---------------------------------------------

interface RecipientChangeInput {
  source_kind: 'Programme' | 'Form';
  source_id: string;
  report_type: 'Daily' | 'Weekly';
  add?: string[];
  remove?: string[];
}

/**
 * Adding and removing named recipients, rather than restating the whole list.
 *
 * "Add Hannah to the weekly report" and "remove Ben" are how people actually
 * talk about this, and making the model reconstruct the full list from a
 * previous read is how somebody quietly gets dropped.
 */
export const reportRecipientsTool: MutationTool<RecipientChangeInput> = {
  name: 'report_recipients_change',
  summary: 'Propose adding or removing recipients of a report',
  description:
    'Add people to, or remove people from, an existing report\'s recipients, leaving everybody else in place. Use for "add Hannah to the weekly report", "remove Ben", or "send it to the office as well". Names are resolved through People and a group like "the office" expands to the people in it now; an unknown or ambiguous name is a question, never a guess. Nothing is sent by this.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    source_kind: SOURCE,
    source_id: uuid,
    report_type: TYPE,
    add: z
      .array(z.string().trim().min(1).max(320))
      .max(50)
      .optional()
      .describe('People, groups or addresses to add'),
    remove: z
      .array(z.string().trim().min(1).max(320))
      .max(50)
      .optional()
      .describe('People or addresses to remove, by name or address')
  }),
  authorization: {
    permissions: ['programme.manage'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    if (!input.add?.length && !input.remove?.length)
      return fail(
        'REPORT_NO_RECIPIENT_CHANGE',
        'Say who should be added or removed.'
      );

    const current = await getReportSubscriptions(
      input.source_kind,
      input.source_id
    );
    if (!current)
      return fail('REPORT_SOURCE_NOT_FOUND', 'That could not be read.');
    const existing = current.subscriptions.find(
      (s) => s.reportType === input.report_type
    );
    if (!existing)
      return fail(
        'REPORT_NOT_CONFIGURED',
        `There is no ${input.report_type.toLowerCase()} report set up for this yet, so there is no recipient list to change.`
      );

    let recipients = [...existing.recipients];
    let expanded: { phrase: string; people: string[] }[] = [];
    const added: string[] = [];
    const removed: string[] = [];

    if (input.add?.length) {
      const resolved = await resolveRecipients(input.add);
      if (!resolved.ok)
        return fail('REPORT_RECIPIENT_UNRESOLVED', resolved.problem);
      expanded = resolved.expandedGroups;
      for (const person of resolved.recipients) {
        if (recipients.some((r) => r.email === person.email)) continue;
        recipients.push({ name: person.name, email: person.email });
        added.push(person.name ?? person.email);
      }
    }

    if (input.remove?.length) {
      for (const raw of input.remove) {
        const value = raw.trim().toLowerCase();
        const match = recipients.filter(
          (r) =>
            r.email === value || (r.name ?? '').toLowerCase().includes(value)
        );
        if (match.length === 0)
          return fail(
            'REPORT_RECIPIENT_NOT_ON_LIST',
            `"${raw.trim()}" is not on the ${input.report_type.toLowerCase()} report's recipient list. It currently goes to ${recipients.map((r) => r.name ?? r.email).join(', ') || 'nobody'}.`
          );
        if (match.length > 1)
          return fail(
            'REPORT_RECIPIENT_AMBIGUOUS',
            `"${raw.trim()}" matches ${match.length} recipients (${match.map((r) => r.name ?? r.email).join(', ')}). Ask which one they mean.`
          );
        recipients = recipients.filter((r) => r.email !== match[0].email);
        removed.push(match[0].name ?? match[0].email);
      }
    }

    const preview: ActionPreview = {
      title: 'Change who gets a report',
      summary:
        [
          added.length ? `Add ${added.join(', ')}` : null,
          removed.length ? `Remove ${removed.join(', ')}` : null
        ]
          .filter(Boolean)
          .join('. ') +
        `. The ${input.report_type.toLowerCase()} report will then go to ${recipients.length} ${recipients.length === 1 ? 'person' : 'people'}.`,
      changes: [
        ...(added.length ? [{ label: 'Adding', to: added.join(', ') }] : []),
        ...(removed.length
          ? [{ label: 'Removing', to: removed.join(', ') }]
          : []),
        {
          label: 'Will go to',
          from:
            existing.recipients.map((r) => r.name ?? r.email).join(', ') ||
            'nobody',
          to: recipients.map((r) => r.name ?? r.email).join(', ') || 'nobody'
        },
        ...expanded.map((group) => ({
          label: `"${group.phrase}" is`,
          to: group.people.join(', ')
        }))
      ],
      warnings: [
        ...(recipients.length === 0 && existing.enabled
          ? ['Nobody would be left, so nothing would be sent.']
          : []),
        ...(expanded.length
          ? [
              'A group was expanded to the people in it now. Somebody added to that group later will NOT start receiving this report.'
            ]
          : [])
      ],
      confirmLabel: 'Save the recipients',
      expectedVersion: existing.version
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    // Recomputed on the way out: the list could have changed between the
    // proposal and the confirmation, and the command takes a whole list.
    const current = await getReportSubscriptions(
      input.source_kind,
      input.source_id
    );
    const existing = current?.subscriptions.find(
      (s) => s.reportType === input.report_type
    );
    if (!existing)
      return fail('REPORT_NOT_CONFIGURED', 'That report is no longer set up.');

    let recipients = [...existing.recipients];
    if (input.add?.length) {
      const resolved = await resolveRecipients(input.add);
      if (!resolved.ok)
        return fail('REPORT_RECIPIENT_UNRESOLVED', resolved.problem);
      for (const person of resolved.recipients)
        if (!recipients.some((r) => r.email === person.email))
          recipients.push({ name: person.name, email: person.email });
    }
    for (const raw of input.remove ?? []) {
      const value = raw.trim().toLowerCase();
      recipients = recipients.filter(
        (r) =>
          !(r.email === value || (r.name ?? '').toLowerCase().includes(value))
      );
    }

    const response = await setReportSubscriptionAction(
      {
        sourceKind: input.source_kind,
        sourceId: input.source_id,
        reportType: input.report_type,
        recipients
      },
      ctx.commandId
    );
    if (!response.ok)
      return fail(
        response.outcome.code ?? 'REPORT_SCHEDULE_FAILED',
        response.outcome.message
      );
    return { ok: true, data: { recipients: recipients.length } };
  }
};

interface DeleteInput {
  source_kind: 'Programme' | 'Form';
  source_id: string;
  report_type: 'Daily' | 'Weekly';
}

export const reportDeleteTool: MutationTool<DeleteInput> = {
  name: 'report_schedule_delete',
  summary: 'Propose removing an automated report',
  description:
    'Delete an automated report so it stops being sent. The reports already made stay in the history - what was reported and to whom is a record of something that happened. Use for "delete this schedule" or "stop sending the daily report entirely". To stop it temporarily, pause it instead.',
  domain: DOMAIN,
  kind: 'mutation',
  status: 'available',
  inputSchema: z.strictObject({
    source_kind: SOURCE,
    source_id: uuid,
    report_type: TYPE
  }),
  authorization: {
    permissions: ['programme.manage'],
    enforcedBy: ENFORCED
  },

  async prepare(input) {
    const current = await getReportSubscriptions(
      input.source_kind,
      input.source_id
    );
    if (!current)
      return fail('REPORT_SOURCE_NOT_FOUND', 'That could not be read.');
    const existing = current.subscriptions.find(
      (s) => s.reportType === input.report_type
    );
    if (!existing)
      return fail(
        'REPORT_NOT_CONFIGURED',
        `There is no ${input.report_type.toLowerCase()} report set up for this, so there is nothing to delete.`
      );

    const preview: ActionPreview = {
      title: 'Delete an automated report',
      summary: `Stop sending the ${input.report_type.toLowerCase()} report. It currently goes to ${existing.recipients.length} ${existing.recipients.length === 1 ? 'person' : 'people'}.`,
      changes: [
        { label: 'Report', to: `${input.report_type} report` },
        {
          label: 'Currently goes to',
          to:
            existing.recipients.map((r) => r.name ?? r.email).join(', ') ||
            'nobody'
        },
        { label: 'Currently', to: existing.enabled ? 'switched on' : 'paused' }
      ],
      warnings: [
        'The reports already made stay in the history.',
        ...(existing.enabled
          ? ['This is switched on, so it would stop sending.']
          : [])
      ],
      confirmLabel: 'Delete it',
      expectedVersion: existing.version
    };
    return { ok: true, preview };
  },

  async execute(input, ctx: MutationContext) {
    const response = await deleteReportSubscriptionAction(
      {
        sourceKind: input.source_kind,
        sourceId: input.source_id,
        reportType: input.report_type
      },
      ctx.commandId
    );
    if (!response.ok)
      return fail(
        response.outcome.code ?? 'REPORT_DELETE_FAILED',
        response.outcome.message
      );
    return { ok: true, data: { deleted: true } };
  }
};

export const REPORT_READ_TOOLS = [reportScheduleTool, reportPreviewTool];
export const REPORT_MUTATION_TOOLS = [
  reportScheduleSetTool,
  reportRecipientsTool,
  reportDeleteTool,
  reportSendTool
];
