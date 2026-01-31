import {
  INVENTORY_STATUSES,
  type InventoryStatus
} from '@/constants/inventory-statuses';
import { CODE_STATUSES, type CodeStatus } from '@/constants/statuses';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { getUserRole } from '@/lib/userRoles';
import { auth, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

type StatusCounts = Record<CodeStatus, number>;
type InventoryStatusCounts = Record<InventoryStatus, number>;
type ClientAggregate = {
  client_id: string;
  name?: string | null;
  email?: string | null;
  total_quantity?: number;
  pickups_completed?: number;
};
type ActivityEvent =
  | {
      type: 'scan';
      occurred_at: string;
      code_id?: string | null;
      client_id?: string | null;
      status?: string | null;
    }
  | {
      type: 'pickup';
      occurred_at: string;
      client_id?: string | null;
      status?: string | null;
      quantity_collected?: number;
    };

const STORAGE_STATUSES: InventoryStatus[] = [
  'Warehouse/Staging',
  'Idle/Warehouse',
  'In Staging'
];

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

    // Total codes
    const { count: totalCodes } = await supabase
      .from('codes')
      .select('*', { count: 'exact', head: true });

    // Codes created this month
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
    const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const { count: codesThisMonth } = await supabase
      .from('codes')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString());

    const { data: codeRows, error: codesError } = await supabase
      .from('codes')
      .select(
        'owner_user_id, status, status_primary, status_secondary, quantity, created_at'
      );

    if (codesError) {
      console.error('Failed to fetch codes for metrics', codesError);
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

    const codesByInventoryStatus: InventoryStatusCounts =
      INVENTORY_STATUSES.reduce(
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

    const totalCollectedMap = new Map<string, number>();
    let storageLoad = 0;

    (codeRows || []).forEach(
      (row: {
        owner_user_id?: string | null;
        quantity?: number | null;
        status_primary?: InventoryStatus | null;
        status_secondary?: InventoryStatus | null;
      }) => {
        const quantity = Number.isFinite(row.quantity)
          ? Math.max(0, Math.floor(row.quantity ?? 0))
          : 0;

        if (row.owner_user_id) {
          totalCollectedMap.set(
            row.owner_user_id,
            (totalCollectedMap.get(row.owner_user_id) || 0) + quantity
          );
        }

        const primary = row.status_primary;
        const secondary = row.status_secondary;
        if (
          (primary && STORAGE_STATUSES.includes(primary)) ||
          (secondary && STORAGE_STATUSES.includes(secondary))
        ) {
          storageLoad += quantity;
        }
      }
    );

    // Codes per month (last 12 months)
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

    const codesPerMonth = Array.from({ length: 12 }).map((_, idx) => {
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

    const { data: completedPickups, error: pickupsError } = await supabase
      .from('pickups')
      .select('client_id, quantity_collected, completed_at')
      .eq('status', 'completed');

    if (pickupsError) {
      console.error('Failed to fetch completed pickups', pickupsError);
    }

    const pickupCounts = new Map<string, number>();
    let pickupQuantityTotal = 0;
    let pickupCountTotal = 0;

    (completedPickups || []).forEach((pickup) => {
      if (!pickup.client_id) return;
      pickupCounts.set(
        pickup.client_id,
        (pickupCounts.get(pickup.client_id) || 0) + 1
      );
      pickupCountTotal += 1;
      pickupQuantityTotal += Number.isFinite(pickup.quantity_collected)
        ? Number(pickup.quantity_collected)
        : 0;
    });

    const averageQuantityPerPickup =
      pickupCountTotal > 0 ? pickupQuantityTotal / pickupCountTotal : 0;

    const lastThirtyDays = new Date(now);
    lastThirtyDays.setUTCDate(lastThirtyDays.getUTCDate() - 30);
    const { count: missedDelayedCount } = await supabase
      .from('pickups')
      .select('*', { count: 'exact', head: true })
      .in('status', ['missed', 'delayed'])
      .gte('scheduled_at', lastThirtyDays.toISOString());

    const { data: scanRows, error: scansError } = await supabase
      .from('scan_events')
      .select('scanned_at')
      .gte('scanned_at', startOfYear.toISOString());

    if (scansError) {
      console.error('Failed to fetch scan events for metrics', scansError);
    }

    let scansThisWeek = 0;
    let scansThisMonth = 0;
    const scanVolumeMap = new Map<string, number>();

    (scanRows || []).forEach((row) => {
      if (!row.scanned_at) return;
      const scannedAt = new Date(row.scanned_at);
      const dateKey = scannedAt.toISOString().split('T')[0];
      scanVolumeMap.set(dateKey, (scanVolumeMap.get(dateKey) || 0) + 1);
      if (scannedAt >= startOfWeek) {
        scansThisWeek += 1;
      }
      if (scannedAt >= startOfMonth) {
        scansThisMonth += 1;
      }
    });

    const scanVolumeByDay = Array.from(scanVolumeMap.entries()).map(
      ([date, count]) => ({
        date,
        count
      })
    );

    const { data: scanTimelineRows, error: scanTimelineError } = await supabase
      .from('scan_events')
      .select('scanned_at, status, code_id, codes!inner(owner_user_id)')
      .order('scanned_at', { ascending: false })
      .limit(8);

    if (scanTimelineError) {
      console.error('Failed to fetch scan timeline', scanTimelineError);
    }

    const pickupTimeline = (completedPickups || [])
      .filter((row) => row.completed_at)
      .sort(
        (a, b) =>
          new Date(b.completed_at).getTime() -
          new Date(a.completed_at).getTime()
      )
      .slice(0, 8);

    const activityTimeline: ActivityEvent[] = [
      ...(scanTimelineRows || []).map((row: any) => ({
        type: 'scan' as const,
        occurred_at: row.scanned_at,
        code_id: row.code_id,
        client_id: row.codes?.owner_user_id ?? null,
        status: row.status
      })),
      ...pickupTimeline.map((row) => ({
        type: 'pickup' as const,
        occurred_at: row.completed_at,
        client_id: row.client_id ?? null,
        status: 'completed',
        quantity_collected: row.quantity_collected ?? 0
      }))
    ]
      .filter((row) => row.occurred_at)
      .sort(
        (a, b) =>
          new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
      )
      .slice(0, 8);

    const clientIds = Array.from(
      new Set([
        ...Array.from(totalCollectedMap.keys()),
        ...Array.from(pickupCounts.keys())
      ])
    );

    let clientRows: { id: string; name: string; email?: string | null }[] = [];
    if (clientIds.length > 0) {
      const { data, error: clientError } = await supabase
        .from('clients')
        .select('id, name, email')
        .in('id', clientIds);

      if (clientError) {
        console.error('Failed to fetch client info for metrics', clientError);
      } else {
        clientRows = data || [];
      }
    }

    const clientInfoMap = new Map(clientRows.map((row) => [row.id, row]));

    const totalCollectedPerClient: ClientAggregate[] = Array.from(
      totalCollectedMap.entries()
    ).map(([clientId, totalQuantity]) => ({
      client_id: clientId,
      name: clientInfoMap.get(clientId)?.name ?? null,
      email: clientInfoMap.get(clientId)?.email ?? null,
      total_quantity: totalQuantity
    }));

    const pickupsPerClient: ClientAggregate[] = Array.from(
      pickupCounts.entries()
    ).map(([clientId, count]) => ({
      client_id: clientId,
      name: clientInfoMap.get(clientId)?.name ?? null,
      email: clientInfoMap.get(clientId)?.email ?? null,
      pickups_completed: count
    }));

    const volumeBuckets = new Map<string, Map<string, number>>();
    (completedPickups || []).forEach((pickup) => {
      if (!pickup.completed_at || !pickup.client_id) return;
      const completed = new Date(pickup.completed_at);
      if (completed < startWindow) return;
      const monthKey = `${completed.getUTCFullYear()}-${String(
        completed.getUTCMonth() + 1
      ).padStart(2, '0')}`;
      const clientBucket =
        volumeBuckets.get(monthKey) || new Map<string, number>();
      clientBucket.set(
        pickup.client_id,
        (clientBucket.get(pickup.client_id) || 0) +
          (Number.isFinite(pickup.quantity_collected)
            ? Number(pickup.quantity_collected)
            : 0)
      );
      volumeBuckets.set(monthKey, clientBucket);
    });

    const clientVolumeTrend = Array.from({ length: 12 }).map((_, idx) => {
      const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - idx), 1)
      );
      const key = `${date.getUTCFullYear()}-${String(
        date.getUTCMonth() + 1
      ).padStart(2, '0')}`;
      const bucket = volumeBuckets.get(key);

      return {
        month: key,
        totals: bucket
          ? Array.from(bucket.entries()).map(([clientId, quantity]) => ({
              client_id: clientId,
              name: clientInfoMap.get(clientId)?.name ?? null,
              quantity
            }))
          : []
      };
    });

    return NextResponse.json({
      total_codes: totalCodes ?? 0,
      codes_this_month: codesThisMonth ?? 0,
      codes_by_status: codesByStatus,
      codes_by_inventory_status: codesByInventoryStatus,
      codes_per_month: codesPerMonth,
      total_collected_per_client: totalCollectedPerClient,
      pickups_per_client: pickupsPerClient,
      average_quantity_per_pickup: averageQuantityPerPickup,
      storage_load: storageLoad,
      missed_delayed_pickups: missedDelayedCount ?? 0,
      client_volume_trend: clientVolumeTrend,
      scans_this_week: scansThisWeek,
      scans_this_month: scansThisMonth,
      scan_volume_by_day: scanVolumeByDay,
      activity_timeline: activityTimeline
    });
  } catch (error) {
    console.error('Unexpected error in GET /api/metrics/company', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
