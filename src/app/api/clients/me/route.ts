import {
  ensureClientRecord,
  getClientContextForUser,
  getUserRole
} from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleResult = await getUserRole(user);
    const { role } = roleResult;

    if (role !== 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const client =
      roleResult.client ||
      (await getClientContextForUser(userId)) ||
      (await ensureClientRecord(user));

    if (!client) {
      return NextResponse.json({ error: 'Client mapping not found' }, { status: 404 });
    }

    return NextResponse.json({
      client_id: client.clientId,
      name: client.name,
      subscription_plan: client.subscription_plan
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/clients/me', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
