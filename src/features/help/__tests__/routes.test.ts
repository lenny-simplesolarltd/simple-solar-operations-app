import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ROUTES, isHelpRoute, routePatternFor } from '../routes';

/**
 * A parallel slot (@modal) and an interception ((..)visits) are ways of
 * rendering a route that already exists somewhere else - the board's visit
 * modal is /visits/[visitId] shown over the board, not a screen of its own. So
 * they are not walked: counting them would invent staff pages nobody can
 * navigate to, and the real route is already listed.
 */
const isSlotOrInterception = (name: string) =>
  name.startsWith('@') || /^\(\.{1,3}\)/.test(name);

function pages(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (isSlotOrInterception(entry.name)) continue;
      out.push(...pages(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === 'page.tsx') {
      out.push(prefix);
    }
  }
  return out;
}

describe('APP_ROUTES', () => {
  it('matches the staff pages that exist (fails when a screen is added or removed)', () => {
    const actual = pages(
      path.resolve(__dirname, '../../../app/dashboard'),
      '/dashboard'
    ).sort();
    expect([...APP_ROUTES].sort()).toEqual(actual);
  });
});

describe('routePatternFor', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/dashboard/booking', '/dashboard/booking'],
    ['/dashboard/booking?tab=ready', '/dashboard/booking'],
    [
      '/dashboard/jobs/9b2f6c1e-0d54-4c8e-a3f7-2f6d1b0c9e77/move',
      '/dashboard/jobs/[jobId]/move'
    ],
    ['/dashboard/jobs/abc', '/dashboard/jobs/[jobId]'],
    ['/dashboard/help/manage/new', '/dashboard/help/manage/new'],
    ['/dashboard/help/manage', '/dashboard/help/manage'],
    ['/dashboard/help/move-a-job', '/dashboard/help/[slug]'],
    ['/dashboard/presales/new', '/dashboard/presales/new'],
    ['/dashboard/nope/x/y', null],
    ['/auth/sign-in', null]
  ])('%s -> %s', (path, expected) => {
    expect(routePatternFor(path)).toBe(expected);
  });

  it('knows the Help Center routes', () => {
    expect(isHelpRoute('/dashboard/help/[slug]')).toBe(true);
    expect(isHelpRoute('/dashboard/booking')).toBe(false);
  });
});
