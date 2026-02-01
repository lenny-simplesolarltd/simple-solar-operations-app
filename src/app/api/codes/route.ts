import {
  INVENTORY_STATUSES,
  type InventoryStatus
} from '@/constants/inventory-statuses';
import { CODE_STATUSES, type CodeStatus } from '@/constants/statuses';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getClientContextForUser, getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleResult = await getUserRole(user);

    const supabase = createSupabaseServerClient();
    const { searchParams } = new URL(request.url);
    const clientIdParam = searchParams.get('clientId');
    const statusParam = searchParams.get('status');
    const limit = Math.min(
      parseInt(searchParams.get('limit') || '25', 10),
      100
    );
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let query = supabase
      .from('codes')
      .select(
        `
          id,
          system_acronym,
          size,
          year,
          status,
          status_primary,
          status_secondary,
          quantity,
          owner_user_id,
          created_at
        `,
        { count: 'exact' }
      )
      .order('created_at', { ascending: false });

    const toInventorySlug = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    const inventoryStatusParam: InventoryStatus | null = statusParam
      ? INVENTORY_STATUSES.find(
          (status) =>
            status === statusParam || toInventorySlug(status) === statusParam
        ) || null
      : null;

    if (roleResult.role === 'company') {
      if (clientIdParam) {
        query = query.eq('owner_user_id', clientIdParam);
      }
      if (statusParam && CODE_STATUSES.includes(statusParam as CodeStatus)) {
        query = query.eq('status', statusParam);
      } else if (inventoryStatusParam) {
        query = query.eq('status_primary', inventoryStatusParam);
      }
    } else if (roleResult.role === 'client') {
      const clientContext =
        roleResult.client || (await getClientContextForUser(userId));

      if (!clientContext) {
        return NextResponse.json(
          { error: 'Client mapping not found' },
          { status: 404 }
        );
      }

      query = query.eq('owner_user_id', clientContext.clientId);
      if (statusParam && CODE_STATUSES.includes(statusParam as CodeStatus)) {
        query = query.eq('status', statusParam);
      } else if (inventoryStatusParam) {
        query = query.eq('status_primary', inventoryStatusParam);
      }
    }

    const { data, error, count } = await query.range(
      offset,
      offset + limit - 1
    );

    if (error) {
      console.error('Failed to fetch codes', error);
      return NextResponse.json(
        { error: 'Failed to fetch codes' },
        { status: 500 }
      );
    }

    let codes = data || [];

    if (roleResult.role === 'company' && codes.length > 0) {
      const codeIds = codes.map((code) => code.id);
      const { data: scanRows, error: scanError } = await supabase
        .from('scan_events')
        .select('code_id, scanned_at')
        .in('code_id', codeIds);

      if (scanError) {
        console.error('Failed to fetch scan stats', scanError);
      } else {
        const scanMap = new Map<
          string,
          { count: number; last_scanned_at: string | null }
        >();

        (scanRows || []).forEach((row) => {
          if (!row.code_id) return;
          const existing = scanMap.get(row.code_id) || {
            count: 0,
            last_scanned_at: null
          };
          existing.count += 1;
          if (row.scanned_at) {
            const current = existing.last_scanned_at
              ? new Date(existing.last_scanned_at).getTime()
              : 0;
            const next = new Date(row.scanned_at).getTime();
            if (next > current) {
              existing.last_scanned_at = row.scanned_at;
            }
          }
          scanMap.set(row.code_id, existing);
        });

        codes = codes.map((code) => {
          const stats = scanMap.get(code.id);
          return {
            ...code,
            scan_count: stats?.count ?? 0,
            last_scanned_at: stats?.last_scanned_at ?? null
          };
        });
      }
    }

    return NextResponse.json({
      codes,
      total: count ?? 0
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/codes', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
