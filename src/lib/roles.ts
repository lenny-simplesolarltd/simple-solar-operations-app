// Role vocabulary and predicates. Safe to import from client components.
//
// The predicates mirror app.is_admin() etc. in the database, which remain the
// enforcement point (RLS); use these only to shape the UI.
export const ROLE_CODES = [
  'Admin',
  'Manager',
  'Director',
  'Office',
  'VariationApprover',
  'Surveyor',
  'Finance',
  'Store',
  'Installer',
  'Scaffolder',
  'ReadOnly'
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

type HasRoles = { roles: readonly RoleCode[] };

const hasAny = (actor: HasRoles, roles: RoleCode[]) =>
  actor.roles.some((role) => roles.includes(role));

export const isAdmin = (actor: HasRoles) => hasAny(actor, ['Admin', 'Manager']);
export const isDirectorClass = (actor: HasRoles) =>
  hasAny(actor, ['Admin', 'Manager', 'Director']);
export const isOfficeClass = (actor: HasRoles) =>
  hasAny(actor, [
    'Admin',
    'Manager',
    'Director',
    'Office',
    'VariationApprover'
  ]);
export const isOfficeManager = (actor: HasRoles) =>
  hasAny(actor, ['Admin', 'Manager', 'Office']);
