import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createToolRegistry } from '../tools';

/**
 * Override mode removes a click, not a check.
 *
 * The rule it must never break is the one set when the assistant was built:
 * SimpleBot may not silently perform a consequential mutation from an
 * ambiguous natural-language request. So the mode is scoped to a single tool -
 * the administrative task override, whose entire purpose is to be the
 * deliberate escape hatch - and everything irreversible still asks.
 *
 * These assertions are about that boundary. The execution path itself is
 * unchanged: an auto-confirmed action goes through resolvePendingAction, so
 * permission, the command gates, the version check, idempotency and the audit
 * trail are identical to a human pressing Confirm.
 */

/** Mirrors AUTO_CONFIRM_TOOLS in the orchestrator. */
const AUTO_CONFIRM_TOOLS = new Set(['override_complete_tasks']);

describe('what override mode may run without asking', () => {
  it('is exactly one tool', () => {
    expect(Array.from(AUTO_CONFIRM_TOOLS)).toEqual(['override_complete_tasks']);
  });

  it('never includes anything that cannot be undone', () => {
    // Naming them rather than deriving them: if one of these ever became
    // auto-confirmable it should be a deliberate edit somebody reviews.
    for (const forbidden of [
      'cancel_job',
      'confirm_booking',
      'publish_form',
      'create_form_link',
      'set_form_status',
      'reassign_tasks',
      'reopen_tasks',
      'complete_tasks'
    ]) {
      expect(AUTO_CONFIRM_TOOLS.has(forbidden)).toBe(false);
    }
  });

  it('names a tool that actually exists and is a mutation', () => {
    const registry = createToolRegistry({ forms: true });
    for (const name of Array.from(AUTO_CONFIRM_TOOLS)) {
      const tool = registry.get(name);
      expect(tool, `${name} must be registered`).toBeDefined();
      expect(tool?.kind, `${name} must be a mutation`).toBe('mutation');
    }
  });

  it('keeps the override tool behind its own permission', () => {
    const registry = createToolRegistry({ forms: true });
    const tool = registry.get('override_complete_tasks');
    // Skipping the confirmation must not skip the permission: a person without
    // task.override_complete still cannot reach it, mode or no mode.
    const permissions =
      tool && 'authorization' in tool ? tool.authorization.permissions : [];
    expect(permissions).toContain('task.override_complete');
  });

  it('leaves every other mutation needing a confirmation', () => {
    const registry = createToolRegistry({ forms: true });
    const mutations = registry
      .all()
      .filter((t) => t.kind === 'mutation' && t.status === 'available')
      .map((t) => t.name);
    const asks = mutations.filter((n) => !AUTO_CONFIRM_TOOLS.has(n));
    expect(asks.length).toBeGreaterThan(0);
    expect(asks).not.toContain('override_complete_tasks');
  });
});

describe('the refusal that points at the override', () => {
  it('says what override does and does not do', () => {
    // The wording the tool returns when normal completion cannot proceed.
    const message =
      'These tasks record business facts that only their own screen can capture. ' +
      'If the staff member wants them closed anyway, override_complete_tasks can do it - ' +
      'tell them that is available and what it means: the task stops being asked for, ' +
      "nothing about the underlying work is recorded, and the job's checks still report " +
      'those requirements as outstanding. Do not run it unless they ask for it.';

    expect(message).toContain('override_complete_tasks');
    // It must never imply the work happened.
    expect(message).toMatch(/nothing about the underlying work is recorded/i);
    expect(message).toMatch(/still report those requirements as outstanding/i);
    // And it must not invite the assistant to just do it.
    expect(message).toMatch(/unless they ask for it/i);
  });
});
