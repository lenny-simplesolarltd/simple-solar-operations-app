-- =============================================================================
-- Backend port: reference configuration the backend runs on.
--
-- Source: reference schema/config-seed.json (TaskTemplates, ReleaseModes,
-- Settings) plus the templates the reference code creates or requires outside
-- the seed (ISS01/ISS02, REM01, INS04, S13, S15-*, RS-*, S06-UNPAID-INTERIM)
-- and the S11 move-impact codes. PRE01-PRE05 already exist (Job Sold).
--
-- Canonical task_templates: due_rule is machine-readable (at_creation /
-- next_staffed_day / none) and only drives app.create_task; the R1
-- generators set their own reference due dates. guidance = the reference
-- evidence_required text (display only).
--
-- Every release mode ships Disabled with scope None, exactly as the reference:
-- nothing runs until an administrator enables the functions. Task ownership
-- needs a task_assignment_rules row per template (see supabase/seeds).
-- =============================================================================

insert into public.task_templates (code, title, task_group, default_priority, due_rule, guidance, template_version) values
  ('BKG01', 'Prepare booking', 'Booking', 2, 'none', 'Survey, presale, extras, board capacity', '1.0'),
  ('BKG02', 'Book dates and allocations', 'Booking', 2, 'none', 'Customer contact outcome and installer/scaffold allocations', '1.0'),
  ('BKG03', 'Reconcile booking response', 'Booking', 2, 'none', 'Value/contact match or approved documented changes', '1.0'),
  ('BKG04', 'Send customer booking email', 'Booking', 2, 'at_creation', 'Approved message and sent record', '1.0'),
  ('BKG05', 'Check calendar events and document pack', 'Booking', 2, 'at_creation', 'Event links and required survey/design/schematic/shutdown documents', '1.0'),
  ('MAT01', 'Place material order', 'Materials', 1, 'none', 'Order lines, delivery date, sent reference', '1.0'),
  ('MAT02', 'Verify already-ordered materials', 'Materials', 1, 'at_creation', 'Supplier confirmation of reference/date/quantities; no duplicate order', '1.0'),
  ('MAT03', 'Reserve and pick stock', 'Materials', 1, 'none', 'Quantities and location; short or damaged goods create a separate action', '1.0'),
  ('MAT04', 'Receive and check delivery', 'Materials', 1, 'none', 'Good/damaged/short quantities and delivery note', '1.0'),
  ('MAT05', 'Friday merchant expected-delivery lists', 'Materials', 1, 'none', 'Reviewed/sent snapshot for next Thursday', '1.0'),
  ('MAT06', 'Merchant confirmation of latest revision', 'Materials', 1, 'none', 'Acknowledgement of latest revision', '1.0'),
  ('SCA01', 'Notify and confirm scaffolder erect', 'Materials', 1, 'none', 'Latest revision confirmed', '1.0'),
  ('SCA02', 'Confirm scaffold erected', 'Scaffold', 1, 'none', 'Actual erect date or delay task', '1.0'),
  ('SCA03', 'Book scaffold strip', 'Scaffold', 1, 'next_staffed_day', 'Strip date/company plus instruction and confirmation', '1.0'),
  ('SCA04', 'Confirm scaffold stripped', 'Scaffold', 1, 'none', 'Actual removal evidence or chase task', '1.0'),
  ('SCA05', 'Friday scaffolder erect/strip list', 'Scaffold', 1, 'none', 'Sent snapshot per company and acknowledgement task', '1.0'),
  ('INS01', 'Installer confirmation call', 'Install', 1, 'next_staffed_day', 'Complete/return/unknown outcome with actual date', '1.0'),
  ('INS02', 'Missing commissioning reminder', 'Install', 1, 'none', 'Submitted evidence or reminder follow-up', '1.0'),
  ('FIN01', 'Interim draft check/send', 'Finance', 1, 'none', 'Confirmed invoice status', '1.0'),
  ('FIN03', 'Balance invoice authorise/send', 'Finance', 1, 'at_creation', 'Confirmed invoice and send result', '1.0'),
  ('GHL01', 'Move GHL opportunity', 'Aftercare', 1, 'next_staffed_day', 'Pipeline/stage and action evidence', '1.0'),
  ('SYS01', 'Check authorisation/integration health', 'System', 1, 'none', 'Last-success timestamps, failures assigned', '1.0'),
  ('SYS02', 'End-of-day review', 'System', 1, 'none', 'Unresolved actions assigned', '1.0'),
  ('S06-UNPAID-INTERIM', 'Chase unpaid interim payment', 'Finance', 1, 'next_staffed_day', 'Payment chase outcome', 'S06-1.0'),
  ('S13-GHL-PROGRESSION', 'Move GHL opportunity (human task)', 'Aftercare', 2, 'none', 'Pipeline/stage and action evidence', 'S13-1.0'),
  ('INS04', 'Customer happy call', 'Aftercare', 1, 'next_staffed_day', 'Customer outcome recorded', 'R1A-1.0'),
  ('REM01', 'Arrange remedial return visit', 'Aftercare', 1, 'next_staffed_day', 'Return visit booked', 'R1A-1.0'),
  ('ISS01', 'Review variation', 'Aftercare', 1, 'next_staffed_day', 'Issue outcome', 'R1A-1.0'),
  ('ISS02', 'Investigate and resolve issue', 'Aftercare', 1, 'next_staffed_day', 'Issue outcome', 'R1A-1.0'),
  ('S11-MOVE-ASSIGNED-PEOPLE', 'Tell assigned installers about the new dates', 'Install', 1, 'at_creation', 'Installer informed', 'S11-1.0'),
  ('S11-MOVE-CALENDAR', 'Update the calendar entry for the moved work', 'Booking', 1, 'at_creation', 'Calendar entry updated', 'S11-1.0'),
  ('S11-MOVE-MATERIALS', 'Check material delivery for the moved work', 'Materials', 1, 'at_creation', 'Delivery date confirmed', 'S11-1.0'),
  ('S11-MOVE-SCAFFOLD', 'Re-confirm scaffold dates', 'Materials', 1, 'at_creation', 'Scaffolder confirmation', 'S11-1.0'),
  ('S11-MOVE-CUSTOMER-NOTICE', 'Tell the customer about the new dates', 'Booking', 1, 'at_creation', 'Customer informed', 'S11-1.0'),
  ('S11-MOVE-INTERIM-INVOICE', 'Review interim invoice timing after the move', 'Finance', 1, 'at_creation', 'Invoice timing reviewed', 'S11-1.0'),
  ('S15-CAN-CUSTOMER', 'Notify customer using reviewed cancellation message', 'Cancellation', 1, 'at_creation', 'Reviewed message and sent record', 'S15-1.0'),
  ('S15-CAN-INSTALLER', 'Notify installer and cancel future commitment', 'Cancellation', 1, 'at_creation', 'Installer notified', 'S15-1.0'),
  ('S15-CAN-MERCHANT', 'Merchant confirmed latest cancellation and goods disposition', 'Cancellation', 1, 'at_creation', 'Merchant confirmation of latest revision', 'S15-1.0'),
  ('S15-CAN-SCAFFOLD', 'Scaffolder acknowledged cancellation', 'Cancellation', 1, 'at_creation', 'Scaffolder acknowledgement of latest revision', 'S15-1.0'),
  ('S15-CAN-STRIP', 'Arrange safe strip and confirm actual removal', 'Cancellation', 1, 'at_creation', 'Actual strip date', 'S15-1.0'),
  ('S15-CAN-CALENDAR', 'Reconcile Calendar removal using retained event ID', 'Cancellation', 1, 'at_creation', 'Calendar removal confirmed', 'S15-1.0'),
  ('S15-CAN-STOCK', 'Review goods: receive, hold, return or reallocate; retain actual cost', 'Cancellation', 1, 'at_creation', 'Goods disposition', 'S15-1.0'),
  ('S15-CAN-XERO', 'Review/cancel Xero invoice', 'Cancellation', 1, 'at_creation', 'Invoice review outcome', 'S15-1.0'),
  ('S15-CAN-FINANCE', 'Review finance obligations and existing payment route', 'Cancellation', 1, 'at_creation', 'Finance review outcome', 'S15-1.0'),
  ('S15-CAN-SIGNABLE', 'Cancel/amend Signable contract with evidence', 'Cancellation', 1, 'at_creation', 'Contract cancellation evidence', 'S15-1.0'),
  ('S15-CAN-PHOENIX', 'Review Phoenix agreement and evidence obligations', 'Cancellation', 1, 'at_creation', 'Agreement review outcome', 'S15-1.0'),
  ('S15-CAN-GHL', 'Record human GHL cancellation stage action', 'Cancellation', 1, 'at_creation', 'GHL stage action', 'S15-1.0'),
  ('S15-CAN-SALES', 'Notify salesperson of cancellation', 'Cancellation', 1, 'at_creation', 'Salesperson notified', 'S15-1.0'),
  ('S15-CAN-LEGACY', 'Close retained paper, Trello and whiteboard records', 'Cancellation', 1, 'at_creation', 'Legacy records closed', 'S15-1.0'),
  ('S15-CAN-REVIEW', 'Review partial work, retained evidence and unresolved obligations', 'Cancellation', 1, 'at_creation', 'Review outcome', 'S15-1.0'),
  ('S15-REOPEN-REVIEW', 'Review fresh planning and invoice/order reuse before booking', 'Cancellation', 1, 'at_creation', 'Reopen review outcome', 'S15-1.0'),
  ('RS-REVIEW', 'Review uncertain outbound outcome', 'System', 1, 'at_creation', 'External outcome confirmed', 'RS-1.0'),
  ('RS-ALERT', 'Integration failure alert', 'System', 1, 'at_creation', 'Failure assigned and resolved', 'RS-1.0')
on conflict (code) do nothing;

insert into public.release_modes (function_id, function_name, mode, mode_record_basis, authorised_job_scope, target_release,
                                  planned_target_mode, current_system, fallback, scope_boundary_notes) values
  ('FN-01', 'Office core/intake/tasks/planners/calls/issues', 'Disabled', 'S02 initial schema; no live configuration', 'None', 'R1', 'Automated', 'Current office processes', 'Owned manual office actions', 'Split per actual function/producer/job-package scope at activation'),
  ('FN-02', 'Calendar entries', 'Disabled', 'S02 initial schema', 'None', 'R2', 'Automated', 'Existing Jotform producer', 'Existing route; R1 manual tasks', 'R2 tested adapter; reconcile IDs before restart'),
  ('FN-03', 'Orders and merchant messages', 'Disabled', 'S02 initial schema', 'None', 'R2', 'Automated', 'Existing ordering/email route', 'Owned existing order/revision/confirmation tasks', 'R2 order/delivery workflow with latest-revision confirmation'),
  ('FN-04', 'Scaffold commitments', 'Disabled', 'S02 initial schema', 'None', 'R2', 'Automated', 'Existing shared scaffold sheet', 'Existing sheet with tracked updates', 'R2 integrated scaffold workflow'),
  ('FN-05', 'Panel stock balances/movements', 'Disabled', 'S02 initial schema', 'None', 'R2', 'Automated', 'Existing physical/store records', 'Continue manual stock', 'R2 full covered-location ledger'),
  ('FN-06', 'Installer app/forms access', 'Disabled', 'S02 initial schema', 'None', 'R3', 'Automated', 'Existing installer process/forms', 'Current documented forms/evidence route', 'R3 only after commissioning amendment and security tests'),
  ('FN-07', 'Commissioning receipt/review', 'Disabled', 'S02 initial schema', 'None', 'R3', 'Automated', 'Current forms/files and company review', 'Keep in-progress jobs on original capture route', 'R3 at recorded job/package/form-version boundary'),
  ('FN-08', 'Handover', 'Disabled', 'S02 initial schema', 'None', 'R3', 'Automated', 'Existing complete handover process', 'Existing complete pack with owner and sent version', 'R3 accepted replacement; PDF separately accepted/deferred'),
  ('FN-09', 'Invoices and payment reconciliation', 'Disabled', 'S02 initial schema', 'None', 'R4', 'Automated', 'Existing authorised Zapier/Xero route', 'Existing authorised route after reconciliation', 'R4 tested invoice/payment adapters; adopt existing IDs'),
  ('FN-10', 'Phoenix evidence/upload/chase', 'Disabled', 'S02 initial schema', 'None', 'R4', 'Manual', 'Existing Phoenix route/agreement', 'Current approved agreement/evidence route', 'R4 integration extends supported finance functions'),
  ('FN-11', 'GHL progression/messages', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Existing GHL workflow', 'Owned human task; record outcome', 'Remains Manual in every release'),
  ('FN-12', 'Accounting/reporting', 'Disabled', 'S02 initial schema', 'None', 'R4', 'Automated', 'Existing finance/reporting processes', 'Existing reviewed reports; retain snapshots', 'R4 approved mapped accounts/tax/recognition/cost'),
  ('FN-13', 'Archive', 'Disabled', 'S02 initial schema', 'None', 'R4', 'Automated', 'New system retains active records', 'Retain active records, hide completed tasks by views', 'R4 tested six-month obligation/restore workflow'),
  ('FN-14', 'Automated backup/restore and health monitoring', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Automated', 'Existing monitoring/recovery details to inventory', 'Named manual health checks', 'R1 demonstrated backup/restore, alerts, last-success'),
  ('FN-15', 'Bank deposit confirmation', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Existing secure bank check', 'Authenticated recorded manual confirmation', 'Track current authorised manual action from R1'),
  ('FN-16', 'Daily authorisation/health and outage review', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Existing company health route', 'Manual dashboard/outage check', 'Track current authorised manual action from R1'),
  ('FN-17', 'GHL cancellation', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Existing authorised GHL cancellation route', 'Human cancellation task', 'Track current authorised manual action from R1'),
  ('FN-18', 'Manual missing-form reminder', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Current installer contact/evidence route', 'Tanya sends/records two-working-day reminder', 'Track current authorised manual action from R1'),
  ('FN-19', 'Operational completion approval', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Current approved evidence/reviewer process', 'Human approval only after required work/evidence/customer/blocker gates', 'Track current authorised manual action from R1'),
  ('FN-20', 'Customer and installer notices', 'Disabled', 'S02 initial schema', 'None', 'R1', 'Manual', 'Existing approved communication route', 'R1 tracked manual sends/outcomes', 'Track current authorised manual action from R1')
on conflict (function_id) do nothing;

insert into public.settings (key, typed_value, scope, version, effective_from, reason) values
  ('office.timezone', '"Europe/London"'::jsonb, 'Global', 1, '2026-01-01', 'Specification default'),
  ('office.staffed_weekdays', '[1,2,3,4,5]'::jsonb, 'Global', 1, '2026-01-01', 'Specification default: Monday–Friday'),
  ('office.hours', '{"start":"09:00","end":"17:00"}'::jsonb, 'Global', 1, '2026-01-01', 'Specification default'),
  ('products.panel_lead_days', '14'::jsonb, 'Global', 1, '2026-01-01', 'Specification default'),
  ('finance.interim_send_lead_days', '7'::jsonb, 'Global', 1, '2026-01-01', 'Specification default'),
  ('finance.deposit_pct', '25'::jsonb, 'Global', 1, '2026-01-01', 'Specification default'),
  ('finance.interim_pct', '35'::jsonb, 'Global', 1, '2026-01-01', 'Specification default'),
  ('finance.balance_pct', '40'::jsonb, 'Global', 1, '2026-01-01', 'Specification default')
on conflict (key, scope, version) do nothing;
