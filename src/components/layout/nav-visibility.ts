import type { AppUser } from '@/lib/auth';
import {
  isAdmin,
  isOfficeClass,
  isOfficeManager,
  type RoleCode
} from '@/lib/roles';
import type { NavAccess, NavGroup, VisibleNavGroup } from '@/types';

// Shapes the menu only. Each page, read model and command is authorised again
// in the database (RLS, execute_read / execute_operations_read role lists,
// execute_command); this just avoids offering links that would bounce.
//
// The rules mirror the backend read registry roles and the canonical
// permissions (role_permissions), so the menu matches what the server allows.

const has = (user: AppUser, roles: RoleCode[]) =>
  user.roles.some((r) => roles.includes(r));

export function canSee(
  access: NavAccess,
  user: AppUser,
  permissions: Set<string>
): boolean {
  switch (access) {
    case 'any':
      return true;
    case 'office':
      return isOfficeClass(user);
    case 'officeManager':
    case 'intakeReview':
      return isOfficeManager(user);
    case 'teamTasks':
      return permissions.has('task.read.all') || isOfficeManager(user);
    case 'jobs':
      return isOfficeClass(user) || has(user, ['Surveyor', 'Finance']);
    case 'jobSales':
      return (
        permissions.has('job.read.all') ||
        permissions.has('job.read.own') ||
        isOfficeClass(user)
      );
    case 'presaleSubmit':
      return permissions.has('presale.submit');
    case 'admin':
      return isAdmin(user);
    case 'materials':
      return isOfficeClass(user) || has(user, ['Store']);
    case 'stock':
      return has(user, ['Admin', 'Manager', 'Store']);
    case 'installer':
      return has(user, ['Installer', 'Office', 'Manager', 'Admin']);
    case 'commissioning':
      return has(user, ['Admin', 'Manager', 'Office']);
    case 'resourcing':
      return isOfficeClass(user);
  }
}

export function visibleNavGroups(
  groups: NavGroup[],
  user: AppUser,
  permissions: Set<string>
): VisibleNavGroup[] {
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items
        .filter((i) => canSee(i.access, user, permissions))
        .map((i) => ({
          title: i.title,
          url: i.url,
          icon: i.icon,
          shortcut: i.shortcut
        }))
    }))
    .filter((g) => g.items.length > 0);
}
