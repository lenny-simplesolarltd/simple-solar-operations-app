import { seedBaseLedgers } from '@/lib/ledgers';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { role } = await getUserRole(user);

    if (role !== 'company') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data, error } = await seedBaseLedgers();

    if (error) {
      console.error('Failed to seed ledgers', error);
      return NextResponse.json(
        { error: 'Failed to seed ledgers' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ledgers: data || [] });
  } catch (error) {
    console.error('Unexpected error in POST /api/ledgers/seed', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
