import { navGroups } from '@/constants/data';
import type { AppUser } from '@/lib/auth';
import type { RoleCode } from '@/lib/roles';
import { describe, expect, it } from 'vitest';
import { visibleNavGroups } from '../nav-visibility';

/**
 * What each role is actually offered, as one table.
 *
 * Three navigation faults were found by reading the menu rather than the code,
 * and none of them could fail a test, because every test asked about one item at
 * a time:
 *
 *   - "Programmes" and "My programme visits" both pointed at
 *     /dashboard/operations/programmes, so the menu showed two features that
 *     were one, and an Admin saw both;
 *   - "Operations" sat in the Work group pointing at the bulk task screen while
 *     a separate Operations group pointed elsewhere, so the word meant two
 *     things;
 *   - Forms was offered only to people who could ADMINISTER forms, so the
 *     installer who was expected to fill one in had no way to reach it.
 *
 * So this asserts the whole menu per role, including that no two items share a
 * destination. The permission sets are the real ones, copied from
 * public.role_permissions - tests/zz-role-navigation.test.mjs fails if the
 * database and this table ever drift apart.
 */

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  Admin: `communication.approve communication.record_send communication.send
    communications.chat.admin communications.chat.use customer.edit
    file.library.manage file.library.read file.manage file.purge forms.create
    forms.edit forms.publish forms.read forms.responses.read forms.send
    forms.templates.manage help.edit help.publish job.read.all job.sale.edit
    presale.submit presale.submit_on_behalf programme.manage programme.read
    programme.read.all programme.report programme.review programme.visit.submit
    task.complete.cross_owner task.override_complete task.read.all`
    .trim()
    .split(/\s+/),
  Manager: `communication.approve communication.record_send communication.send
    communications.chat.use customer.edit file.library.manage file.library.read
    file.manage file.purge forms.create forms.edit forms.publish forms.read
    forms.responses.read forms.send forms.templates.manage help.edit
    help.publish job.read.all job.sale.edit presale.submit
    presale.submit_on_behalf programme.manage programme.read programme.read.all
    programme.report programme.review programme.visit.submit
    task.complete.cross_owner task.override_complete task.read.all`
    .trim()
    .split(/\s+/),
  Director: `communication.approve communications.chat.use customer.edit
    file.library.manage file.library.read file.manage forms.read
    forms.responses.read job.read.all job.sale.edit programme.read
    programme.read.all programme.report task.complete.cross_owner
    task.override_complete task.read.all`
    .trim()
    .split(/\s+/),
  Office: `communication.approve communication.record_send communication.send
    communications.chat.use customer.edit file.library.manage file.library.read
    file.manage forms.create forms.edit forms.publish forms.read
    forms.responses.read forms.send forms.templates.manage help.edit
    job.read.all job.sale.edit presale.submit presale.submit_on_behalf
    programme.read programme.read.all programme.report programme.review
    task.complete.cross_owner task.override_complete task.read.all`
    .trim()
    .split(/\s+/),
  Installer:
    'communications.chat.use programme.read programme.visit.submit'.split(' '),
  Surveyor:
    'communications.chat.use file.library.read job.read.own presale.submit'.split(
      ' '
    )
};

const user = (role: RoleCode): AppUser => ({
  id: '00000000-0000-4000-8000-000000000001',
  email: 'staff@example.com',
  fullName: 'Staff Member',
  roles: [role]
});

/** Both release-gated modules on, which is the state being signed off. */
const RELEASED = { forms: true, programmes: true, canFillForms: false };

const menu = (role: keyof typeof ROLE_PERMISSIONS, canFillForms = false) =>
  visibleNavGroups(
    navGroups,
    user(role as RoleCode),
    new Set(ROLE_PERMISSIONS[role]),
    { ...RELEASED, canFillForms }
  );

const items = (role: keyof typeof ROLE_PERMISSIONS, canFillForms = false) =>
  menu(role, canFillForms).flatMap((g) =>
    g.items.map((i) => `${g.label} / ${i.title}`)
  );

const urls = (role: keyof typeof ROLE_PERMISSIONS, canFillForms = false) =>
  menu(role, canFillForms).flatMap((g) => g.items.map((i) => i.url));

describe('role x navigation matrix', () => {
  it('never offers the same destination twice to anybody', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const seen = urls(role);
      const duplicates = seen.filter((u, i) => seen.indexOf(u) !== i);
      expect(duplicates, `${role} is offered a duplicate destination`).toEqual(
        []
      );
    }
  });

  it('never gives one word two meanings', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const titles = items(role).map((i) => i.split(' / ')[1]);
      const duplicates = titles.filter((t, i) => titles.indexOf(t) !== i);
      expect(duplicates, `${role} sees a repeated menu label`).toEqual([]);
    }
  });

  it('gives Programmes its own group, not a corner of Operations', () => {
    const groups = menu('Office').map((g) => g.label);
    expect(groups).toContain('Programmes');
    const programmes = menu('Office').find((g) => g.label === 'Programmes');
    expect(programmes?.items.map((i) => i.title)).toEqual(['Programmes']);
  });

  it('offers the office the management view and not the field one', () => {
    for (const role of ['Admin', 'Manager', 'Office', 'Director'] as const) {
      const titles = items(role);
      expect(titles, role).toContain('Programmes / Programmes');
      expect(titles, role).not.toContain('Programmes / My programme visits');
    }
  });

  it('offers an installer their own visits and no board or builder', () => {
    const titles = items('Installer');
    expect(titles).toContain('Programmes / My programme visits');
    expect(titles).not.toContain('Programmes / Programmes');
    expect(urls('Installer')).not.toContain('/dashboard/forms');
  });

  it('offers Forms to a person who has a form to complete but cannot build one', () => {
    // The installer holds no forms.* permission at all.
    expect(ROLE_PERMISSIONS.Installer.some((p) => p.startsWith('forms.'))).toBe(
      false
    );
    expect(urls('Installer', false)).not.toContain('/dashboard/forms');
    expect(urls('Installer', true)).toContain('/dashboard/forms');
  });

  it('shows a surveyor no programme and no forms', () => {
    const titles = items('Surveyor', false);
    expect(titles.filter((t) => /programme/i.test(t))).toEqual([]);
    expect(urls('Surveyor')).not.toContain('/dashboard/forms');
  });

  it('hides both gated modules entirely when they are switched off', () => {
    const off = visibleNavGroups(
      navGroups,
      user('Admin'),
      new Set(ROLE_PERMISSIONS.Admin),
      { forms: false, programmes: false }
    ).flatMap((g) => g.items.map((i) => i.url));
    expect(off).not.toContain('/dashboard/forms');
    expect(off.filter((u) => u.includes('programme'))).toEqual([]);
  });

  it('keeps the bulk task screen out of the Programmes mental model', () => {
    const work = menu('Office').find((g) => g.label === 'Work');
    const bulk = work?.items.find((i) => i.url === '/dashboard/operations');
    expect(bulk?.title).toBe('Bulk task operations');
  });
});
