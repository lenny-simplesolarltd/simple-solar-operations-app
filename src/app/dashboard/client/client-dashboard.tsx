'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { ContributionGraph } from '@/components/metrics/contribution-graph';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { INVENTORY_STATUSES } from '@/constants/inventory-statuses';
import { CODE_STATUS_LABELS, type CodeStatus } from '@/constants/statuses';
import { IconLoader2, IconLock } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';

type ClientInfo = {
  client_id: string;
  name: string;
  subscription_plan: 'basic' | 'pro';
};

type ClientMetrics = {
  subscription_plan: 'basic' | 'pro';
  total_codes: number;
  total_collected: number;
  codes_by_status: Record<CodeStatus, number>;
  codes_by_inventory_status: Record<string, number>;
  codes_per_month?: { month: string; count: number }[];
  codes_by_size?: { size: string; count: number; total_quantity: number }[];
  top_sizes?: { size: string; count: number; total_quantity: number }[];
  pickups_completed_week?: number;
  pickups_completed_month?: number;
  scans_this_week?: number;
  scans_this_month?: number;
  scan_volume_by_day?: { date: string; count: number }[];
  lastActivity?: {
    date: string;
    status: string;
    count: number;
  } | null;
  recentActivity?: { date: string; status: string; count: number }[];
  monthSummary?: {
    thisMonthCollected: number;
    lastMonthCollected: number;
    delta: number;
    percentChange: number | null;
  };
  activity_timeline?: {
    type: 'scan' | 'pickup';
    occurred_at: string;
    code_id?: string;
    quantity_collected?: number;
    status?: string | null;
  }[];
};

type ClientCode = {
  id: string;
  size: string;
  status?: CodeStatus;
  year: number;
  created_at?: string;
};

type ClientDashboardView = 'metrics' | 'codes';

const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 30000;

const VIEW_COPY: Record<
  ClientDashboardView,
  { title: string; description: string }
> = {
  metrics: {
    title: 'Client Metrics',
    description: 'Review your inventory counts and activity.'
  },
  codes: {
    title: 'Client Codes',
    description: 'Browse your QR codes and their status.'
  }
};

export default function ClientDashboard({
  view = 'metrics'
}: {
  view?: ClientDashboardView;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [client, setClient] = useState<ClientInfo | null>(null);
  const [metrics, setMetrics] = useState<ClientMetrics | null>(null);
  const [codes, setCodes] = useState<ClientCode[]>([]);
  const [codesTotal, setCodesTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingCodes, setLoadingCodes] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const statusFilter = searchParams.get('status') || '';

  const isPro = client?.subscription_plan === 'pro';

  const loadClient = useCallback(async () => {
    try {
      const res = await fetch('/api/clients/me');
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load client');
      }
      const data: ClientInfo = await res.json();
      setClient(data);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to load client'
      );
    }
  }, []);

  const loadMetrics = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoadingMeta(true);
    }
    try {
      const res = await fetch('/api/metrics/client');
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load metrics');
      }
      const data: ClientMetrics = await res.json();
      setMetrics(data);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to load metrics'
      );
    } finally {
      if (!options?.silent) {
        setLoadingMeta(false);
      }
    }
  }, []);

  const loadCodes = useCallback(
    async (
      pageNumber = 0,
      options?: { silent?: boolean },
      statusValue: string = statusFilter
    ) => {
      if (!options?.silent) {
        setLoadingCodes(true);
      }
      try {
        const params = new URLSearchParams();
        params.set('limit', PAGE_SIZE.toString());
        params.set('offset', (pageNumber * PAGE_SIZE).toString());
        if (statusValue) {
          params.set('status', statusValue);
        }

        const res = await fetch(`/api/codes?${params.toString()}`);
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Failed to load codes');
        }

        const payload = await res.json();
        setCodes(payload.codes || []);
        setCodesTotal(payload.total || 0);
      } catch (error) {
        console.error(error);
        toast.error(
          error instanceof Error ? error.message : 'Failed to load codes'
        );
      } finally {
        if (!options?.silent) {
          setLoadingCodes(false);
        }
      }
    },
    [statusFilter]
  );

  const viewCopy = VIEW_COPY[view];
  const showMetrics = view === 'metrics';
  const showCodes = view === 'codes';
  const statusSlugMap = useMemo(
    () =>
      INVENTORY_STATUSES.reduce<Record<string, string>>((acc, status) => {
        const slug = status
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        acc[status] = slug;
        return acc;
      }, {}),
    []
  );
  const statusLabelFromSlug = useMemo(() => {
    const entry = Object.entries(statusSlugMap).find(
      ([, slug]) => slug === statusFilter
    );
    return entry?.[0] || statusFilter.replace(/_/g, ' ');
  }, [statusFilter, statusSlugMap]);

  const handleStatusFilter = useCallback(
    (status: string) => {
      const slug = statusSlugMap[status];
      if (!slug) return;
      router.push(`/dashboard/client/codes?status=${encodeURIComponent(slug)}`);
    },
    [router, statusSlugMap]
  );

  useEffect(() => {
    loadClient();
    loadMetrics();
  }, [loadClient, loadMetrics]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter]);

  useEffect(() => {
    if (!showCodes) return;
    loadCodes(page, undefined, statusFilter);
  }, [loadCodes, page, showCodes, statusFilter]);

  const hasNextPage = (page + 1) * PAGE_SIZE < codesTotal;

  useEffect(() => {
    if (!showMetrics) return;
    const intervalId = setInterval(() => {
      loadMetrics({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadMetrics, showMetrics]);

  useEffect(() => {
    if (!showCodes) return;
    const intervalId = setInterval(() => {
      loadCodes(page, { silent: true }, statusFilter);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadCodes, page, showCodes, statusFilter]);

  return (
    <PageContainer>
      <div className='w-full min-w-0 space-y-8'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-3xl font-bold tracking-tight'>
              {viewCopy.title}
            </h1>
            <p className='text-muted-foreground'>{viewCopy.description}</p>
          </div>
          <Badge variant='secondary'>
            {client?.subscription_plan
              ? `${client.subscription_plan} plan`
              : '—'}
          </Badge>
        </div>

        {showMetrics && (
          <Card>
            <CardHeader className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
              <div>
                <CardTitle>Your metrics</CardTitle>
                <CardDescription>
                  Real-time counts scoped to your account.
                </CardDescription>
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => loadMetrics()}
                disabled={loadingMeta}
              >
                {loadingMeta ? (
                  <>
                    <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                    Refreshing
                  </>
                ) : (
                  'Refresh'
                )}
              </Button>
            </CardHeader>
            <CardContent>
              {metrics?.lastActivity && (
                <div className='bg-muted/30 mb-4 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs sm:text-sm'>
                  <span className='font-semibold'>Last activity:</span>
                  <span>
                    {CODE_STATUS_LABELS[
                      metrics.lastActivity.status as CodeStatus
                    ] || metrics.lastActivity.status}
                  </span>
                  <span className='text-muted-foreground'>
                    •{' '}
                    {formatDistanceToNow(new Date(metrics.lastActivity.date), {
                      addSuffix: true
                    })}
                  </span>
                </div>
              )}
              <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5'>
                <Card className='border-muted'>
                  <CardHeader>
                    <CardDescription>Total Codes</CardDescription>
                    <CardTitle className='text-3xl'>
                      {loadingMeta ? '—' : (metrics?.total_codes ?? 0)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card className='border-muted'>
                  <CardHeader>
                    <CardDescription>Total Collected</CardDescription>
                    <CardTitle className='text-3xl'>
                      {loadingMeta ? '—' : (metrics?.total_collected ?? 0)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card className='border-muted'>
                  <CardHeader>
                    <CardDescription>Pending</CardDescription>
                    <CardTitle className='text-3xl'>
                      {loadingMeta
                        ? '—'
                        : (metrics?.codes_by_status?.pending ?? 0)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card className='border-muted'>
                  <CardHeader>
                    <CardDescription>In Progress</CardDescription>
                    <CardTitle className='text-3xl'>
                      {loadingMeta
                        ? '—'
                        : (metrics?.codes_by_status?.in_progress ?? 0)}
                    </CardTitle>
                  </CardHeader>
                </Card>
                <Card className='border-muted'>
                  <CardHeader>
                    <CardDescription>Completed</CardDescription>
                    <CardTitle className='text-3xl'>
                      {loadingMeta
                        ? '—'
                        : (metrics?.codes_by_status?.completed ?? 0)}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </div>
              {metrics?.monthSummary && (
                <div className='text-muted-foreground mt-4 space-y-1 text-xs sm:text-sm'>
                  <p>
                    This month: {metrics.monthSummary.thisMonthCollected}{' '}
                    collected
                  </p>
                  <p>
                    Last month: {metrics.monthSummary.lastMonthCollected}{' '}
                    {metrics.monthSummary.percentChange === null
                      ? '(n/a)'
                      : `(${metrics.monthSummary.delta >= 0 ? '+' : ''}${metrics.monthSummary.percentChange}%)`}
                  </p>
                </div>
              )}
              <div className='mt-6'>
                <h4 className='text-sm font-semibold'>Inventory status</h4>
                <div className='mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4'>
                  {INVENTORY_STATUSES.map((status) => {
                    const slug = statusSlugMap[status];
                    const isActive = statusFilter === slug;
                    return (
                      <Card
                        key={status}
                        className={`border-muted hover:bg-muted/40 cursor-pointer transition-colors ${
                          isActive ? 'ring-primary/40 ring-1' : ''
                        }`}
                        role='button'
                        tabIndex={0}
                        onClick={() => handleStatusFilter(status)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleStatusFilter(status);
                          }
                        }}
                      >
                        <CardHeader>
                          <CardDescription>{status}</CardDescription>
                          <CardTitle>
                            {loadingMeta
                              ? '—'
                              : (metrics?.codes_by_inventory_status?.[status] ??
                                0)}
                          </CardTitle>
                        </CardHeader>
                      </Card>
                    );
                  })}
                </div>
              </div>
              <div className='mt-6 rounded-md border p-4'>
                <div className='flex items-center justify-between'>
                  <h4 className='text-sm font-semibold'>Recent activity</h4>
                  <span className='text-muted-foreground text-xs'>
                    Last scans
                  </span>
                </div>
                <div className='mt-3 space-y-2'>
                  {(metrics?.recentActivity || []).length > 0 ? (
                    (metrics?.recentActivity || []).slice(0, 8).map((entry) => (
                      <div
                        className='flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm'
                        key={`${entry.date}-${entry.status}`}
                      >
                        <span className='text-muted-foreground'>
                          {format(new Date(entry.date), 'PP')}
                        </span>
                        <span>
                          {CODE_STATUS_LABELS[entry.status as CodeStatus] ||
                            entry.status}
                        </span>
                        <span className='font-semibold'>{entry.count}</span>
                      </div>
                    ))
                  ) : (
                    <p className='text-muted-foreground text-sm'>
                      No activity yet — scans will appear here.
                    </p>
                  )}
                </div>
              </div>
              {isPro && metrics?.codes_per_month && (
                <div className='mt-8 h-72'>
                  <ResponsiveContainer width='100%' height='100%'>
                    <LineChart data={metrics.codes_per_month}>
                      <CartesianGrid strokeDasharray='3 3' />
                      <XAxis dataKey='month' tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Line
                        type='monotone'
                        dataKey='count'
                        stroke='hsl(var(--primary))'
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {!isPro && (
                <>
                  <div className='mt-6 grid grid-cols-1 gap-3 md:grid-cols-3'>
                    {[
                      'Monthly trend chart (Pro)',
                      'Size breakdown (Pro)',
                      'Pickups per week (Pro)'
                    ].map((label) => (
                      <Card
                        className='border-muted bg-muted/30 text-muted-foreground opacity-70'
                        key={label}
                      >
                        <CardHeader>
                          <CardDescription className='flex items-center gap-2'>
                            <IconLock className='h-4 w-4' />
                            {label}
                          </CardDescription>
                          <p className='text-xs'>
                            Upgrade to Pro to unlock this view.
                          </p>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                </>
              )}
              {isPro && metrics?.codes_by_size && (
                <div className='mt-6 grid grid-cols-2 gap-2 md:grid-cols-4'>
                  {metrics.codes_by_size.map((row) => (
                    <Card key={row.size} className='border-muted'>
                      <CardHeader>
                        <CardDescription>
                          {row.size || 'Unspecified'}
                        </CardDescription>
                        <CardTitle>{row.total_quantity}</CardTitle>
                        <p className='text-muted-foreground text-xs'>
                          {row.count} codes
                        </p>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              )}
              {isPro && metrics?.top_sizes && metrics.top_sizes.length > 0 && (
                <div className='mt-6'>
                  <h4 className='text-sm font-semibold'>Top sizes</h4>
                  <div className='mt-3 grid grid-cols-1 gap-2 md:grid-cols-3'>
                    {metrics.top_sizes.map((row) => (
                      <Card key={`top-${row.size}`} className='border-muted'>
                        <CardHeader>
                          <CardDescription>
                            {row.size || 'Unspecified'}
                          </CardDescription>
                          <CardTitle>{row.total_quantity}</CardTitle>
                          <p className='text-muted-foreground text-xs'>
                            {row.count} codes
                          </p>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              {isPro && (
                <div className='mt-6 grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <Card className='border-muted'>
                    <CardHeader>
                      <CardDescription>
                        Pickups completed (week)
                      </CardDescription>
                      <CardTitle>
                        {loadingMeta
                          ? '—'
                          : (metrics?.pickups_completed_week ?? 0)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card className='border-muted'>
                    <CardHeader>
                      <CardDescription>
                        Pickups completed (month)
                      </CardDescription>
                      <CardTitle>
                        {loadingMeta
                          ? '—'
                          : (metrics?.pickups_completed_month ?? 0)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>
              )}
              {isPro && (
                <div className='mt-6 grid grid-cols-1 gap-4 md:grid-cols-2'>
                  <Card className='border-muted'>
                    <CardHeader>
                      <CardDescription>Scans this week</CardDescription>
                      <CardTitle>
                        {loadingMeta ? '—' : (metrics?.scans_this_week ?? 0)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card className='border-muted'>
                    <CardHeader>
                      <CardDescription>Scans this month</CardDescription>
                      <CardTitle>
                        {loadingMeta ? '—' : (metrics?.scans_this_month ?? 0)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>
              )}
              {isPro && (
                <Card className='border-muted mt-6'>
                  <CardHeader>
                    <CardTitle>Scan activity</CardTitle>
                    <CardDescription>
                      Daily scan volume with recent events.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {loadingMeta ? (
                      <div className='text-muted-foreground flex items-center gap-2'>
                        <IconLoader2 className='h-4 w-4 animate-spin' />
                        Loading scan activity...
                      </div>
                    ) : (
                      <div className='grid gap-6 lg:grid-cols-[2fr,1fr]'>
                        <ContributionGraph
                          data={metrics?.scan_volume_by_day || []}
                          year={new Date().getFullYear()}
                        />
                        <div>
                          <h4 className='text-sm font-semibold'>
                            Recent activity
                          </h4>
                          <div className='mt-3 space-y-2'>
                            {metrics?.activity_timeline?.length ? (
                              metrics.activity_timeline.map((event, index) => (
                                <Card
                                  key={`${event.type}-${index}`}
                                  className='border-muted'
                                >
                                  <CardHeader className='py-3'>
                                    <CardDescription className='capitalize'>
                                      {event.type}
                                    </CardDescription>
                                    <CardTitle className='text-sm'>
                                      {event.type === 'scan'
                                        ? `Scanned ${event.code_id}`
                                        : `Pickup collected (${event.quantity_collected ?? 0})`}
                                    </CardTitle>
                                    <p className='text-muted-foreground text-xs'>
                                      {event.occurred_at
                                        ? format(
                                            new Date(event.occurred_at),
                                            'PP p'
                                          )
                                        : '—'}
                                    </p>
                                  </CardHeader>
                                </Card>
                              ))
                            ) : (
                              <p className='text-muted-foreground text-sm'>
                                No recent activity yet.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        )}

        {showCodes && (
          <Card>
            <CardHeader className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
              <div>
                <CardTitle>Your Codes</CardTitle>
                <CardDescription>
                  {isPro
                    ? 'Includes creation timestamps plus core fields.'
                    : 'Includes creation timestamps plus core fields.'}
                </CardDescription>
              </div>
              <div className='text-muted-foreground flex flex-wrap items-center gap-2 text-sm'>
                <span>
                  {codesTotal} code{codesTotal === 1 ? '' : 's'}
                </span>
                {statusFilter && (
                  <Badge variant='outline' className='text-xs capitalize'>
                    Filtered: {statusLabelFromSlug || statusFilter}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {loadingCodes ? (
                <div className='text-muted-foreground flex items-center gap-2'>
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                  Loading codes...
                </div>
              ) : codes.length === 0 ? (
                <p className='text-muted-foreground text-sm'>No codes yet.</p>
              ) : (
                <div className='overflow-x-auto'>
                  <Table className='min-w-[560px]'>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code ID</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='hidden sm:table-cell'>
                          Year
                        </TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {codes.map((code) => (
                        <TableRow key={code.id}>
                          <TableCell>
                            <code className='font-mono text-sm'>{code.id}</code>
                          </TableCell>
                          <TableCell className='text-sm'>{code.size}</TableCell>
                          <TableCell>
                            <Badge variant='outline'>
                              {code.status
                                ? CODE_STATUS_LABELS[code.status] || code.status
                                : 'pending'}
                            </Badge>
                          </TableCell>
                          <TableCell className='hidden text-sm sm:table-cell'>
                            {code.year}
                          </TableCell>
                          <TableCell className='text-muted-foreground text-xs'>
                            {code.created_at
                              ? format(new Date(code.created_at), 'PP p')
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
            <CardFooter className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                disabled={page === 0 || loadingCodes}
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
              >
                Previous
              </Button>
              <div className='text-muted-foreground text-sm'>
                Page {page + 1} of{' '}
                {Math.max(1, Math.ceil(codesTotal / PAGE_SIZE))}
              </div>
              <Button
                variant='outline'
                size='sm'
                disabled={!hasNextPage || loadingCodes}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </CardFooter>
          </Card>
        )}

        <Card className='border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/20'>
          <CardContent className='text-muted-foreground p-4 text-sm'>
            Need scanner access? Contact your company admin to upgrade or enable
            company permissions. Client dashboards are view-only.
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
