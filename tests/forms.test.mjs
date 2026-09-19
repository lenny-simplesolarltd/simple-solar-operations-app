// Integration tests for Forms (commands, revisions, links, submissions, RLS).
//
// LOCAL Supabase stack only. Staff changes go through public.execute_command
// as real signed-in users; recipients use the public entry points with the
// anon key, exactly like a signed-out browser.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { anon, email, ensureLogin, service, signInAs } from './helpers.mjs';

let lucy, hannah, john, ben, anne;
let jobId;
// Synthetic local test data is left in place (published revisions are immutable).
const formIds = [];

const token = () => randomBytes(32).toString('base64url');
const hash = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

async function command(client, type, payload, extra = {}) {
  const { data, error } = await client.rpc('execute_command', {
    p_request: {
      command_id: extra.commandId ?? randomUUID(),
      command_type: type,
      payload,
      ...extra.envelope
    }
  });
  return { result: data?.result, replayed: data?.replayed, error };
}

const ok = (r) => {
  assert.ifError(r.error);
  return r.result;
};

const FEEDBACK = {
  fields: [
    {
      id: 'rating',
      type: 'scale',
      label: 'How would you rate the installation?',
      required: true,
      min: 1,
      max: 10
    },
    {
      id: 'tidy',
      type: 'yes_no',
      label: 'Was the installer tidy?',
      required: true
    },
    {
      id: 'mess',
      type: 'long_text',
      label: 'What was left untidy?',
      required: true,
      condition: { field: 'tidy', op: 'equals', value: false }
    },
    { id: 'comments', type: 'long_text', label: 'Comments', required: false }
  ]
};

async function publishedForm(client = lucy, definition = FEEDBACK) {
  const created = ok(
    await command(client, 'FORMS_CREATE', {
      kind: 'form',
      title: 'Post-install feedback',
      definition
    })
  );
  formIds.push(created.form_id);
  const published = ok(
    await command(
      client,
      'FORMS_PUBLISH',
      { form_id: created.form_id },
      { envelope: { expected_version: created.version } }
    )
  );
  return published;
}

async function invite(client, formId, extra = {}) {
  const t = token();
  const id = randomUUID();
  const r = await command(client, 'FORMS_INVITATION_CREATE', {
    invitation_id: id,
    token_hash: hash(t),
    form_id: formId,
    recipient_type: 'customer',
    job_id: jobId,
    ...extra
  });
  return { ...r, token: t, id };
}

before(async () => {
  for (const n of ['lucy', 'hannah', 'john', 'ben', 'anne'])
    await ensureLogin(email(n));
  [lucy, hannah, john, ben, anne] = await Promise.all(
    ['lucy', 'hannah', 'john', 'ben', 'anne'].map((n) => signInAs(email(n)))
  );
  const { data } = await service.from('jobs').select('id').limit(1).single();
  jobId = data.id;
});

describe('permissions', () => {
  test('office staff can create; others cannot, and cannot read forms', async () => {
    const created = ok(
      await command(lucy, 'FORMS_CREATE', {
        kind: 'form',
        title: 'Permission check'
      })
    );
    formIds.push(created.form_id);
    assert.equal(created.status, 'draft');

    for (const client of [john, anne, ben]) {
      const denied = await command(client, 'FORMS_CREATE', {
        kind: 'form',
        title: 'Nope'
      });
      assert.match(denied.error.message, /FORMS_PERMISSION_DENIED/);
    }
    const installer = await john
      .from('forms')
      .select('id')
      .eq('id', created.form_id);
    assert.deepEqual(installer.data, []);
    const surveyor = await anne
      .from('forms')
      .select('id')
      .eq('id', created.form_id);
    assert.deepEqual(surveyor.data, []);
    const director = await ben
      .from('forms')
      .select('id')
      .eq('id', created.form_id);
    assert.equal(director.data.length, 1, 'Directors can read forms');
    const anonymous = await anon.from('forms').select('id');
    assert.ok(anonymous.error || anonymous.data.length === 0);
  });

  test('tables cannot be written directly, only through commands', async () => {
    const insert = await lucy
      .from('forms')
      .insert({ kind: 'form', title: 'x', status: 'draft' });
    assert.ok(insert.error);
    const token_hash = await lucy
      .from('form_invitations')
      .select('token_hash')
      .limit(1);
    assert.ok(token_hash.error, 'the token hash column is not readable');
  });
});

describe('drafts and revisions', () => {
  test('edit a draft with optimistic concurrency', async () => {
    const created = ok(
      await command(lucy, 'FORMS_CREATE', {
        kind: 'form',
        title: 'Concurrency'
      })
    );
    formIds.push(created.form_id);
    const first = ok(
      await command(
        lucy,
        'FORMS_UPDATE_DRAFT',
        { form_id: created.form_id, definition: FEEDBACK },
        { envelope: { expected_version: created.version } }
      )
    );
    assert.equal(first.version, created.version + 1);
    // Hannah still holds the old version: refused, nothing overwritten.
    const stale = await command(
      hannah,
      'FORMS_UPDATE_DRAFT',
      { form_id: created.form_id, title: 'Overwrite' },
      { envelope: { expected_version: created.version } }
    );
    assert.match(stale.error.message, /FORMS_STALE_VERSION/);
    const { data } = await lucy
      .from('forms')
      .select('title, definition')
      .eq('id', created.form_id)
      .single();
    assert.equal(data.title, 'Concurrency');
    assert.equal(data.definition.fields.length, 4);
  });

  test('invalid definitions are refused', async () => {
    const cases = [
      {
        fields: [
          { id: 'a', type: 'short_text', label: 'A' },
          { id: 'a', type: 'short_text', label: 'B' }
        ]
      },
      { fields: [{ id: 'x', type: 'javascript', label: 'Bad' }] },
      {
        fields: [
          { id: 'x', type: 'short_text', label: 'X', onchange: 'alert(1)' }
        ]
      },
      {
        fields: [
          { id: 'c', type: 'single_choice', label: 'No options', options: [] }
        ]
      },
      {
        fields: [
          {
            id: 'later',
            type: 'short_text',
            label: 'L',
            condition: { field: 'first', op: 'answered' }
          },
          { id: 'first', type: 'short_text', label: 'F' }
        ]
      },
      { fields: [{ id: 's', type: 'scale', label: 'S', min: 1, max: 99 }] }
    ];
    for (const definition of cases) {
      const r = await command(lucy, 'FORMS_CREATE', {
        kind: 'form',
        title: 'Bad',
        definition
      });
      assert.match(
        r.error.message,
        /FORMS_INVALID_DEFINITION/,
        JSON.stringify(definition)
      );
    }
  });

  test('publishing freezes a revision; later edits need a new revision', async () => {
    const v1 = await publishedForm();
    assert.equal(v1.revision, 1);
    const again = await command(
      lucy,
      'FORMS_PUBLISH',
      { form_id: v1.form_id },
      { envelope: { expected_version: v1.version } }
    );
    assert.match(again.error.message, /FORMS_NO_CHANGES/);

    const edited = ok(
      await command(
        lucy,
        'FORMS_UPDATE_DRAFT',
        { form_id: v1.form_id, title: 'Post-install feedback (v2)' },
        { envelope: { expected_version: v1.version } }
      )
    );
    const { data: rev1 } = await lucy
      .from('form_revisions')
      .select('title, definition')
      .eq('id', v1.revision_id)
      .single();
    assert.equal(
      rev1.title,
      'Post-install feedback',
      'revision 1 is untouched by draft edits'
    );

    const v2 = ok(
      await command(
        lucy,
        'FORMS_PUBLISH',
        { form_id: v1.form_id },
        { envelope: { expected_version: edited.version } }
      )
    );
    assert.equal(v2.revision, 2);

    const tamper = await service
      .from('form_revisions')
      .update({ title: 'changed' })
      .eq('id', v1.revision_id);
    assert.match(
      tamper.error.message,
      /FORMS_IMMUTABLE/,
      'even the service role cannot rewrite a revision'
    );
  });

  test('templates: create, copy into a form, and stay independent', async () => {
    const template = ok(
      await command(lucy, 'FORMS_CREATE', {
        kind: 'template',
        title: 'Post-install template',
        definition: FEEDBACK
      })
    );
    formIds.push(template.form_id);
    assert.equal(template.status, 'active');
    const fromTemplate = ok(
      await command(hannah, 'FORMS_CREATE', {
        kind: 'form',
        title: 'From template',
        source_template_id: template.form_id
      })
    );
    formIds.push(fromTemplate.form_id);
    ok(
      await command(
        lucy,
        'FORMS_UPDATE_DRAFT',
        { form_id: template.form_id, definition: { fields: [] } },
        { envelope: { expected_version: template.version } }
      )
    );
    const { data } = await lucy
      .from('forms')
      .select('definition, source_template_id')
      .eq('id', fromTemplate.form_id)
      .single();
    assert.equal(
      data.definition.fields.length,
      4,
      'editing the template does not change forms made from it'
    );
    assert.equal(data.source_template_id, template.form_id);

    const pub = await command(
      lucy,
      'FORMS_PUBLISH',
      { form_id: template.form_id },
      { envelope: { expected_version: template.version + 1 } }
    );
    assert.match(pub.error.message, /FORMS_TEMPLATE_NOT_PUBLISHABLE/);
  });

  test('commands are idempotent: the same command id is a replay, not a second form', async () => {
    const commandId = randomUUID();
    const a = await command(
      lucy,
      'FORMS_CREATE',
      { kind: 'form', title: 'Once' },
      { commandId }
    );
    const b = await command(
      lucy,
      'FORMS_CREATE',
      { kind: 'form', title: 'Once' },
      { commandId }
    );
    formIds.push(a.result.form_id);
    assert.equal(b.replayed, true);
    assert.equal(a.result.form_id, b.result.form_id);
    const changed = await command(
      lucy,
      'FORMS_CREATE',
      { kind: 'form', title: 'Different' },
      { commandId }
    );
    assert.match(changed.error.message, /COMMAND_CONFLICT/);
  });

  test('changes are audited with the actor and command', async () => {
    const created = ok(
      await command(lucy, 'FORMS_CREATE', { kind: 'form', title: 'Audited' })
    );
    formIds.push(created.form_id);
    const { data } = await service
      .from('audit_events')
      .select('action, initiating_person_id, command_id')
      .eq('entity_id', created.form_id);
    assert.equal(data.length, 1);
    assert.equal(data[0].action, 'FORMS_CREATE');
    assert.ok(data[0].initiating_person_id && data[0].command_id);
  });
});

describe('links and submissions', () => {
  test('a link opens the exact revision it was created for', async () => {
    const v1 = await publishedForm();
    const link = await invite(lucy, v1.form_id);
    assert.ifError(link.error);
    // Publish v2 afterwards.
    const edited = ok(
      await command(
        lucy,
        'FORMS_UPDATE_DRAFT',
        { form_id: v1.form_id, title: 'Renamed later' },
        { envelope: { expected_version: v1.version } }
      )
    );
    ok(
      await command(
        lucy,
        'FORMS_PUBLISH',
        { form_id: v1.form_id },
        { envelope: { expected_version: edited.version } }
      )
    );

    const { data } = await anon.rpc('forms_public_open', {
      p_token: link.token
    });
    assert.equal(data.state, 'open');
    assert.equal(
      data.title,
      'Post-install feedback',
      'the old link still shows revision 1'
    );

    const newer = await invite(lucy, v1.form_id);
    const { data: v2 } = await anon.rpc('forms_public_open', {
      p_token: newer.token
    });
    assert.equal(
      v2.title,
      'Renamed later',
      'a new link uses the current revision'
    );
  });

  test('guessed, malformed and cross-form tokens reveal nothing', async () => {
    for (const t of [token(), 'short', "' or 1=1 --", '../../etc', '']) {
      const { data } = await anon.rpc('forms_public_open', { p_token: t });
      assert.deepEqual(data, { state: 'not_found' });
    }
    const guessed = await anon.rpc('forms_public_submit', {
      p_token: token(),
      p_submission_id: randomUUID(),
      p_answers: {}
    });
    assert.equal(guessed.data.state, 'not_found');
  });

  test('submission is validated against the revision, never the browser', async () => {
    const v1 = await publishedForm();
    const link = await invite(lucy, v1.form_id);
    const submit = (answers) =>
      anon.rpc('forms_public_submit', {
        p_token: link.token,
        p_submission_id: randomUUID(),
        p_answers: answers
      });

    assert.match(
      (await submit({ rating: 8 })).error.message,
      /FORMS_REQUIRED_MISSING/
    );
    assert.match(
      (await submit({ rating: 8, tidy: true, injected: 'x' })).error.message,
      /FORMS_UNKNOWN_FIELD/
    );
    assert.match(
      (await submit({ rating: 11, tidy: true })).error.message,
      /FORMS_INVALID_ANSWER/
    );
    assert.match(
      (await submit({ rating: 'ten', tidy: true })).error.message,
      /FORMS_INVALID_ANSWER/
    );
    // Conditional: "tidy = false" makes the follow-up required.
    assert.match(
      (await submit({ rating: 5, tidy: false })).error.message,
      /FORMS_REQUIRED_MISSING/
    );
    assert.match(
      (await submit({ rating: 5, tidy: true, comments: 'x'.repeat(200_000) }))
        .error.message,
      /too large|INVALID_ANSWER/
    );

    const submissionId = randomUUID();
    const first = await anon.rpc('forms_public_submit', {
      p_token: link.token,
      p_submission_id: submissionId,
      p_answers: {
        rating: 9,
        tidy: true,
        mess: 'hidden answer is dropped',
        comments: '<script>alert(1)</script>'
      }
    });
    assert.ifError(first.error);
    assert.equal(first.data.ok, true);

    // Double-click: the same submission id is recognised; a different one is refused.
    const repeat = await anon.rpc('forms_public_submit', {
      p_token: link.token,
      p_submission_id: submissionId,
      p_answers: { rating: 1, tidy: true }
    });
    assert.deepEqual([repeat.data.ok, repeat.data.state], [true, 'submitted']);
    const second = await anon.rpc('forms_public_submit', {
      p_token: link.token,
      p_submission_id: randomUUID(),
      p_answers: { rating: 1, tidy: true }
    });
    assert.deepEqual([second.data.ok, second.data.state], [false, 'submitted']);

    const { data: rows } = await lucy
      .from('form_submissions')
      .select('answers, revision_id')
      .eq('invitation_id', link.id);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].answers, {
      rating: 9,
      tidy: true,
      comments: '<script>alert(1)</script>'
    });
    assert.equal(rows[0].revision_id, v1.revision_id);
    const opened = await anon.rpc('forms_public_open', { p_token: link.token });
    assert.equal(opened.data.state, 'submitted');
    assert.equal(opened.data.definition, null);
  });

  test('revoked, expired and closed links stop working', async () => {
    const v1 = await publishedForm();
    const revoked = await invite(lucy, v1.form_id);
    ok(
      await command(lucy, 'FORMS_INVITATION_REVOKE', {
        invitation_id: revoked.id,
        reason: 'Sent to the wrong person'
      })
    );
    assert.equal(
      (await anon.rpc('forms_public_open', { p_token: revoked.token })).data
        .state,
      'revoked'
    );
    const late = await anon.rpc('forms_public_submit', {
      p_token: revoked.token,
      p_submission_id: randomUUID(),
      p_answers: { rating: 5, tidy: true }
    });
    assert.equal(late.data.state, 'revoked');

    const badExpiry = await invite(lucy, v1.form_id, {
      expires_at: '2000-01-01T00:00:00Z'
    });
    assert.match(badExpiry.error.message, /FORMS_INVALID_EXPIRY/);
    const expiring = await invite(lucy, v1.form_id, {
      expires_at: new Date(Date.now() + 60_000).toISOString()
    });
    assert.ifError(expiring.error);
    // Simulate time passing (local test data only; triggers allow this column).
    await service
      .from('form_invitations')
      .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq('id', expiring.id);
    assert.equal(
      (await anon.rpc('forms_public_open', { p_token: expiring.token })).data
        .state,
      'expired'
    );

    const open = await invite(lucy, v1.form_id);
    const { data: form } = await lucy
      .from('forms')
      .select('version')
      .eq('id', v1.form_id)
      .single();
    ok(
      await command(
        lucy,
        'FORMS_SET_STATUS',
        { form_id: v1.form_id, status: 'closed' },
        { envelope: { expected_version: form.version } }
      )
    );
    assert.equal(
      (await anon.rpc('forms_public_open', { p_token: open.token })).data.state,
      'closed'
    );
  });

  test('links: permissions, recipients and job visibility', async () => {
    const v1 = await publishedForm();
    const denied = await invite(john, v1.form_id);
    assert.match(denied.error.message, /FORMS_PERMISSION_DENIED/);
    const noJob = await invite(lucy, v1.form_id, { job_id: undefined });
    assert.match(noJob.error.message, /FORMS_CUSTOMER_NEEDS_JOB/);
    const unknownJob = await invite(lucy, v1.form_id, { job_id: randomUUID() });
    assert.match(unknownJob.error.message, /FORMS_JOB_NOT_FOUND/);
    const { data: surveyor } = await service
      .from('people')
      .select('id')
      .eq('email', email('anne'))
      .single();
    const toSurveyor = await invite(lucy, v1.form_id, {
      recipient_type: 'surveyor',
      person_id: surveyor.id,
      job_id: undefined
    });
    assert.ifError(toSurveyor.error);
    const { data: installer } = await service
      .from('people')
      .select('id')
      .eq('email', email('john'))
      .single();
    const notSurveyor = await invite(lucy, v1.form_id, {
      recipient_type: 'surveyor',
      person_id: installer.id,
      job_id: undefined
    });
    assert.match(notSurveyor.error.message, /FORMS_SURVEYOR_NOT_FOUND/);
    const draftOnly = ok(
      await command(lucy, 'FORMS_CREATE', {
        kind: 'form',
        title: 'Unpublished'
      })
    );
    formIds.push(draftOnly.form_id);
    assert.match(
      (await invite(lucy, draftOnly.form_id)).error.message,
      /FORMS_NOT_PUBLISHED/
    );
  });

  test('responses are readable only with forms.responses.read', async () => {
    const v1 = await publishedForm();
    const link = await invite(lucy, v1.form_id);
    await anon.rpc('forms_public_submit', {
      p_token: link.token,
      p_submission_id: randomUUID(),
      p_answers: { rating: 7, tidy: true }
    });
    assert.equal(
      (
        await lucy
          .from('form_submissions')
          .select('id')
          .eq('invitation_id', link.id)
      ).data.length,
      1
    );
    assert.equal(
      (
        await ben
          .from('form_submissions')
          .select('id')
          .eq('invitation_id', link.id)
      ).data.length,
      1
    );
    assert.deepEqual(
      (
        await john
          .from('form_submissions')
          .select('id')
          .eq('invitation_id', link.id)
      ).data,
      []
    );
    assert.deepEqual(
      (
        await anne
          .from('form_submissions')
          .select('id')
          .eq('invitation_id', link.id)
      ).data,
      []
    );
    const anonymous = await anon.from('form_submissions').select('id');
    assert.ok(anonymous.error || anonymous.data.length === 0);
    const { data: audit } = await service
      .from('audit_events')
      .select('after_json')
      .eq('action', 'FORMS_SUBMITTED')
      .eq(
        'entity_id',
        (
          await lucy
            .from('form_submissions')
            .select('id')
            .eq('invitation_id', link.id)
            .single()
        ).data.id
      );
    assert.equal(audit.length, 1);
    assert.equal(
      JSON.stringify(audit[0].after_json).includes('rating'),
      false,
      'answers are not copied into the audit log'
    );
  });
});
