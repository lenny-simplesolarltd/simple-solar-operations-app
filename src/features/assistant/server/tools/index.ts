import 'server-only';

import { formsEnabled } from '@/features/forms/server/service';
import { ToolRegistry, type PlannedTool } from '../registry';
import { BULK_TASK_MUTATION_TOOLS, BULK_TASK_READ_TOOLS } from './bulk-tasks';
import { CUSTOMER_MUTATION_TOOLS, CUSTOMER_READ_TOOLS } from './customers';
import { FILE_MANAGEMENT_TOOLS } from './file-management';
import { FILE_TOOLS } from './files';
import { FORMS_MUTATION_TOOLS, FORMS_READ_TOOLS } from './forms';
import { HELP_TOOLS } from './help';
import { JOB_OPERATION_TOOLS } from './job-operations';
import { findJobTool, getJobTasksTool, getJobTool } from './jobs';
import {
  getJobBlockersTool,
  getJobTimelineTool,
  listJobOperationsTool
} from './operations';
import { PLANNED_TOOLS } from './planned';
import { PRESALE_MUTATION_TOOLS } from './presale-create';
import {
  PRESALE_REVISION_MUTATION_TOOLS,
  PRESALE_REVISION_READ_TOOLS
} from './presale-revise';
import { getPresaleWorkflowTool } from './presale';
import { getMyTasksTool, getTeamTasksTool } from './tasks';

/**
 * The production registry. A tool belongs here as `available` only when the
 * application already exposes the operation safely; everything else is
 * registered as planned.
 */
export function createToolRegistry(
  options: { forms: boolean } = { forms: true }
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
    .register(getPresaleWorkflowTool);
  // Bulk task work: the same batch command the Tasks screen submits, so the
  // permissions, the requirement policy, the idempotency and the processing
  // centre are shared rather than re-implemented for the assistant.
  for (const tool of [...BULK_TASK_READ_TOOLS, ...BULK_TASK_MUTATION_TOOLS])
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
  for (const tool of PLANNED_TOOLS) registry.register(tool);
  return registry;
}

/** The registry for one request: Forms tools only while Forms is switched on. */
export async function createRequestToolRegistry(): Promise<ToolRegistry> {
  return createToolRegistry({ forms: await formsEnabled() });
}
