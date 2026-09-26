// Programme reads at the size the programme will actually be.
//
// Every other programme test runs against a dozen properties, and that is
// exactly the size at which a query that silently returns its first 500 rows
// looks correct. This file builds a synthetic programme large enough to catch
// that: more than 500 visits, with the largest board column over 500 on its
// own, and then asserts the two things the screens depend on -
//
//   1. the count the database reports describes the same set as the rows, so
//      "Showing 1-100 of 1,427" is a fact and not a hopeful guess;
//   2. rows past 500 are reachable, and reachable BY FILTER as well as by
//      paging - the postcode filter used to run in JavaScript after the
//      truncation, so searching a large programme searched only its first slice.
//
// Named zz- so it runs after the tests that count rows.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

// Comfortably past 500 in total and in one disposition, without making the
// suite slow.
const PROPERTIES = 700;
// 660, not 640: the paging test reads a page of 100 at offset 550, so the
// fixture has to carry 650 visits of its own. At 640 it only reached that far
// when programmes.test.mjs had already added a few - which made this file pass
// in the full suite and fail when run alone.
const VISITS = 660;
const REF = 'SCALE-';

let programmeId, formId, revisionId, installerId, reviewerId, office;
let gateWas = null;
let properties = [];

/** The same select the application uses, including the inner property join. */
const COLUMNS = `
  id, visit_date, disposition, review_status, portal_verification, submitted_at,
  search_text,
  property:programme_properties!programme_visits_property_id_fkey!inner (
    external_ref, address_line1, town, postcode, postcode_norm, expected_serial_norm
  )
`;

before(async () => {
  // Programmes is release-gated, and FN-22 is Disabled by default. Without this
  // every read below returns nothing and the failures look like a paging bug
  // rather than a switched-off module.
  const was = await service
    .from('release_modes')
    .select('mode, authorised_job_scope')
    .eq('function_id', 'FN-22')
    .single();
  assert.ifError(was.error);
  gateWas = was.data;
  const mode = await service
    .from('release_modes')
    .update({ mode: 'Manual', authorised_job_scope: 'Pilot' })
    .eq('function_id', 'FN-22');
  assert.ifError(mode.error);

  const programme = await service
    .from('programmes')
    .select('id, visit_form_id, synthetic')
    .eq('code', 'DEV-PCH-SIM')
    .single();
  assert.ifError(programme.error);
  // The fixture programme is synthetic and the flag is contagious and
  // immutable, so nothing here can attach itself to a real programme.
  assert.equal(programme.data.synthetic, true);
  programmeId = programme.data.id;
  formId = programme.data.visit_form_id;

  const revision = await service
    .from('form_revisions')
    .select('id')
    .eq('form_id', formId)
    .order('revision_number', { ascending: false })
    .limit(1)
    .single();
  assert.ifError(revision.error);
  revisionId = revision.data.id;

  const people = await service
    .from('people')
    .select('id, email')
    .in('email', [email('john'), email('lucy')]);
  assert.ifError(people.error);
  assert.equal(people.data.length, 2);
  installerId = people.data.find((p) => p.email === email('john')).id;
  reviewerId = people.data.find((p) => p.email === email('lucy')).id;

  await ensureLogin(email('lucy'));
  office = await signInAs(email('lucy'));

  // Properties. Postcodes are deliberately spread so a postcode filter selects
  // a slice that does NOT sit inside the first 500 rows.
  const rows = Array.from({ length: PROPERTIES }, (_, i) => ({
    programme_id: programmeId,
    external_ref: `${REF}${String(i + 1).padStart(5, '0')}`,
    address_line1: `${i + 1} Scale Terrace`,
    town: 'Exeter',
    postcode: `EX${9 - (i % 5)} ${1 + (i % 9)}ZZ`,
    expected_meter_serial: `MTR-SC-${String(i + 1).padStart(5, '0')}`,
    synthetic: true
  }));
  const inserted = await service
    .from('programme_properties')
    .insert(rows)
    .select('id, external_ref, postcode');
  assert.ifError(inserted.error);
  properties = inserted.data.sort((a, b) =>
    a.external_ref < b.external_ref ? -1 : 1
  );

  // Submissions, one per visit: programme_visits requires a real submission.
  const submissions = Array.from({ length: VISITS }, () => ({
    id: randomUUID(),
    form_id: formId,
    revision_id: revisionId,
    answers: { scale: true },
    source: 'Staff',
    submitted_by: installerId
  }));
  const subs = await service
    .from('form_submissions')
    .insert(submissions)
    .select('id');
  assert.ifError(subs.error);

  const day = (i) =>
    new Date(Date.now() - (i % 40) * 86400000).toISOString().slice(0, 10);
  const visits = properties.slice(0, VISITS).map((property, i) => {
    // 1 in 8 stays in the review queue; the rest are complete and live. That
    // puts well over 500 in a single board column.
    const awaiting = i % 8 === 0;
    return {
      id: randomUUID(),
      programme_id: programmeId,
      property_id: property.id,
      installer_id: installerId,
      form_id: formId,
      form_revision_id: revisionId,
      submission_id: subs.data[i].id,
      outcome: 'SimChangedPortalWorking',
      actual_meter_serial: `MTR-SC-${String(i + 1).padStart(5, '0')}`,
      new_sim_serial: `SIM-SC-${String(i + 1).padStart(5, '0')}`,
      csq: 12,
      signal_classification: 'Good',
      meter_serial_matches: true,
      portal_check_required: true,
      review_status: awaiting ? 'AwaitingReview' : 'Reviewed',
      disposition: awaiting ? 'AwaitingReview' : 'CompleteAndWorking',
      portal_verification: awaiting ? null : 'ConfirmedLive',
      reviewed_by: awaiting ? null : reviewerId,
      reviewed_at: awaiting ? null : new Date().toISOString(),
      visit_date: day(i),
      submitted_at: new Date(Date.now() - i * 60000).toISOString(),
      synthetic: true
    };
  });
  for (let i = 0; i < visits.length; i += 200) {
    const { error } = await service
      .from('programme_visits')
      .insert(visits.slice(i, i + 200));
    assert.ifError(error);
  }
});

after(async () => {
  // Left exactly as it was found - restored to what was read, not to a guess at
  // what the default is. A test that switches a release gate and then hard-codes
  // it back "off" would silently switch the module off for whoever had switched
  // it on.
  if (gateWas)
    await service
      .from('release_modes')
      .update({
        mode: gateWas.mode,
        authorised_job_scope: gateWas.authorised_job_scope
      })
      .eq('function_id', 'FN-22');

  // Leaves the database as it was found, so the row-counting tests stay valid
  // however the suite is ordered.
  const ids = properties.map((p) => p.id);
  for (let i = 0; i < ids.length; i += 200) {
    await service
      .from('programme_visits')
      .delete()
      .in('property_id', ids.slice(i, i + 200));
  }
  await service
    .from('programme_properties')
    .delete()
    .like('external_ref', `${REF}%`);
});

/** The application's query, with whatever filters the test is asking about. */
async function page({ offset = 0, limit = 100, apply = (q) => q }) {
  const { data, count, error } = await apply(
    office
      .from('programme_visits')
      .select(COLUMNS, { count: 'exact' })
      .eq('programme_id', programmeId)
      .neq('review_status', 'Draft')
  )
    .order('submitted_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);
  assert.ifError(error);
  return { rows: data, total: count };
}

describe('programme reads at scale', () => {
  test('the count is the real count, not the size of the page', async () => {
    const first = await page({ limit: 100 });
    assert.equal(first.rows.length, 100);
    assert.ok(
      first.total > 500,
      `expected more than 500 visits, got ${first.total}`
    );

    // The count the screen prints must agree with the database.
    const { count: actual, error } = await service
      .from('programme_visits')
      .select('id', { count: 'exact', head: true })
      .eq('programme_id', programmeId)
      .neq('review_status', 'Draft');
    assert.ifError(error);
    assert.equal(first.total, actual);
  });

  test('rows past 500 are reachable, and are different rows', async () => {
    const first = await page({ limit: 100, offset: 0 });
    const beyond = await page({ limit: 100, offset: 550 });
    assert.equal(beyond.rows.length, 100);
    assert.equal(beyond.total, first.total);

    const early = new Set(first.rows.map((r) => r.id));
    assert.ok(
      beyond.rows.every((r) => !early.has(r.id)),
      'page 6 returned rows from page 1'
    );
  });

  test('every visit is reachable by paging, with no gaps or repeats', async () => {
    const seen = new Set();
    let total = null;
    for (let offset = 0; ; offset += 200) {
      const p = await page({ limit: 200, offset });
      total ??= p.total;
      p.rows.forEach((r) => seen.add(r.id));
      if (offset + p.rows.length >= p.total || p.rows.length === 0) break;
    }
    assert.equal(seen.size, total);
  });

  test('the postcode filter runs in the database, so it searches all of it', async () => {
    // EX5 is spread across the whole programme, including well past row 500.
    const filtered = await page({
      limit: 100,
      apply: (q) => q.like('property.postcode_norm', 'EX5%')
    });
    const everything = await page({ limit: 1 });

    assert.ok(filtered.total > 0, 'no EX5 properties matched');
    assert.ok(
      filtered.total < everything.total,
      'the filter did not narrow anything'
    );
    assert.ok(
      filtered.rows.every((r) => r.property.postcode_norm.startsWith('EX5')),
      'a row came back that does not match the filter'
    );

    // The same question asked of the database directly.
    const { count: actual, error } = await service
      .from('programme_visits')
      .select('id, property:programme_properties!inner(postcode_norm)', {
        count: 'exact',
        head: true
      })
      .eq('programme_id', programmeId)
      .neq('review_status', 'Draft')
      .like('property.postcode_norm', 'EX5%');
    assert.ifError(error);
    assert.equal(filtered.total, actual);
  });

  test('one search box finds a visit past row 500 by any of its identifiers', async () => {
    // Visits are ordered by submitted_at descending and submitted_at decreases
    // with the index, so a high index is deep in the list.
    const deep = properties[600];
    const index = String(601).padStart(5, '0');

    // An address, a PCH reference, an expected serial, the serial actually
    // fitted and the new SIM - each on its own must find this one visit. They
    // live on two tables, which is why the searchable text is kept on the visit.
    const search = (term) => ({
      limit: 10,
      apply: (q) => q.ilike('search_text', `%${term.toLowerCase()}%`)
    });
    for (const term of [
      deep.external_ref,
      `601 Scale Terrace`,
      `MTR-SC-${index}`,
      `SIM-SC-${index}`
    ]) {
      const found = await page(search(term));
      assert.equal(found.total, 1, `"${term}" did not find exactly one visit`);
      assert.equal(found.rows[0].property.external_ref, deep.external_ref);
    }
  });

  test('a corrected address is findable under the new address, not the old', async () => {
    const property = properties[610];
    const { error } = await service
      .from('programme_properties')
      .update({ address_line1: 'Flat 2, Corrected House' })
      .eq('id', property.id);
    assert.ifError(error);

    const found = await page({
      limit: 10,
      apply: (q) => q.ilike('search_text', '%corrected house%')
    });
    assert.equal(found.total, 1, 'the corrected address was not searchable');

    const stale = await page({
      limit: 10,
      apply: (q) => q.ilike('search_text', '%611 scale terrace%')
    });
    assert.equal(stale.total, 0, 'the old address is still searchable');
  });

  test('each board column reports its own true size', async () => {
    const columns = {};
    for (const disposition of ['AwaitingReview', 'CompleteAndWorking']) {
      const p = await page({
        limit: 60,
        apply: (q) => q.eq('disposition', disposition)
      });
      columns[disposition] = p.total;
      // The column shows 60 cards; its header must state the real number.
      assert.ok(p.rows.length <= 60);
    }
    assert.ok(
      columns.CompleteAndWorking > 500,
      `expected a column past 500, got ${columns.CompleteAndWorking}`
    );
    assert.ok(columns.AwaitingReview > 0);

    const everything = await page({ limit: 1 });
    // A per-column query is not a re-slicing of one page: the columns together
    // account for the whole programme.
    const summed = Object.values(columns).reduce((a, b) => a + b, 0);
    assert.ok(summed <= everything.total);
  });

  test('filters compose, and the count reflects all of them', async () => {
    const both = await page({
      limit: 100,
      apply: (q) =>
        q
          .eq('disposition', 'CompleteAndWorking')
          .eq('portal_verification', 'ConfirmedLive')
          .like('property.postcode_norm', 'EX5%')
    });
    const onlyPostcode = await page({
      limit: 1,
      apply: (q) => q.like('property.postcode_norm', 'EX5%')
    });
    assert.ok(both.total > 0);
    assert.ok(both.total <= onlyPostcode.total);
    assert.ok(
      both.rows.every(
        (r) =>
          r.disposition === 'CompleteAndWorking' &&
          r.portal_verification === 'ConfirmedLive'
      )
    );
  });
});
