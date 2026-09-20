-- =============================================================================
-- Communications: open three of the four doors.
--
-- 20260920250000 built the dispatch spine and left every gate shut. This
-- migration opens the three that are configuration, and deliberately does NOT
-- open the fourth.
--
--   email.mode                   CAPTURE -> LIVE      (opened here)
--   email.transport              noop    -> resend    (opened here)
--   email.from_mailbox           ""      -> a mailbox (opened here)
--   outbound.allowed_recipients  []      -> []        (LEFT SHUT, on purpose)
--   release_modes FN-03 / FN-04  Disabled             (LEFT SHUT, on purpose)
--
-- WHY THE ALLOW-LIST STAYS EMPTY
--
-- It holds real third-party addresses - merchants, scaffolders, named people
-- at other companies. Those do not belong in a git repository, so they are
-- applied directly to the database by the owner and never committed. Until
-- somebody does that, app.email_claim_decision refuses on the empty allow-list
-- and app.outbound_guard refuses again behind it. So applying this migration
-- still sends nothing.
--
-- WHY THE RELEASE MODES STAY DISABLED
--
-- Switching a function to Automated is an operational decision with a named
-- approver and a recorded reason, and RELEASE_CONTROL already exists to do it
-- properly from /dashboard/release. A migration that flipped it silently would
-- route around the person who is supposed to decide.
--
-- SO WHAT ACTUALLY HAPPENS AFTER THIS
--
-- Nothing, until a person does BOTH of these:
--
--   1. Set the allow-list on the database (never in git):
--        insert into public.settings
--          (key, typed_value, scope, version, effective_from, reason)
--        select 'outbound.allowed_recipients',
--               '["someone@example.co.uk"]'::jsonb, 'Global',
--               coalesce(max(version), 0) + 1, current_date,
--               'who we may email, agreed with the owner'
--        from public.settings
--        where key = 'outbound.allowed_recipients' and scope = 'Global';
--
--   2. Switch FN-03 and/or FN-04 to Automated from /dashboard/release.
--
-- Start with ONE address you control and watch it arrive before widening it.
-- The allow-list is the last thing standing between a bug and a merchant.
--
-- FN-18 and FN-20 are NOT part of this and never will be: their recorded
-- planned_target_mode is Manual, so app.outbox_claim refuses them whatever
-- these settings say. COMMUNICATION_RECORD_SENT remains their only route.
--
-- Settings rows are immutable - a change is a new version, and app.setting()
-- reads the highest version whose effective_from has arrived. So these are
-- inserts, not updates, and the previous values stay readable as history.
-- =============================================================================

-- The mailbox operational email is sent FROM, and where replies land. Chosen by
-- the owner, not guessed. It must be a real, monitored mailbox: merchants reply
-- to it, and a reply recorded in public.acknowledgements is the only evidence
-- of receipt this system will ever have. A transport response is submission.
insert into public.settings (key, typed_value, scope, version, effective_from, reason)
select 'email.from_mailbox', '"operations@simplesolarltd.co.uk"'::jsonb, 'Global',
       coalesce(max(s.version), 0) + 1, current_date,
       'Owner-supplied sending mailbox, neutral across FN-03 merchants and FN-04 scaffolders. Replies land here and are recorded as acknowledgements by a person.'
from public.settings s
where s.key = 'email.from_mailbox' and s.scope = 'Global';

-- Which adapter the worker loads. Nothing in the database branches on this; it
-- exists so the choice is recorded configuration rather than a deployment
-- detail nobody can find later.
insert into public.settings (key, typed_value, scope, version, effective_from, reason)
select 'email.transport', '"resend"'::jsonb, 'Global',
       coalesce(max(s.version), 0) + 1, current_date,
       'Resend, over its HTTP API. Send-only: it cannot search the sent mailbox, so the worker refuses to re-send a row marked reconcile_first and leaves it for a person.'
from public.settings s
where s.key = 'email.transport' and s.scope = 'Global';

-- The per-type live switch (app.outbox_action_types.live_setting). Anything
-- other than the exact string LIVE means due rows are reported and left
-- Pending. This alone sends nothing: the allow-list and the release mode are
-- both still shut.
insert into public.settings (key, typed_value, scope, version, effective_from, reason)
select 'email.mode', '"LIVE"'::jsonb, 'Global',
       coalesce(max(s.version), 0) + 1, current_date,
       'Email dispatch may proceed as far as the remaining gates allow. The allow-list is still empty and FN-03/FN-04 are still Disabled, so nothing can be claimed or sent yet.'
from public.settings s
where s.key = 'email.mode' and s.scope = 'Global';

-- public.release_modes is deliberately NOT touched here, not even to leave a
-- note. It is the RELEASE_CONTROL command's table, with its own version and
-- audit triggers; writing to it from a migration would bump that version under
-- a command that may be mid-flight, and would blur who decided what. The
-- decision, and the note explaining it, belong to whoever switches FN-03 or
-- FN-04 from /dashboard/release with a recorded reason.
