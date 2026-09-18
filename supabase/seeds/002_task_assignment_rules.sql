-- =============================================================================
-- Task ownership for the Presale / Job Sold flow.
--
-- Explicit and deterministic: one active rule per template, resolved by stable
-- person identity (legacy_id -> uuid). Nothing here depends on row order, names
-- or "the first Office person". Admin-editable in the app; a change never
-- touches tasks that already exist (tasks snapshot their owner).
--
-- Repeatable: a template that already has an active rule is left alone.
-- =============================================================================

insert into public.task_assignment_rules (template_code, owner_person_id, backup_person_id, eligible_owner_roles, notes)
select v.template_code, o.id, b.id, v.roles, v.notes
from (values
  ('PRE01', 'PERSON-tanya', null,         array['Admin','Manager','Director','Office','VariationApprover'], null),
  ('PRE02', 'PERSON-tanya', null,         array['Admin','Manager','Director','Office','VariationApprover'], null),
  ('PRE03', 'PERSON-ben',   'PERSON-dan', array['Admin','Manager','Director'], 'Named personal responsibility for bank confirmation.'),
  ('PRE04', 'PERSON-tanya', null,         array['Admin','Manager','Director','Office','VariationApprover'], null),
  ('PRE05', 'PERSON-tanya', null,         array['Admin','Manager','Director','Office','VariationApprover'], 'Provisional until the finance workflow is ported.')
) as v (template_code, owner_legacy_id, backup_legacy_id, roles, notes)
join public.people o on o.legacy_id = v.owner_legacy_id
left join public.people b on b.legacy_id = v.backup_legacy_id
where not exists (
  select 1 from public.task_assignment_rules r where r.template_code = v.template_code and r.active
);
