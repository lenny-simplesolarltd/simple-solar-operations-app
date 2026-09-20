import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getSalespeople = vi.fn(async () => [
  { id: SURVEYOR, displayName: 'Sam Surveyor' },
  { id: OTHER_SURVEYOR, displayName: 'Sally Surveyor' }
]);
vi.mock('@/features/presale/server/queries', () => ({
  getSalespeople: () => getSalespeople()
}));

const submitPresale = vi.fn(async (_id?: string, _submission?: unknown) => ({
  ok: true as const,
  result: {
    job_id: 'j',
    job_ref: 'SS-ABCD-0001',
    customer_id: 'c',
    presale_id: 'p',
    workflow_stage: 'Prebooking',
    replay: false,
    customer: { display_name: 'Ann Smith', postcode: 'PL2 3PD' },
    tasks: [
      {
        code: 'PRE01',
        title: 'Check the sale',
        owner_name: 'Tanya',
        backup_name: null,
        due_at: null,
        priority: 2
      }
    ]
  }
}));
vi.mock('@/features/presale/server/submit-presale', () => ({
  submitPresale: (id: string, submission: unknown) =>
    submitPresale(id, submission)
}));

import { createPresaleTool } from '../tools/presale-create';
import { makeActor, THREAD } from './helpers';

const SURVEYOR = '33333333-3333-4333-8333-333333333333';
const OTHER_SURVEYOR = '44444444-4444-4444-8444-444444444444';
const COMMAND = '55555555-5555-4555-8555-555555555555';

/**
 * Recording a sale is the most consequential thing the assistant can do: it
 * creates a customer, a job and its first tasks, and cannot be undone or
 * edited afterwards. These assertions are about the two ways that could go
 * wrong quietly - a price off by a factor of a hundred, and a sale attached to
 * the wrong person - plus the refusals that keep a half-known sale out of the
 * database entirely.
 */

const base = {
  first_name: 'Ann',
  last_name: 'Smith',
  address_line1: '1 High Street',
  town: 'Plymouth',
  postcode: 'pl2 3pd',
  phone: '01752 000111',
  finance_route: 'Standard' as const,
  agreed_price_pounds: 8500,
  roof_required: true,
  electrical_required: true,
  scaffold_required: true
};

const ctx = (id = SURVEYOR) => ({ actor: makeActor({ id }), threadId: THREAD });
const mutationCtx = (id = SURVEYOR) => ({
  ...ctx(id),
  commandId: COMMAND,
  expectedVersion: null,
  initiatedVia: 'assistant' as const
});

beforeEach(() => {
  submitPresale.mockClear();
  getSalespeople.mockClear();
});

describe('what reaches the database', () => {
  it('sends pounds as pence, and shows the money on the card', async () => {
    const prepared = await createPresaleTool.prepare(base, ctx());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // £8,500 must read as £8,500 to the person confirming it - this is the
    // check that catches a hundred-fold slip before it becomes a sale.
    expect(
      prepared.preview.changes.find((c) => c.label === 'Agreed price')?.to
    ).toBe('£8,500.00');

    await createPresaleTool.execute(base, mutationCtx());
    const [, submission] = submitPresale.mock.calls[0] as unknown as [
      string,
      { sale: { agreed_price_pence: number }; computed: unknown }
    ];
    expect(submission.sale.agreed_price_pence).toBe(850_000);
  });

  it('normalises the postcode the way the database stores it', async () => {
    await createPresaleTool.execute(base, mutationCtx());
    const [, submission] = submitPresale.mock.calls[0] as unknown as [
      string,
      { customer: { postcode: string } }
    ];
    expect(submission.customer.postcode).toBe('PL2 3PD');
  });

  it('records no design, and says which it is', async () => {
    await createPresaleTool.execute(base, mutationCtx());
    const [, submission] = submitPresale.mock.calls[0] as unknown as [
      string,
      { design: unknown; catalogue_version: string }
    ];
    expect(submission.design).toEqual({});
    // Not a borrowed catalogue version pretending a design happened.
    expect(submission.catalogue_version).toBe('simplebot-no-designer');
  });

  it('passes the command id through, so a retry is a replay not a second sale', async () => {
    await createPresaleTool.execute(base, mutationCtx());
    expect(submitPresale.mock.calls[0][0]).toBe(COMMAND);
  });

  it('warns that it cannot be undone, and that no design is kept', async () => {
    const prepared = await createPresaleTool.prepare(base, ctx());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const warnings = prepared.preview.warnings.join(' ');
    expect(warnings).toMatch(/cannot be edited or undone/i);
    expect(warnings).toMatch(/no design is recorded/i);
  });
});

describe('whose sale it is', () => {
  it('defaults to the signed-in Surveyor', async () => {
    await createPresaleTool.execute(base, mutationCtx());
    const [, submission] = submitPresale.mock.calls[0] as unknown as [
      string,
      { sale: { salesperson_id: string } }
    ];
    expect(submission.sale.salesperson_id).toBe(SURVEYOR);
  });

  it('asks whose it is when the signed-in person is not a Surveyor', async () => {
    const prepared = await createPresaleTool.prepare(
      base,
      ctx('99999999-9999-4999-8999-999999999999')
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.code).toBe('SALESPERSON_REQUIRED');
    // It must name the choices rather than leaving the staff member guessing.
    expect(prepared.message).toContain('Sam Surveyor');
    expect(submitPresale).not.toHaveBeenCalled();
  });

  it('refuses a name that matches more than one Surveyor', async () => {
    const prepared = await createPresaleTool.prepare(
      { ...base, salesperson: 'Surveyor' },
      ctx()
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.code).toBe('AMBIGUOUS_SALESPERSON');
  });

  it('refuses a name that matches nobody active', async () => {
    const prepared = await createPresaleTool.prepare(
      { ...base, salesperson: 'Nobody' },
      ctx()
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.code).toBe('SALESPERSON_NOT_FOUND');
  });
});

describe('what it refuses before writing anything', () => {
  it('refuses a postcode that is not real', async () => {
    for (const postcode of ['abc', '123', 'ZZZ 999']) {
      const prepared = await createPresaleTool.prepare(
        { ...base, postcode },
        ctx()
      );
      expect(prepared.ok, `${postcode} must be refused`).toBe(false);
      if (prepared.ok) continue;
      expect(prepared.code).toBe('INVALID_POSTCODE');
    }
    expect(submitPresale).not.toHaveBeenCalled();
  });

  it('refuses a customer nobody could contact', async () => {
    const prepared = await createPresaleTool.prepare(
      { ...base, phone: undefined, email: undefined },
      ctx()
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.code).toBe('CONTACT_METHOD_REQUIRED');
  });

  it('refuses a sale for nothing', async () => {
    const prepared = await createPresaleTool.prepare(
      { ...base, agreed_price_pounds: 0 },
      ctx()
    );
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.code).toBe('INVALID_GROSS_AMOUNT');
  });

  it('repeats the database’s own refusal rather than claiming success', async () => {
    submitPresale.mockResolvedValueOnce({
      ok: false,
      code: 'SALESPERSON_MUST_BE_SELF',
      message: 'You may only record your own sales.',
      field: 'sale.salesperson_id'
    } as never);
    const result = await createPresaleTool.execute(base, mutationCtx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SALESPERSON_MUST_BE_SELF');
    expect(result.message).toContain('sale.salesperson_id');
  });
});
