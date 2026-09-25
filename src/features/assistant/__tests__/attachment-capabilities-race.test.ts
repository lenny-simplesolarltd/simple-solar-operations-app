import { describe, expect, it, vi } from 'vitest';
import { readAttachments } from '../lib/attachments';

/**
 * Capabilities are fetched when the drawer opens. A file chosen inside that
 * window used to be read with `capabilities` still null, so the import
 * capability was absent and the property list took the ordinary text path -
 * the whole register into the model, silently.
 *
 * The panel now awaits the capabilities answer before reading. These assert the
 * contract that fix depends on: what readAttachments does with the answer once
 * it arrives late, and what it does when the caller may not import.
 */
const CSV =
  'PCH ID,Address\r\nPCH-1,"9 Northampton Close, Plymouth, Devon PL5 4JT"';

const resolvesLate = <T>(value: T, ms = 5) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe('a property list attached before capabilities have landed', () => {
  it('is staged, not read, once the awaited answer allows importing', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            summary: {
              import_id: '6f1c0d7a-1f2b-4a3c-8d4e-5f6a7b8c9d01',
              filename: 'props.csv',
              rows: 1
            }
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    // The panel's await, modelled: capabilities arrive after the file is chosen.
    const caps = await resolvesLate({
      configured: true,
      tools: [{ name: 'apply_programme_import' }]
    });
    const mayImport = caps.tools.some(
      (t: { name: string }) => t.name === 'apply_programme_import'
    );

    const file = new File([CSV], 'props.csv', { type: 'text/csv' });
    const { attachments, rejected } = await readAttachments([file], 0, {
      programmeImport: mayImport ? {} : undefined
    });

    expect(rejected).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(attachments)).not.toContain('Northampton');
    vi.unstubAllGlobals();
  });

  it('never reaches the route for someone who may not import', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([CSV], 'props.csv', { type: 'text/csv' });
    const { attachments } = await readAttachments([file], 0, {
      programmeImport: undefined
    });
    expect(fetchMock).not.toHaveBeenCalled();
    // It is read as an ordinary CSV instead, which is why the gate above must
    // be decided from an awaited answer and never from a not-yet-loaded null.
    expect(attachments[0].kind).toBe('text');
    vi.unstubAllGlobals();
  });
});
