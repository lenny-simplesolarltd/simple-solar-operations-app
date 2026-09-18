# Database ownership

Two implementation streams share ONE hosted Supabase project
(`ocpwrrajskywpqpatwea`). Read this before writing any migration.

## Identity + Job Sold stream owns

Tables: `people`, `roles`, `person_roles`, `skills`, `person_skills`,
`audit_events`, `permissions`, `role_permissions`, `customers`, `jobs`,
`presales`, `task_templates`, `tasks`, `task_assignment_rules`, `commands`.

Also: Supabase Auth integration, the `auth.users -> people` link trigger,
`public.current_actor()`, `public.submit_presale()`, and the shared `app.*`
helpers - `current_person_id`, `current_roles`, `has_any_role`,
`has_permission`, `is_active_actor`, `is_admin`, `is_director_class`,
`is_office_class`, `is_office_manager`, `touch_row`, `stamp_created`,
`audit_row_change`, `forbid_mutation`, `forbid_audit_mutation`,
`next_staffed_day`, `generate_job_ref`, `resolve_task_assignment`,
`create_task` and the payload validators. Frontend: authentication,
People & access (invites), Presale / Job Sold.

These are the **canonical** Person, Customer, Job, Task, Audit, Role and Command
models. Do not create parallel versions; reference them by foreign key.

## Backend-port stream owns

Every other table in `public` (the reference-schema port: work packages,
allocations, task events/dependencies, issues, calls, intake, evidence, stock,
ordering, scaffold, communications, commissioning, finance, operations, ...),
and its own helpers in `app` (`is_stock_class`, `is_finance_class`,
`holds_active_allocation`, `stamp_setting`), policies and triggers.

## Rules for everyone (people and agents)

1. **Migrations are append-only and forward-only.** Never edit or delete an
   applied migration, and never rewrite hosted migration history.
2. **Never drop, truncate, rename or replace another stream's objects.**
   `drop schema app cascade` and `drop table ... cascade` on shared objects are
   forbidden: CASCADE silently removes the other stream's policies, triggers and
   foreign keys too. (That is what `20260919110000` did; `20260919120000`
   repaired it.)
3. **No `supabase db reset`, no blanket `truncate`, no destructive cleanup on
   hosted** without the owner's explicit approval. The local stack
   (ports 5532x) is the only thing tests may reset.
4. **The `app` schema is shared.** Add to it with `create or replace`; never
   drop it. Depend on the helpers above rather than re-implementing them.
5. **Pull before you push.** `supabase db push` must see every hosted migration
   in `supabase/migrations`. If hosted has versions you lack, fetch them first;
   do not work around the mismatch.
6. **Migrations must tolerate the combined architecture** - both streams'
   objects exist in every environment, including a fresh local replay.
7. Need a column, constraint or behaviour on the other stream's table? Ask the
   owner, or add it in a migration they have agreed to.

## History note (2026-09-19)

`20260919100000`-`20260919107000` (backend-port stream) built the reference
tables on top of the identity foundation. `20260919110000` then dropped the 14
identity/Job Sold tables and the `app` schema with CASCADE, which also removed
78 policies, 89 triggers and 130 foreign keys from the backend tables.
`20260919120000_restore_identity_and_job_sold` restored the owned objects and
reconnected the 130 foreign keys. The backend stream's own policies, triggers
and helpers were not restored by it: those tables currently have RLS enabled
with no policies (service-role only) until that stream re-creates them.
