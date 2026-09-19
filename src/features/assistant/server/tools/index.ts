import 'server-only';

import { ToolRegistry } from '../registry';
import { FORMS_MUTATION_TOOLS, FORMS_READ_TOOLS } from './forms';
import { findJobTool, getJobTasksTool, getJobTool } from './jobs';
import { PLANNED_TOOLS } from './planned';
import { getPresaleWorkflowTool } from './presale';
import { getMyTasksTool, getTeamTasksTool } from './tasks';

/**
 * The production registry. A tool belongs here as `available` only when the
 * application already exposes the operation safely; everything else is
 * registered as planned.
 */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry()
    .register(findJobTool)
    .register(getJobTool)
    .register(getJobTasksTool)
    .register(getMyTasksTool)
    .register(getTeamTasksTool)
    .register(getPresaleWorkflowTool);
  // Forms: the same service the manual builder uses. Mutations are proposals
  // a staff member confirms; see tools/forms.ts.
  for (const tool of [...FORMS_READ_TOOLS, ...FORMS_MUTATION_TOOLS]) {
    registry.register(tool as Parameters<ToolRegistry['register']>[0]);
  }
  for (const tool of PLANNED_TOOLS) registry.register(tool);
  return registry;
}
