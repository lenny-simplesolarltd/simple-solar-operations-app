-- =============================================================================
-- DEV / ACCEPTANCE ONLY: a commissioning form so the R3 installer and review
-- flow can be exercised.
--
-- WHY THIS IS DEV DATA: the reference system never had production
-- commissioning forms either - it carried one synthetic template in its DEV
-- fixture (s12/fixture.js: TPL-COM-ROOF with panel count, inverter model and a
-- photo). The real questions are business content Simple Solar must decide, and
-- staff cannot create templates in the app (commissioning_templates is
-- read-only to every role; only a migration, a seed or the service role
-- writes it).
--
-- Until the business supplies the real forms, COMMISSIONING_REVIEW cannot
-- Accept anything, because app.iw_approved_template finds no approved template
-- for the trade. This seed installs one approved template per commissioning
-- trade, clearly marked DEV-ACCEPTANCE, so the workflow can be tested.
--
-- Remove before real use:
--   delete from public.commissioning_questions where template_id in
--     (select id from public.commissioning_templates where template_version = 'DEV-ACCEPTANCE-1.0');
--   delete from public.commissioning_templates where template_version = 'DEV-ACCEPTANCE-1.0';
--
-- This does NOT disturb R1. The R1 office route (COMMISSIONING_RECORD) keeps
-- its own per-trade template, equipment_type 'OfficeRecordedEvidence', which
-- app.s12_ensure_r1_office_template deliberately leaves unapproved so office
-- evidence is never mistaken for a technical review. The template below is a
-- separate row: a different equipment_type, approved, for the R3 route only.
-- Only one approved template per trade may be active, or
-- app.iw_approved_template fails R1C_TEMPLATE_AMBIGUOUS - so do not add a
-- second one alongside this.
--
-- Repeatable: matched by (trade, equipment_type, template_version).
-- =============================================================================

insert into public.commissioning_templates (trade, equipment_type, template_version, effective_from, active,
                                            approved_by, approved_at)
select v.trade, 'DevAcceptance', 'DEV-ACCEPTANCE-1.0', current_date, true,
       (select p.id from public.people p where p.legacy_id = 'PERSON-lenny-dev'), now()
from (values ('Roof'), ('Electrical')) as v (trade)
where exists (select 1 from public.people p where p.legacy_id = 'PERSON-lenny-dev')
  and not exists (select 1 from public.commissioning_templates t
                  where t.trade = v.trade and t.equipment_type = 'DevAcceptance'
                    and t.template_version = 'DEV-ACCEPTANCE-1.0');

insert into public.commissioning_questions (template_id, question_key, label, data_type, required_when,
                                            photo_category, display_order, help_text)
select t.id, v.question_key, v.label, v.data_type, v.required_when, v.photo_category, v.display_order,
       'DEV acceptance question - replace with the real commissioning form.'
from public.commissioning_templates t
cross join (values
  ('panel_count',    'Number of panels installed', 'number', 'always', null,         1),
  ('inverter_model', 'Inverter model',             'text',   'always', null,         2),
  ('install_photo',  'Photo of the finished work', 'photo',  null,     'Completion', 3)
) as v (question_key, label, data_type, required_when, photo_category, display_order)
where t.template_version = 'DEV-ACCEPTANCE-1.0'
  and not exists (select 1 from public.commissioning_questions q
                  where q.template_id = t.id and q.question_key = v.question_key);
