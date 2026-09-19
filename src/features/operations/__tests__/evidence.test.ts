import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const previewWriteBlock = vi.fn<() => Promise<string | null>>();
vi.mock('@/lib/preview/guard', () => ({
  previewWriteBlock: () => previewWriteBlock()
}));

const rpc = vi.fn();
const createSignedUrl = vi.fn();
const createSignedUploadUrl = vi.fn();
const from = vi.fn(() => ({ createSignedUrl, createSignedUploadUrl }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, storage: { from } })
}));

import { GET } from '@/app/api/evidence/[evidenceId]/route';
import {
  EVIDENCE_MAX_BYTES,
  evidenceDownloadName,
  evidenceFileProblem,
  evidenceMimeType,
  evidenceOpensInline
} from '../evidence-rules';
import {
  beginEvidenceUpload,
  completeEvidenceUpload
} from '../evidence-upload';

const ID = '0b0e1f1c-5d0a-4f7e-9a53-3c2f4b6d7e80';
const TASK = '7a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const PATH = `job/${ID}/contract.pdf`;
const refusal = (message: string) => ({
  data: null,
  error: { code: 'P0001', message }
});
const get = (id: string, query = '') =>
  GET(new NextRequest(`http://localhost/api/evidence/${id}${query}`), {
    params: Promise.resolve({ evidenceId: id })
  });

beforeEach(() => {
  vi.clearAllMocks();
  previewWriteBlock.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('file rules', () => {
  it('accepts photos and PDFs whose name and type agree', () => {
    for (const [name, type] of [
      ['a.jpg', 'image/jpeg'],
      ['a.JPEG', 'image/jpeg'],
      ['a.png', 'image/png'],
      ['a.webp', 'image/webp'],
      ['a.heic', 'image/heic'],
      ['contract.pdf', 'application/pdf']
    ])
      expect(evidenceFileProblem({ name, type, size: 10 })).toBeNull();
  });

  it('lets an allowed extension stand in for a missing type only', () => {
    expect(evidenceMimeType({ name: 'IMG_1.HEIC', type: '' })).toBe(
      'image/heic'
    );
    expect(evidenceMimeType({ name: 'a.pdf', type: '' })).toBe(
      'application/pdf'
    );
    expect(evidenceMimeType({ name: 'a.pdf', type: 'text/html' })).toBeNull();
    expect(evidenceMimeType({ name: 'a.exe', type: 'image/jpeg' })).toBeNull();
    expect(evidenceMimeType({ name: 'noextension', type: '' })).toBeNull();
  });

  it('refuses anything a browser or server could run, and bad sizes', () => {
    for (const [name, type] of [
      ['a.html', 'text/html'],
      ['a.svg', 'image/svg+xml'],
      ['a.js', 'text/javascript'],
      ['a.exe', 'application/x-msdownload'],
      ['a.jpg', 'application/x-msdownload']
    ])
      expect(evidenceFileProblem({ name, type, size: 10 })).toMatch(
        /Only photos/
      );
    expect(
      evidenceFileProblem({ name: 'a.pdf', type: 'application/pdf', size: 0 })
    ).toMatch(/empty/);
    expect(
      evidenceFileProblem({
        name: 'a.pdf',
        type: 'application/pdf',
        size: EVIDENCE_MAX_BYTES + 1
      })
    ).toMatch(/25 MB/);
  });

  it('keeps header-breaking characters out of download names', () => {
    expect(evidenceDownloadName('../../x"; filename=evil.exe\r\n', 'f')).toBe(
      'x filename=evil.exe'
    );
    expect(evidenceDownloadName('C:\\Users\\me\\scan.pdf', 'f')).toBe(
      'scan.pdf'
    );
    expect(evidenceDownloadName('  ', 'fallback.pdf')).toBe('fallback.pdf');
    expect(evidenceDownloadName(null, 'fallback.pdf')).toBe('fallback.pdf');
  });

  it('only opens known-safe types in the browser', () => {
    expect(evidenceOpensInline('application/pdf')).toBe(true);
    expect(evidenceOpensInline('image/jpeg')).toBe(true);
    expect(evidenceOpensInline('text/html')).toBe(false);
    expect(evidenceOpensInline(null)).toBe(false);
  });
});

describe('GET /api/evidence/[id]', () => {
  it('refuses a malformed id without touching the database', async () => {
    for (const id of ['nope', `${ID}x`, '..%2F..%2Fetc', "' or 1=1 --"]) {
      const response = await get(id);
      expect(response.status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('makes "not yours" indistinguishable from "not found"', async () => {
    rpc.mockResolvedValueOnce(refusal('EVIDENCE_ACCESS_DENIED'));
    const denied = await get(ID);
    rpc.mockResolvedValueOnce(refusal('EVIDENCE_NOT_FOUND'));
    const missing = await get(ID);
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses signed-out, inactive and role-less people', async () => {
    for (const [code, status] of [
      ['R1A_AUTHENTICATED_EMAIL_REQUIRED', 401],
      ['R1A_INACTIVE_ACTOR', 403],
      ['R1A_NO_ACTIVE_ROLE', 403],
      ['R1A_UNKNOWN_OR_DUPLICATE_ACTOR', 403]
    ] as const) {
      rpc.mockResolvedValueOnce(refusal(code));
      expect((await get(ID)).status).toBe(status);
    }
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses while previewing another user', async () => {
    previewWriteBlock.mockResolvedValue('Preview is read-only.');
    expect((await get(ID)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('redirects to a one-minute signed URL for the path the DATABASE names', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        evidence_id: ID,
        storage_path: PATH,
        filename: 'Signed contract.pdf',
        safe_filename: 'contract.pdf',
        mime_type: 'application/pdf'
      },
      error: null
    });
    createSignedUrl.mockResolvedValueOnce({
      data: { signedUrl: 'https://storage.test/sign/abc?token=SECRET' },
      error: null
    });
    const response = await get(ID, '?path=other-job/secret.pdf');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      'https://storage.test/sign/abc?token=SECRET'
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(rpc).toHaveBeenCalledWith('evidence_open', { p_evidence_id: ID });
    expect(from).toHaveBeenCalledWith('evidence');
    expect(createSignedUrl).toHaveBeenCalledWith(PATH, 60, undefined);
  });

  it('downloads with a safe name, and forces download for unknown types', async () => {
    const file = {
      evidence_id: ID,
      storage_path: PATH,
      filename: 'Signed "contract".pdf',
      safe_filename: 'contract.pdf',
      mime_type: 'application/pdf'
    };
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: 'https://storage.test/x' },
      error: null
    });
    rpc.mockResolvedValueOnce({ data: file, error: null });
    await get(ID, '?download=1');
    expect(createSignedUrl).toHaveBeenLastCalledWith(PATH, 60, {
      download: 'Signed contract.pdf'
    });
    rpc.mockResolvedValueOnce({
      data: { ...file, mime_type: null, filename: null },
      error: null
    });
    await get(ID);
    expect(createSignedUrl).toHaveBeenLastCalledWith(PATH, 60, {
      download: 'contract.pdf'
    });
  });

  it('says so, and has it recorded, when the stored file is gone', async () => {
    rpc
      .mockResolvedValueOnce({
        data: { evidence_id: ID, storage_path: PATH, mime_type: 'image/png' },
        error: null
      })
      .mockResolvedValueOnce({ data: { file_present: false }, error: null });
    createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'Object not found' }
    });
    const response = await get(ID);
    expect(response.status).toBe(410);
    expect(rpc).toHaveBeenLastCalledWith('evidence_report_missing', {
      p_evidence_id: ID
    });
  });

  it('reports a storage outage as such, not as a missing file', async () => {
    rpc
      .mockResolvedValueOnce({
        data: { evidence_id: ID, storage_path: PATH, mime_type: 'image/png' },
        error: null
      })
      .mockResolvedValueOnce({ data: { file_present: true }, error: null });
    createSignedUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'timeout' }
    });
    expect((await get(ID)).status).toBe(502);
  });
});

describe('upload server actions', () => {
  const file = { name: 'contract.pdf', type: 'application/pdf', size: 100 };
  const input = {
    uploadId: ID,
    context: { type: 'Task' as const, id: TASK },
    file
  };

  it('refuses bad ids and bad files before any database call', async () => {
    expect((await beginEvidenceUpload({ ...input, uploadId: 'x' })).ok).toBe(
      false
    );
    expect(
      (
        await beginEvidenceUpload({
          ...input,
          context: { type: 'Task', id: '../x' }
        })
      ).ok
    ).toBe(false);
    expect(
      (
        await beginEvidenceUpload({
          ...input,
          file: { name: 'x.html', type: 'text/html', size: 1 }
        })
      ).ok
    ).toBe(false);
    expect((await completeEvidenceUpload('x')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('is blocked while previewing', async () => {
    previewWriteBlock.mockResolvedValue('Preview is read-only.');
    expect(await beginEvidenceUpload(input)).toEqual({
      ok: false,
      message: 'Preview is read-only.'
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never sends a job or a person - only the object acted on', async () => {
    rpc.mockResolvedValueOnce({
      data: { evidence_id: ID, storage_path: PATH, upload_status: 'Pending' },
      error: null
    });
    createSignedUploadUrl.mockResolvedValueOnce({
      data: { token: 'tok', path: PATH },
      error: null
    });
    const ticket = await beginEvidenceUpload({
      ...input,
      ...({ jobId: 'spoofed', personId: 'spoofed' } as object)
    });
    expect(ticket).toEqual({
      ok: true,
      evidenceId: ID,
      path: PATH,
      token: 'tok'
    });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('evidence_upload_begin');
    expect(Object.keys(args.p_request).sort()).toEqual([
      'context_id',
      'context_type',
      'filename',
      'mime_type',
      'size_bytes',
      'upload_id'
    ]);
    // the signed upload URL is for the path the database minted
    expect(createSignedUploadUrl).toHaveBeenCalledWith(PATH);
  });

  it('a retry of a finished upload sends nothing again', async () => {
    rpc.mockResolvedValueOnce({
      data: { evidence_id: ID, storage_path: PATH, upload_status: 'Uploaded' },
      error: null
    });
    expect(await beginEvidenceUpload(input)).toEqual({
      ok: true,
      evidenceId: ID,
      path: PATH,
      token: null
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('when storage will not issue a URL, checks whether the file already arrived', async () => {
    rpc
      .mockResolvedValueOnce({
        data: { evidence_id: ID, storage_path: PATH, upload_status: 'Pending' },
        error: null
      })
      .mockResolvedValueOnce({
        data: {
          evidence_id: ID,
          storage_path: PATH,
          upload_status: 'Uploaded'
        },
        error: null
      });
    createSignedUploadUrl.mockResolvedValueOnce({
      data: null,
      error: { message: 'The resource already exists' }
    });
    expect(await beginEvidenceUpload(input)).toEqual({
      ok: true,
      evidenceId: ID,
      path: PATH,
      token: null
    });
    expect(rpc).toHaveBeenLastCalledWith('evidence_upload_complete', {
      p_evidence_id: ID
    });
  });

  it('shows the database wording for a refusal', async () => {
    rpc
      .mockResolvedValueOnce(refusal('R1A_TASK_ACCESS_DENIED'))
      .mockResolvedValueOnce({
        data: { message: 'Only the task owner can do this.' },
        error: null
      });
    expect(await beginEvidenceUpload(input)).toEqual({
      ok: false,
      message: 'Only the task owner can do this.'
    });
  });
});
