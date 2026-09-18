-- =============================================================================
-- Re-link existing, VERIFIED Supabase Auth users to their people rows.
--
-- The link normally happens by trigger when an auth user is created or its
-- email is verified. If the people table has been rebuilt while auth.users kept
-- its rows, those logins need linking again. Never creates an auth user, never
-- touches passwords, and links only a confirmed email to an unlinked, active
-- person. Repeatable.
-- =============================================================================

select set_config('app.executing_service', 'auth:relink', false);

update public.people p
   set auth_user_id = u.id
  from auth.users u
 where u.email_confirmed_at is not null
   and lower(btrim(u.email)) = p.email
   and p.auth_user_id is null
   and p.active
   and not exists (select 1 from public.people x where x.auth_user_id = u.id);

select set_config('app.executing_service', '', false);
