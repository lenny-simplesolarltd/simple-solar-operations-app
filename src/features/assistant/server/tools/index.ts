import 'server-only';

import { formsEnabled } from '@/features/forms/server/service';
import { ToolRegistry, type PlannedTool } from '../registry';
import { FILE_TOOLS } from './files';
import { FORMS_MUTATION_TOOLS, FORMS_READ_TOOLS } from './forms';
import { HELP_TOOLS } from './help';
import { findJobTool, getJobTasksTool, getJobTool } from './jobs';
import { PLANNED_TOOLS } from './planned';
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
    .register(getMyTasksTool)
    .register(getTeamTasksTool)
    .register(getPresaleWorkflowTool);
  // Stored files: the same reads as the job Files tab and the Files library.
  for (const tool of FILE_TOOLS)
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
