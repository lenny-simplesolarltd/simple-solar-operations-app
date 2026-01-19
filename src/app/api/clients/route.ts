import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
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

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, email, subscription_plan, created_at')
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to fetch clients', error);
      return NextResponse.json(
        { error: 'Failed to load clients' },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Unexpected error in GET /api/clients', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
