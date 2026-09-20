import { listChatPeople } from '@/features/chat/queries';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** People search for the New conversation picker. Authorized by the read. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const result = await listChatPeople(q.trim() || undefined);
  if (!result.ok)
    return Response.json({ error: result.error.message }, { status: 400 });
  return Response.json(
    { people: result.data },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
