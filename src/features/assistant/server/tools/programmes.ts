import 'server-only';

import {
  DISPOSITION_HINT,
  DISPOSITION_LABEL,
  OUTCOME_LABEL,
  PORTAL_LABEL,
  SIGNAL_LABEL,
  reviewReason
} from '@/features/programmes/labels';
import {
  currentAccess,
  getDailyReport,
  getDashboard,
  getProgramme,
  getProperty,
  getVisit,
  listProgrammes,
  listVisits,
  searchPropertyPage,
  visitEvidence
} from '@/features/programmes/server/queries';
import {
  DISPOSITIONS,
  PORTAL_VERIFICATIONS,
  REVIEW_STATUSES,
  VISIT_OUTCOMES,
  type ProgrammeVisit
} from '@/features/programmes/types';
import { z } from 'zod';
import type {
  ProgrammeCandidate,
  ProgrammeVisitCardData
} from '../../protocol';
import type { ReadTool, ToolResult } from '../registry';

/**
 * Programme reads for the assistant.
 *
 * Every one of these is an adapter over the SAME query the Programmes screens
 * use. That is the point: the assistant must not be able to answer "how many
 * are outstanding?" with a number the Overview would disagree with, so nothing
 * here counts, filters or classifies anything itself. Aggregates come from
 * PROGRAMME_DASHBOARD and PROGRAMME_DAILY_REPORT - the reads behind the Overview
 * and the Daily report - and row queries come from the same RLS-bound selects
 * the list and board use.
 *
 * Authorisation is the signed-in person's, resolved on the server. The
 * programme id the model supplies is DATA, not authority: RLS and the read
 * handlers decide what comes back, and a programme this person cannot see
 * returns nothing whatever the model asks for.
 *
 * Nothing here returns a storage URL. Evidence is named by its canonical id so
 * it is fetched through the authenticated evidence route, where
 * app.can_read_evidence still applies.
 */

const RLS =
  'RLS on programme_properties/programme_visits plus programme.* permissions; ' +
  'aggregates go through public.execute_operations_read, which re-checks programme.report';

/** Bounded on purpose: the model must never be handed a programme to count. */
const PAGE = { DEFAULT: 20, MAX: 50 } as const;

/**
 * How many rows a card lists. Smaller than a page on purpose: a card is read on
 * a phone, and a list long enough to scroll past the answer is not a result.
 * The TRUE total still comes from the query, so what the card says it is
 * showing and what it says exists are both honest.
 */
const CARD_ROWS = 8;

/** The card's view of a property: identifiers staff quote, never the row id. */
function propertyCandidate(p: {
  id: string;
  externalRef: string;
  addressLine1: string;
  addressLine2?: string | null;
  town: string | null;
  postcode: string | null;
}): ProgrammeCandidate {
  return {
    id: p.id,
    reference: p.externalRef,
    address: [p.addressLine1, p.addressLine2, p.town]
      .filter(Boolean)
      .join(', '),
    postcode: p.postcode
  };
}

/** The card's view of a visit. Built from the same row the model was given. */
export function visitCard(v: ProgrammeVisit): ProgrammeVisitCardData {
  return {
    id: v.id,
    reference: v.property.externalRef,
    address: [v.property.addressLine1, v.property.town]
      .filter(Boolean)
      .join(', '),
    postcode: v.property.postcode,
    installer: v.installerName,
    visitDate: v.visitDate,
    submittedAt: v.submittedAt,
    outcome: v.outcome ? OUTCOME_LABEL[v.outcome] : null,
    disposition: DISPOSITION_LABEL[v.disposition],
    portalVerification: v.portalVerification
      ? PORTAL_LABEL[v.portalVerification]
      : null,
    csq: v.csq,
    csqBand: v.signalClassification
      ? SIGNAL_LABEL[v.signalClassification]
      : null,
    serialMismatch: v.meterSerialMatches === false
  };
}

const programmeIdInput = z
  .uuid()
  .describe('Programme id (UUID) from programme_list');

const refused = (code: string, message: string): ToolResult => ({
  ok: false,
  code,
  message
});

const NO_ACCESS = () =>
  refused(
    'PROGRAMME_ACCESS_DENIED',
    'This staff member does not have access to operational programmes.'
  );

/** The identifiers staff actually use, never the row id alone. */
function visitForModel(v: ProgrammeVisit) {
  return {
    visit_id: v.id,
    property_reference: v.property.externalRef,
    address: [v.property.addressLine1, v.property.town]
      .filter(Boolean)
      .join(', '),
    postcode: v.property.postcode,
    installer: v.installerName,
    visit_date: v.visitDate,
    submitted_at: v.submittedAt,
    outcome: v.outcome ? OUTCOME_LABEL[v.outcome] : null,
    status: DISPOSITION_LABEL[v.disposition],
    review_status: v.reviewStatus,
    portal_verification: v.portalVerification
      ? PORTAL_LABEL[v.portalVerification]
      : null,
    csq: v.csq,
    csq_band: v.signalClassification
      ? SIGNAL_LABEL[v.signalClassification]
      : null,
    // Baseline beside observation, so "compare what PCH gave us with what the
    // installer found" is answerable from one row without a second lookup.
    expected_meter_serial: v.property.expectedMeterSerial,
    existing_sim_type: v.property.existingSimType,
    existing_sim_serial: v.property.existingSimSerial,
    actual_meter_serial: v.actualMeterSerial,
    new_sim_serial: v.newSimSerial,
    meter_serial_matches: v.meterSerialMatches,
    // Stated as its own field because it is the single most common reason a
    // visit needs a human: the meter on site was not the one expected.
    serial_mismatch: v.meterSerialMatches === false
  };
}

export const listProgrammesTool: ReadTool<Record<string, never>> = {
  name: 'programme_list',
  summary: 'List the operational programmes this staff member can see',
  description:
    'List operational programmes (for example a meter/SIM replacement programme) the signed-in staff member can see, with code, client, status and id. Call this first to turn a programme name the person mentions into a programme id for the other programme tools.',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({}),
  // programme.read, not "any signed-in person": a Surveyor holds no programme
  // permission, and offering them a programme tool advertises a module they
  // would then be refused by. The execute() guard below is the real check.
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute() {
    const session = await currentAccess();
    if (!session || !session.access.read) return NO_ACCESS();
    const programmes = await listProgrammes();
    return {
      ok: true,
      data: {
        programmes: programmes.map((p) => ({
          programme_id: p.id,
          code: p.code,
          name: p.name,
          client: p.clientName,
          status: p.status,
          // Development fixtures are real rows in a real table; saying so stops
          // the assistant reporting test data as the client's position.
          test_data: p.synthetic
        })),
        capabilities: session.access
      }
    };
  }
};

export const programmeSummaryTool: ReadTool<{ programmeId: string }> = {
  name: 'programme_summary',
  summary:
    'Programme position: target, progress, outstanding work and CSQ bands',
  description:
    'The live position of one programme: properties imported, the delivery target, attended, completed and live, remaining, visits today, run rate, and the counts that need office attention (awaiting review, action required, meter replacements, no access, portal checks outstanding, serial mismatches, CSQ bands). These are the same figures the programme Overview shows. Use it for "how are we doing", "are we on track", "how many are outstanding", "what needs attention".',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ programmeId: programmeIdInput }),
  authorization: {
    permissions: ['programme.report'],
    enforcedBy: RLS
  },
  async execute({ programmeId }) {
    const session = await currentAccess();
    if (!session || !session.access.report) return NO_ACCESS();
    const data = await getDashboard(programmeId);
    if (!data)
      return refused(
        'PROGRAMME_NOT_FOUND',
        'That programme could not be found, or this staff member cannot report on it.'
      );

    const target = data.target_property_count;
    const days = data.by_day.length;
    const perDay = days > 0 ? data.visits_total / days : null;

    return {
      ok: true,
      data: {
        programme: {
          code: data.programme.code,
          name: data.programme.name,
          client: data.programme.client_name,
          status: data.programme.status,
          test_data: data.programme.synthetic
        },
        delivery: {
          programme_target: target,
          properties_imported: data.total_properties,
          awaiting_import:
            target === null
              ? null
              : Math.max(target - data.total_properties, 0),
          attended: data.attended,
          completed_and_live: data.completed_properties,
          remaining_of_imported: data.remaining,
          remaining_against_target:
            target === null
              ? null
              : Math.max(target - data.completed_properties, 0),
          delivery_window:
            data.delivery_start_date || data.delivery_end_date
              ? { from: data.delivery_start_date, to: data.delivery_end_date }
              : null,
          // Said plainly rather than left for the model to guess at: with no
          // agreed end date there is no required daily rate to quote.
          note:
            data.delivery_end_date === null
              ? 'No delivery window has been agreed, so no required daily rate can be given.'
              : undefined
        },
        activity: {
          visits_total: data.visits_total,
          visits_today: data.visits_today,
          days_worked: days,
          visits_per_working_day:
            perDay === null ? null : Number(perDay.toFixed(1)),
          sims_changed: data.sims_changed
        },
        needs_attention: {
          awaiting_review: data.awaiting_review,
          action_required: data.action_required,
          meter_replacements_required: data.meter_replacements_required,
          no_access_rebook: data.no_access_rebook,
          portal_checks_outstanding: data.portal_outstanding,
          serial_mismatches: data.serial_mismatches
        },
        outcomes: {
          complete_and_working: data.complete_and_working,
          no_access: data.no_access,
          meter_dead: data.meter_dead,
          portal_confirmed_live: data.portal_confirmed_live,
          portal_not_live: data.portal_not_live,
          portal_unable_to_verify: data.portal_unable_to_verify
        },
        csq_bands: data.csq_bands,
        by_installer: data.by_installer.slice(0, 20)
      },
      display: {
        kind: 'programme_summary',
        programme: {
          code: data.programme.code,
          name: data.programme.name,
          client: data.programme.client_name,
          status: data.programme.status,
          testData: data.programme.synthetic,
          attended: data.attended,
          remaining: data.remaining,
          completedAndLive: data.completed_properties,
          target,
          // Null rather than 0 where no day has been worked: a rate nobody has
          // earned yet is not a rate of zero.
          runRate: perDay === null ? null : Number(perDay.toFixed(1))
        }
      }
    };
  }
};

export const propertySearchTool: ReadTool<{
  programmeId: string;
  query?: string;
  outstandingOnly?: boolean;
  limit?: number;
  offset?: number;
}> = {
  name: 'programme_property_search',
  summary:
    'Search programme properties by address, postcode, reference or serial',
  description:
    "Search a programme's properties by address, postcode or postcode area, the client's property reference, or the expected meter serial. Set outstandingOnly to list only properties with no submitted visit yet. Returns a page of matches and the TRUE total, so the total can be quoted directly - never add the returned rows up. Use it to turn an address the person mentions into a property id.",
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    programmeId: programmeIdInput,
    query: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe(
        'Address, postcode, postcode area, property reference or meter serial'
      ),
    outstandingOnly: z
      .boolean()
      .optional()
      .describe('Only properties with no submitted visit yet'),
    limit: z.number().int().min(1).max(PAGE.MAX).optional(),
    offset: z.number().int().min(0).optional()
  }),
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute({ programmeId, query, outstandingOnly, limit, offset }) {
    const session = await currentAccess();
    if (!session || !session.access.read) return NO_ACCESS();
    const page = await searchPropertyPage(programmeId, {
      query,
      only: outstandingOnly ? 'outstanding' : 'all',
      limit: limit ?? PAGE.DEFAULT,
      offset: offset ?? 0
    });
    return {
      ok: true,
      data: {
        total_matches: page.total,
        showing: {
          from: page.total === 0 ? 0 : page.offset + 1,
          to: page.offset + page.properties.length
        },
        properties: page.properties.map((p) => ({
          property_id: p.id,
          property_reference: p.externalRef,
          address: [p.addressLine1, p.addressLine2, p.town]
            .filter(Boolean)
            .join(', '),
          postcode: p.postcode,
          expected_meter_serial: p.expectedMeterSerial,
          existing_sim_type: p.existingSimType,
          existing_sim_serial: p.existingSimSerial
        })),
        note:
          page.total > page.properties.length
            ? `Showing ${page.properties.length} of ${page.total}. Ask for a narrower search, or request the next page with offset.`
            : undefined
      },
      display: {
        kind: 'programme_candidates',
        target: 'property',
        title: query ? `Properties matching “${query}”` : 'Properties',
        // The query's own total, not the number of rows listed: "King Street"
        // matching 40 properties has to read as 40, whatever a card can show.
        total: page.total,
        candidates: page.properties.slice(0, CARD_ROWS).map(propertyCandidate)
      }
    };
  }
};

export const propertyDetailTool: ReadTool<{ propertyId: string }> = {
  name: 'programme_property_get',
  summary: 'One property and every visit recorded against it',
  description:
    'Full detail for one programme property, with every visit recorded against it in order. Use it for "what happened at 24 King Street" once programme_property_search has identified the property.',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    propertyId: z.uuid().describe('Property id from programme_property_search')
  }),
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute({ propertyId }) {
    const session = await currentAccess();
    if (!session || !session.access.read) return NO_ACCESS();
    const property = await getProperty(propertyId);
    if (!property)
      return refused(
        'PROGRAMME_PROPERTY_NOT_FOUND',
        'That property could not be found, or this staff member cannot see it.'
      );
    const page = await listVisits(property.programmeId, {
      limit: PAGE.MAX
    });
    const visits = page.visits.filter((v) => v.propertyId === propertyId);
    return {
      ok: true,
      data: {
        property: {
          property_id: property.id,
          programme_id: property.programmeId,
          property_reference: property.externalRef,
          address: [property.addressLine1, property.addressLine2, property.town]
            .filter(Boolean)
            .join(', '),
          postcode: property.postcode,
          // The CLIENT's baseline for this property. What the installer found
          // is on the visits below; the two are never merged.
          expected_meter_serial: property.expectedMeterSerial,
          existing_sim_type: property.existingSimType,
          existing_sim_serial: property.existingSimSerial,
          notes: property.notes
        },
        visits: visits.map(visitForModel),
        visited: visits.length > 0
      },
      display: {
        kind: 'programme_property',
        property: {
          id: property.id,
          reference: property.externalRef,
          address: [property.addressLine1, property.addressLine2, property.town]
            .filter(Boolean)
            .join(', '),
          postcode: property.postcode,
          expectedMeterSerial: property.expectedMeterSerial,
          existingSimType: property.existingSimType,
          existingSimSerial: property.existingSimSerial,
          // listVisits returns newest first, so the first row is the state the
          // property is actually in. Null while nobody has been.
          state: visits[0] ? DISPOSITION_LABEL[visits[0].disposition] : null,
          visited: visits.length > 0
        }
      }
    };
  }
};

const visitFilters = z.strictObject({
  programmeId: programmeIdInput,
  query: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe(
      'Address, postcode, property reference, meter serial or SIM serial'
    ),
  from: z.iso.date().optional().describe('Earliest visit date, YYYY-MM-DD'),
  to: z.iso.date().optional().describe('Latest visit date, YYYY-MM-DD'),
  installerId: z.uuid().optional().describe('Installer person id'),
  outcome: z.enum(VISIT_OUTCOMES).optional(),
  disposition: z
    .enum(DISPOSITIONS)
    .optional()
    .describe(
      'Operational state: AwaitingReview, NoAccessRebook, ActionRequired, MeterRequiresChanging, CompleteAndWorking'
    ),
  reviewStatus: z.enum(REVIEW_STATUSES).optional(),
  portalVerification: z.enum(PORTAL_VERIFICATIONS).optional(),
  csqBand: z.enum(['Good', 'Advisory', 'Bad']).optional(),
  postcode: z
    .string()
    .trim()
    .min(1)
    .max(8)
    .optional()
    .describe('Postcode area, e.g. EX1'),
  serialMismatchOnly: z
    .boolean()
    .optional()
    .describe('Only visits where the meter on site was not the expected one'),
  limit: z.number().int().min(1).max(PAGE.MAX).optional(),
  offset: z.number().int().min(0).optional()
});

export const visitSearchTool: ReadTool<z.infer<typeof visitFilters>> = {
  name: 'programme_visit_search',
  summary:
    'Search programme visits by date, installer, outcome, state, CSQ or portal result',
  description:
    'Search the visits recorded in a programme. Filters compose: date range, installer, field outcome, operational state (disposition), review status, portal verification, CSQ band, postcode area, serial mismatch, and free text across address, property reference, meter serial and SIM serial. Returns a page and the TRUE total - quote the total, never count the returned rows. Use it for the review queue, the board columns, "what needs action", "today\'s no-access visits", "SIM changes not confirmed live".',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: visitFilters,
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute(input) {
    const session = await currentAccess();
    if (!session || !session.access.read) return NO_ACCESS();
    const page = await listVisits(input.programmeId, {
      query: input.query,
      from: input.from,
      to: input.to,
      installer_id: input.installerId,
      outcome: input.outcome,
      disposition: input.disposition,
      review_status: input.reviewStatus,
      portal_verification: input.portalVerification,
      signal_classification: input.csqBand,
      postcode: input.postcode,
      limit: input.limit ?? PAGE.DEFAULT,
      offset: input.offset ?? 0
    });
    // The serial mismatch flag is derived by the server on submission; there is
    // no column filter for it, so it narrows the page rather than the query.
    // Said out loud, because a narrowed page means the total describes the
    // filters BEFORE it.
    const rows = input.serialMismatchOnly
      ? page.visits.filter((v) => v.meterSerialMatches === false)
      : page.visits;

    return {
      ok: true,
      data: {
        total_matches: page.total,
        showing: {
          from: page.total === 0 ? 0 : page.offset + 1,
          to: page.offset + rows.length
        },
        visits: rows.map(visitForModel),
        note: input.serialMismatchOnly
          ? 'total_matches counts every visit matching the other filters; the listed rows are the serial mismatches within this page.'
          : page.total > rows.length
            ? `Showing ${rows.length} of ${page.total}. Narrow the filters or request the next page with offset.`
            : undefined
      },
      display: {
        kind: 'programme_candidates',
        target: 'visit',
        title: input.query ? `Visits matching “${input.query}”` : 'Visits',
        total: page.total,
        candidates: rows.slice(0, CARD_ROWS).map((v) => ({
          id: v.id,
          reference: v.property.externalRef,
          address: [v.property.addressLine1, v.property.town]
            .filter(Boolean)
            .join(', '),
          postcode: v.property.postcode,
          // Two visits to the same property are told apart by who went, when.
          detail:
            [v.installerName, v.visitDate].filter(Boolean).join(' · ') ||
            undefined
        }))
      }
    };
  }
};

export const visitDetailTool: ReadTool<{ visitId: string }> = {
  name: 'programme_visit_get',
  summary: 'Everything recorded for one visit, including the office review',
  description:
    'One visit in full: property, installer, when it was submitted, the field outcome, meter serial recorded against the serial expected, meter reading, new SIM serial, CSQ and band, portal verification, the installer\'s comments, why it needs review, the office decision and any action note, and what evidence is attached. Use it for "what happened there", "what was the meter reading", "who visited".',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    visitId: z.uuid().describe('Visit id from programme_visit_search')
  }),
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute({ visitId }) {
    const session = await currentAccess();
    if (!session || !session.access.read) return NO_ACCESS();
    const visit = await getVisit(visitId);
    if (!visit)
      return refused(
        'PROGRAMME_VISIT_NOT_FOUND',
        'That visit could not be found, or this staff member cannot see it.'
      );
    const evidence = await visitEvidence(visitId);
    return {
      ok: true,
      data: {
        ...visitForModel(visit),
        expected_meter_serial: visit.property.expectedMeterSerial,
        actual_meter_serial: visit.actualMeterSerial,
        meter_reading: visit.meterReading,
        new_sim_serial: visit.newSimSerial,
        installer_comments: visit.installerComments,
        portal_check_required: visit.portalCheckRequired,
        review_reasons: visit.reviewReasons.map(reviewReason),
        recommended_state: visit.recommendedDisposition
          ? DISPOSITION_LABEL[visit.recommendedDisposition]
          : null,
        state_meaning: DISPOSITION_HINT[visit.disposition],
        office_review: {
          reviewed_by: visit.reviewedByName,
          reviewed_at: visit.reviewedAt,
          action_note: visit.actionNote
        },
        evidence: evidence.map((e) => ({
          evidence_id: e.id,
          category: e.category,
          filename: e.filename
        })),
        // The version the review command will expect. Handing it to the model
        // as data keeps the optimistic concurrency check honest: a visit
        // changed by somebody else since this read is refused, not overwritten.
        version: visit.version,
        // Said explicitly so the assistant never completes a visit on a good
        // signal alone.
        completion_rule:
          'A visit can only be Complete & working once the office has confirmed in the PCH portal that the meter is live. A good CSQ is not portal confirmation.'
      },
      display: { kind: 'programme_visit', visit: visitCard(visit) }
    };
  }
};

export const visitEvidenceTool: ReadTool<{ visitId: string }> = {
  name: 'programme_visit_evidence',
  summary: 'The photographs and files attached to a visit',
  description:
    'List the evidence attached to a visit - calling card, meter, SIM and CSQ photographs and anything else the form collected - with the canonical evidence id and category for each. Returns identifiers only; the files themselves are fetched through the authenticated evidence route, which re-checks that this staff member may read them.',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    visitId: z.uuid().describe('Visit id from programme_visit_search')
  }),
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute({ visitId }) {
    const session = await currentAccess();
    if (!session || !session.access.read) return NO_ACCESS();
    const evidence = await visitEvidence(visitId);
    return {
      ok: true,
      data: {
        visit_id: visitId,
        evidence: evidence.map((e) => ({
          evidence_id: e.id,
          category: e.category,
          filename: e.filename,
          mime_type: e.mimeType,
          size_bytes: e.sizeBytes
        })),
        // No storage URL is produced here on purpose: a signed link would be a
        // second, unaudited way to reach a file that app.can_read_evidence is
        // supposed to guard.
        note:
          evidence.length === 0
            ? 'No evidence is attached to this visit.'
            : 'Open evidence through the application; these ids are not links.'
      }
    };
  }
};

export const dailyReportTool: ReadTool<{ programmeId: string; date?: string }> =
  {
    name: 'programme_daily_report',
    summary:
      "A day's programme report: the summary and every property attended",
    description:
      'The client daily report for one date: properties attended, SIMs swapped, no access, meters requiring replacement, action required, confirmed live, not live, awaiting review, serial mismatches, and a line for every property attended. Defaults to today. These are the same figures the Daily report screen shows. Nothing is sent to anyone by calling this.',
    domain: 'programmes',
    kind: 'read',
    status: 'available',
    inputSchema: z.strictObject({
      programmeId: programmeIdInput,
      date: z.iso.date().optional().describe('YYYY-MM-DD; defaults to today')
    }),
    authorization: { permissions: ['programme.report'], enforcedBy: RLS },
    async execute({ programmeId, date }) {
      const session = await currentAccess();
      if (!session || !session.access.report) return NO_ACCESS();
      const report = await getDailyReport(programmeId, date);
      if (!report)
        return refused(
          'PROGRAMME_NOT_FOUND',
          'That programme could not be found, or this staff member cannot report on it.'
        );
      return {
        ok: true,
        data: {
          programme: report.programme.name,
          date: report.date,
          summary: {
            properties_attended: report.properties_attended,
            visits: report.visits,
            sims_swapped: report.sims_swapped,
            no_access: report.no_access,
            meters_requiring_replacement: report.meters_requiring_replacement,
            action_required: report.action_required,
            complete_and_live: report.complete_and_live,
            awaiting_review: report.awaiting_review,
            awaiting_portal_confirmation: report.awaiting_portal_confirmation,
            portal_confirmed_live: report.portal_confirmed_live,
            portal_not_live: report.portal_not_live,
            portal_unable_to_verify: report.portal_unable_to_verify,
            serial_mismatches: report.serial_mismatches
          },
          // Bounded: a busy day is summarised above, and the lines are a sample
          // rather than a bulk transfer into the model's context.
          lines: report.lines.slice(0, PAGE.MAX).map((l) => ({
            property_reference: l.external_ref,
            address: l.address,
            postcode: l.postcode,
            installer: l.installer,
            outcome: OUTCOME_LABEL[l.outcome],
            actual_meter_serial: l.actual_meter_serial,
            expected_meter_serial: l.expected_meter_serial,
            serial_mismatch: l.meter_serial_matches === false,
            meter_reading: l.meter_reading,
            new_sim_serial: l.new_sim_serial,
            csq: l.csq,
            portal_verification: l.portal_verification
              ? PORTAL_LABEL[l.portal_verification]
              : null,
            status: DISPOSITION_LABEL[l.disposition]
          })),
          lines_shown: Math.min(report.lines.length, PAGE.MAX),
          lines_total: report.lines.length
        }
      };
    }
  };

export const programmeCapabilitiesTool: ReadTool<Record<string, never>> = {
  name: 'programme_capabilities',
  summary: 'What this staff member can do with programmes',
  description:
    'What the signed-in staff member is actually allowed to do in the Programmes module, as capabilities rather than role names. Use it to answer "what can you do with PCH?" so the answer matches this person rather than describing features they cannot use.',
  domain: 'programmes',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({}),
  authorization: { permissions: ['programme.read'], enforcedBy: RLS },
  async execute() {
    const session = await currentAccess();
    if (!session || !session.access.read)
      return {
        ok: true,
        data: {
          has_programme_access: false,
          // Not a refusal: "you have no access" is the honest answer to the
          // question, and the assistant should say it rather than listing
          // capabilities this person will then be refused.
          can: [],
          note: 'This staff member has no access to operational programmes.'
        }
      };
    const a = session.access;
    const can: string[] = [];
    if (a.read) can.push('find properties and see their visits');
    if (a.readAll)
      can.push('search every visit in the programme, and see the board');
    if (a.report)
      can.push(
        'report on progress against the target, and read the daily report'
      );
    if (a.review)
      can.push(
        'review submitted visits: confirm the portal result and set the operational state'
      );
    if (a.submit) can.push('record a visit against a property');
    if (a.manage)
      can.push('import the property list and administer the programme');
    return {
      ok: true,
      data: { has_programme_access: true, capabilities: a, can }
    };
  }
};

export const PROGRAMME_READ_TOOLS = [
  listProgrammesTool,
  programmeSummaryTool,
  propertySearchTool,
  propertyDetailTool,
  visitSearchTool,
  visitDetailTool,
  visitEvidenceTool,
  dailyReportTool,
  programmeCapabilitiesTool
] as const;
