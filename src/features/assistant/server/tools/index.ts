import 'server-only';

import { formsEnabled } from '@/features/forms/server/service';
import { programmesEnabled } from '@/features/programmes/server/queries';
import { ToolRegistry, type PlannedTool } from '../registry';
import { BULK_TASK_MUTATION_TOOLS, BULK_TASK_READ_TOOLS } from './bulk-tasks';
import { CUSTOMER_SEARCH_READ_TOOLS } from './customer-search';
import { CUSTOMER_MUTATION_TOOLS, CUSTOMER_READ_TOOLS } from './customers';
import { DOCUMENT_MUTATION_TOOLS, DOCUMENT_READ_TOOLS } from './documents';
import { FILE_MANAGEMENT_TOOLS } from './file-management';
import { FILE_TOOLS } from './files';
import { FORMS_MUTATION_TOOLS, FORMS_READ_TOOLS } from './forms';
import { HELP_TOOLS } from './help';
import { listPeopleTool } from './people';
import { messageColleagueTool } from './chat';
import { JOB_OPERATION_TOOLS } from './job-operations';
import { findJobTool, getJobTasksTool, getJobTool } from './jobs';
import {
  getJobBlockersTool,
  getJobTimelineTool,
  listJobOperationsTool
} from './operations';
import { PLANNED_TOOLS } from './planned';
import {
  PROGRAMME_IMPORT_MUTATION_TOOLS,
  PROGRAMME_IMPORT_READ_TOOLS
} from './programme-imports';
import { REPORT_MUTATION_TOOLS, REPORT_READ_TOOLS } from './reports';
import {
  PROGRAMME_OPERATION_MUTATION_TOOLS,
  PROGRAMME_OPERATION_READ_TOOLS
} from './programme-operations';
import { PROGRAMME_READ_TOOLS } from './programmes';
import { PRESALE_MUTATION_TOOLS } from './presale-create';
import {
  PRESALE_REVISION_MUTATION_TOOLS,
  PRESALE_REVISION_READ_TOOLS
} from './presale-revise';
import { getPresaleWorkflowTool } from './presale';
import { QUOTE_READ_TOOLS } from './quotes';
import { TASK_EVIDENCE_MUTATION_TOOLS } from './task-evidence';
import { getMyTasksTool, getTeamTasksTool } from './tasks';

/**
 * The production registry. A tool belongs here as `available` only when the
 * application already exposes the operation safely; everything else is
 * registered as planned.
 */
export function createToolRegistry(
  options: { forms: boolean; programmes?: boolean } = {
    forms: true,
    programmes: true
  }
): ToolRegistry {
  const registry = new ToolRegistry()
    .register(findJobTool)
    .register(getJobTool)
    .register(getJobTasksTool)
    .register(getJobTimelineTool)
    .register(getJobBlockersTool)
    // The whole operation surface for one job, straight from ACTION_AVAILABILITY:
    // what this person can do now, and the database's own reason for the rest.
    .register(listJobOperationsTool)
    .register(getMyTasksTool)
    .register(getTeamTasksTool)
    .register(getPresaleWorkflowTool)
    .register(listPeopleTool)
    .register(messageColleagueTool);
  // Bulk task work: the same batch command the Tasks screen submits, so the
  // permissions, the requirement policy, the idempotency and the processing
  // centre are shared rather than re-implemented for the assistant.
  for (const tool of [...BULK_TASK_READ_TOOLS, ...BULK_TASK_MUTATION_TOOLS])
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Finding a customer rather than a job: one person can hold several jobs,
  // and a caller is a person. No new read model - customers_select already
  // ties a customer's visibility to their jobs'. See tools/customer-search.ts.
  for (const tool of CUSTOMER_SEARCH_READ_TOOLS)
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Customer contact details and lead source: CUSTOMER_UPDATE / JOB_SALE_UPDATE,
  // the commands added in 20260920270000. Contact details and where the enquiry
  // came from only - never the customer's name or address, never the agreed
  // commercial terms. See tools/customers.ts.
  for (const tool of [...CUSTOMER_READ_TOOLS, ...CUSTOMER_MUTATION_TOOLS])
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Job operations the assistant can carry out: moving planned work and
  // raising an issue. Both are existing R1 commands; availability, stage rules
  // and the audit trail stay in the database. See tools/job-operations.ts.
  for (const tool of JOB_OPERATION_TOOLS)
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Revising a quote: PRESALE_REVISE writes a new immutable version rather
  // than editing one, and the tool can reach the agreed price and the notes
  // only - a design change needs recomputed totals the designer alone
  // produces. See tools/presale-revise.ts.
  for (const tool of [
    ...PRESALE_REVISION_READ_TOOLS,
    ...PRESALE_REVISION_MUTATION_TOOLS
  ])
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Reading a quote: what the customer is on now, and what changed between two
  // versions - both off the same PRESALE_VERSIONS model the presale screen
  // reads, so a figure SimpleBot quotes cannot disagree with the screen.
  for (const tool of QUOTE_READ_TOOLS)
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Generated documents: the quotation pack and the ROI report. Generating
  // QUEUES a new revision through DOCUMENT_GENERATE and never rewrites a
  // stored one. See tools/documents.ts.
  for (const tool of [...DOCUMENT_READ_TOOLS, ...DOCUMENT_MUTATION_TOOLS])
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Attaching a signed contract to PRE02. It cannot upload and takes no
  // storage path: it links a file a PERSON already stored on the job, so the
  // attestation stays with whoever chose the file. See tools/task-evidence.ts.
  for (const tool of TASK_EVIDENCE_MUTATION_TOOLS)
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Recording a sale: the same public.submit_presale the New presale wizard
  // submits. It captures no design, and says so on the card and afterwards.
  for (const tool of PRESALE_MUTATION_TOOLS)
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Stored files: the same reads as the job Files tab and the Files library,
  // and the same file-manager commands for filing them. Nothing that deletes a
  // document is offered to the model - see tools/file-management.ts.
  for (const tool of [...FILE_TOOLS, ...FILE_MANAGEMENT_TOOLS])
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Help Center: read-only, the same published guides staff read.
  for (const tool of HELP_TOOLS)
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  // Forms: the same service the manual builder uses. Mutations are proposals
  // a staff member confirms; see tools/forms.ts.
  // While Forms is switched off (release gate FN-21) its tools are only
  // planned: the model is told they are unavailable and none can execute.
  for (const tool of [...FORMS_READ_TOOLS, ...FORMS_MUTATION_TOOLS]) {
    registry.register(
      options.forms
        ? (tool as Parameters<ToolRegistry['register']>[0])
        : ({
            name: tool.name,
            summary: tool.summary,
            domain: tool.domain,
            kind: tool.kind,
            status: 'planned',
            dependsOn: 'Forms is switched off (release gate FN-21)'
          } satisfies PlannedTool)
    );
  }
  // Programmes: the same reads the programme screens use, so a number the
  // assistant quotes and a number the Overview shows cannot disagree. Gated on
  // FN-22 exactly as the screens are - while the module is switched off the
  // model is told the tools are unavailable and none can execute.
  for (const tool of [
    ...PROGRAMME_READ_TOOLS,
    // Imports: explaining and applying a property list that was staged on the
    // import screen. There is deliberately no tool that STAGES a file from
    // chat - see programme-imports.ts - because the model would be retyping
    // somebody's property list, which is exactly how invented rows get in.
    ...PROGRAMME_IMPORT_READ_TOOLS,
    ...PROGRAMME_IMPORT_MUTATION_TOOLS,
    ...REPORT_READ_TOOLS,
    ...REPORT_MUTATION_TOOLS,
    // Office review and the installer's own visit workflow. Both go through
    // the same commands the screens call - PROGRAMME_VISIT_REVIEW, and
    // START then SUBMIT - so "Complete & working" still needs the office's
    // portal confirmation whoever asks for it and however they phrase it.
    ...PROGRAMME_OPERATION_READ_TOOLS,
    ...PROGRAMME_OPERATION_MUTATION_TOOLS
  ]) {
    registry.register(
      options.programmes !== false
        ? (tool as Parameters<ToolRegistry['register']>[0])
        : ({
            name: tool.name,
            summary: tool.summary,
            domain: tool.domain,
            kind: tool.kind,
            status: 'planned',
            dependsOn: 'Programmes is switched off (release gate FN-22)'
          } satisfies PlannedTool)
    );
  }
  for (const tool of PLANNED_TOOLS) registry.register(tool);
  return registry;
}

/** The registry for one request: release-gated tools only while their module is on. */
export async function createRequestToolRegistry(): Promise<ToolRegistry> {
  const [forms, programmes] = await Promise.all([
    formsEnabled(),
    programmesEnabled()
  ]);
  return createToolRegistry({ forms, programmes });
}
