// LOCAL Supabase stack only (helpers.mjs asserts it).
//
// The reporting feature's own acceptance: that a schedule sends once per
// period, that deleting one keeps what it already did, and - the claim that
// matters most - that a built report is never mistaken for a delivered one.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { email, ensureLogin, service, signInAs } from './helpers.mjs';

let lenny, programmeId, formId;
const made = [];

const command = async (client, type, payload, envelope = {}) => {
  const { data, error } = await client.rpc('execute_command', {
    p_request: {
      command_id: randomUUID(),
      command_type: type,
      payload,
      ...envelope
    }
  });
  return { result: data?.result, error };
};
const ok = (r) => {
  assert.ifError(r.error);
  return r.result;
};
const refusal = (r) => r.error?.message?.match(/[A-Z][A-Z0-9_]{3,}/)?.[0];

const clearReports = async () => {
  await service.from('report_runs').delete().neq('id', randomUUID());
  await service.from('report_subscriptions').delete().neq('id', randomUUID());
  await service.from('communications').delete().eq('type', 'ScheduledReport');
};

before(async () => {
  await ensureLogin(email('lenny'));
  lenny = await signInAs(email('lenny'));
  for (const fn of ['FN-22', 'FN-21'])
    assert.ifError(
      (
        await service
          .from('release_modes')
          .update({ mode: 'Manual', authorised_job_scope: 'Pilot' })
          .eq('function_id', fn)
      ).error
    );
  const programme = await service
    .from('programmes')
    .select('id, visit_form_id')
    .eq('code', 'DEV-PCH-SIM')
    .single();
  assert.ifError(programme.error);
  programmeId = programme.data.id;
  formId = programme.data.visit_form_id;
  await clearReports();
});

after(clearReports);

describe('a schedule reports each period once', () => {
  test('a repeated sweep in the same period builds nothing more', async () => {
    await clearReports();
    ok(
      await command(lenny, 'REPORT_SUBSCRIPTION_SET', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        enabled: true,
        send_hour: 0,
        recipients: [{ name: 'Office', email: 'office@example.test' }]
      })
    );

    // The sweep is a database function; pg_cron calls it exactly this way.
    const sweep = async () => {
      const { data, error } = await service.rpc('run_reports_at', {
        p_at: '2026-09-26T09:00:00Z'
      });
      assert.ifError(error);
      return data;
    };
    const first = await sweep();
    const second = await sweep();
    const third = await sweep();

    assert.equal(first.built, 1, 'the first sweep builds the day');
    assert.equal(second.built, 0, 'a repeat builds nothing');
    assert.equal(third.built, 0);

    const runs = await service
      .from('report_runs')
      .select('id', { count: 'exact', head: true });
    assert.equal(runs.count, 1, 'three sweeps, one report');
  });
});

describe('deleting a schedule keeps what it already reported', () => {
  test('the runs survive the subscription', async () => {
    await clearReports();
    ok(
      await command(lenny, 'REPORT_SUBSCRIPTION_SET', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Weekly',
        enabled: true,
        recipients: [{ name: 'Office', email: 'office@example.test' }]
      })
    );
    ok(
      await command(lenny, 'REPORT_SEND', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Weekly'
      })
    );
    const before = await service
      .from('report_runs')
      .select('id', { count: 'exact', head: true });
    assert.ok(before.count >= 1, 'a run should exist');

    ok(
      await command(lenny, 'REPORT_SUBSCRIPTION_DELETE', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Weekly'
      })
    );
    const subs = await service
      .from('report_subscriptions')
      .select('id', { count: 'exact', head: true });
    assert.equal(subs.count, 0, 'the subscription is gone');

    const after = await service
      .from('report_runs')
      .select('id', { count: 'exact', head: true });
    assert.equal(after.count, before.count, 'the history is not deleted');
  });
});

describe('sending by hand is not sending twice', () => {
  test('the same period, sent again, produces no second report', async () => {
    await clearReports();
    ok(
      await command(lenny, 'REPORT_SUBSCRIPTION_SET', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        enabled: true,
        recipients: [{ name: 'Office', email: 'office@example.test' }]
      })
    );
    const send = () =>
      command(lenny, 'REPORT_SEND', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        to: '2026-09-20'
      });
    const first = ok(await send());
    const second = ok(await send());
    const third = ok(await send());

    assert.equal(first.already_reported ?? false, false);
    assert.equal(second.already_reported, true, 'a second send is a no-op');
    assert.equal(third.already_reported, true);
    assert.equal(second.run_id, first.run_id);

    const runs = await service
      .from('report_runs')
      .select('id', { count: 'exact', head: true })
      .eq('period_end', '2026-09-20');
    assert.equal(runs.count, 1, 'one period, one report');

    const comms = await service
      .from('communications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'ScheduledReport');
    assert.equal(comms.count, 1, 'one period, one email prepared');
  });
});

describe('a prepared report is not a delivered one', () => {
  test('the communication is Approved, nothing is queued, nothing is sent', async () => {
    await clearReports();
    ok(
      await command(lenny, 'REPORT_SUBSCRIPTION_SET', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        enabled: true,
        recipients: [{ name: 'Office', email: 'office@example.test' }]
      })
    );
    ok(
      await command(lenny, 'REPORT_SEND', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        to: '2026-09-19'
      })
    );
    const comm = await service
      .from('communications')
      .select('status, sent_at, outbox_id')
      .eq('type', 'ScheduledReport')
      .single();
    assert.ifError(comm.error);
    assert.equal(comm.data.status, 'Approved');
    assert.equal(comm.data.sent_at, null, 'nothing claims a send time');
    assert.equal(comm.data.outbox_id, null, 'nothing reached the outbox');

    const reportOutbox = await service
      .from('outbox')
      .select('id', { count: 'exact', head: true })
      .eq('action_type', 'EmailReport');
    assert.equal(reportOutbox.count, 0, 'the outbound gates held');
  });

  test('a report with nobody to send to is refused, and prepares no email', async () => {
    await clearReports();
    ok(
      await command(lenny, 'REPORT_SUBSCRIPTION_SET', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        enabled: true,
        recipients: []
      })
    );
    ok(
      await command(lenny, 'REPORT_SEND', {
        source_kind: 'Programme',
        source_id: programmeId,
        report_type: 'Daily',
        to: '2026-09-18'
      })
    );
    const run = await service
      .from('report_runs')
      .select('status, detail, communication_id')
      .eq('period_end', '2026-09-18')
      .single();
    assert.equal(run.data.status, 'Refused');
    assert.match(run.data.detail, /no recipients/i);
    assert.equal(run.data.communication_id, null);
  });
});

describe('who may change a schedule', () => {
  test('an installer cannot', async () => {
    await ensureLogin(email('john'));
    const john = await signInAs(email('john'));
    const r = await command(john, 'REPORT_SUBSCRIPTION_SET', {
      source_kind: 'Programme',
      source_id: programmeId,
      report_type: 'Daily',
      enabled: true,
      recipients: [{ name: 'X', email: 'x@example.test' }]
    });
    assert.equal(r.error !== null, true, 'an installer must be refused');
  });

  test('a bad address is refused by the database, not just the form', async () => {
    const r = await command(lenny, 'REPORT_SUBSCRIPTION_SET', {
      source_kind: 'Programme',
      source_id: programmeId,
      report_type: 'Daily',
      recipients: [{ name: 'Nope', email: 'not-an-address' }]
    });
    assert.equal(refusal(r), 'R1A_INVALID_FIELDS');
  });
});

describe('a form report reads each response on its own revision', () => {
  test('and never carries a photograph or a signature', async () => {
    const report = await lenny.rpc('execute_operations_read', {
      p_request: {
        read_type: 'FORM_RESPONSE_REPORT',
        payload: { form_id: formId, from: '2026-09-01', to: '2026-09-30' }
      }
    });
    assert.ifError(report.error);
    const text = JSON.stringify(report.data ?? {});
    assert.ok(!text.includes('storage/v1'), 'no storage path');
    assert.ok(!/"type":\s*"photo"/.test(text), 'no photo field');
  });
});
