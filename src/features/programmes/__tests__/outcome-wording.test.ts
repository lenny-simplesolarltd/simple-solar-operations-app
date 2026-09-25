import { describe, expect, it } from 'vitest';
import { OUTCOME_LABEL, OUTCOME_SHORT, PORTAL_LABEL } from '../labels';
import { VISIT_OUTCOMES, PORTAL_VERIFICATIONS } from '../types';

/**
 * Who is allowed to claim the portal is live.
 *
 * The installer's options read "SIM card changed - portal working". An installer
 * on a doorstep cannot see the PCH portal; they can see whether the meter looks
 * like it is running. Wording a field observation as a portal result is how a
 * property ends up called finished while its meter is dark - the exact thing Dan
 * said must not happen, and the reason portal verification is a separate,
 * office-only fact.
 *
 * The canonical values are untouched by the rewording, and these assertions
 * exist to keep it that way: rename a key here and the mapping from the form's
 * option ids, the review rules and the completion constraint all break.
 */
describe('installer-facing outcome wording', () => {
  it('keeps the canonical outcomes exactly as the database names them', () => {
    expect(Object.keys(OUTCOME_LABEL).sort()).toEqual(
      [...VISIT_OUTCOMES].sort()
    );
    expect(Object.keys(OUTCOME_SHORT).sort()).toEqual(
      [...VISIT_OUTCOMES].sort()
    );
  });

  it('never has the installer reporting on the portal', () => {
    for (const outcome of VISIT_OUTCOMES) {
      expect(OUTCOME_LABEL[outcome].toLowerCase()).not.toContain('portal');
      expect(OUTCOME_SHORT[outcome].toLowerCase()).not.toContain('portal');
    }
  });

  it('says what the installer can actually observe', () => {
    expect(OUTCOME_LABEL.SimChangedPortalWorking).toBe(
      'SIM changed — meter appears working'
    );
    expect(OUTCOME_LABEL.SimChangedPortalNotWorking).toBe(
      'SIM changed — meter not working'
    );
  });

  it('leaves portal verification as the office’s own wording', () => {
    expect(Object.keys(PORTAL_LABEL).sort()).toEqual(
      [...PORTAL_VERIFICATIONS].sort()
    );
    expect(PORTAL_LABEL.ConfirmedLive).toContain('Confirmed live');
    expect(PORTAL_LABEL.NotLive).toContain('Not live');
  });
});
