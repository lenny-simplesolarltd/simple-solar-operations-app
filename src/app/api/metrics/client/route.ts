import {
  INVENTORY_STATUSES,
  type InventoryStatus
} from '@/constants/inventory-statuses';
import { CODE_STATUSES, type CodeStatus } from '@/constants/statuses';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getClientContextForUser, getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

type StatusCounts = Record<CodeStatus, number>;
type InventoryStatusCounts = Record<InventoryStatus, number>;
type SizeBucket = { size: string; count: number; total_quantity: number };
type ActivityEvent =
  | {
      type: 'scan';
      occurred_at: string;
      code_id: string;
      status?: string | null;
    }
  | {
      type: 'pickup';
      occurred_at: string;
      status?: string | null;
      quantity_collected: number;
    };

export async function GET() {
  try {
    const { userId } = await auth();
    const user = await currentUser();

    if (!userId || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const roleResult = await getUserRole(user);

    if (roleResult.role !== 'client') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const clientContext =
      roleResult.client || (await getClientContextForUser(userId));

    if (!clientContext) {
      return NextResponse.json({ error: 'Client mapping not found' }, { status: 404 });
    }

    const supabase = createSupabaseServerClient();

    const { data: codeRows, error: codesError } = await supabase
      .from('codes')
      .select('status, status_primary, quantity, size, created_at')
      .eq('owner_user_id', clientContext.clientId);

    if (codesError) {
      console.error('Failed to fetch client codes', codesError);
    }

    const codesByStatus: StatusCounts = CODE_STATUSES.reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as StatusCounts
    );

    (codeRows || []).forEach((row: { status?: CodeStatus | null }) => {
      if (row.status && CODE_STATUSES.includes(row.status)) {
        codesByStatus[row.status] = codesByStatus[row.status] + 1;
      }
    });

    const codesByInventoryStatus: InventoryStatusCounts = INVENTORY_STATUSES.reduce(
      (acc, status) => ({ ...acc, [status]: 0 }),
      {} as InventoryStatusCounts
    );

    (codeRows || []).forEach(
      (row: { status_primary?: InventoryStatus | null }) => {
        const value =
          row.status_primary && INVENTORY_STATUSES.includes(row.status_primary)
            ? row.status_primary
            : 'None';
        codesByInventoryStatus[value] = codesByInventoryStatus[value] + 1;
      }
    );

    const sizeMap = new Map<string, SizeBucket>();
    let totalCollected = 0;

    (codeRows || []).forEach((row: { size?: string | null; quantity?: number }) => {
      const size = row.size || 'unspecified';
      const quantity = Number.isFinite(row.quantity)
        ? Math.max(0, Math.floor(row.quantity ?? 0))
        : 0;
      totalCollected += quantity;
      const existing = sizeMap.get(size) || {
        size,
        count: 0,
        total_quantity: 0
      };
      existing.count += 1;
      existing.total_quantity += quantity;
      sizeMap.set(size, existing);
    });

    const codesBySize = Array.from(sizeMap.values()).sort(
      (a, b) => b.total_quantity - a.total_quantity
    );
    const topSizes = codesBySize.slice(0, 3);

    const response: any = {
      subscription_plan: clientContext.subscription_plan,
      total_codes: codeRows?.length ?? 0,
      total_collected: totalCollected,
      codes_by_status: codesByStatus,
      codes_by_inventory_status: codesByInventoryStatus,
      totals_by_status: {
        workflow: codesByStatus,
        inventory: codesByInventoryStatus
      }
    };

    if (clientContext.subscription_plan === 'pro') {
      const now = new Date();
      const startOfMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      );
      const startOfWeek = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      );
      const weekDay = startOfWeek.getUTCDay();
      const weekOffset = (weekDay + 6) % 7;
      startOfWeek.setUTCDate(startOfWeek.getUTCDate() - weekOffset);
      const startWindow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)
      );

      const monthlyBuckets: Record<string, number> = {};
      (codeRows || [])
        .filter((row) => row.created_at)
        .forEach((row) => {
          const created = new Date(row.created_at);
          if (created < startWindow) return;
          const key = `${created.getUTCFullYear()}-${String(
            created.getUTCMonth() + 1
          ).padStart(2, '0')}`;
          monthlyBuckets[key] = (monthlyBuckets[key] || 0) + 1;
        });

      response.codes_per_month = Array.from({ length: 12 }).map((_, idx) => {
        const date = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - idx), 1)
        );
        const key = `${date.getUTCFullYear()}-${String(
          date.getUTCMonth() + 1
        ).padStart(2, '0')}`;

        return {
          month: key,
          count: monthlyBuckets[key] || 0
        };
      });
      response.codes_by_size = codesBySize;
      response.top_sizes = topSizes;

      const { count: pickupsWeekCount } = await supabase
        .from('pickups')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientContext.clientId)
        .eq('status', 'completed')
        .gte('completed_at', startOfWeek.toISOString());

      const { count: pickupsMonthCount } = await supabase
        .from('pickups')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', clientContext.clientId)
        .eq('status', 'completed')
        .gte('completed_at', startOfMonth.toISOString());

      response.pickups_completed_week = pickupsWeekCount ?? 0;
      response.pickups_completed_month = pickupsMonthCount ?? 0;

      const { data: scanRows } = await supabase
        .from('scan_events')
        .select(
          `
          id,
          scanned_at,
          status,
          code_id,
          codes!inner (
            owner_user_id
          )
        `
        )
        .eq('codes.owner_user_id', clientContext.clientId)
        .order('scanned_at', { ascending: false })
        .limit(3);

      const { data: pickupRows } = await supabase
        .from('pickups')
        .select('id, completed_at, status, quantity_collected')
        .eq('client_id', clientContext.clientId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(3);

      const timeline: ActivityEvent[] = [
        ...(scanRows || []).map((row: any) => ({
          type: 'scan' as const,
          occurred_at: row.scanned_at,
          code_id: row.code_id,
          status: row.status
        })),
        ...(pickupRows || []).map((row: any) => ({
          type: 'pickup' as const,
          occurred_at: row.completed_at,
          status: row.status,
          quantity_collected: row.quantity_collected || 0
        }))
      ]
        .filter((row) => row.occurred_at)
        .sort(
          (a, b) =>
            new Date(b.occurred_at).getTime() -
            new Date(a.occurred_at).getTime()
        )
        .slice(0, 3);

      response.activity_timeline = timeline;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Unexpected error in GET /api/metrics/client', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
