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

/** Modules behind a release gate (release_modes), as the server read them. */
export interface Released {
  forms: boolean;
  /**
   * This person has at least one form they may complete. Optional and
   * defaulting to false: an omitted capability must never open a door.
   */
  canFillForms?: boolean;
  programmes: boolean;
}

export function canSee(
  access: NavAccess,
  user: AppUser,
  permissions: Set<string>,
  released: Released = { forms: false, programmes: false }
): boolean {
  switch (access) {
    case 'any':
      return true;
    case 'office':
      return isOfficeClass(user);
    case 'officeManager':
    case 'intakeReview':
      return isOfficeManager(user);
    case 'files':
      // The roles app.can_read_evidence lets read some file (installers: their
      // allocated work; Store: delivery notes). ReadOnly / Scaffolder read none.
      return has(user, [
        'Admin',
        'Manager',
        'Director',
        'Office',
        'VariationApprover',
        'Surveyor',
        'Finance',
        'Store',
        'Installer'
      ]);
    case 'releaseControl':
      // Admin / Manager switch functions; Director (go-live approver) reads.
      return isAdmin(user) || has(user, ['Director']);
    case 'systemHealth':
      // Director records backup / restore evidence there (read only otherwise).
      return isOfficeManager(user) || has(user, ['Director']);
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
    case 'communications':
      // Mirrors the communications_select RLS policy (app.is_office_class()),
      // plus VariationApprover, who the read registry also lets look. Not
      // release-gated: the office must be able to work through captured drafts
      // and record their own sends while every function is still Disabled.
      return isOfficeClass(user) || has(user, ['VariationApprover']);
    case 'chat':
      // Everyone who works in the system talks to colleagues, installers and
      // scaffolders included. ReadOnly is an observer account and is excluded,
      // which is exactly what communications.chat.use encodes.
      return permissions.has('communications.chat.use');
    case 'forms':
      // Hidden, not merely disabled, while Forms is switched off. Offered to
      // form MANAGERS and to anyone with a form to complete - needing Forms
      // administration in order to reach the form you are asked to fill in was
      // the problem this replaces.
      return (
        released.forms &&
        (permissions.has('forms.read') || released.canFillForms === true)
      );
    case 'programmes':
      // The office view: reporting, review and the board.
      return (
        released.programmes &&
        (permissions.has('programme.read.all') ||
          permissions.has('programme.review') ||
          permissions.has('programme.manage'))
      );
    case 'programmeField':
      // The field worker's own entry: their properties and their visits.
      return released.programmes && permissions.has('programme.visit.submit');
    case 'programmeFieldOnly':
      // The same entry, but only for people who do NOT also get the management
      // view. An Admin used to see "Programmes" and "My programme visits"
      // pointing at the same URL, which reads as two features and is one.
      return (
        canSee('programmeField', user, permissions, released) &&
        !canSee('programmes', user, permissions, released)
      );
  }
}

export function visibleNavGroups(
  groups: NavGroup[],
  user: AppUser,
  permissions: Set<string>,
  released: Released = { forms: false, programmes: false }
): VisibleNavGroup[] {
  return groups
    .map((g) => ({
      label: g.label,
      items: g.items
        .filter((i) => canSee(i.access, user, permissions, released))
        .map((i) => ({
          title: i.title,
          url: i.url,
          icon: i.icon,
          shortcut: i.shortcut
        }))
    }))
    .filter((g) => g.items.length > 0);
}
