'use client';

import { Button } from '@/components/ui/button';
import { IconDownload, IconLoader2 } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { exportDailyReportAction, exportVisitsAction } from '../server/actions';
import type { VisitFilters } from '../types';

/**
 * CSV export.
 *
 * The file is an OUTPUT. The rows come from the same filtered query the screen
 * reads, so the file and the screen cannot disagree; and nothing is ever read
 * back in from one. A spreadsheet is not the operational system.
 */
function download(filename: string, csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: 'text/csv;charset=utf-8' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportVisitsButton({
  programmeId,
  filters,
  label = 'Export CSV'
}: {
  programmeId: string;
  filters?: VisitFilters;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type='button'
      variant='outline'
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await exportVisitsAction(programmeId, filters ?? {});
        setBusy(false);
        if (result.ok) download(result.filename, result.csv);
        else toast.error(result.message);
      }}
    >
      {busy ? (
        <IconLoader2 aria-hidden className='animate-spin' />
      ) : (
        <IconDownload aria-hidden />
      )}
      {label}
    </Button>
  );
}

export function ExportDailyReportButton({
  programmeId,
  date
}: {
  programmeId: string;
  date?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type='button'
      variant='outline'
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await exportDailyReportAction(programmeId, date);
        setBusy(false);
        if (result.ok) download(result.filename, result.csv);
        else toast.error(result.message);
      }}
    >
      {busy ? (
        <IconLoader2 aria-hidden className='animate-spin' />
      ) : (
        <IconDownload aria-hidden />
      )}
      Download daily report
    </Button>
  );
}
