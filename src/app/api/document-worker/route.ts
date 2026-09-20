import {
  runDocumentWorker,
  type RpcClient
} from '@/features/documents/server/worker';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recovery pass for document generation.
 *
 *   POST /api/document-worker   Authorization: Bearer <DOCUMENT_WORKER_SECRET>
 *
 * This is NOT how a document normally starts. Pressing Generate runs the
 * worker inline so it begins at once; this endpoint exists for the work that
 * inline pass could not finish - a process that died mid-render, a storage
 * outage that has since cleared, a retry whose backoff has expired.
 *
 * The claim RPC is granted to service_role only, so this runs with the service
 * key and therefore has to be shut to everyone else: without the secret set it
 * refuses rather than running unauthenticated.
 */
export async function POST(request: Request) {
  const secret = process.env.DOCUMENT_WORKER_SECRET;
  if (!secret)
    return Response.json(
      {
        error:
          'DOCUMENT_WORKER_SECRET is not set; the worker endpoint is closed'
      },
      { status: 503 }
    );
  if (!authorized(request, secret))
    return Response.json({ error: 'unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey)
    return Response.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY must be set on the server' },
      { status: 503 }
    );

  const client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  }) as unknown as RpcClient;

  try {
    const report = await runDocumentWorker(client, 10);
    return Response.json(report);
  } catch (error) {
    console.error('document worker failed', error);
    return Response.json({ error: 'worker failed' }, { status: 500 });
  }
}

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const offered = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(offered);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
