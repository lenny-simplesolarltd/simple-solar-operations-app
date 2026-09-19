-- =============================================================================
-- Task ownership for the R1 backend templates (booking, finance, install and
-- aftercare, cancellation, system/resilience).
--
-- Same model as 002: one active rule per template, resolved by stable person
-- identity (legacy_id -> uuid), never by row order or names. Owners follow the
-- reference: Tanya owns office work, Hannah reviews variations, Ben is the
-- escalation backup for the daily system checks and resilience alerts.
-- INS02 (lead installer) and the S15 cancellation tasks (the acting user) set
-- their owner explicitly and need no rule.
--
-- Repeatable: a template that already has an active rule is left alone.
-- =============================================================================

insert into public.task_assignment_rules (template_code, owner_person_id, backup_person_id, eligible_owner_roles, notes)
select t.code, o.id, b.id, v.roles, v.notes
from (values
  ('office', 'PERSON-tanya',  null,         array['Admin','Manager','Director','Office','VariationApprover'], null),
  ('variation', 'PERSON-hannah', null,      array['Admin','Manager','Director','Office','VariationApprover'], 'Variation review owner.'),
  ('system', 'PERSON-tanya',  'PERSON-ben', array['Admin','Manager','Director','Office','VariationApprover'], 'Daily checks and alerts; Ben is escalation backup.')
) as v (kind, owner_legacy_id, backup_legacy_id, roles, notes)
join public.task_templates t on case
    when t.code = 'ISS01' then 'variation'
    when t.code in ('SYS01', 'SYS02', 'RS-REVIEW', 'RS-ALERT') then 'system'
    else 'office' end = v.kind
join public.people o on o.legacy_id = v.owner_legacy_id
left join public.people b on b.legacy_id = v.backup_legacy_id
where t.code not in ('PRE01', 'PRE02', 'PRE03', 'PRE04', 'PRE05', 'INS02')
  and t.code not like 'S15-%'
  and not exists (select 1 from public.task_assignment_rules r where r.template_code = t.code and r.active);
