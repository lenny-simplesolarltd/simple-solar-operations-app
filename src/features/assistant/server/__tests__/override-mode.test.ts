import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runAssistantTurn } from '../orchestrator';
import { canUseOverrideMode, ToolRegistry } from '../registry';
import { volatileSystemPrompt } from '../system-prompt';
import { createToolRegistry } from '../tools';
import {
  collector,
  makeActor,
  makePendingActions,
  scriptedProvider,
  silentAudit,
  THREAD
} from './helpers';

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

describe('what the model is told when the mode is on', () => {
  const prompt = (on: boolean, actor = makeActor()) =>
    volatileSystemPrompt(actor, undefined, new Date(), on);

  it('says nothing about override mode when it is off', () => {
    expect(prompt(false)).not.toMatch(/override mode is on/i);
  });

  it('tells it to use the override instead of explaining why it cannot', () => {
    const text = prompt(true);
    expect(text).toMatch(/override mode is on/i);
    expect(text).toMatch(/use override_complete_tasks/i);
    // The complaint that prompted this: it asked for the request to be worded
    // differently, and for a reason, instead of acting.
    expect(text).toMatch(/do not ask for a reason/i);
    expect(text).toMatch(/do not ask them to word the request differently/i);
  });

  it('still requires it to say what an override did not record', () => {
    const text = prompt(true);
    expect(text).toMatch(/no business fact was written/i);
    expect(text).toMatch(/still report the requirement as outstanding/i);
  });

  it('is withheld in preview, where nothing can be written', () => {
    const previewing = makeActor();
    previewing.previewing = true;
    expect(prompt(true, previewing)).not.toMatch(/override mode is on/i);
  });
});

// -- Who may switch it on ------------------------------------------------------

/**
 * The toggle used to be shown to everybody. For most people it did nothing -
 * override_complete_tasks needs task.override_complete, so the tool was never
 * offered - which is the worst of both worlds: it looks like a switch that is
 * broken rather than a boundary that is deliberate.
 *
 * It is now gated on that same permission, on the server, because the flag
 * arrives in the request body.
 */
describe('who may use override mode', () => {
  const holder = () =>
    makeActor({
      roles: ['Office'],
      permissions: ['task.read.all', 'task.override_complete']
    });

  it('allows the roles that already hold the override permission', () => {
    expect(canUseOverrideMode(holder())).toBe(true);
  });

  it('refuses anyone without it, however senior their role sounds', () => {
    for (const actor of [
      makeActor({ roles: ['Installer'], permissions: [] }),
      makeActor({ roles: ['Surveyor'], permissions: [] }),
      makeActor({ roles: ['Finance'], permissions: [] }),
      // Reading every task queue is not the same authority as closing a task
      // while recording nothing.
      makeActor({ roles: ['Office'], permissions: ['task.read.all'] })
    ]) {
      expect(canUseOverrideMode(actor), actor.user.roles.join()).toBe(false);
    }
  });

  it('refuses a developer previewing as somebody who does hold it', () => {
    const previewing = holder();
    previewing.previewing = true;
    expect(canUseOverrideMode(previewing)).toBe(false);
  });

  it('is the permission the override tool itself asks for', () => {
    const tool = createToolRegistry({ forms: true }).get(
      'override_complete_tasks'
    );
    const permissions =
      tool && 'authorization' in tool ? tool.authorization.permissions : [];
    // One permission, not two lists that can drift apart.
    expect(permissions).toContain('task.override_complete');
    expect(canUseOverrideMode(holder())).toBe(true);
  });
});

describe('the browser cannot switch it on by itself', () => {
  /** Runs one turn with overrideMode asked for, and returns what the model was sent. */
  async function turn(actor: ReturnType<typeof makeActor>) {
    const { provider, requests } = scriptedProvider([
      { text: 'Right you are.' }
    ]);
    const out = collector();
    await runAssistantTurn({
      actor,
      threadId: THREAD,
      message: 'close it anyway',
      transcript: [],
      provider,
      registry: new ToolRegistry(),
      pendingActions: makePendingActions(),
      overrideMode: true,
      audit: silentAudit().sink,
      emit: out.emit
    });
    return requests[0].system.volatile;
  }

  it('tells the model the mode is on for somebody who may use it', async () => {
    const volatile = await turn(
      makeActor({
        roles: ['Office'],
        permissions: ['task.read.all', 'task.override_complete']
      })
    );
    expect(volatile).toMatch(/override mode is on/i);
  });

  it('ignores the flag from somebody who may not - the turn reads as mode off', async () => {
    // The request body said overrideMode: true. It is re-decided on the
    // server, so a crafted request buys nothing.
    const volatile = await turn(
      makeActor({ roles: ['Installer'], permissions: [] })
    );
    expect(volatile).not.toMatch(/override mode is on/i);
  });
});
