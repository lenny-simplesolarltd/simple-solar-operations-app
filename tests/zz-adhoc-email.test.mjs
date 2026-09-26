// LOCAL Supabase stack only (helpers.mjs asserts it).
//
// Ad-hoc email: a person writes it, and it goes from the office mailbox.
// The claims that matter - composing is approving, FN-24 gates it alone, and
// an unresolved merge field REFUSES rather than emailing a customer the raw
// placeholder.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

let lenny;

const command = async (client, type, payload) => {
  const { data, error } = await client.rpc('execute_command', {
    p_request: { command_id: randomUUID(), command_type: type, payload }
  });
  return { result: data?.result, error };
};
const ok = (r) => {
  assert.ifError(r.error);
  return r.result;
};
const refusal = (r) => r.error?.message?.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];

const setGate = async (fn, mode) =>
  assert.ifError(
    (
      await service
        .from('release_modes')
        .update({
          mode,
          authorised_job_scope: mode === 'Disabled' ? 'None' : 'All'
        })
        .eq('function_id', fn)
    ).error
  );

const clear = async () => {
  // Inbound first: its rows point at the communications below.
  await service.from('inbound_emails').delete().neq('id', randomUUID());
  await service.from('outbox').delete().eq('action_type', 'EmailAdhoc');
  await service.from('communications').delete().eq('type', 'AdhocEmail');
  await service.from('email_templates').delete().neq('id', randomUUID());
};

before(async () => {
  await ensureLogin(email('lenny'));
  lenny = await signInAs(email('lenny'));
  await clear();
});

// Release modes are global rows shared with every other suite: a gate left
// open here reappears as an unrelated failure somewhere else. Both are put
// back, including FN-03, which is only opened to prove it does NOT open FN-24.
after(async () => {
  await clear();
  await setGate('FN-24', 'Disabled');
  await setGate('FN-03', 'Disabled');
});

describe('ad-hoc email has its own gate', () => {
  test('with FN-24 shut nothing is composed, and FN-03 does not open it', async () => {
    await clear();
    await setGate('FN-24', 'Disabled');
    await setGate('FN-03', 'Automated');

    const r = await command(lenny, 'ADHOC_EMAIL_SEND', {
      recipients: [{ name: 'Dan', email: 'dan@example.test' }],
      subject: 'Hello',
      body: 'Hello there.'
    });
    assert.match(refusal(r) ?? '', /MODE_DENIED/);

    const comms = await service
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'AdhocEmail');
    assert.equal(comms.count, 0, 'a refused send leaves no draft behind');
  });

  test('with FN-24 open it composes, approves and queues in one act', async () => {
    await clear();
    await setGate('FN-24', 'Automated');

    const sent = ok(
      await command(lenny, 'ADHOC_EMAIL_SEND', {
        recipients: [
          { name: 'Dan', email: 'Dan@Example.test' },
          { email: 'lenny@example.test' }
        ],
        subject: 'Scaffold on Tuesday',
        body: 'Morning - the scaffold is booked for Tuesday.'
      })
    );
    assert.equal(sent.status, 'Queued');
    assert.equal(sent.recipients, 2);

    const comm = (
      await service
        .from('communications')
        .select('*')
        .eq('id', sent.communication_id)
        .single()
    ).data;
    // Composing IS approving: no second step, but the approver is recorded.
    assert.equal(comm.status, 'Queued');
    assert.ok(comm.approved_at, 'the moment of approval is recorded');
    assert.ok(comm.approved_by, 'and who approved it');
    assert.equal(comm.approved_by, comm.created_by, 'the author approved it');
    // Addresses are normalised, so the snapshot matches every other kind.
    assert.deepEqual(
      JSON.parse(comm.recipients_snapshot).map((r) => r.email),
      ['dan@example.test', 'lenny@example.test']
    );

    const out = await service
      .from('outbox')
      .select('id', { count: 'exact', head: true })
      .eq('action_type', 'EmailAdhoc');
    assert.equal(out.count, 1, 'it reached the outbox');
  });

  test('a bad address is refused before anything is composed', async () => {
    await clear();
    await setGate('FN-24', 'Automated');
    const r = await command(lenny, 'ADHOC_EMAIL_SEND', {
      recipients: [{ email: 'not-an-address' }],
      subject: 'x',
      body: 'y'
    });
    assert.match(refusal(r) ?? '', /EMAIL_RECIPIENT_INVALID/);
    const comms = await service
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'AdhocEmail');
    assert.equal(comms.count, 0);
  });
});

describe('templates and their merge fields', () => {
  test('a template with an unknown placeholder is refused when saved', async () => {
    await clear();
    const r = await command(lenny, 'EMAIL_TEMPLATE_SET', {
      name: 'Bad',
      subject: 'Hello {{custmoer_name}}',
      body: 'Body'
    });
    assert.match(refusal(r) ?? '', /EMAIL_TEMPLATE_UNKNOWN_FIELD/);
  });

  test('a saved template is listed with the fields it may use', async () => {
    await clear();
    const made = ok(
      await command(lenny, 'EMAIL_TEMPLATE_SET', {
        name: 'Scaffold booked',
        description: 'Tell the customer when the scaffold arrives',
        subject: 'Your scaffold - {{job_ref}}',
        body: 'Hello {{customer_first_name}},\n\nSent {{today}} by {{sender_name}}.'
      })
    );
    assert.ok(made.template_id);

    const { data, error } = await lenny.rpc('execute_operations_read', {
      p_request: { read_type: 'EMAIL_TEMPLATES', payload: {} }
    });
    assert.ifError(error);
    const body = data.data;
    assert.equal(body.templates.length, 1);
    assert.equal(body.templates[0].name, 'Scaffold booked');
    assert.ok(
      body.mergeFields.some((f) => f.key === 'customer_name'),
      'the catalogue tells the screen what may be merged'
    );
  });

  test('an unresolved merge field refuses the send', async () => {
    // The claim that matters most. "Hi {{customer_name}}," reaching a customer
    // cannot be recalled, and silently blanking it is no better.
    await clear();
    await setGate('FN-24', 'Automated');
    const r = await command(lenny, 'ADHOC_EMAIL_SEND', {
      recipients: [{ email: 'dan@example.test' }],
      subject: 'Your install',
      body: 'Hello {{customer_first_name}}, all booked.'
    });
    assert.match(refusal(r) ?? '', /EMAIL_MERGE_UNRESOLVED/);

    const comms = await service
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'AdhocEmail');
    assert.equal(comms.count, 0, 'nothing half-written is left behind');
  });

  test('with a customer named, the placeholders resolve into the text', async () => {
    await clear();
    await setGate('FN-24', 'Automated');
    const made = await service
      .from('customers')
      .insert({
        first_name: 'Ada',
        last_name: 'Lovelace',
        address_line1: '12 Mill Lane',
        town: 'Plymouth',
        postcode: 'PL1 1AA',
        email: 'ada@example.test'
      })
      .select('id')
      .single();
    assert.ifError(made.error);

    const sent = ok(
      await command(lenny, 'ADHOC_EMAIL_SEND', {
        recipients: [{ email: 'dan@example.test' }],
        subject: 'Your install, {{customer_first_name}}',
        body: 'Hello {{customer_name}} of {{customer_address}}.\n\nSent {{today}}.',
        customer_id: made.data.id
      })
    );
    const comm = (
      await service
        .from('communications')
        .select('subject, body_snapshot')
        .eq('id', sent.communication_id)
        .single()
    ).data;
    assert.equal(comm.subject, 'Your install, Ada');
    assert.match(
      comm.body_snapshot,
      /Ada Lovelace of 12 Mill Lane, Plymouth, PL1 1AA/
    );
    assert.ok(
      !comm.body_snapshot.includes('{{'),
      'no placeholder survives into what was sent'
    );
    await service.from('customers').delete().eq('id', made.data.id);
  });
});

describe('receiving a reply', () => {
  const record = (over = {}) =>
    service.rpc('inbound_email_record', {
      p: {
        provider_message_id: `msg-${randomUUID()}`,
        from_address: 'buyer@merchant.test',
        subject: 'Re: Scaffold on Tuesday',
        text_body: 'Fine by us.',
        received_at: new Date().toISOString(),
        ...over
      }
    });

  const sendOne = async () => {
    await setGate('FN-24', 'Automated');
    const sent = ok(
      await command(lenny, 'ADHOC_EMAIL_SEND', {
        recipients: [{ email: 'buyer@merchant.test' }],
        subject: 'Scaffold on Tuesday',
        body: 'Morning - the scaffold is booked for Tuesday.'
      })
    );
    return sent.communication_id;
  };

  test('a reply quoting the tag is threaded to the exact message', async () => {
    await clear();
    const commId = await sendOne();
    const r = await record({
      text_body: `Fine by us.\n\n> Morning...\n\n[SSO-COMM:${commId}]`
    });
    assert.ifError(r.error);
    assert.equal(r.data.matched_by, 'Tag');
    assert.equal(r.data.communication_id, commId);
  });

  test('without a tag it falls back to who was written to, and says so', async () => {
    await clear();
    const commId = await sendOne();
    const r = await record();
    assert.ifError(r.error);
    // Weaker than a tag, and labelled differently so a reader can tell.
    assert.equal(r.data.matched_by, 'Sender');
    assert.equal(r.data.communication_id, commId);
  });

  test('a stranger belongs to no thread, which is not a failure', async () => {
    await clear();
    const r = await record({ from_address: 'nobody@elsewhere.test' });
    assert.ifError(r.error);
    assert.equal(r.data.matched_by, 'None');
    assert.equal(r.data.communication_id, null);
  });

  test('a redelivered webhook records the message once', async () => {
    // Svix retries on any non-2xx, so this is the normal case, not an edge.
    await clear();
    const id = `msg-${randomUUID()}`;
    const first = await record({ provider_message_id: id });
    const second = await record({ provider_message_id: id });
    assert.ifError(second.error);
    assert.equal(second.data.already_recorded, true);
    assert.equal(second.data.inbound_id, first.data.inbound_id);

    const rows = await service
      .from('inbound_emails')
      .select('id', { count: 'exact', head: true })
      .eq('provider_message_id', id);
    assert.equal(rows.count, 1);
  });

  test('a signed-in person cannot invent received mail', async () => {
    // The only writer is the webhook, with the service key. RLS grants SELECT
    // and nothing else, and the function is revoked from authenticated.
    await clear();
    const r = await lenny.rpc('inbound_email_record', {
      p: { provider_message_id: 'forged', from_address: 'boss@example.test' }
    });
    assert.ok(r.error, 'the RPC is not callable by a signed-in user');

    const direct = await lenny.from('inbound_emails').insert({
      provider_message_id: 'forged-2',
      from_address: 'boss@example.test',
      received_at: new Date().toISOString()
    });
    assert.ok(direct.error, 'and neither is a direct insert');
  });
});
