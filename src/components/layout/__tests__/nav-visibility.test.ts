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
  it('gives everyone home, their tasks and their requests', () => {
    expect(urls(['Installer'])).toEqual([
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
    expect(groups.map((g) => g.label)).toEqual(['Home', 'Work']);
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

  it('shows admin only to admins', () => {
    expect(urls(['Manager'])).toContain('/dashboard/people');
    expect(urls(['Director'])).not.toContain('/dashboard/people');
  });
});
