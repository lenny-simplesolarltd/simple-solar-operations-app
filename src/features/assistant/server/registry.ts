import 'server-only';

import type { AppUser } from '@/lib/auth';
import { z } from 'zod';
import type { DisplayCard, PendingActionView } from '../protocol';

/**
 * The assistant tool registry.
 *
 * A tool is a typed adapter over an operation the application ALREADY exposes
 * (a server query, a domain command). The registry is the only path from the
 * model to the application: the model can name a tool and supply arguments,
 * nothing else. It never sees SQL, a Supabase client, or an identity field.
 *
 * Tools do not re-implement business rules. Authorization here is a coarse
 * pre-check that gives the model an honest "not permitted" early; the real
 * enforcement stays where it already lives - RLS and the domain commands.
 */

export type ToolDomain =
  | 'customers'
  | 'jobs'
  | 'presales'
  | 'tasks'
  | 'quotes'
  | 'documents'
  | 'booking'
  | 'evidence'
  | 'materials'
  | 'scaffolding'
  | 'installation'
  | 'commissioning'
  | 'forms'
  | 'finance'
  | 'calendar'
  | 'reporting'
  | 'programmes'
  | 'help';

/** Who is asking. Resolved on the server from the session - never from the model or the browser. */
export interface ToolActor {
  user: AppUser;
  permissions: ReadonlySet<string>;
  /** Development "View as user" preview: read tools only; every mutation is unavailable. */
  previewing?: boolean;
}

export interface ToolContext {
  actor: ToolActor;
  threadId: string;
  signal?: AbortSignal;
}

/** Extra context a mutation receives when (and only when) a human has confirmed it. */
export interface MutationContext extends ToolContext {
  /**
   * The pending action's id. Mutation adapters MUST pass it to the domain
   * command as its command_id so the existing `commands` idempotency (same id
   * + same actor + same payload = same result, never a second execution)
   * covers the assistant too.
   */
  commandId: string;
  /** Row version captured when the action was proposed; pass it as expected_version where the command supports it. */
  expectedVersion: number | null;
  initiatedVia: 'assistant';
}

export type ToolResult =
  | {
      ok: true;
      /** What the model reads. Keep it minimal: no contact details unless the tool's purpose needs them. */
      data: unknown;
      /** What the drawer renders. */
      display?: DisplayCard;
    }
  | { ok: false; code: string; message: string };

export interface ToolAuthorization {
  /** Permission codes the actor must hold (all of them). Empty = any active staff member. */
  permissions: readonly string[];
  /**
   * Roles, ANY of which the actor must hold. Omitted = no role restriction.
   *
   * Some backend commands are gated by role rather than by a permission code -
   * app.is_office and friends - and there is no permission that stands in for
   * them. Naming the roles here keeps the coarse pre-check honest instead of
   * borrowing an unrelated permission as a proxy. It is still only a
   * pre-check: app.authorize_command re-decides it whatever this says.
   */
  roles?: readonly string[];
  /** Where the authoritative check lives, for reviewers. */
  enforcedBy: string;
}

interface ToolBase<I> {
  name: string;
  /** Written for the model: when to use it and what it returns. */
  description: string;
  /** One line for staff-facing capability lists. */
  summary: string;
  domain: ToolDomain;
  inputSchema: z.ZodType<I>;
  authorization: ToolAuthorization;
}

export interface ReadTool<I = unknown> extends ToolBase<I> {
  kind: 'read';
  status: 'available';
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}

export type ActionPreview = Omit<
  PendingActionView,
  'token' | 'actionId' | 'tool' | 'expiresAt'
> & {
  expectedVersion: number | null;
};

export interface MutationTool<I = unknown> extends ToolBase<I> {
  kind: 'mutation';
  status: 'available';
  /**
   * Validates the request against current data and describes what WOULD
   * change. Must not write anything.
   */
  prepare(
    input: I,
    ctx: ToolContext
  ): Promise<
    | { ok: true; preview: ActionPreview }
    | { ok: false; code: string; message: string }
  >;
  /** Runs the existing domain command. Only ever called by the confirmation endpoint. */
  execute(input: I, ctx: MutationContext): Promise<ToolResult>;
}

/** A capability the assistant is designed for but the backend does not expose yet. Never executable. */
export interface PlannedTool {
  name: string;
  summary: string;
  domain: ToolDomain;
  kind: 'read' | 'mutation';
  status: 'planned';
  /** The BACKEND DEPENDENCY that unblocks it. */
  dependsOn: string;
}

export type AvailableTool = ReadTool | MutationTool;
export type RegisteredTool = AvailableTool | PlannedTool;

const TOOL_NAME = /^[a-z][a-z0-9_]{2,63}$/;

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<I>(tool: ReadTool<I> | MutationTool<I> | PlannedTool): this {
    if (!TOOL_NAME.test(tool.name)) {
      throw new Error(`Invalid assistant tool name: ${tool.name}`);
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`Assistant tool registered twice: ${tool.name}`);
    }
    if (tool.status === 'available' && tool.kind === 'mutation') {
      if (
        typeof tool.prepare !== 'function' ||
        typeof tool.execute !== 'function'
      ) {
        throw new Error(
          `Mutation tool ${tool.name} must define prepare() and execute()`
        );
      }
    }
    this.tools.set(tool.name, tool as RegisteredTool);
    return this;
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  all(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  planned(): PlannedTool[] {
    return this.all().filter((t): t is PlannedTool => t.status === 'planned');
  }

  /** Tools this actor may be offered. Planned tools are never offered to the model. */
  availableFor(actor: ToolActor): AvailableTool[] {
    return this.all().filter(
      (t): t is AvailableTool =>
        t.status === 'available' &&
        isPermitted(t, actor) &&
        !(actor.previewing && t.kind === 'mutation')
    );
  }
}

export function isPermitted(tool: AvailableTool, actor: ToolActor): boolean {
  const { permissions, roles } = tool.authorization;
  if (!permissions.every((p) => actor.permissions.has(p))) return false;
  if (roles && roles.length > 0) {
    return roles.some((r) => actor.user.roles.includes(r as never));
  }
  return true;
}

/** JSON Schema for a tool's input, in the shape model providers expect. */
export function toolInputJsonSchema(
  tool: AvailableTool
): Record<string, unknown> {
  const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
}

export type ToolResolution =
  | { ok: true; tool: AvailableTool; input: unknown }
  | { ok: false; code: string; message: string };

/**
 * The single gate every model-requested (or confirmed) tool call passes:
 * registered -> available -> permitted for this actor -> arguments valid.
 */
export function resolveToolCall(
  registry: ToolRegistry,
  actor: ToolActor,
  name: string,
  args: unknown
): ToolResolution {
  const tool = registry.get(name);
  if (!tool) {
    return {
      ok: false,
      code: 'UNKNOWN_TOOL',
      message: `"${name}" is not a registered assistant tool.`
    };
  }
  if (tool.status === 'planned') {
    return {
      ok: false,
      code: 'TOOL_UNAVAILABLE',
      message: `"${name}" is planned but not available yet (${tool.dependsOn}).`
    };
  }
  if (!isPermitted(tool, actor)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      message: `The signed-in staff member is not permitted to use "${name}".`
    };
  }
  const parsed = tool.inputSchema.safeParse(args);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENTS',
      message: `Invalid arguments for "${name}": ${z.prettifyError(parsed.error)}`
    };
  }
  return { ok: true, tool, input: parsed.data };
}
