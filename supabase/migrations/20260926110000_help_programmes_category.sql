-- =============================================================================
-- A Help Center category for Programmes.
--
-- The Help Center shipped with fourteen categories and no home for programme
-- work, which meant the whole of PCH - importing a property register, the
-- board, recording and reviewing a visit, and the reports that go to the
-- client - had nowhere to be documented. Staff asking SimpleBot "how do I
-- review a visit" got nothing back, because there was nothing to find.
--
-- Placed after Commissioning and before Materials: it belongs with the
-- operational work rather than with administration.
--
-- ROLLBACK:
--   begin;
--   delete from public.help_categories where code = 'programmes';
--   commit;
-- =============================================================================

insert into public.help_categories (code, title, description, icon, sort_order) values
  ('programmes', 'Programmes',
   'Property programmes: importing the list, the board, visits, review and reports.',
   'programmes', 85)
on conflict (code) do update set
  title = excluded.title,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order;
