// Correcting a customer's contact details, and a job's lead source. Run:
//   node t_customer_contact.mjs        (needs PORT_ALL=1; the runner sets it)
//
// Until migration 20260920270000 there was no way to do either. public.customers
// carried a SELECT policy and nothing else, so a phone number captured at
// intake was permanent, and staff asking the assistant to fix one were told it
// had no tool for it - correctly, because no such capability existed anywhere.
//
// What these assertions are really protecting is the NARROWNESS of the fix.
// It would have been easy to add a general "update the job" command and hand
// it to an assistant. Instead CUSTOMER_UPDATE reaches four contact fields and
// JOB_SALE_UPDATE reaches one, and the things a sentence must never change -
// who the customer is, where they live, what they agreed to pay - are refused
// by the payload allow-list itself rather than by anybody's good intentions.
import assert from 'node:assert/strict';
import { setup } from './fixtures.mjs';

const f = await setup();
const { db, one, all, people, cmd, id, ok, sell } = f;

const sold = await sell('tanya');
if (sold.error) { console.log('sale failed', sold); process.exit(1); }
const JOB = sold.job_id;

const job = () => one(`select * from public.jobs where id=$1`, [JOB]);
const customer = () =>
  one(`select c.* from public.customers c join public.jobs j on j.customer_id=c.id where j.id=$1`, [JOB]);

const C = (type, payload, extra = {}) => ({ command_id: id(), command_type: type, job_id: JOB, ...extra, payload });

/** Runs a command expected to fail, and returns the refusal code. */
const refuses = async (who, request) => {
  const r = await cmd(who, request);
  assert.ok(r.error, `expected a refusal, got ${JSON.stringify(r)}`);
  return r.error;
};

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// --- The thing staff actually asked for --------------------------------------

test('adds a phone number to a customer who had none', async () => {
  const before = await customer();
  assert.equal(before.phone, '07700900001');
  const r = ok(await cmd('tanya', C('CUSTOMER_UPDATE', { phone: '01833 660484' },
    { expected_version: before.version })), 'add phone');
  assert.deepEqual(r.changed, ['phone']);
  const after = await customer();
  assert.equal(after.phone, '01833 660484');
  // Everything else is left exactly as it was: naming one field changes one field.
  assert.equal(after.first_name, before.first_name);
  assert.equal(after.last_name, before.last_name);
  assert.equal(after.address_line1, before.address_line1);
  assert.equal(after.postcode, before.postcode);
  assert.equal(after.version, before.version + 1);
});

test('records where the enquiry came from', async () => {
  const before = await job();
  const r = ok(await cmd('tanya', C('JOB_SALE_UPDATE', { lead_source: 'Facebook' },
    { expected_version: before.version })), 'lead source');
  assert.equal(r.lead_source, 'Facebook');
  assert.equal(r.previous_lead_source, null);
  const after = await job();
  assert.equal(after.lead_source, 'Facebook');
  // The commercial terms are untouched by a lead-source change.
  assert.equal(after.finance_route, before.finance_route);
  assert.equal(after.original_gross_pence, before.original_gross_pence);
  assert.equal(after.quote_reference, before.quote_reference);
  assert.equal(after.salesperson_id, before.salesperson_id);
});

test('changes several contact fields at once', async () => {
  const before = await customer();
  const r = ok(await cmd('tanya', C('CUSTOMER_UPDATE',
    { email: 'ann.smith@example.com', contact_notes: 'Prefers calls after 6pm' },
    { expected_version: before.version })), 'multi');
  assert.deepEqual(r.changed.sort(), ['contact_notes', 'email']);
  const after = await customer();
  assert.equal(after.email, 'ann.smith@example.com');
  assert.equal(after.contact_notes, 'Prefers calls after 6pm');
  assert.equal(after.phone, before.phone, 'phone was not named, so phone did not change');
});

// --- What it must never reach ------------------------------------------------

test('refuses to change the customer\'s name or address', async () => {
  const v = (await customer()).version;
  for (const payload of [
    { first_name: 'Robert' },
    { last_name: 'Smythe' },
    { address_line1: '2 Other Street' },
    { postcode: 'ZZ9 9ZZ' },
    { town: 'Elsewhere' },
  ]) {
    const code = await refuses('tanya', C('CUSTOMER_UPDATE', payload, { expected_version: v }));
    assert.match(code, /R1A_INVALID_FIELDS/, `${JSON.stringify(payload)} must be refused`);
  }
  const after = await customer();
  assert.equal(after.first_name, 'Ann');
  assert.equal(after.last_name, 'Smith');
  assert.equal(after.address_line1, '1 High St');
});

test('refuses to change the agreed commercial terms', async () => {
  const j = await job();
  for (const payload of [
    { lead_source: 'X', original_gross_pence: 1 },
    { lead_source: 'X', finance_route: 'Finance' },
    { lead_source: 'X', quote_reference: 'Q-999' },
    { lead_source: 'X', salesperson_id: people.ben },
    { agreed_price_pence: 1 },
  ]) {
    const code = await refuses('tanya', C('JOB_SALE_UPDATE', payload, { expected_version: j.version }));
    assert.match(code, /R1A_INVALID_FIELDS/, `${JSON.stringify(payload)} must be refused`);
  }
  const after = await job();
  assert.equal(after.original_gross_pence, j.original_gross_pence);
  assert.equal(after.finance_route, j.finance_route);
});

test('refuses to leave a customer with no way of being contacted', async () => {
  const v = (await customer()).version;
  const code = await refuses('tanya', C('CUSTOMER_UPDATE', { phone: '', email: '' }, { expected_version: v }));
  assert.match(code, /CUSTOMER_CONTACT_REQUIRED/);
  const after = await customer();
  assert.ok(after.phone || after.email, 'the customer is still reachable');
});

test('clears one contact detail while the other still reaches them', async () => {
  // The guard is "reachable", not "never blank": a wrong number should be
  // removable when an email address is on file.
  const before = await customer();
  assert.ok(before.email, 'this case needs an email on file');
  ok(await cmd('tanya', C('CUSTOMER_UPDATE', { phone: '' }, { expected_version: before.version })), 'clear phone');
  const after = await customer();
  assert.equal(after.phone, null);
  assert.equal(after.email, before.email);
  // Put it back for the cases that follow.
  ok(await cmd('tanya', C('CUSTOMER_UPDATE', { phone: '01833 660484' },
    { expected_version: after.version })), 'restore phone');
});

test('refuses a value that is not a contact detail', async () => {
  const v = (await customer()).version;
  assert.match(await refuses('tanya', C('CUSTOMER_UPDATE', { phone: 'give me a ring' }, { expected_version: v })),
    /CUSTOMER_PHONE_INVALID/);
  assert.match(await refuses('tanya', C('CUSTOMER_UPDATE', { email: 'not-an-address' }, { expected_version: v })),
    /CUSTOMER_EMAIL_INVALID/);
});

// --- The gates that apply to every command -----------------------------------

test('refuses a correction proposed from stale details', async () => {
  const v = (await customer()).version;
  const code = await refuses('tanya', C('CUSTOMER_UPDATE', { phone: '01752 000111' }, { expected_version: v - 1 }));
  assert.match(code, /R1A_STALE_VERSION/);
});

test('refuses a change that changes nothing', async () => {
  const c = await customer();
  assert.match(await refuses('tanya', C('CUSTOMER_UPDATE', { phone: c.phone }, { expected_version: c.version })),
    /CUSTOMER_NO_CHANGE/);
  const j = await job();
  assert.match(await refuses('tanya', C('JOB_SALE_UPDATE', { lead_source: j.lead_source }, { expected_version: j.version })),
    /JOB_SALE_NO_CHANGE/);
});

test('refuses staff who do not hold the permission', async () => {
  const v = (await customer()).version;
  // An installer has no business editing customer records.
  const code = await refuses('inst_a', C('CUSTOMER_UPDATE', { phone: '01752 000222' }, { expected_version: v }));
  assert.match(code, /R1A_ROLE_DENIED/);
  assert.equal((await customer()).version, v, 'a refusal changes nothing');
});

test('refuses an imported historical record', async () => {
  // A historical record is inert by construction: jobs_historical_is_inert
  // refuses the class without an archive date and a source system, so there is
  // no such thing as a "live historical" job to begin with.
  await db.query(
    `update public.jobs set record_class='HistoricalImport', archived_at=now(),
            source_system='historical-job-booking-form' where id=$1`, [JOB]);
  const v = (await customer()).version;
  const code = await refuses('tanya', C('CUSTOMER_UPDATE', { phone: '01752 000333' }, { expected_version: v }));
  // Refused before the handler is even reached - imported records are not work.
  assert.match(code, /HISTORICAL_IMPORT|CUSTOMER_EDIT_HISTORICAL/);
  assert.equal((await customer()).version, v);
  await db.query(
    `update public.jobs set record_class='Live', archived_at=null, source_system=null where id=$1`, [JOB]);
});

test('replaying the same command does not apply it twice', async () => {
  const before = await customer();
  const request = C('CUSTOMER_UPDATE', { phone: '01752 000444' }, { expected_version: before.version });
  const first = ok(await cmd('tanya', request), 'first');
  const replayed = await cmd('tanya', request);
  assert.equal(replayed.replayed, true, 'the second call is a replay');
  assert.deepEqual(replayed.result, first);
  const after = await customer();
  assert.equal(after.version, before.version + 1, 'the version moved once, not twice');
});

test('every accepted change is on the audit trail', async () => {
  const c = await customer();
  ok(await cmd('tanya', C('CUSTOMER_UPDATE', { contact_notes: 'Gate code 1234' },
    { expected_version: c.version })), 'audited change');
  const events = await all(
    `select * from public.audit_events where entity_type='customers' and entity_id=$1 order by occurred_at desc`,
    [c.id]);
  assert.ok(events.length > 0, 'the customer change was recorded');
  // A refusal writes nothing.
  const before = (await all(`select count(*)::int n from public.audit_events`))[0].n;
  await refuses('tanya', C('CUSTOMER_UPDATE', { phone: 'nope' }, { expected_version: (await customer()).version }));
  const after = (await all(`select count(*)::int n from public.audit_events`))[0].n;
  assert.equal(after, before, 'a refused command leaves no audit trail');
});

for (const [name, fn] of tests) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); process.exit(1); }
}
console.log(`${passed}/${tests.length} passed`);
