// Shared test fixture on the canonical identity/Job Sold schema:
// staff with linked logins, roles, task assignment rules for every template,
// R1 release modes, and helpers for commands, reads and sales.
import { fresh } from './harness.mjs';
import { randomUUID } from 'node:crypto';

export async function setup() {
  const db = await fresh();
  const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
  const all = async (sql, p = []) => (await db.query(sql, p)).rows;
  const people = {}, users = {};
  for (const [key, name, role, capacity] of [
    ['tanya', 'Tanya', 'Office'], ['hannah', 'Hannah', 'VariationApprover'], ['ben', 'Ben Quick', 'Admin'],
    ['dan', 'Dan', 'Director'], ['store', 'Store Owner', 'Store'], ['sam', 'Sam Surveyor', 'Surveyor'],
    ['inst_a', 'Installer A', 'Installer', 1], ['inst_b', 'Installer B', 'Installer', 1]]) {
    const email = `${key}@test.local`;
    const p = await one(`insert into public.people (legacy_id, email, display_name, capacity_per_day) values ($1,$2,$3,$4) returning id`,
      [`PERSON-${key}`, email, name, capacity ?? null]);
    await db.query(`insert into public.person_roles (person_id, role_code) values ($1,$2)`, [p.id, role]);
    const uid = randomUUID();
    // The identity foundation links a verified login to the person by email.
    await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1,$2,now())`, [uid, email]);
    people[key] = p.id; users[key] = uid;
  }
  // Explicit task ownership (Job Sold design): one active rule per template.
  const office = ['Admin', 'Manager', 'Director', 'Office', 'VariationApprover'];
  await db.query(`insert into public.task_assignment_rules (template_code, owner_person_id, backup_person_id, eligible_owner_roles)
    select t.code,
           case when t.code = 'PRE03' then $2::uuid when t.code = 'ISS01' then $3::uuid else $1::uuid end,
           case when t.code = 'PRE03' then $4::uuid when t.code in ('SYS01','SYS02','RS-REVIEW','RS-ALERT') then $2::uuid else null end,
           case when t.code = 'PRE03' then array['Admin','Manager','Director'] else $5::text[] end
    from public.task_templates t
    where not exists (select 1 from public.task_assignment_rules r where r.template_code = t.code and r.active)`,
    [people.tanya, people.ben, people.hannah, people.dan, office]);
  await db.query(`update public.release_modes set authorised_job_scope = 'Pilot',
    mode = case when function_id in ('FN-01','FN-14') then 'Automated' else 'Manual' end
    where target_release = 'R1'`);

  async function as(who) {
    const claims = who && users[who] ? { sub: users[who], email: `${who}@test.local`, role: 'authenticated' } : {};
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  }
  async function cmd(who, request) {
    await as(who);
    try { return (await db.query(`select public.execute_command($1::jsonb) r`, [request])).rows[0].r; }
    catch (e) { return { error: e.message, detail: e.detail }; }
  }
  async function read(who, request) {
    await as(who);
    try { return (await db.query(`select public.execute_read($1::jsonb) r`, [request])).rows[0].r; }
    catch (e) { return { error: e.message, detail: e.detail }; }
  }
  // Sell a job through the canonical Job Sold entry point.
  async function sell(who = 'tanya', over = {}) {
    await as(who);
    const payload = {
      customer: { first_name: 'Ann', last_name: 'Smith', address_line1: '1 High St', town: 'Leeds', postcode: 'LS1 1AA',
                  phone: '07700900001', ...(over.customer || {}) },
      sale: { salesperson_id: people.sam, finance_route: 'Standard', agreed_price_pence: 500000, ...(over.sale || {}) },
      scope: { roof_required: true, electrical_required: true, scaffold_required: true, ...(over.scope || {}) },
      design: {}, design_schema_version: 1, catalogue_version: 'test-1',
      computed: { system_kwp: 6.2, net_panels: 12, computed_total_pence: 500000, price_breakdown: [] } };
    try { return (await db.query(`select public.submit_presale($1::uuid, $2::jsonb) r`, [randomUUID(), payload])).rows[0].r; }
    catch (e) { return { error: e.message, detail: e.detail }; }
  }
  const id = () => randomUUID();
  const ok = (r, msg) => { if (!r || !r.ok) { console.log('FAILED:', msg, r); process.exit(1); } return r.result; };
  return { db, one, all, people, users, cmd, read, sell, as, id, ok };
}

// Sale -> ReadyToBook for a Standard job. Returns { job, jobRef }.
export async function readyToBook(f, over = {}) {
  const { one, cmd, id, ok, sell } = f;
  const task = async (job, code) => one(`select * from public.tasks where job_id=$1 and template_code=$2`, [job, code]);
  const sold = await sell('tanya', over);
  if (sold.error) { console.log('sale failed', sold); process.exit(1); }
  const job = sold.job_id;
  let t = await task(job, 'PRE01');
  ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'sent', invoice_number: 'INV-1', invoice_sent: true } }), 'pre01');
  t = await task(job, 'PRE02');
  ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'signed', contract_id: 'SIG-1', contract_signed: true, evidence_path: `${job}/contract.pdf` } }), 'pre02');
  t = await task(job, 'PRE04');
  ok(await cmd('tanya', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'ok', customer_details_verified: true, sold_value_verified: true, verified_gross_amount: 5000 } }), 'pre04');
  t = await task(job, 'PRE03');
  const r = ok(await cmd('ben', { command_id: id(), command_type: 'TASK_COMPLETE', task_id: t.id, expected_version: t.version, payload: { completion_note: 'received', deposit_bank_confirmed: true, deposit_amount: '1250', deposit_received_date: '2026-09-02', deposit_bank_reference: 'BANK-1' } }), 'pre03');
  if (r.job.workflow_stage !== 'ReadyToBook') { console.log('not ready', JSON.stringify(r.readiness)); process.exit(1); }
  return { job, jobRef: sold.job_ref };
}
