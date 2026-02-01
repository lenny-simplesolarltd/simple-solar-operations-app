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

    const clients = data || [];
    if (clients.length === 0) {
      return NextResponse.json([]);
    }

    const clientIds = clients.map((client) => client.id);
    const statsByClient = new Map<
      string,
      {
        total_codes: number;
        active_codes: number;
        total_scans: number;
        last_scanned_at: string | null;
      }
    >();

    clientIds.forEach((id) =>
      statsByClient.set(id, {
        total_codes: 0,
        active_codes: 0,
        total_scans: 0,
        last_scanned_at: null
      })
    );

    const { data: codes, error: codesError } = await supabase
      .from('codes')
      .select('id, owner_user_id, status')
      .in('owner_user_id', clientIds);

    if (codesError) {
      console.error('Failed to fetch client codes', codesError);
      return NextResponse.json(
        { error: 'Failed to load clients' },
        { status: 500 }
      );
    }

    const codeOwnerMap = new Map<string, string>();
    (codes || []).forEach((code) => {
      if (!code.owner_user_id) return;
      codeOwnerMap.set(code.id, code.owner_user_id);
      const stats = statsByClient.get(code.owner_user_id);
      if (!stats) return;
      stats.total_codes += 1;
      if (code.status !== 'archived') {
        stats.active_codes += 1;
      }
    });

    const codeIds = Array.from(codeOwnerMap.keys());
    const chunkSize = 1000;

    for (let i = 0; i < codeIds.length; i += chunkSize) {
      const chunk = codeIds.slice(i, i + chunkSize);
      const { data: scanRows, error: scanError } = await supabase
        .from('scan_events')
        .select('code_id, scanned_at')
        .in('code_id', chunk);

      if (scanError) {
        console.error('Failed to fetch scan stats', scanError);
        return NextResponse.json(
          { error: 'Failed to load clients' },
          { status: 500 }
        );
      }

      (scanRows || []).forEach((row) => {
        if (!row.code_id) return;
        const ownerId = codeOwnerMap.get(row.code_id);
        if (!ownerId) return;
        const stats = statsByClient.get(ownerId);
        if (!stats) return;
        stats.total_scans += 1;
        if (row.scanned_at) {
          const current = stats.last_scanned_at
            ? new Date(stats.last_scanned_at).getTime()
            : 0;
          const next = new Date(row.scanned_at).getTime();
          if (next > current) {
            stats.last_scanned_at = row.scanned_at;
          }
        }
      });
    }

    const withStats = clients.map((client) => {
      const stats = statsByClient.get(client.id);
      return {
        ...client,
        total_codes: stats?.total_codes ?? 0,
        active_codes: stats?.active_codes ?? 0,
        total_scans: stats?.total_scans ?? 0,
        last_scanned_at: stats?.last_scanned_at ?? null
      };
    });

    return NextResponse.json(withStats);
  } catch (error) {
    console.error('Unexpected error in GET /api/clients', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
