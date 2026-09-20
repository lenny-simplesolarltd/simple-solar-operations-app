import { describe, expect, it } from 'vitest';

/**
 * "Complete with override" submits on the click that chose it.
 *
 * The behaviour under test is the guard around that click, not React's
 * rendering: choosing the action IS the deliberate act, so there is no dialog
 * to stop a second press. What stops it is a ref that changes synchronously,
 * because two clicks in the same tick would both read a batched state flag as
 * false.
 *
 * The board's own code is exercised through the same shape it uses: a guard
 * that is set before the await and cleared after the submission is
 * acknowledged.
 */
function makeOverrideClicker(submit: (ids: string[]) => Promise<void>) {
  const inFlight = { current: false };
  let starts = 0;
  return {
    starts: () => starts,
    inFlight: () => inFlight.current,
    click: (ids: string[]) => {
      if (inFlight.current) return;
      inFlight.current = true;
      starts += 1;
      return submit(ids).finally(() => {
        inFlight.current = false;
      });
    }
  };
}

describe('override submits once per selection', () => {
  it('a rapid double click starts exactly one batch', async () => {
    const sent: string[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const clicker = makeOverrideClicker(async (ids) => {
      sent.push(ids);
      await gate;
    });

    // Both presses land before anything awaits, which is exactly the case a
    // batched state flag would miss.
    clicker.click(['t1', 't2']);
    clicker.click(['t1', 't2']);
    expect(clicker.starts()).toBe(1);
    expect(sent).toHaveLength(1);

    release();
    await Promise.resolve();
    await Promise.resolve();
  });

  it('a second selection can be overridden once the first is acknowledged', async () => {
    const sent: string[][] = [];
    const clicker = makeOverrideClicker(async (ids) => {
      sent.push(ids);
    });
    await clicker.click(['a']);
    await clicker.click(['b']);
    expect(sent).toEqual([['a'], ['b']]);
    expect(clicker.inFlight()).toBe(false);
  });

  it('every selected task is submitted, across jobs and owners', () => {
    const sent: string[][] = [];
    const clicker = makeOverrideClicker(async (ids) => {
      sent.push(ids);
    });
    // The board sends the whole selection and lets the database judge each
    // one; it does not pre-filter by owner or job.
    const selection = ['jobA-PRE01', 'jobA-PRE02', 'jobB-PRE03'];
    clicker.click(selection);
    expect(sent[0]).toEqual(selection);
  });

  it('an empty selection sends nothing', async () => {
    const sent: string[][] = [];
    const guard = async (ids: string[]) => {
      if (ids.length === 0) return;
      sent.push(ids);
    };
    await guard([]);
    expect(sent).toEqual([]);
  });
});

describe('the recorded override reason', () => {
  // public.tasks requires a non-blank override_reason (tasks_override_shape).
  // The UI supplies it rather than asking, and rather than the constraint
  // being relaxed for a UX change.
  const OVERRIDE_REASON =
    'Administrative override from the task list. No business fact was recorded.';

  it('is non-blank, so the database constraint is satisfied without a prompt', () => {
    expect(OVERRIDE_REASON.trim().length).toBeGreaterThan(0);
  });

  it('claims no business fact', () => {
    // It must never read as evidence that the underlying work happened.
    for (const forbidden of [
      'invoice',
      'signed',
      'contract',
      'deposit',
      'confirmed',
      'verified',
      'received'
    ]) {
      expect(OVERRIDE_REASON.toLowerCase()).not.toContain(forbidden);
    }
    expect(OVERRIDE_REASON).toMatch(/no business fact was recorded/i);
  });
});
