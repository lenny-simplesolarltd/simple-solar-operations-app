import { describe, expect, it } from 'vitest';
import { TAG_KIND_LABEL, tagHref, type ChatTag } from '../types';

const tag = (over: Partial<ChatTag>): ChatTag => ({
  kind: 'job',
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  title: 'SS-ABCD-1234',
  detail: null,
  status: null,
  jobId: null,
  jobRef: null,
  ...over
});

describe('tagHref', () => {
  it('opens each kind at its own page', () => {
    expect(tagHref(tag({ kind: 'job', id: 'j1' }))).toBe('/dashboard/jobs/j1');
    expect(tagHref(tag({ kind: 'task', id: 't1' }))).toBe(
      '/dashboard/tasks/t1'
    );
    expect(tagHref(tag({ kind: 'form', id: 'f1' }))).toBe(
      '/dashboard/forms/f1'
    );
    expect(tagHref(tag({ kind: 'form_submission', id: 's1' }))).toBe(
      '/dashboard/forms/responses/s1'
    );
  });

  // Scheduled work and scaffold have no page of their own, so the chip opens
  // the job at the tab that shows them.
  it('sends the kinds with no page of their own to their job', () => {
    expect(tagHref(tag({ kind: 'work_package', id: 'w1', jobId: 'j9' }))).toBe(
      '/dashboard/jobs/j9?tab=work'
    );
    expect(
      tagHref(tag({ kind: 'scaffold_booking', id: 'b1', jobId: 'j9' }))
    ).toBe('/dashboard/jobs/j9?tab=operations');
  });

  // A card whose job is missing must still be clickable rather than linking to
  // /dashboard/jobs/null.
  it('falls back to the planner when the job is not known', () => {
    expect(tagHref(tag({ kind: 'work_package', id: 'w1' }))).toBe(
      '/dashboard/planner'
    );
    expect(tagHref(tag({ kind: 'scaffold_booking', id: 'b1' }))).toBe(
      '/dashboard/planner'
    );
  });

  it('names every kind it can render', () => {
    for (const kind of Object.keys(TAG_KIND_LABEL))
      expect(TAG_KIND_LABEL[kind as ChatTag['kind']]).toBeTruthy();
  });
});
