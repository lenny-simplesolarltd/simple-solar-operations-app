import 'server-only';

import { ToolRegistry } from '../registry';
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
  for (const tool of PLANNED_TOOLS) registry.register(tool);
  return registry;
}
