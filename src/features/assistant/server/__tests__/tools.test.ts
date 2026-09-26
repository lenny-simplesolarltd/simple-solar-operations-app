import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getOpenTasks = vi.fn();
const getJobDetail = vi.fn();
const searchVisibleJobs = vi.fn();
vi.mock('@/features/jobs/server/queries', () => ({
  OPEN_TASK_STATUSES: ['Open', 'Waiting', 'InProgress', 'Blocked'],
  getOpenTasks: () => getOpenTasks(),
  getJobDetail: (id: string) => getJobDetail(id)
}));
vi.mock('@/features/jobs/server/search', () => ({
  searchVisibleJobs: (q: string) => searchVisibleJobs(q)
}));

import { resolveToolCall } from '../registry';
import { createToolRegistry } from '../tools';
import { JOB_ID, makeActor, OTHER_PERSON, THREAD } from './helpers';

const registry = createToolRegistry();

async function call(name: string, args: unknown, actor = makeActor()) {
  const resolved = resolveToolCall(registry, actor, name, args);
  if (!resolved.ok) return resolved;
  if (resolved.tool.kind !== 'read') throw new Error('expected a read tool');
  return resolved.tool.execute(resolved.input, { actor, threadId: THREAD });
}

const task = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  code: 'PRE01',
  title: 'Check the sale',
  status: 'Open',
  priority: 2,
  dueAt: null,
  blockingReason: null,
  ownerId: OTHER_PERSON,
  ownerName: 'Someone Else',
  backupId: null,
  backupName: null,
  jobId: JOB_ID,
  jobRef: 'SS-TEST-0001',
  jobName: 'Parton',
  ...over
});

beforeEach(() => {
  getOpenTasks.mockReset();
  getJobDetail.mockReset();
  searchVisibleJobs.mockReset();
});

describe('the production registry', () => {
  it('exposes read tools, and mutations only for Forms, bulk task work, filing and contact corrections (each a confirmed proposal)', () => {
    const available = registry.all().filter((t) => t.status === 'available');
    expect(
      available
        .filter((t) => t.kind === 'read')
        .map((t) => t.name)
        .sort()
    ).toEqual([
      'compare_quote_revisions',
      'email_templates',
      'explain_programme_import',
      'find_customer',
      'find_job',
      'get_current_quote',
      'get_customer_contact',
      'get_form',
      'get_form_access',
      'get_form_response',
      'get_generated_documents',
      'get_help_article',
      'get_help_for_route',
      'get_job',
      'get_job_blockers',
      'get_job_tasks',
      'get_job_timeline',
      'get_my_tasks',
      'get_operation_status',
      'get_presale_workflow',
      'get_quote_versions',
      'get_related_help',
      'get_team_tasks',
      'list_file_folders',
      'list_form_responses',
      'list_forms',
      'list_job_files',
      'list_job_operations',
      'list_people',
      'list_programme_imports',
      'plan_task_action',
      'programme_capabilities',
      'programme_daily_report',
      'programme_list',
      'programme_property_get',
      'programme_property_search',
      'programme_summary',
      'programme_visit_evidence',
      'programme_visit_get',
      'programme_visit_search',
      'programme_visit_submit_status',
      'report_preview',
      'report_schedule',
      'search_files',
      'search_help_articles'
    ]);
    const mutations = available.filter((t) => t.kind === 'mutation');
    expect(mutations.map((t) => t.name).sort()).toEqual([
      'apply_programme_import',
      'attach_task_evidence',
      'complete_tasks',
      'create_file_folder',
      'create_form',
      'create_form_link',
      'create_presale',
      'discard_programme_import',
      'edit_form_draft',
      'email_send',
      'email_template_set',
      'generate_document_pack',
      'message_colleague',
      'move_files_to_folder',
      'move_job',
      'override_complete_tasks',
      'programme_review_visit',
      'programme_visit_submit',
      'publish_form',
      'raise_issue',
      'reopen_tasks',
      'report_recipients_change',
      'report_schedule_delete',
      'report_schedule_set',
      'report_send',
      'retry_operation',
      'revise_quote',
      'revoke_form_link',
      'save_form_as_template',
      'set_form_access',
      'set_form_status',
      'set_lead_source',
      'update_customer_contact'
    ]);
    // Every mutation is an adapter over something the app already exposes:
    // the Forms service, the task batch command the Tasks screen submits, or
    // the file-manager commands the Files screen calls.
    for (const tool of mutations) {
      expect([
        'forms',
        'tasks',
        'evidence',
        'customers',
        'jobs',
        'calendar',
        // Messaging a colleague (CHAT_START + CHAT_SEND) and writing email
        // from the office mailbox (ADHOC_EMAIL_SEND) - each the same command
        // the matching screen calls. Chat cannot leave the company; email can,
        // which is why FN-24 gates it and a person confirms every card.
        'communications',
        'presales',
        // Programme review, the installer's visit workflow, and applying a
        // staged property import - each the same command the screens call.
        'programmes',
        // Scheduling a report and sending one by hand: REPORT_SUBSCRIPTION_SET
        // and REPORT_SEND, the same commands the reports screen calls. Neither
        // delivers anything - the outbox and its gates still decide that.
        'reporting',
        // Generating a customer document: DOCUMENT_GENERATE, the same command
        // the Documents card's Generate button calls. It queues a revision and
        // sends nothing to anyone.
        'documents'
      ]).toContain(tool.domain);
      // Correcting contact details and lead source is CUSTOMER_UPDATE /
      // JOB_SALE_UPDATE (migration 20260920270000). Each asks for its own
      // permission up front; the command re-checks it whatever this says.
      if (tool.name === 'update_customer_contact') {
        expect(tool.authorization.permissions).toEqual(['customer.edit']);
      }
      if (tool.name === 'set_lead_source') {
        expect(tool.authorization.permissions).toEqual(['job.sale.edit']);
      }
      // Recording a sale creates a customer, a job and its tasks, and cannot
      // be undone. It asks for the same permission the wizard does.
      if (tool.name === 'create_presale') {
        expect(tool.authorization.permissions).toEqual(['presale.submit']);
      }
      if (tool.domain === 'evidence') {
        // Nothing that removes a document is offered to the model, whatever
        // else an evidence mutation does.
        expect(tool.name).not.toMatch(/trash|delete|purge|destroy/);
        // Filing is the file-manager commands, and asks for their permission.
        // attach_task_evidence is not filing: it is TASK_EVIDENCE_ATTACH on
        // PRE02, gated by role and by the task's own attachability, and it
        // moves no file. It is named here so a NEW evidence mutation still
        // has to argue for its exemption rather than inherit this one.
        if (tool.name !== 'attach_task_evidence') {
          expect(tool.authorization.permissions).toContain('file.manage');
        }
      }
      if (tool.domain === 'forms') {
        expect(
          tool.authorization.permissions.some((p) => p.startsWith('forms.'))
        ).toBe(true);
      }
    }
    // The one bulk action that needs its own permission asks for it up front;
    // the batch command re-checks it per item whatever this says.
    expect(
      mutations.find((t) => t.name === 'override_complete_tasks')?.authorization
        .permissions
    ).toEqual(['task.read.all', 'task.override_complete']);
  });

  it('builds the quote and document capabilities rather than leaving them planned', () => {
    // These were the last entries in planned.ts. Each is now a real tool over
    // an operation the application already exposes - PRESALE_VERSIONS,
    // JOB_DOCUMENTS, DOCUMENT_GENERATE, TASK_EVIDENCE_ATTACH - so a staff
    // member is no longer told "not available yet" about something the app
    // does.
    for (const name of [
      'find_customer',
      'get_current_quote',
      'compare_quote_revisions',
      'get_generated_documents',
      'generate_document_pack',
      'attach_task_evidence'
    ]) {
      const tool = registry.get(name);
      expect(tool?.status, name).toBe('available');
      expect(tool && 'execute' in tool, name).toBe(true);
    }
    // The draft-then-approve quote workflow BD-05 proposed is retired, not
    // built: presales are append-only, so there is no draft to edit and no
    // approval gate. revise_quote is the amendment.
    for (const name of [
      'create_quote_amendment',
      'update_quote_draft',
      'approve_quote_revision',
      'get_quote_history'
    ]) {
      expect(registry.get(name), name).toBeUndefined();
      expect(
        resolveToolCall(registry, makeActor({ roles: ['Admin'] }), name, {})
      ).toMatchObject({ ok: false, code: 'UNKNOWN_TOOL' });
    }
    // Nothing is left claiming to be planned.
    expect(registry.planned().map((t) => t.name)).toEqual([]);
  });

  it('has no tool that accepts an identity or arbitrary query', () => {
    const identity =
      /actor|person_?id|submitted_?by|permission|sql|query_text/i;
    // "role" is banned too, because a tool that accepts one could be letting
    // the model claim the actor's authority. Two tools name roles as DATA
    // rather than as a claim: set_form_access configures which roles a form
    // appears for, exactly as the editor's checkboxes do, and list_people
    // filters the directory by one ("who are the surveyors"). Neither says
    // anything about who is ASKING - that stays with ctx.actor, and the
    // database returns only what that person may see either way. They are
    // listed here by name so a new tool with a role field still fails this
    // test, and so the exception has to be argued for rather than inherited.
    const rolesAreConfiguration = new Set(['set_form_access', 'list_people']);
    for (const tool of registry.all()) {
      if (tool.status !== 'available') continue;
      const schema = JSON.stringify(
        (
          tool.inputSchema as { toJSONSchema?: () => unknown }
        ).toJSONSchema?.() ?? {}
      );
      // Every tool, without exception: nothing may accept an identity.
      expect(schema, tool.name).not.toMatch(identity);
      if (!rolesAreConfiguration.has(tool.name))
        expect(schema, tool.name).not.toMatch(/role/i);
    }
    // And the exception really is configuration: it decides who a FORM is for,
    // never who the caller is. Authority stays with ctx.actor and the command.
    const exception = registry.get('set_form_access');
    expect(exception?.status).toBe('available');
    expect(
      exception && 'authorization' in exception
        ? exception.authorization.permissions
        : []
    ).toContain('forms.edit');
  });
});

describe('read tools defer to the application’s own authorization', () => {
  it('reports a job hidden by RLS as not found, without guessing', async () => {
    getJobDetail.mockResolvedValue(null);
    expect(await call('get_job', { jobId: JOB_ID })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND'
    });
    expect(await call('get_job_tasks', { jobId: JOB_ID })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND'
    });
    expect(getJobDetail).toHaveBeenCalledWith(JOB_ID);
  });

  it('"my tasks" means the server-resolved actor - the model cannot ask for someone else', async () => {
    const me = makeActor();
    getOpenTasks.mockResolvedValue([
      task({ code: 'PRE01', ownerId: me.user.id, ownerName: 'Tanya Office' }),
      task({ code: 'PRE02', backupId: me.user.id }),
      task({ code: 'PRE03' })
    ]);

    const result = await call('get_my_tasks', {}, me);
    expect(result).toMatchObject({ ok: true });
    const codes = (
      result as { data: { tasks: { code: string }[] } }
    ).data.tasks.map((t) => t.code);
    expect(codes).toEqual(['PRE01', 'PRE02']);

    expect(
      await call('get_my_tasks', { personId: OTHER_PERSON }, me)
    ).toMatchObject({
      ok: false,
      code: 'INVALID_ARGUMENTS'
    });
  });

  it('team tasks require task.read.all', async () => {
    getOpenTasks.mockResolvedValue([task({ ownerName: 'Tanya Office' })]);
    expect(await call('get_team_tasks', { ownerName: 'Tanya' })).toMatchObject({
      ok: false,
      code: 'PERMISSION_DENIED'
    });
    expect(getOpenTasks).not.toHaveBeenCalled();

    const allowed = makeActor({ permissions: ['task.read.all'] });
    expect(
      await call('get_team_tasks', { ownerName: 'tanya' }, allowed)
    ).toMatchObject({
      ok: true,
      data: { total: 1 }
    });
  });

  it('keeps customer contact details out of what the model reads', async () => {
    getJobDetail.mockResolvedValue({
      job: {
        id: JOB_ID,
        job_ref: 'SS-TEST-0001',
        workflow_stage: 'Presale',
        sold_at: '2026-09-01T10:00:00Z',
        finance_route: 'Standard',
        original_gross_pence: 1250000,
        current_contract_gross_pence: 1250000,
        lead_source: null,
        quote_reference: 'Q-1',
        roof_required: true,
        electrical_required: false,
        scaffold_required: true,
        version: 3,
        customers: {
          first_name: 'Pat',
          last_name: 'Parton',
          address_line1: '1 High Street',
          address_line2: null,
          town: 'Leeds',
          postcode: 'LS1 1AA',
          phone: '07700900123',
          email: 'pat@example.test'
        },
        presales: [
          {
            system_kwp: 4.35,
            net_panels: 10,
            catalogue_version: '2026.1',
            roof_notes: null,
            electrical_notes: null
          }
        ],
        salesperson: { display_name: 'Rick Surveyor' }
      },
      tasks: [task({ status: 'Blocked', blockingReason: 'Awaiting DNO' })]
    });

    const result = await call('get_job', { jobId: JOB_ID });
    const text = JSON.stringify((result as { data: unknown }).data);
    expect(text).toContain('Pat Parton');
    expect(text).not.toContain('07700900123');
    expect(text).not.toContain('pat@example.test');
    expect(text).not.toContain('1 High Street');
    expect(result).toMatchObject({
      ok: true,
      display: { kind: 'job_summary', taskCounts: { open: 1, blocked: 1 } }
    });
  });

  it('find_job renders job cards and says when nothing visible matched', async () => {
    searchVisibleJobs.mockResolvedValue({ hits: [], total: 0 });
    const none = await call('find_job', { query: 'Miss Parton' });
    expect(none).toMatchObject({
      ok: true,
      display: { kind: 'job_list', jobs: [] }
    });
    expect(JSON.stringify((none as { data: unknown }).data)).toMatch(
      /may not have access/
    );
  });
});
