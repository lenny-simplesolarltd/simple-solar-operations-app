import { listReportPeople } from '@/features/programmes/server/recipients';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Staff who could receive a report, for the recipient box.
 *
 * Typing a colleague's address from memory is how a report goes to nobody:
 * one wrong character and it is accepted, sent and never arrives. The
 * directory already knows these addresses, so the box offers them.
 *
 * Authorized by the read, not here: listReportPeople goes through the caller's
 * own client, so RLS decides. Somebody who may not see the directory gets
 * themselves, which is the correct answer rather than an error.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const { people, unreachable } = await listReportPeople(q.trim() || undefined);
  return Response.json(
    {
      people: people.map((p) => ({
        name: p.displayName,
        email: p.email,
        roles: p.roles
      })),
      // Named rather than hidden: "why is Dan not in the list" has an answer.
      unreachable: unreachable.map((p) => ({
        name: p.displayName,
        reason: p.reason
      }))
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
