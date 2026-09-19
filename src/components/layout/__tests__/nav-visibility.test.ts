import { navGroups } from '@/constants/data';
import type { AppUser } from '@/lib/auth';
import type { RoleCode } from '@/lib/roles';
import { describe, expect, it } from 'vitest';
import { visibleNavGroups } from '../nav-visibility';

const user = (roles: RoleCode[]): AppUser => ({
  id: '00000000-0000-4000-8000-000000000001',
  email: 'staff@example.com',
  fullName: 'Staff Member',
  roles
});

const urls = (roles: RoleCode[], permissions: string[] = []) =>
  visibleNavGroups(navGroups, user(roles), new Set(permissions)).flatMap((g) =>
    g.items.map((i) => i.url)
  );

describe('visibleNavGroups', () => {
  it('gives an installer home, tasks, requests and their installs', () => {
    expect(urls(['Installer'])).toEqual([
      '/dashboard',
      '/dashboard/tasks',
      '/dashboard/requests',
      '/dashboard/installs'
    ]);
    expect(urls(['ReadOnly'])).toEqual([
      '/dashboard',
      '/dashboard/tasks',
      '/dashboard/requests'
    ]);
  });

  it('offers team tasks from the canonical permission or the office-manager rule', () => {
    expect(urls(['Surveyor'], ['task.read.all'])).toContain(
      '/dashboard/tasks?scope=team'
    );
    expect(urls(['Office'])).toContain('/dashboard/tasks?scope=team');
    expect(urls(['Director'])).not.toContain('/dashboard/tasks?scope=team');
  });

  it('matches job search to the JOBS read roles', () => {
    expect(urls(['Director'])).toContain('/dashboard/jobs');
    expect(urls(['Finance'])).toContain('/dashboard/jobs');
    expect(urls(['Store'])).not.toContain('/dashboard/jobs');
  });

  it('offers selling only with presale.submit', () => {
    expect(urls(['Surveyor'], ['presale.submit', 'job.read.own'])).toEqual(
      expect.arrayContaining(['/dashboard/presales/new', '/dashboard/presales'])
    );
    expect(urls(['Office'])).not.toContain('/dashboard/presales/new');
  });

  it('drops empty groups and never exposes access rules to the client', () => {
    const groups = visibleNavGroups(navGroups, user(['Installer']), new Set());
    expect(groups.map((g) => g.label)).toEqual(['Home', 'Work', 'Installs']);
    for (const item of groups.flatMap((g) => g.items)) {
      expect(item).not.toHaveProperty('access');
    }
  });

  it('offers booking to the office and intake review to office managers', () => {
    expect(urls(['Director'])).toContain('/dashboard/booking');
    expect(urls(['Director'])).not.toContain('/dashboard/intake');
    expect(urls(['Office'])).toEqual(
      expect.arrayContaining(['/dashboard/booking', '/dashboard/intake'])
    );
    expect(urls(['Surveyor'])).not.toContain('/dashboard/booking');
  });

  it('gives the store materials, goods in and stock but not booking', () => {
    const store = urls(['Store']);
    expect(store).toEqual(
      expect.arrayContaining([
        '/dashboard/materials',
        '/dashboard/orders',
        '/dashboard/goods-in',
        '/dashboard/stock'
      ])
    );
    expect(store).not.toContain('/dashboard/booking');
    expect(urls(['Office'])).not.toContain('/dashboard/stock');
  });

  it('shows admin only to admins', () => {
    expect(urls(['Manager'])).toContain('/dashboard/people');
    expect(urls(['Director'])).not.toContain('/dashboard/people');
  });
});

describe('Forms behind its release gate', () => {
  const formsUrls = (released: boolean, permissions: string[]) =>
    visibleNavGroups(navGroups, user(['Office']), new Set(permissions), {
      forms: released
    })
      .flatMap((g) => g.items.map((i) => i.url))
      .filter((u) => u.startsWith('/dashboard/forms'));

  it('is hidden while Forms is switched off, even with forms.read', () => {
    expect(formsUrls(false, ['forms.read'])).toEqual([]);
  });

  it('shows once switched on, only with forms.read', () => {
    expect(formsUrls(true, ['forms.read'])).toEqual(['/dashboard/forms']);
    expect(formsUrls(true, [])).toEqual([]);
  });

  it('defaults to hidden when the gate is not supplied (fails closed)', () => {
    const all = visibleNavGroups(
      navGroups,
      user(['Admin']),
      new Set(['forms.read'])
    );
    expect(all.flatMap((g) => g.items.map((i) => i.url))).not.toContain(
      '/dashboard/forms'
    );
  });
});
