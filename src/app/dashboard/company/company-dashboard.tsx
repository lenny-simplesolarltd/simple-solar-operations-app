'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { QrReader } from 'react-qr-reader';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ContributionGraph } from '@/components/metrics/contribution-graph';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  INVENTORY_STATUSES,
  type InventoryStatus
} from '@/constants/inventory-statuses';
import {
  CODE_STATUSES,
  CODE_STATUS_LABELS,
  type CodeStatus
} from '@/constants/statuses';
import { useScanEvents } from '@/hooks/use-scan-events';
import type { ScanEventWithCode } from '@/lib/supabaseClient';
import {
  IconAlertCircle,
  IconCamera,
  IconDownload,
  IconLoader2,
  IconScan,
  IconTrash,
  IconUsers
} from '@tabler/icons-react';

type Client = {
  id: string;
  name: string;
  email?: string | null;
  subscription_plan: 'basic' | 'pro';
  created_at?: string;
  total_codes?: number;
  active_codes?: number;
  total_scans?: number;
  last_scanned_at?: string | null;
};

type CompanyMetrics = {
  total_codes: number;
  codes_this_month: number;
  codes_by_status: Record<CodeStatus, number>;
  codes_by_inventory_status: Record<InventoryStatus, number>;
  codes_per_month: { month: string; count: number }[];
  total_collected_per_client: {
    client_id: string;
    name?: string | null;
    email?: string | null;
    total_quantity?: number;
  }[];
  pickups_per_client: {
    client_id: string;
    name?: string | null;
    email?: string | null;
    pickups_completed?: number;
  }[];
  average_quantity_per_pickup: number;
  storage_load: number;
  missed_delayed_pickups: number;
  client_volume_trend: {
    month: string;
    totals: { client_id: string; name?: string | null; quantity: number }[];
  }[];
  scans_this_week: number;
  scans_this_month: number;
  scan_volume_by_day: { date: string; count: number }[];
  activity_timeline?: {
    type: 'scan' | 'pickup';
    occurred_at: string;
    code_id?: string;
    status?: string | null;
    client_id?: string | null;
    quantity_collected?: number;
  }[];
};

type CodeRow = {
  id: string;
  size: string;
  year: number;
  status?: CodeStatus;
  status_primary?: string | null;
  status_secondary?: string | null;
  quantity?: number;
  owner_user_id?: string | null;
  created_at?: string;
  scan_count?: number;
  last_scanned_at?: string | null;
};

type CompanyDashboardView = 'metrics' | 'scanner' | 'codes' | 'clients';

const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 30000;
const SIZE_OPTIONS = ['unspecified', 'XS', 'S', 'M', 'L', 'XL', 'XXL'];

const VIEW_COPY: Record<
  CompanyDashboardView,
  { title: string; description: string }
> = {
  metrics: {
    title: 'Company Metrics',
    description: 'Monitor inventory activity across all clients.'
  },
  scanner: {
    title: 'Company Scanner',
    description: 'Scan codes and activate them for client inventory.'
  },
  codes: {
    title: 'Company Codes',
    description: 'Review and filter codes by client.'
  },
  clients: {
    title: 'Clients & Subscriptions',
    description: 'Manage client plans and visibility.'
  }
};

export default function CompanyDashboard({
  view = 'metrics'
}: {
  view?: CompanyDashboardView;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [activeScanClientId, setActiveScanClientId] = useState<string | null>(
    null
  );
  const [activationDialogOpen, setActivationDialogOpen] = useState(false);
  const [activationStep, setActivationStep] = useState<'client' | 'status'>(
    'client'
  );
  const [activationClientId, setActivationClientId] = useState<string | null>(
    null
  );
  const [pendingPayload, setPendingPayload] = useState<string | null>(null);
  const [selectedInventoryStatuses, setSelectedInventoryStatuses] = useState<
    InventoryStatus[]
  >([]);
  const [activationQuantity, setActivationQuantity] = useState(1);
  const [codesClientFilter, setCodesClientFilter] = useState<string>('all');
  const [codesPage, setCodesPage] = useState(0);
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [codesTotal, setCodesTotal] = useState(0);
  const [codesLoading, setCodesLoading] = useState(false);
  const [codeUpdateState, setCodeUpdateState] = useState<
    Record<string, boolean>
  >({});
  const [metrics, setMetrics] = useState<CompanyMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [lastScanned, setLastScanned] = useState<ScanEventWithCode | null>(
    null
  );
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<CodeStatus>('pending');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetCodeId, setDeleteTargetCodeId] = useState<string | null>(
    null
  );
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [selectedSize, setSelectedSize] = useState<string>('unspecified');
  const [preferredDeviceId, setPreferredDeviceId] = useState<string | null>(
    null
  );
  const [fallbackFacingMode, setFallbackFacingMode] = useState<
    'environment' | 'user'
  >('environment');
  const [useExactFacingMode, setUseExactFacingMode] = useState(true);
  const [isScanning, setIsScanning] = useState(true);
  const lastScanRef = useRef<string | null>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    scans,
    isLoading: scansLoading,
    error: scansError,
    recordScan,
    refreshScans
  } = useScanEvents();

  const clientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    clients.forEach((client) => map.set(client.id, client.name));
    return map;
  }, [clients]);
  // Default to the rear camera when available.
  const scannerConstraints = useMemo(() => {
    const baseConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 }
    };

    if (preferredDeviceId) {
      return { ...baseConstraints, deviceId: { exact: preferredDeviceId } };
    }

    const facingMode = useExactFacingMode
      ? { exact: fallbackFacingMode }
      : { ideal: fallbackFacingMode };

    return { ...baseConstraints, facingMode };
  }, [fallbackFacingMode, preferredDeviceId, useExactFacingMode]);

  const loadClients = useCallback(async () => {
    setClientsLoading(true);
    try {
      const res = await fetch('/api/clients');
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load clients');
      }
      const data: Client[] = await res.json();
      setClients(data);
      if (!activeScanClientId && data.length > 0) {
        setActiveScanClientId(data[0].id);
      }
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to load clients'
      );
    } finally {
      setClientsLoading(false);
    }
  }, [activeScanClientId]);

  const loadMetrics = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setMetricsLoading(true);
    }
    try {
      const res = await fetch('/api/metrics/company');
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load metrics');
      }
      const data: CompanyMetrics = await res.json();
      setMetrics(data);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to load metrics'
      );
    } finally {
      if (!options?.silent) {
        setMetricsLoading(false);
      }
    }
  }, []);

  const loadCodes = useCallback(
    async (
      page = 0,
      clientId = codesClientFilter,
      options?: { silent?: boolean }
    ) => {
      if (!options?.silent) {
        setCodesLoading(true);
      }
      try {
        const params = new URLSearchParams();
        params.set('limit', PAGE_SIZE.toString());
        params.set('offset', (page * PAGE_SIZE).toString());
        if (clientId && clientId !== 'all') {
          params.set('clientId', clientId);
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
          setCodesLoading(false);
        }
      }
    },
    [codesClientFilter]
  );

  useEffect(() => {
    loadClients();
    loadMetrics();
  }, [loadClients, loadMetrics]);

  useEffect(() => {
    loadCodes(codesPage, codesClientFilter);
  }, [codesClientFilter, codesPage, loadCodes]);

  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, []);

  const handlePlanChange = async (clientId: string, plan: 'basic' | 'pro') => {
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_plan: plan })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update plan');
      }

      const updated = await res.json();
      setClients((prev) =>
        prev.map((client) =>
          client.id === updated.id
            ? { ...client, subscription_plan: updated.subscription_plan }
            : client
        )
      );
      toast.success('Subscription updated');
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update plan'
      );
    }
  };

  const handleCodeUpdate = useCallback(
    async (
      codeId: string,
      updates: {
        owner_user_id?: string | null;
        size?: string;
        status?: CodeStatus;
      }
    ) => {
      setCodeUpdateState((prev) => ({ ...prev, [codeId]: true }));

      let previousRow: CodeRow | undefined;
      setCodes((prev) =>
        prev.map((row) => {
          if (row.id !== codeId) return row;
          previousRow = row;
          return { ...row, ...updates };
        })
      );

      try {
        const res = await fetch(`/api/codes/${codeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Failed to update code');
        }

        const payload = await res.json();
        const updatedCode = payload.code as CodeRow;

        setCodes((prev) =>
          prev.map((row) =>
            row.id === codeId
              ? {
                  ...row,
                  ...updatedCode,
                  scan_count: row.scan_count,
                  last_scanned_at: row.last_scanned_at
                }
              : row
          )
        );

        await Promise.all([
          loadCodes(codesPage, codesClientFilter, { silent: true }),
          loadMetrics({ silent: true })
        ]);
        toast.success('Code updated');
      } catch (error) {
        if (previousRow) {
          setCodes((prev) =>
            prev.map((row) => (row.id === codeId ? previousRow : row))
          );
        }
        console.error(error);
        toast.error(
          error instanceof Error ? error.message : 'Failed to update code'
        );
      } finally {
        setCodeUpdateState((prev) => ({ ...prev, [codeId]: false }));
      }
    },
    [codesClientFilter, codesPage, loadCodes, loadMetrics]
  );

  const handleStatusUpdate = async () => {
    if (!lastScanned?.code?.id) return;
    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/codes/${lastScanned.code.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: selectedStatus })
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update status');
      }

      const data = await res.json();
      const newStatus = data.code?.status || selectedStatus;

      setLastScanned((prev) =>
        prev
          ? {
              ...prev,
              status: newStatus,
              code: prev.code ? { ...prev.code, status: newStatus } : prev.code
            }
          : prev
      );

      toast.success('Status updated');
      setStatusDialogOpen(false);
      await Promise.all([
        refreshScans(),
        loadCodes(codesPage, codesClientFilter),
        loadMetrics()
      ]);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status'
      );
    } finally {
      setStatusUpdating(false);
    }
  };

  const resetActivationFlow = useCallback(
    (nextClientId?: string | null) => {
      setActivationDialogOpen(false);
      setActivationStep('client');
      setPendingPayload(null);
      setSelectedInventoryStatuses([]);
      setActivationQuantity(1);
      setActivationClientId(nextClientId ?? activeScanClientId);
      setIsScanning(true);

      lastScanRef.current = null;
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    },
    [activeScanClientId]
  );

  const openActivationFlow = useCallback(
    (payload: string) => {
      setPendingPayload(payload);
      setActivationStep('client');
      setActivationClientId(activeScanClientId);
      setSelectedInventoryStatuses([]);
      setActivationQuantity(1);
      setActivationDialogOpen(true);
      setIsScanning(false);
    },
    [activeScanClientId]
  );

  const toggleInventoryStatus = useCallback((status: InventoryStatus) => {
    setSelectedInventoryStatuses((prev) => {
      if (prev.includes(status)) {
        return prev.filter((value) => value !== status);
      }

      if (prev.length >= 2) {
        toast.error('Select up to two inventory statuses.');
        return prev;
      }

      return [...prev, status];
    });
  }, []);

  const handleActivationSubmit = async () => {
    if (!pendingPayload) {
      return;
    }

    if (!activationClientId) {
      toast.error('Select a client to continue.');
      setActivationStep('client');
      return;
    }

    if (selectedInventoryStatuses.length === 0) {
      toast.error('Select at least one inventory status.');
      return;
    }

    try {
      setIsRecording(true);
      const [primary, secondary] = selectedInventoryStatuses;
      const scanEvent = await recordScan(pendingPayload, {
        size: selectedSize,
        clientId: activationClientId,
        statusPrimary: primary,
        statusSecondary: secondary ?? null,
        quantity: activationQuantity
      });

      setLastScanned(scanEvent);
      setSelectedStatus((scanEvent.code?.status as CodeStatus) || 'pending');
      setStatusDialogOpen(true);
      setActiveScanClientId(activationClientId);
      toast.success('QR code activated', {
        description: `Code ID: ${scanEvent.code?.id || 'Unknown'}`
      });
      refreshScans();
      loadCodes(codesPage, codesClientFilter);
      loadMetrics();
      resetActivationFlow(activationClientId);
    } catch (err) {
      console.error('Error recording scan:', err);
      toast.error('Failed to record scan', {
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    } finally {
      setIsRecording(false);
    }
  };

  const handleScan = async (result: any, scanError: any) => {
    if (scanError) {
      const errorMessage = scanError?.message || scanError?.toString() || '';
      const isDecodeMiss =
        errorMessage.includes('NotFoundException') ||
        errorMessage.includes('ChecksumException') ||
        errorMessage.includes('FormatException') ||
        errorMessage.includes('selectBestPatterns');
      const isPermissionError =
        errorMessage.includes('Permission') ||
        errorMessage.includes('NotAllowedError') ||
        errorMessage.includes('denied') ||
        errorMessage.includes('NotFoundError');

      // Ignore routine decode failures when no QR is detected in a frame.
      if (isDecodeMiss) {
        return;
      }

      if (isPermissionError) {
        setCameraError(
          'Unable to access camera. Please ensure camera permissions are granted.'
        );
        setIsScanning(false);
        console.error('QR Scanner permission error:', scanError);
      }
      return;
    }

    if (!result) return;

    const resultText = result?.text || result;
    if (!resultText) return;

    if (
      lastScanRef.current === resultText ||
      isRecording ||
      activationDialogOpen
    ) {
      return;
    }
    lastScanRef.current = resultText;

    openActivationFlow(resultText);

    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }
    scanTimeoutRef.current = setTimeout(() => {
      lastScanRef.current = null;
    }, 2000);
  };

  const hasNextPage = (codesPage + 1) * PAGE_SIZE < codesTotal;
  const activeClientPlan = clients.find(
    (c) => c.id === activeScanClientId
  )?.subscription_plan;
  const clientCollectionRows = useMemo(() => {
    if (!metrics) return [];

    const rows = new Map<
      string,
      {
        client_id: string;
        name?: string | null;
        email?: string | null;
        total_quantity: number;
        pickups_completed: number;
      }
    >();

    (metrics.total_collected_per_client || []).forEach((entry) => {
      rows.set(entry.client_id, {
        client_id: entry.client_id,
        name: entry.name ?? null,
        email: entry.email ?? null,
        total_quantity: entry.total_quantity ?? 0,
        pickups_completed: 0
      });
    });

    (metrics.pickups_per_client || []).forEach((entry) => {
      const existing = rows.get(entry.client_id) || {
        client_id: entry.client_id,
        name: entry.name ?? null,
        email: entry.email ?? null,
        total_quantity: 0,
        pickups_completed: 0
      };
      existing.pickups_completed = entry.pickups_completed ?? 0;
      rows.set(entry.client_id, existing);
    });

    return Array.from(rows.values()).sort(
      (a, b) => b.total_quantity - a.total_quantity
    );
  }, [metrics]);

  const volumeTrendRows = useMemo(() => {
    if (!metrics?.client_volume_trend) return [];

    const rows = metrics.client_volume_trend.flatMap((bucket) =>
      bucket.totals.map((entry) => ({
        month: bucket.month,
        client_id: entry.client_id,
        name: entry.name ?? null,
        quantity: entry.quantity
      }))
    );

    return rows
      .sort(
        (a, b) =>
          new Date(`${b.month}-01`).getTime() -
            new Date(`${a.month}-01`).getTime() || b.quantity - a.quantity
      )
      .slice(0, 24);
  }, [metrics]);

  const viewCopy = VIEW_COPY[view];
  const showMetrics = view === 'metrics';
  const showScanner = view === 'scanner';
  const showCodes = view === 'codes';
  const showClients = view === 'clients';
  const activityTimeline = metrics?.activity_timeline ?? [];

  const getBaseUrl = useCallback(() => {
    const envUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
    if (envUrl) return envUrl;
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return '';
  }, []);

  const buildCodeUrl = useCallback(
    (codeId: string) => `${getBaseUrl()}/code/${codeId}`,
    [getBaseUrl]
  );

  const fetchAllCodes = useCallback(async () => {
    const limit = 100;
    let offset = 0;
    let allRows: CodeRow[] = [];

    while (true) {
      const params = new URLSearchParams();
      params.set('limit', limit.toString());
      params.set('offset', offset.toString());
      if (codesClientFilter && codesClientFilter !== 'all') {
        params.set('clientId', codesClientFilter);
      }

      const res = await fetch(`/api/codes?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to load codes');
      }

      const payload = await res.json();
      const pageRows: CodeRow[] = payload.codes || [];
      allRows = allRows.concat(pageRows);

      if (pageRows.length < limit) {
        break;
      }
      offset += limit;
    }

    return allRows;
  }, [codesClientFilter]);

  const handleDownloadCsv = useCallback(async () => {
    const escape = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`;

    try {
      const allRows = await fetchAllCodes();
      const header = ['code', 'client', 'size', 'year', 'status', 'url'];
      const rows = allRows.map((code) =>
        [
          code.id,
          code.owner_user_id
            ? clientNameMap.get(code.owner_user_id) || code.owner_user_id
            : 'Unassigned',
          code.size,
          code.year,
          code.status || 'pending',
          buildCodeUrl(code.id)
        ]
          .map(escape)
          .join(',')
      );
      const csv = [header.join(','), ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `company-codes-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to download CSV'
      );
    }
  }, [buildCodeUrl, clientNameMap, fetchAllCodes]);

  const handleDownloadZip = useCallback(async () => {
    try {
      const allRows = await fetchAllCodes();
      if (allRows.length === 0) return;
      const qrcode = await import('qrcode');
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      const escape = (value: string | number) =>
        `"${String(value).replace(/"/g, '""')}"`;
      const header = ['code', 'client', 'size', 'year', 'status', 'url'];
      const rows = allRows.map((code) =>
        [
          code.id,
          code.owner_user_id
            ? clientNameMap.get(code.owner_user_id) || code.owner_user_id
            : 'Unassigned',
          code.size,
          code.year,
          code.status || 'pending',
          buildCodeUrl(code.id)
        ]
          .map(escape)
          .join(',')
      );
      zip.file('codes.csv', [header.join(','), ...rows].join('\n'));

      await Promise.all(
        allRows.map(async (code) => {
          const url = buildCodeUrl(code.id);
          const dataUrl = await qrcode.toDataURL(url, {
            margin: 1,
            width: 300
          });
          const base64 = dataUrl.split(',')[1] || '';
          zip.file(`qr-${code.id}.png`, base64, { base64: true });
        })
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `company-codes-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to download ZIP'
      );
    }
  }, [buildCodeUrl, clientNameMap, fetchAllCodes]);

  const handleDownloadQr = useCallback(
    async (codeId: string) => {
      try {
        const qrcode = await import('qrcode');
        const url = buildCodeUrl(codeId);
        const dataUrl = await qrcode.toDataURL(url, {
          margin: 1,
          width: 300
        });
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `qr-${codeId}.png`;
        link.click();
      } catch (error) {
        console.error(error);
        toast.error(
          error instanceof Error ? error.message : 'Failed to download QR'
        );
      }
    },
    [buildCodeUrl]
  );

  const handleDeleteCode = useCallback(
    async (codeId: string) => {
      try {
        setDeleteLoading(true);
        const res = await fetch(`/api/codes/${codeId}`, { method: 'DELETE' });
        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(errorData.error || 'Failed to delete code');
        }
        toast.success('Code deleted');
        setDeleteDialogOpen(false);
        setDeleteTargetCodeId(null);
        await Promise.all([
          loadCodes(codesPage, codesClientFilter),
          loadMetrics(),
          refreshScans()
        ]);
      } catch (error) {
        console.error(error);
        toast.error(
          error instanceof Error ? error.message : 'Failed to delete code'
        );
      } finally {
        setDeleteLoading(false);
      }
    },
    [codesClientFilter, codesPage, loadCodes, loadMetrics, refreshScans]
  );

  const openDeleteDialog = useCallback((codeId: string) => {
    setDeleteTargetCodeId(codeId);
    setDeleteDialogOpen(true);
  }, []);

  useEffect(() => {
    if (!showScanner) return;
    let isActive = true;

    const selectCamera = async () => {
      if (!navigator?.mediaDevices?.getUserMedia) return;
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' } }
        });
        if (!isActive) return;
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings?.();
        if (settings?.deviceId) {
          setPreferredDeviceId(settings.deviceId);
        }
        setFallbackFacingMode('environment');
        setUseExactFacingMode(true);
      } catch (error) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          if (!isActive) return;
          const videoDevices = devices.filter(
            (device) => device.kind === 'videoinput'
          );
          if (videoDevices.length <= 1) {
            setFallbackFacingMode('user');
            setUseExactFacingMode(true);
            return;
          }

          setFallbackFacingMode('environment');
          setUseExactFacingMode(false);
          const labeled = videoDevices.filter((device) => device.label);
          const candidates = labeled.length > 0 ? labeled : videoDevices;
          const backMatch = candidates.find((device) =>
            /back|rear|environment/i.test(device.label)
          );
          if (backMatch?.deviceId) {
            setPreferredDeviceId(backMatch.deviceId);
          }
        } catch (innerError) {
          console.warn('Failed to detect cameras', innerError);
        }
      } finally {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      }
    };

    selectCamera();

    return () => {
      isActive = false;
    };
  }, [showScanner]);

  useEffect(() => {
    if (!showMetrics) return;
    const intervalId = setInterval(() => {
      loadMetrics({ silent: true });
      refreshScans({ silent: true });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadMetrics, refreshScans, showMetrics]);

  useEffect(() => {
    if (!showCodes) return;
    const intervalId = setInterval(() => {
      loadCodes(codesPage, codesClientFilter, { silent: true });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [codesClientFilter, codesPage, loadCodes, showCodes]);

  return (
    <PageContainer>
      <div className='space-y-8'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div>
            <h1 className='text-3xl font-bold tracking-tight'>
              {viewCopy.title}
            </h1>
            <p className='text-muted-foreground'>{viewCopy.description}</p>
          </div>
          <Badge variant='secondary'>Company</Badge>
        </div>

        {showMetrics && (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4'>
            <Card>
              <CardHeader>
                <CardDescription>Total Codes</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading ? '—' : (metrics?.total_codes ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Across all clients
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Codes This Month</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading ? '—' : (metrics?.codes_this_month ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Created since the 1st
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Pending</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading
                    ? '—'
                    : (metrics?.codes_by_status?.pending ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Waiting for action
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Completed</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading
                    ? '—'
                    : (metrics?.codes_by_status?.completed ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Finished items
              </CardFooter>
            </Card>
          </div>
        )}

        {showMetrics && (
          <Card>
            <CardHeader>
              <CardTitle>Inventory status (primary)</CardTitle>
              <CardDescription>v0.2 inventory breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <div className='grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4'>
                {INVENTORY_STATUSES.map((status) => (
                  <div key={status} className='rounded-md border p-3'>
                    <p className='text-muted-foreground text-xs'>{status}</p>
                    <p className='text-lg font-semibold'>
                      {metricsLoading
                        ? '—'
                        : (metrics?.codes_by_inventory_status?.[status] ?? 0)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {showMetrics && (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-3'>
            <Card>
              <CardHeader>
                <CardDescription>Storage Load</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading ? '—' : (metrics?.storage_load ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Quantity in storage statuses
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Avg Qty / Pickup</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading
                    ? '—'
                    : (metrics?.average_quantity_per_pickup ?? 0).toFixed(1)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Completed pickups
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Missed/Delayed Pickups</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading
                    ? '—'
                    : (metrics?.missed_delayed_pickups ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Last 30 days
              </CardFooter>
            </Card>
          </div>
        )}

        {showMetrics && (
          <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardDescription>Scans This Week</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading ? '—' : (metrics?.scans_this_week ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Since Monday (UTC)
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Scans This Month</CardDescription>
                <CardTitle className='text-3xl'>
                  {metricsLoading ? '—' : (metrics?.scans_this_month ?? 0)}
                </CardTitle>
              </CardHeader>
              <CardFooter className='text-muted-foreground text-sm'>
                Month to date
              </CardFooter>
            </Card>
          </div>
        )}

        {showMetrics && (
          <Card>
            <CardHeader>
              <CardTitle>Scan Activity</CardTitle>
              <CardDescription>
                Daily scan volume with the latest events.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metricsLoading ? (
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
                    <h4 className='text-sm font-semibold'>Latest activity</h4>
                    <div className='mt-3 space-y-2'>
                      {activityTimeline.length === 0 ? (
                        <p className='text-muted-foreground text-sm'>
                          No recent activity yet.
                        </p>
                      ) : (
                        activityTimeline.map((event, index) => (
                          <div
                            className='rounded-md border p-3'
                            key={`${event.type}-${index}`}
                          >
                            <div className='flex items-center justify-between gap-2'>
                              <p className='text-sm font-medium'>
                                {event.type === 'scan'
                                  ? `Scanned ${event.code_id ?? 'code'}`
                                  : `Pickup completed (${event.quantity_collected ?? 0})`}
                              </p>
                              <Badge variant='outline' className='capitalize'>
                                {event.type}
                              </Badge>
                            </div>
                            {event.client_id && (
                              <p className='text-muted-foreground mt-1 text-xs'>
                                Client:{' '}
                                {clientNameMap.get(event.client_id) ||
                                  event.client_id}
                              </p>
                            )}
                            <p className='text-muted-foreground mt-1 text-xs'>
                              {event.occurred_at
                                ? format(new Date(event.occurred_at), 'PP p')
                                : '—'}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showMetrics && (
          <Card>
            <CardHeader>
              <CardTitle>Client Collections</CardTitle>
              <CardDescription>
                Total collected + completed pickups
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metricsLoading ? (
                <div className='text-muted-foreground flex items-center gap-2'>
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                  Loading client totals...
                </div>
              ) : clientCollectionRows.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  No client data yet.
                </p>
              ) : (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Total Collected</TableHead>
                        <TableHead>Completed Pickups</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientCollectionRows.map((row) => (
                        <TableRow key={row.client_id}>
                          <TableCell className='text-sm'>
                            <div className='flex flex-col'>
                              <span>{row.name || '—'}</span>
                              <span className='text-muted-foreground text-xs'>
                                {row.email || row.client_id}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className='text-sm'>
                            {row.total_quantity ?? 0}
                          </TableCell>
                          <TableCell className='text-sm'>
                            {row.pickups_completed ?? 0}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showMetrics && (
          <Card>
            <CardHeader>
              <CardTitle>Client Volume Trend</CardTitle>
              <CardDescription>
                Monthly pickup quantities (sample)
              </CardDescription>
            </CardHeader>
            <CardContent>
              {metricsLoading ? (
                <div className='text-muted-foreground flex items-center gap-2'>
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                  Loading trend...
                </div>
              ) : volumeTrendRows.length === 0 ? (
                <p className='text-muted-foreground text-sm'>
                  No pickup volume yet.
                </p>
              ) : (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Quantity</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {volumeTrendRows.map((row, index) => (
                        <TableRow
                          key={`${row.client_id}-${row.month}-${index}`}
                        >
                          <TableCell className='text-sm'>{row.month}</TableCell>
                          <TableCell className='text-sm'>
                            {row.name || row.client_id}
                          </TableCell>
                          <TableCell className='text-sm'>
                            {row.quantity}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showScanner && (
          <Card>
            <CardHeader className='flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
              <div className='space-y-1'>
                <CardTitle className='flex items-center gap-2'>
                  <IconScan className='h-5 w-5' />
                  QR Scanner
                </CardTitle>
                <CardDescription>
                  Scan a code to activate it under a client and inventory
                  status.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className='grid gap-4 lg:grid-cols-[2fr,1fr]'>
                <div className='overflow-hidden rounded-lg border'>
                  {cameraError ? (
                    <div className='border-destructive/50 bg-destructive/10 flex flex-col items-center justify-center rounded-lg border p-8'>
                      <IconAlertCircle className='text-destructive mb-4 h-12 w-12' />
                      <h3 className='mb-2 text-lg font-semibold'>
                        Camera Error
                      </h3>
                      <p className='text-muted-foreground mb-4 text-center text-sm'>
                        {cameraError}
                      </p>
                      <Button
                        className='mt-2'
                        onClick={() => {
                          setCameraError(null);
                          setIsScanning(true);
                        }}
                      >
                        Try Again
                      </Button>
                    </div>
                  ) : (
                    <div className='relative mx-auto h-[400px] w-full max-w-md overflow-hidden rounded-lg bg-black'>
                      {isScanning && (
                        <>
                          <QrReader
                            key={`company-scanner-${preferredDeviceId || fallbackFacingMode}`}
                            onResult={handleScan}
                            constraints={scannerConstraints}
                            scanDelay={500}
                            containerStyle={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%'
                            }}
                            videoContainerStyle={{
                              position: 'relative',
                              width: '100%',
                              height: '100%',
                              paddingTop: 0,
                              overflow: 'hidden'
                            }}
                            videoStyle={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover'
                            }}
                            videoId='qr-video'
                            ViewFinder={() => null}
                          />
                          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
                            <div className='absolute inset-0 bg-black/30' />
                            <div className='relative z-10 h-64 w-64'>
                              <div className='border-primary absolute top-0 left-0 h-12 w-12 border-t-4 border-l-4' />
                              <div className='border-primary absolute top-0 right-0 h-12 w-12 border-t-4 border-r-4' />
                              <div className='border-primary absolute bottom-0 left-0 h-12 w-12 border-b-4 border-l-4' />
                              <div className='border-primary absolute right-0 bottom-0 h-12 w-12 border-r-4 border-b-4' />
                              <div className='animate-scan via-primary absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-transparent to-transparent' />
                            </div>
                          </div>
                          <div className='absolute bottom-4 left-1/2 z-20 -translate-x-1/2'>
                            <Badge className='bg-primary/90 backdrop-blur-sm'>
                              {isRecording ? (
                                <>
                                  <IconLoader2 className='mr-2 h-3 w-3 animate-spin' />
                                  Recording...
                                </>
                              ) : (
                                <>
                                  <IconCamera className='mr-2 h-3 w-3' />
                                  Scanning...
                                </>
                              )}
                            </Badge>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className='space-y-4'>
                  <div className='rounded-lg border p-4'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <p className='text-muted-foreground text-sm'>
                          Active client
                        </p>
                        <p className='text-lg font-semibold'>
                          {activeScanClientId
                            ? clientNameMap.get(activeScanClientId)
                            : 'Not selected'}
                        </p>
                      </div>
                      {activeClientPlan && (
                        <Badge variant='outline'>{activeClientPlan} plan</Badge>
                      )}
                    </div>
                  </div>
                  <div className='rounded-lg border p-4'>
                    <div className='flex items-center justify-between'>
                      <div>
                        <p className='text-muted-foreground text-sm'>
                          Last scanned
                        </p>
                        <p className='text-lg font-semibold'>
                          {lastScanned?.code?.id ?? '—'}
                        </p>
                      </div>
                      {lastScanned?.code?.status && (
                        <Badge variant='secondary'>
                          {CODE_STATUS_LABELS[
                            lastScanned.code.status as CodeStatus
                          ] || lastScanned.code.status}
                        </Badge>
                      )}
                    </div>
                    {lastScanned?.scanned_at && (
                      <p className='text-muted-foreground mt-2 text-xs'>
                        {format(new Date(lastScanned.scanned_at), 'PPpp')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {showCodes && (
          <Card>
            <CardHeader className='flex flex-col gap-3'>
              <div>
                <CardTitle>Codes by Client</CardTitle>
                <CardDescription>
                  Filter codes by client and monitor their status.
                </CardDescription>
              </div>
              <div className='flex w-full flex-col gap-3 md:flex-row md:items-end'>
                <div className='flex w-full flex-col gap-3 md:flex-row md:items-end'>
                  <Select
                    value={codesClientFilter}
                    onValueChange={(value) => {
                      setCodesPage(0);
                      setCodesClientFilter(value);
                    }}
                  >
                    <SelectTrigger className='w-full md:w-[240px]'>
                      <SelectValue placeholder='Filter by client' />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='all'>All clients</SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className='text-muted-foreground text-sm md:ml-2'>
                    {codesTotal} code{codesTotal === 1 ? '' : 's'}
                  </div>
                </div>
                <div className='flex items-center gap-2 md:ml-auto md:flex-nowrap'>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleDownloadCsv}
                    disabled={codesTotal === 0}
                  >
                    <IconDownload className='mr-2 h-4 w-4' />
                    CSV
                  </Button>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={handleDownloadZip}
                    disabled={codesTotal === 0}
                  >
                    <IconDownload className='mr-2 h-4 w-4' />
                    ZIP
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {codesLoading ? (
                <div className='text-muted-foreground flex items-center gap-2'>
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                  Loading codes...
                </div>
              ) : codes.length === 0 ? (
                <p className='text-muted-foreground text-sm'>No codes found.</p>
              ) : (
                <div className='-mx-6 overflow-x-auto'>
                  <div className='min-w-[960px] px-6'>
                    <Table className='w-full'>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code ID</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead className='hidden sm:table-cell'>
                            Size
                          </TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='hidden md:table-cell'>
                            Year
                          </TableHead>
                          <TableHead className='hidden md:table-cell'>
                            Created
                          </TableHead>
                          <TableHead className='hidden md:table-cell'>
                            Total Scans
                          </TableHead>
                          <TableHead className='hidden lg:table-cell'>
                            Last Scan
                          </TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {codes.map((code) => {
                          const isRowUpdating = Boolean(
                            codeUpdateState[code.id]
                          );

                          return (
                            <TableRow key={code.id}>
                              <TableCell>
                                <code className='font-mono text-sm'>
                                  {code.id}
                                </code>
                              </TableCell>
                              <TableCell className='text-sm'>
                                <Select
                                  value={code.owner_user_id ?? 'unassigned'}
                                  onValueChange={(value) =>
                                    handleCodeUpdate(code.id, {
                                      owner_user_id:
                                        value === 'unassigned' ? null : value
                                    })
                                  }
                                  disabled={isRowUpdating || clientsLoading}
                                >
                                  <SelectTrigger className='h-8 w-[180px] max-w-[220px]'>
                                    <SelectValue placeholder='Assign client' />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value='unassigned'>
                                      Unassigned
                                    </SelectItem>
                                    {clients.map((client) => (
                                      <SelectItem
                                        key={client.id}
                                        value={client.id}
                                      >
                                        {client.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className='hidden text-sm sm:table-cell'>
                                <Select
                                  value={code.size || 'unspecified'}
                                  onValueChange={(value) =>
                                    handleCodeUpdate(code.id, { size: value })
                                  }
                                  disabled={isRowUpdating}
                                >
                                  <SelectTrigger className='h-8 w-[110px]'>
                                    <SelectValue placeholder='Size' />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SIZE_OPTIONS.map((option) => (
                                      <SelectItem key={option} value={option}>
                                        {option === 'unspecified'
                                          ? 'Unspecified'
                                          : option}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={code.status || 'pending'}
                                  onValueChange={(value) =>
                                    handleCodeUpdate(code.id, {
                                      status: value as CodeStatus
                                    })
                                  }
                                  disabled={isRowUpdating}
                                >
                                  <SelectTrigger className='h-8 w-[170px]'>
                                    <SelectValue placeholder='Status' />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CODE_STATUSES.map((status) => (
                                      <SelectItem key={status} value={status}>
                                        {CODE_STATUS_LABELS[status]}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className='hidden text-sm md:table-cell'>
                                {code.year}
                              </TableCell>
                              <TableCell className='text-muted-foreground hidden text-sm md:table-cell'>
                                {code.created_at
                                  ? format(new Date(code.created_at), 'PP')
                                  : '—'}
                              </TableCell>
                              <TableCell className='hidden text-sm md:table-cell'>
                                {code.scan_count ?? 0}
                              </TableCell>
                              <TableCell className='text-muted-foreground hidden text-xs lg:table-cell'>
                                {code.last_scanned_at
                                  ? format(
                                      new Date(code.last_scanned_at),
                                      'PP p'
                                    )
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                <div className='flex items-center gap-2'>
                                  <Button
                                    variant='outline'
                                    size='icon'
                                    onClick={() => handleDownloadQr(code.id)}
                                    aria-label={`Download QR for ${code.id}`}
                                  >
                                    <IconDownload className='h-4 w-4' />
                                  </Button>
                                  <Button
                                    variant='outline'
                                    size='icon'
                                    onClick={() => openDeleteDialog(code.id)}
                                    aria-label={`Delete code ${code.id}`}
                                    className='text-destructive hover:text-destructive'
                                  >
                                    <IconTrash className='h-4 w-4' />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className='flex items-center justify-between'>
              <Button
                variant='outline'
                size='sm'
                disabled={codesPage === 0 || codesLoading}
                onClick={() => setCodesPage((p) => Math.max(p - 1, 0))}
              >
                Previous
              </Button>
              <div className='text-muted-foreground text-sm'>
                Page {codesPage + 1} of{' '}
                {Math.max(1, Math.ceil(codesTotal / PAGE_SIZE))}
              </div>
              <Button
                variant='outline'
                size='sm'
                disabled={!hasNextPage || codesLoading}
                onClick={() => setCodesPage((p) => p + 1)}
              >
                Next
              </Button>
            </CardFooter>
          </Card>
        )}

        {showClients && (
          <Card>
            <CardHeader className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
              <div>
                <CardTitle>Clients &amp; Subscription</CardTitle>
                <CardDescription>
                  Promote clients to pro for deeper metrics.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {clientsLoading ? (
                <div className='text-muted-foreground flex items-center gap-2'>
                  <IconLoader2 className='h-4 w-4 animate-spin' />
                  Loading clients...
                </div>
              ) : clients.length === 0 ? (
                <p className='text-muted-foreground text-sm'>No clients yet.</p>
              ) : (
                <div className='-mx-6 overflow-x-auto'>
                  <div className='min-w-[900px] px-6'>
                    <Table className='w-full'>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Client</TableHead>
                          <TableHead className='hidden sm:table-cell'>
                            Contact Email
                          </TableHead>
                          <TableHead className='hidden sm:table-cell'>
                            Total Codes
                          </TableHead>
                          <TableHead className='hidden md:table-cell'>
                            Active Codes
                          </TableHead>
                          <TableHead className='hidden md:table-cell'>
                            Total Scans
                          </TableHead>
                          <TableHead className='hidden lg:table-cell'>
                            Last Scan
                          </TableHead>
                          <TableHead>Plan</TableHead>
                          <TableHead className='hidden xl:table-cell'>
                            Created
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {clients.map((client) => (
                          <TableRow key={client.id}>
                            <TableCell className='text-sm'>
                              <div className='flex flex-col'>
                                <span className='flex items-center gap-2'>
                                  <IconUsers className='text-muted-foreground h-4 w-4' />
                                  {client.name}
                                </span>
                                <span className='text-muted-foreground text-xs sm:hidden'>
                                  {client.email || '—'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className='text-muted-foreground hidden text-sm sm:table-cell'>
                              {client.email || '—'}
                            </TableCell>
                            <TableCell className='hidden text-sm sm:table-cell'>
                              {client.total_codes ?? 0}
                            </TableCell>
                            <TableCell className='hidden text-sm md:table-cell'>
                              {client.active_codes ?? 0}
                            </TableCell>
                            <TableCell className='hidden text-sm md:table-cell'>
                              {client.total_scans ?? 0}
                            </TableCell>
                            <TableCell className='text-muted-foreground hidden text-xs lg:table-cell'>
                              {client.last_scanned_at
                                ? format(
                                    new Date(client.last_scanned_at),
                                    'PP p'
                                  )
                                : '—'}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={client.subscription_plan}
                                onValueChange={(value) =>
                                  handlePlanChange(
                                    client.id,
                                    value as 'basic' | 'pro'
                                  )
                                }
                              >
                                <SelectTrigger className='w-32'>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='basic'>Basic</SelectItem>
                                  <SelectItem value='pro'>Pro</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className='text-muted-foreground hidden text-sm xl:table-cell'>
                              {client.created_at
                                ? format(new Date(client.created_at), 'PP')
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {showMetrics && (
          <>
            <Card>
              <CardHeader className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
                <div>
                  <CardTitle>Codes Per Month</CardTitle>
                  <CardDescription>
                    Recent creation trend (last 12 months)
                  </CardDescription>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => loadMetrics()}
                >
                  Refresh
                </Button>
              </CardHeader>
              <CardContent className='h-80'>
                {metricsLoading ? (
                  <div className='text-muted-foreground flex h-full items-center justify-center gap-2'>
                    <IconLoader2 className='h-4 w-4 animate-spin' />
                    Loading chart...
                  </div>
                ) : (
                  <ResponsiveContainer width='100%' height='100%'>
                    <LineChart data={metrics?.codes_per_month || []}>
                      <CartesianGrid strokeDasharray='3 3' />
                      <XAxis dataKey='month' tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'hsl(var(--popover))',
                          border: '1px solid hsl(var(--border))',
                          color: 'hsl(var(--foreground))'
                        }}
                        labelStyle={{ color: 'hsl(var(--foreground))' }}
                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                      />
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
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
                <div>
                  <CardTitle>Recent Scans</CardTitle>
                  <CardDescription>
                    Showing the latest 10 scans you performed
                  </CardDescription>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => refreshScans()}
                  disabled={scansLoading}
                >
                  {scansLoading ? (
                    <>
                      <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />{' '}
                      Refreshing
                    </>
                  ) : (
                    'Refresh'
                  )}
                </Button>
              </CardHeader>
              <CardContent>
                {scansError && (
                  <div className='border-destructive/50 bg-destructive/10 text-destructive mb-4 rounded-md border p-3 text-sm'>
                    {scansError.message}
                  </div>
                )}
                {scansLoading ? (
                  <div className='text-muted-foreground flex items-center gap-2'>
                    <IconLoader2 className='h-4 w-4 animate-spin' />
                    Loading scans...
                  </div>
                ) : scans.length === 0 ? (
                  <p className='text-muted-foreground text-sm'>No scans yet.</p>
                ) : (
                  <div className='overflow-x-auto'>
                    <Table className='min-w-[640px]'>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Code ID</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className='hidden md:table-cell'>
                            Payload
                          </TableHead>
                          <TableHead>Scanned At</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {scans.slice(0, 10).map((scan) => (
                          <TableRow key={scan.id}>
                            <TableCell className='font-mono text-sm'>
                              {scan.code?.id || scan.code_id}
                            </TableCell>
                            <TableCell>
                              <Badge variant='outline'>
                                {scan.status
                                  ? CODE_STATUS_LABELS[
                                      scan.status as CodeStatus
                                    ] || scan.status
                                  : scan.code?.status
                                    ? CODE_STATUS_LABELS[
                                        scan.code.status as CodeStatus
                                      ] || scan.code.status
                                    : 'pending'}
                              </Badge>
                            </TableCell>
                            <TableCell className='text-muted-foreground hidden text-xs md:table-cell'>
                              <code>{scan.raw_payload.slice(0, 40)}</code>
                            </TableCell>
                            <TableCell className='text-muted-foreground text-xs'>
                              {format(new Date(scan.scanned_at), 'PP p')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {showScanner && (
        <>
          <Dialog
            open={activationDialogOpen}
            onOpenChange={(open) => {
              if (!open) {
                resetActivationFlow();
              } else {
                setActivationDialogOpen(true);
              }
            }}
          >
            <DialogContent>
              {activationStep === 'client' ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Step 1: Select client</DialogTitle>
                    <DialogDescription>
                      Choose the client this QR code will be activated under.
                    </DialogDescription>
                  </DialogHeader>
                  <div className='space-y-3'>
                    {clientsLoading ? (
                      <div className='text-muted-foreground flex items-center gap-2'>
                        <IconLoader2 className='h-4 w-4 animate-spin' />
                        Loading clients...
                      </div>
                    ) : (
                      <Command>
                        <CommandInput placeholder='Search clients...' />
                        <CommandList>
                          <CommandEmpty>No clients found.</CommandEmpty>
                          <CommandGroup>
                            {clients.map((client) => (
                              <CommandItem
                                key={client.id}
                                value={`${client.name} ${client.email ?? ''}`.trim()}
                                onSelect={() => {
                                  setActivationClientId(client.id);
                                  setActiveScanClientId(client.id);
                                }}
                              >
                                <div className='flex flex-col'>
                                  <span className='text-sm'>{client.name}</span>
                                  <span className='text-muted-foreground text-xs'>
                                    {client.email || '—'}
                                  </span>
                                </div>
                                {client.id === activationClientId && (
                                  <Badge
                                    className='ml-auto'
                                    variant='secondary'
                                  >
                                    Selected
                                  </Badge>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    )}
                  </div>
                  <DialogFooter>
                    <Button
                      variant='outline'
                      onClick={() => resetActivationFlow()}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => setActivationStep('status')}
                      disabled={!activationClientId}
                    >
                      Next
                    </Button>
                  </DialogFooter>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Step 2: Inventory status</DialogTitle>
                    <DialogDescription>
                      Select up to two statuses and confirm the quantity.
                    </DialogDescription>
                  </DialogHeader>
                  <div className='space-y-4'>
                    <div className='bg-muted/30 rounded-md border p-3'>
                      <p className='text-muted-foreground text-xs'>Client</p>
                      <p className='text-sm font-medium'>
                        {activationClientId
                          ? clientNameMap.get(activationClientId) ||
                            'Selected client'
                          : 'Select client'}
                      </p>
                    </div>
                    <div className='grid gap-2 md:grid-cols-2'>
                      {INVENTORY_STATUSES.map((status) => (
                        <label
                          key={status}
                          className='flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm'
                        >
                          <Checkbox
                            checked={selectedInventoryStatuses.includes(status)}
                            onCheckedChange={() =>
                              toggleInventoryStatus(status)
                            }
                          />
                          <span>{status}</span>
                        </label>
                      ))}
                    </div>
                    <p className='text-muted-foreground text-xs'>
                      Pick one or two options. Use “None” for no inventory
                      status.
                    </p>
                    <div className='grid gap-2'>
                      <Label htmlFor='activation-size'>Size</Label>
                      <Select
                        value={selectedSize}
                        onValueChange={setSelectedSize}
                      >
                        <SelectTrigger id='activation-size'>
                          <SelectValue placeholder='Select size' />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='unspecified'>
                            Unspecified
                          </SelectItem>
                          <SelectItem value='XS'>XS</SelectItem>
                          <SelectItem value='S'>S</SelectItem>
                          <SelectItem value='M'>M</SelectItem>
                          <SelectItem value='L'>L</SelectItem>
                          <SelectItem value='XL'>XL</SelectItem>
                          <SelectItem value='XXL'>XXL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='grid gap-2'>
                      <Label htmlFor='activation-quantity'>Quantity</Label>
                      <Input
                        id='activation-quantity'
                        type='number'
                        min={1}
                        value={activationQuantity}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next > 0) {
                            setActivationQuantity(next);
                          } else {
                            setActivationQuantity(1);
                          }
                        }}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      variant='outline'
                      onClick={() => setActivationStep('client')}
                    >
                      Back
                    </Button>
                    <Button
                      onClick={handleActivationSubmit}
                      disabled={
                        isRecording ||
                        !activationClientId ||
                        selectedInventoryStatuses.length === 0
                      }
                    >
                      {isRecording && (
                        <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                      )}
                      Save
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>

          <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Update Status</DialogTitle>
                <DialogDescription>
                  Adjust the status for {lastScanned?.code?.id ?? 'this code'}.
                </DialogDescription>
              </DialogHeader>
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>Current</span>
                  <Badge variant='outline'>
                    {lastScanned?.code?.status
                      ? CODE_STATUS_LABELS[
                          lastScanned.code.status as CodeStatus
                        ] || lastScanned.code.status
                      : 'pending'}
                  </Badge>
                </div>
                <Select
                  value={selectedStatus}
                  onValueChange={(value) =>
                    setSelectedStatus(value as CodeStatus)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder='Select status' />
                  </SelectTrigger>
                  <SelectContent>
                    {CODE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {CODE_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  variant='outline'
                  onClick={() => setStatusDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleStatusUpdate} disabled={statusUpdating}>
                  {statusUpdating && (
                    <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                  )}
                  Save
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteDialogOpen(false);
            setDeleteTargetCodeId(null);
          } else {
            setDeleteDialogOpen(true);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete code</DialogTitle>
            <DialogDescription>
              {deleteTargetCodeId
                ? `Delete code ${deleteTargetCodeId}? This cannot be undone.`
                : 'This cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setDeleteDialogOpen(false);
                setDeleteTargetCodeId(null);
              }}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={() => {
                if (deleteTargetCodeId) {
                  handleDeleteCode(deleteTargetCodeId);
                }
              }}
              disabled={!deleteTargetCodeId || deleteLoading}
            >
              {deleteLoading ? (
                <>
                  <IconLoader2 className='mr-2 h-4 w-4 animate-spin' />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
