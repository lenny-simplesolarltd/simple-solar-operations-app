import { searchMentions } from '@/features/chat/server/mentions';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What "@" offers. Every source applies the signed-in person's own visibility,
 * so this can only suggest what they could already find.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return Response.json(
    { suggestions: await searchMentions(q) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
