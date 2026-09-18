-- =============================================================================
-- Staff directory seed.
--
-- Derived (and reviewed by hand) from the DEV spreadsheet exports dated
-- 2026-09-18: People, PersonRoles, PersonSkills. The application does not read
-- those CSVs; this file is the controlled import.
--
-- Repeatable: every statement is insert-if-absent, so re-running never
-- overwrites later edits made in the app.
--
-- Included: the 22 genuine identities (of 35 CSV rows; the other 13 are
-- fixtures), their active PersonRoles, their skills.
-- Excluded (synthetic DEV/test fixtures): PERSON-store, PERSON-installer-a/-b,
--   PERSON-scaffolder, PERSON-s11-*, PERSON-s15-*, PERSON-s16-*, PERSON-s17-*,
--   PERSON-rp-a/-b-*, their skills, and ROLE-R1A-smoke-admin (an inactive
--   smoke-test Admin grant on Tanya).
-- PERSON-info (the shared info@ mailbox) is kept as an operational/contact
-- identity only: it holds NO role and must never be given a login or act as a
-- human actor. With no active role it has no access even if a login existed.
-- No auth.users are created here. Logins are invited separately and link to
-- these rows by verified email.
--
-- Normalisations applied:
--   * roles come from PersonRoles only (People.role is not imported)
--   * 'NOT_CONFIGURED' placeholders -> null
--   * blank skill level -> 'Member' (the reference default)
--   * display names 'John Doyle Installer' / 'Josh Lewis Installer' -> the
--     role suffix is dropped
-- =============================================================================

insert into public.people (legacy_id, email, display_name, active, capacity_per_day) values
  ('PERSON-tanya',        'tanya@simplesolarltd.co.uk',        'Tanya Harris',     true, null),
  ('PERSON-ben',          'ben@simplesolarltd.co.uk',          'Ben Quick',        true, null),
  ('PERSON-hannah',       'hannah@simplesolarltd.co.uk',       'Hannah Harvey',    true, null),
  ('PERSON-lenny-dev',    'lenny@simplesolarltd.co.uk',        'Lenny DEV',        true, null),
  ('PERSON-info',         'info@simplesolarltd.co.uk',         'Simple Solar Info', true, null),
  ('PERSON-dan',          'dan@simplesolarltd.co.uk',          'Dan Barnes',       true, null),
  ('PERSON-lucy',         'lucy@simplesolarltd.co.uk',         'Lucy Ross',        true, null),
  ('PERSON-rosie',        'rosie@simplesolarltd.co.uk',        'Rosie Ashley',     true, null),
  ('PERSON-mike',         'mike@simplesolarltd.co.uk',         'Mike Bater',       true, null),
  ('PERSON-anne',         'anne@simplesolarltd.co.uk',         'Anne Pike',        true, null),
  ('PERSON-rick',         'rick@simplesolarltd.co.uk',         'Rick Jarvis',      true, null),
  ('PERSON-dave-hopwood', 'davehopwood@simplesolarltd.co.uk',  'Dave Hopwood',     true, null),
  ('PERSON-dave-gorman',  'dave@simplesolarltd.co.uk',         'Dave Gorman',      true, null),
  ('PERSON-dan-anderson', 'dananderson@simplesolarltd.co.uk',  'Dan Anderson',     true, 1),
  ('PERSON-john-doyle',   'john@simplesolarltd.co.uk',         'John Doyle',       true, 1),
  ('PERSON-josh-lewis',   'josh@simplesolarltd.co.uk',         'Josh Lewis',       true, 1),
  ('PERSON-angel',        'angel@simplesolarltd.co.uk',        'Angel Dos Santos', true, 1),
  ('PERSON-james',        'james@simplesolarltd.co.uk',        'James Davies',     true, 1),
  ('PERSON-robbie',       'robbie@simplesolarltd.co.uk',       'Robbie Daniel',    true, 1),
  ('PERSON-darren',       'darren@simplesolarltd.co.uk',       'Darren Lester',    true, 1),
  ('PERSON-casey',        'casey@simplesolarltd.co.uk',        'Casey Lakey',      true, 1),
  ('PERSON-lucan',        'lucan@simplesolarltd.co.uk',        'Lucan Bender',     true, 1)
on conflict (legacy_id) do nothing;

insert into public.person_roles (person_id, role_code)
select p.id, v.role_code
from (values
  ('PERSON-tanya',        'Office'),
  ('PERSON-ben',          'Director'),
  ('PERSON-hannah',       'Office'),
  ('PERSON-hannah',       'VariationApprover'),
  ('PERSON-lenny-dev',    'Admin'),
  ('PERSON-dan',          'Director'),
  ('PERSON-lucy',         'Office'),
  ('PERSON-rosie',        'Office'),
  ('PERSON-mike',         'Surveyor'),
  ('PERSON-anne',         'Surveyor'),
  ('PERSON-rick',         'Surveyor'),
  ('PERSON-dave-hopwood', 'Manager'),
  ('PERSON-dave-gorman',  'Surveyor'),
  ('PERSON-dan-anderson', 'Installer'),
  ('PERSON-john-doyle',   'Installer'),
  ('PERSON-josh-lewis',   'Installer'),
  ('PERSON-angel',        'Installer'),
  ('PERSON-james',        'Installer'),
  ('PERSON-robbie',       'Installer'),
  ('PERSON-darren',       'Installer'),
  ('PERSON-casey',        'Installer'),
  ('PERSON-lucan',        'Installer')
) as v (legacy_id, role_code)
join public.people p on p.legacy_id = v.legacy_id
on conflict (person_id, role_code) do nothing;

insert into public.person_skills (person_id, skill_code, level)
select p.id, v.skill_code, 'Member'
from (values
  ('PERSON-dan-anderson', 'Electrical'),
  ('PERSON-john-doyle',   'Roof'),
  ('PERSON-josh-lewis',   'Roof'),
  ('PERSON-angel',        'Roof'),
  ('PERSON-james',        'Electrical'),
  ('PERSON-robbie',       'Electrical'),
  ('PERSON-darren',       'Electrical'),
  ('PERSON-casey',        'Electrical'),
  ('PERSON-lucan',        'Electrical')
) as v (legacy_id, skill_code)
join public.people p on p.legacy_id = v.legacy_id
on conflict (person_id, skill_code) do nothing;
