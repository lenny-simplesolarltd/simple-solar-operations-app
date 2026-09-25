import { describe, expect, it } from 'vitest';
import { publishState } from '../publish-state';

const state = (over: Partial<Parameters<typeof publishState>[0]> = {}) =>
  publishState({
    isTemplate: false,
    revision: 1,
    hasUnpublishedChanges: false,
    dirty: false,
    ...over
  });

describe('what the person is looking at', () => {
  it('is live when the draft matches the published version', () => {
    const s = state();
    expect(s.label).toBe('Live · v1');
    expect(s.tone).toBe('live');
  });

  // The case the old wording got wrong: "Published" in the editor and "Draft"
  // in the preview, with nothing saying both were true of different things.
  it('names the version being edited AND the one still live', () => {
    const s = state({ revision: 1, hasUnpublishedChanges: true });
    expect(s.label).toBe('Editing draft · v2');
    expect(s.detail).toBe('Version 1 stays live until you publish.');
    expect(s.tone).toBe('draft');
  });

  it('treats unsaved edits the same as saved-but-unpublished ones', () => {
    expect(state({ dirty: true }).label).toBe('Editing draft · v2');
  });

  it('says plainly when nobody can open it yet', () => {
    const s = state({ revision: 0 });
    expect(s.label).toBe('Not published yet');
    expect(s.detail).toMatch(/Nobody can open/);
  });

  it('does not call a template published or draft', () => {
    expect(state({ isTemplate: true }).label).toBe('Template');
  });

  it('never says "Published" and "Draft" of the same form at once', () => {
    for (const rev of [0, 1, 7])
      for (const changed of [true, false]) {
        const s = state({ revision: rev, hasUnpublishedChanges: changed });
        const says = `${s.label} ${s.detail ?? ''}`;
        expect(/\bLive\b/.test(says) && /\bEditing draft\b/.test(says)).toBe(
          false
        );
      }
  });
});
