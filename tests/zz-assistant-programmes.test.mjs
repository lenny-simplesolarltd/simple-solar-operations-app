// The assistant's Programme authority, proven where it is actually enforced.
//
// The point of these tests is not that the tool files declare the right
// permission strings - a declaration is a comment with a type. It is that the
// canonical reads and commands the tools delegate to REFUSE the wrong actor,
// under a real session, against the real database. If any of these started
// passing for the wrong role, SimpleBot would inherit that hole immediately.
//
// Named zz- so it runs after the tests that count rows.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

let programmeId, gateWas;
const clients = {};

/** Runs a command exactly as the assistant's mutation tools do. */
async function command(client, type, payload, extra = {}) {
  const { data, error } = await client.rpc('execute_command', {
    p_request: {
      command_id: extra.commandId ?? randomUUID(),
      command_type: type,
      payload,
      ...(extra.expectedVersion !== undefined
        ? { expected_version: extra.expectedVersion }
        : {})
    }
  });
  if (error) return { ok: false, code: error.message };
  return data?.ok
    ? { ok: true, result: data.result }
    : { ok: false, code: data?.outcome?.code ?? 'REFUSED' };
}

const read = async (client, readType, payload = {}) => {
  const { data, error } = await client.rpc('execute_operations_read', {
    p_request: { read_type: readType, payload }
  });
  return error
    ? { ok: false, code: error.code }
    : { ok: true, data: data?.data };
};

before(async () => {
  const was = await service
    .from('release_modes')
    .select('mode, authorised_job_scope')
    .eq('function_id', 'FN-22')
    .single();
  assert.ifError(was.error);
  gateWas = was.data;
  await service
    .from('release_modes')
    .update({ mode: 'Manual', authorised_job_scope: 'Pilot' })
    .eq('function_id', 'FN-22');

  const programme = await service
    .from('programmes')
    .select('id, synthetic')
    .eq('code', 'DEV-PCH-SIM')
    .single();
  assert.ifError(programme.error);
  assert.equal(programme.data.synthetic, true);
  programmeId = programme.data.id;

  for (const who of ['lenny', 'lucy', 'john', 'mike']) {
    await ensureLogin(email(who));
    clients[who] = await signInAs(email(who));
  }
});

after(async () => {
  if (gateWas)
    await service
      .from('release_modes')
      .update({
        mode: gateWas.mode,
        authorised_job_scope: gateWas.authorised_job_scope
      })
      .eq('function_id', 'FN-22');
});

describe('who the assistant may act for', () => {
  test('the four roles hold the capabilities the tools are declared against', async () => {
    const perms = await service
      .from('role_permissions')
      .select('role_code, permission_code')
      .like('permission_code', 'programme%');
    const held = {};
    for (const r of perms.data)
      (held[r.role_code] ??= new Set()).add(r.permission_code);

    // Admin administers, Office reviews and reports, Installer submits only,
    // Surveyor holds nothing at all. The assistant's tools are declared
    // against exactly these, so a change here must break this test.
    assert.ok(held.Admin.has('programme.manage'));
    assert.ok(held.Office.has('programme.review'));
    assert.ok(held.Office.has('programme.report'));
    assert.ok(!held.Office.has('programme.manage'), 'Office must not import');
    assert.ok(held.Installer.has('programme.visit.submit'));
    assert.ok(
      !held.Installer.has('programme.review'),
      'an installer must not review'
    );
    assert.ok(!held.Installer.has('programme.report'));
    assert.equal(
      held.Surveyor,
      undefined,
      'a surveyor holds no programme permission'
    );
  });

  test('a surveyor sees no programme rows at all, whatever id is supplied', async () => {
    const surveyor = clients.mike;
    const properties = await surveyor
      .from('programme_properties')
      .select('id', { count: 'exact', head: true })
      .eq('programme_id', programmeId);
    assert.equal(properties.count, 0, 'RLS let a surveyor see properties');

    const visits = await surveyor
      .from('programme_visits')
      .select('id', { count: 'exact', head: true })
      .eq('programme_id', programmeId);
    assert.equal(visits.count, 0, 'RLS let a surveyor see visits');

    // The aggregate read is the assistant's only route to programme numbers.
    const dashboard = await read(surveyor, 'PROGRAMME_DASHBOARD', {
      programme_id: programmeId
    });
    assert.equal(dashboard.ok, false, 'a surveyor got programme reporting');
  });

  test('an installer cannot office-review, however the request is phrased', async () => {
    const awaiting = await service
      .from('programme_visits')
      .select('id, version, property_id')
      .eq('programme_id', programmeId)
      .eq('review_status', 'AwaitingReview')
      .limit(1)
      .single();
    assert.ifError(awaiting.error);

    for (const disposition of [
      'CompleteAndWorking',
      'ActionRequired',
      'NoAccessRebook',
      'MeterRequiresChanging'
    ]) {
      const refusal = await command(
        clients.john,
        'PROGRAMME_VISIT_REVIEW',
        {
          visit_id: awaiting.data.id,
          disposition,
          ...(disposition === 'CompleteAndWorking'
            ? { portal_verification: 'ConfirmedLive' }
            : {})
        },
        { expectedVersion: awaiting.data.version }
      );
      assert.equal(
        refusal.ok,
        false,
        `an installer reviewed a visit as ${disposition}`
      );
    }

    // And nothing moved.
    const after = await service
      .from('programme_visits')
      .select('review_status, disposition')
      .eq('id', awaiting.data.id)
      .single();
    assert.equal(after.data.review_status, 'AwaitingReview');
  });

  test('an installer cannot report, and cannot import', async () => {
    assert.equal(
      (
        await read(clients.john, 'PROGRAMME_DASHBOARD', {
          programme_id: programmeId
        })
      ).ok,
      false
    );
    const imported = await command(clients.john, 'PROGRAMME_IMPORT_CREATE', {
      import_id: randomUUID(),
      programme_id: programmeId,
      filename: 'x.csv',
      header: ['a'],
      row_count: 0
    });
    assert.equal(imported.ok, false, 'an installer staged an import');
  });

  test('office may review and report, but may not import', async () => {
    assert.equal(
      (
        await read(clients.lucy, 'PROGRAMME_DASHBOARD', {
          programme_id: programmeId
        })
      ).ok,
      true
    );
    const imported = await command(clients.lucy, 'PROGRAMME_IMPORT_CREATE', {
      import_id: randomUUID(),
      programme_id: programmeId,
      filename: 'x.csv',
      header: ['a'],
      row_count: 0
    });
    assert.equal(
      imported.ok,
      false,
      'Office imported without programme.manage'
    );
  });

  test('a fabricated actor in the payload changes nothing', async () => {
    const admin = await service
      .from('people')
      .select('id')
      .eq('email', email('lenny'))
      .single();
    const awaiting = await service
      .from('programme_visits')
      .select('id, version')
      .eq('programme_id', programmeId)
      .eq('review_status', 'AwaitingReview')
      .limit(1)
      .single();

    // The installer names the Admin as the actor, the way a prompt-injected
    // model would. Authority comes from auth.uid(), so it is ignored.
    const refusal = await command(
      clients.john,
      'PROGRAMME_VISIT_REVIEW',
      {
        visit_id: awaiting.data.id,
        disposition: 'ActionRequired',
        actor_id: admin.data.id,
        person_id: admin.data.id,
        role: 'Admin'
      },
      { expectedVersion: awaiting.data.version }
    );
    assert.equal(
      refusal.ok,
      false,
      'a supplied actor id escalated an installer'
    );
  });
});

describe('the portal rule the assistant must not talk its way around', () => {
  test('a good CSQ does not make a visit complete', async () => {
    const good = await service
      .from('programme_visits')
      .select('id, version, csq, signal_classification, portal_verification')
      .eq('programme_id', programmeId)
      .eq('review_status', 'AwaitingReview')
      .gte('csq', 14)
      .is('portal_verification', null)
      .limit(1)
      .maybeSingle();
    if (!good.data) return; // nothing in this state right now

    const refusal = await command(
      clients.lucy,
      'PROGRAMME_VISIT_REVIEW',
      { visit_id: good.data.id, disposition: 'CompleteAndWorking' },
      { expectedVersion: good.data.version }
    );
    assert.equal(
      refusal.ok,
      false,
      'a good CSQ completed a visit without the portal'
    );

    const still = await service
      .from('programme_visits')
      .select('disposition')
      .eq('id', good.data.id)
      .single();
    assert.notEqual(still.data.disposition, 'CompleteAndWorking');
  });
});

describe('the assistant answers at programme scale without reading the programme', () => {
  /**
   * This suite owns the scale it needs.
   *
   * It used to assert "more than a hundred properties" and rely on
   * zz-programme-scale.test.mjs having run first to create them - but that file
   * sorts AFTER this one, so in the documented order the data never existed and
   * the assertion could only pass by accident. A test that passes in one file
   * order and fails in another is not a passing test.
   *
   * Outstanding means "no visit that has left Draft", so properties with no
   * visits at all are exactly the fixture required.
   */
  // Past the 500-row page the reads are meant to defend against, on both
  // counts: enough unvisited properties to make "outstanding" a real number,
  // and enough visits that a search must page rather than return everything.
  const SCALE = 700;
  const VISITS = 560;
  const SCALE_REF = 'AST-SCALE-';
  let scaleProperties = [];

  before(async () => {
    const rows = Array.from({ length: SCALE }, (_, i) => ({
      programme_id: programmeId,
      external_ref: `${SCALE_REF}${String(i + 1).padStart(5, '0')}`,
      address_line1: `${i + 1} Assistant Scale Row`,
      town: 'Exeter',
      postcode: `EX${9 - (i % 5)} ${1 + (i % 9)}ZY`,
      expected_meter_serial: `MTR-AST-${String(i + 1).padStart(5, '0')}`,
      synthetic: true
    }));
    const inserted = await service
      .from('programme_properties')
      .insert(rows)
      .select('id, external_ref');
    assert.ifError(inserted.error);
    scaleProperties = inserted.data.sort((a, b) =>
      a.external_ref < b.external_ref ? -1 : 1
    );

    // A visit needs a real submission, and the programme's own form revision.
    const programme = await service
      .from('programmes')
      .select('visit_form_id')
      .eq('id', programmeId)
      .single();
    assert.ifError(programme.error);
    const form = await service
      .from('forms')
      .select('current_revision_id')
      .eq('id', programme.data.visit_form_id)
      .single();
    assert.ifError(form.error);
    const staff = await service
      .from('people')
      .select('id, email')
      .in('email', [email('john'), email('lucy')]);
    assert.ifError(staff.error);
    const installerId = staff.data.find((p) => p.email === email('john')).id;
    const reviewerId = staff.data.find((p) => p.email === email('lucy')).id;

    const submissions = Array.from({ length: VISITS }, () => ({
      id: randomUUID(),
      form_id: programme.data.visit_form_id,
      revision_id: form.data.current_revision_id,
      answers: { scale: true },
      source: 'Staff',
      submitted_by: installerId
    }));
    const subs = await service
      .from('form_submissions')
      .insert(submissions)
      .select('id');
    assert.ifError(subs.error);

    // The LAST properties get the visits, so the first pages of "outstanding"
    // stay unvisited and the two counts are genuinely different questions.
    const visited = scaleProperties.slice(SCALE - VISITS);
    const visits = visited.map((property, i) => {
      const awaiting = i % 8 === 0;
      return {
        id: randomUUID(),
        programme_id: programmeId,
        property_id: property.id,
        installer_id: installerId,
        form_id: programme.data.visit_form_id,
        form_revision_id: form.data.current_revision_id,
        submission_id: subs.data[i].id,
        outcome: 'SimChangedPortalWorking',
        actual_meter_serial: `MTR-AST-${String(i + 1).padStart(5, '0')}`,
        new_sim_serial: `SIM-AST-${String(i + 1).padStart(5, '0')}`,
        csq: 12,
        signal_classification: 'Good',
        meter_serial_matches: true,
        portal_check_required: true,
        review_status: awaiting ? 'AwaitingReview' : 'Reviewed',
        disposition: awaiting ? 'AwaitingReview' : 'CompleteAndWorking',
        portal_verification: awaiting ? null : 'ConfirmedLive',
        reviewed_by: awaiting ? null : reviewerId,
        reviewed_at: awaiting ? null : new Date().toISOString(),
        visit_date: new Date(Date.now() - (i % 40) * 86400000)
          .toISOString()
          .slice(0, 10),
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
    // Visits reference the properties, so they go first.
    const ids = scaleProperties.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 200)
      await service
        .from('programme_visits')
        .delete()
        .in('property_id', ids.slice(i, i + 200));
    await service
      .from('programme_properties')
      .delete()
      .like('external_ref', `${SCALE_REF}%`);
  });

  test('outstanding properties are counted by the database, not by listing them', async () => {
    const office = clients.lucy;
    const page = await office
      .from('programme_properties')
      .select(
        'id, visits:programme_visits!programme_visits_property_id_fkey!left(id)',
        {
          count: 'exact'
        }
      )
      .eq('programme_id', programmeId)
      .eq('active', true)
      .neq('visits.review_status', 'Draft')
      .is('visits', null)
      .order('external_ref')
      .range(0, 19);
    assert.ifError(page.error);

    // A page of twenty, and a count of everything: the shape the assistant
    // needs so it never has to add rows up itself.
    assert.ok(page.data.length <= 20);
    assert.ok(
      page.count > 100,
      `expected a large programme, got ${page.count}`
    );

    // The same question, answered the slow honest way.
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await service
        .from('programme_properties')
        .select('id')
        .eq('programme_id', programmeId)
        .eq('active', true)
        .range(from, from + 999);
      all.push(...data);
      if (data.length < 1000) break;
    }
    const visited = new Set();
    for (let from = 0; ; from += 1000) {
      const { data } = await service
        .from('programme_visits')
        .select('property_id')
        .eq('programme_id', programmeId)
        .neq('review_status', 'Draft')
        .range(from, from + 999);
      data.forEach((v) => visited.add(v.property_id));
      if (data.length < 1000) break;
    }
    assert.equal(
      page.count,
      all.filter((p) => !visited.has(p.id)).length,
      'the counted total disagrees with the programme'
    );
  });

  test('a visit search returns a bounded page and a truthful total', async () => {
    const office = clients.lucy;
    const { data, count, error } = await office
      .from('programme_visits')
      .select('id', { count: 'exact' })
      .eq('programme_id', programmeId)
      .neq('review_status', 'Draft')
      .range(0, 19);
    assert.ifError(error);
    assert.ok(
      data.length <= 20,
      'the assistant would be handed more than a page'
    );
    assert.ok(
      count > 500,
      `expected a programme past 500 visits, got ${count}`
    );
  });
});

describe('who gets the credit, and the blame', () => {
  test('a review issued the way the assistant issues one is recorded against the human', async () => {
    const awaiting = await service
      .from('programme_visits')
      .select('id, version')
      .eq('programme_id', programmeId)
      .eq('review_status', 'AwaitingReview')
      .limit(1)
      .single();
    assert.ifError(awaiting.error);

    const lucy = await service
      .from('people')
      .select('id')
      .eq('email', email('lucy'))
      .single();

    // The same shape a confirmed assistant action sends: the pending action's
    // id becomes the command id, which is what makes a replay a replay.
    const commandId = randomUUID();
    const done = await command(
      clients.lucy,
      'PROGRAMME_VISIT_REVIEW',
      {
        visit_id: awaiting.data.id,
        disposition: 'ActionRequired',
        action_note: 'Recorded through the assistant during acceptance.'
      },
      { commandId, expectedVersion: awaiting.data.version }
    );
    assert.equal(done.ok, true, `review refused: ${done.code}`);

    const audit = await service
      .from('audit_events')
      .select('initiating_person_id, executing_service, command_id, action')
      .eq('command_id', commandId)
      .limit(5);
    assert.ifError(audit.error);
    assert.ok(audit.data.length > 0, 'the review wrote no audit event');
    for (const row of audit.data) {
      // The accountable actor is the signed-in staff member, never a bot.
      assert.equal(
        row.initiating_person_id,
        lucy.data.id,
        'the audit names somebody other than the person who asked'
      );
      assert.equal(row.command_id, commandId);
    }
    // Worth knowing: executing_service names the COMMAND, not the channel, so
    // "issued through the assistant" is not persisted anywhere yet. The human
    // actor is, which is the half that matters for accountability.
    assert.match(
      audit.data[0].executing_service,
      /^command:PROGRAMME_VISIT_REVIEW$/
    );

    // Replaying the identical command id must not review it twice.
    const replay = await command(
      clients.lucy,
      'PROGRAMME_VISIT_REVIEW',
      {
        visit_id: awaiting.data.id,
        disposition: 'ActionRequired',
        action_note: 'Recorded through the assistant during acceptance.'
      },
      { commandId, expectedVersion: awaiting.data.version }
    );
    assert.equal(replay.ok, true, 'a replay should return the first result');
    const events = await service
      .from('audit_events')
      .select('id', { count: 'exact', head: true })
      .eq('command_id', commandId);
    assert.equal(
      events.count,
      audit.data.length,
      'the replay wrote a second audit event'
    );
  });
});
