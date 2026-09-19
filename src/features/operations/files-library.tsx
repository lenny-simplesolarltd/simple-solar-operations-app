import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { formatDate } from '@/features/jobs/format';
import Link from 'next/link';
import {
  EVIDENCE_GROUPS,
  evidenceGroupKey,
  evidenceGroupLabel
} from './evidence-groups';
import { EvidenceLinks } from './evidence-list';
import type { EvidenceSearchFile } from './evidence-queries';
import { evidenceCategoryLabel, formatBytes } from './evidence-rules';

// The Files library: search form (plain GET, so a search can be bookmarked or
// shared) and the results. What each person may see is decided by
// public.search_evidence.

export interface FilesQuery {
  q: string;
  category: string;
  from: string;
  to: string;
  offset: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_CATEGORIES = new Set<string>(
  EVIDENCE_GROUPS.flatMap((g) => g.categories)
);

const first = (v: string | string[] | undefined) =>
  ((Array.isArray(v) ? v[0] : v) ?? '').trim();

export function parseFilesQuery(
  params: Record<string, string | string[] | undefined>
): FilesQuery {
  const category = first(params.category);
  const from = first(params.from);
  const to = first(params.to);
  const offset = Number.parseInt(first(params.offset), 10);
  return {
    q: first(params.q).slice(0, 120),
    category: KNOWN_CATEGORIES.has(category) ? category : '',
    from: DATE.test(from) ? from : '',
    to: DATE.test(to) ? to : '',
    offset: Number.isFinite(offset) && offset > 0 ? offset : 0
  };
}

/** The query string for a Files library URL (blank values left out). */
export function filesHref(query: Partial<FilesQuery>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '' && value !== 0)
      params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `/dashboard/files?${s}` : '/dashboard/files';
}

const control =
  'border-input bg-background h-9 w-full rounded-md border px-3 text-sm';

export function FilesSearchForm({ query }: { query: FilesQuery }) {
  const filtered = !!(query.q || query.category || query.from || query.to);
  return (
    <form
      method='get'
      action='/dashboard/files'
      role='search'
      aria-label='Search files'
      className='bg-card grid gap-3 rounded-lg border p-3 md:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_auto_auto_auto] lg:items-end'
    >
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='files-q'>Search</Label>
        <Input
          id='files-q'
          name='q'
          type='search'
          defaultValue={query.q}
          maxLength={120}
          placeholder='Customer, job ref, postcode or file name'
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='files-category'>Type of file</Label>
        <select
          id='files-category'
          name='category'
          defaultValue={query.category}
          className={control}
        >
          <option value=''>All files</option>
          {EVIDENCE_GROUPS.map((g) => (
            <optgroup key={g.key} label={g.label}>
              {g.categories.map((c) => (
                <option key={c} value={c}>
                  {evidenceCategoryLabel(c)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='files-from'>Added from</Label>
        <Input
          id='files-from'
          name='from'
          type='date'
          defaultValue={query.from}
        />
      </div>
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='files-to'>Added to</Label>
        <Input id='files-to' name='to' type='date' defaultValue={query.to} />
      </div>
      <div className='flex gap-2'>
        <Button type='submit'>Search</Button>
        {filtered && (
          <Button asChild variant='ghost'>
            <Link href='/dashboard/files'>Clear</Link>
          </Button>
        )}
      </div>
    </form>
  );
}

function JobCell({ file }: { file: EvidenceSearchFile }) {
  return (
    <Link href={`/dashboard/jobs/${file.job_id}?tab=files`}>
      <span className='decoration-primary font-mono font-semibold underline decoration-2 underline-offset-4'>
        {file.job_ref}
      </span>
      <span className='text-muted-foreground block text-xs'>
        {[file.customer_name, file.postcode].filter(Boolean).join(' · ')}
      </span>
    </Link>
  );
}

function Kind({ file }: { file: EvidenceSearchFile }) {
  return (
    <span className='flex flex-col items-start gap-1'>
      <Badge variant='outline'>{evidenceCategoryLabel(file.category)}</Badge>
      <span className='text-muted-foreground text-xs'>
        {evidenceGroupLabel(evidenceGroupKey(file))}
      </span>
    </span>
  );
}

const meta = (file: EvidenceSearchFile) =>
  [
    file.added_at ? formatDate(file.added_at) : null,
    file.added_by_name,
    formatBytes(file.size_bytes),
    file.task_title
  ].filter(Boolean);

export function FilesResults({
  files,
  total,
  query,
  pageSize
}: {
  files: EvidenceSearchFile[];
  total: number;
  query: FilesQuery;
  pageSize: number;
}) {
  if (files.length === 0) {
    return (
      <EmptyState
        title='No files match'
        description={
          query.offset > 0
            ? 'There are no more files for this search.'
            : 'Try a different search, file type or date range. You only see files on work you can access.'
        }
      />
    );
  }
  const start = query.offset + 1;
  const end = query.offset + files.length;
  const hasPrevious = query.offset > 0;
  const hasNext = end < total;

  return (
    <div className='flex flex-col gap-3'>
      <p className='text-muted-foreground text-sm' aria-live='polite'>
        {total === files.length && !hasPrevious
          ? `${total} ${total === 1 ? 'file' : 'files'}`
          : `Showing ${start}-${end} of ${total} files`}
        , newest first
      </p>

      <div className='hidden overflow-x-auto rounded-lg border md:block'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Job</TableHead>
              <TableHead className='whitespace-nowrap'>Added</TableHead>
              <TableHead className='text-right'>
                <span className='sr-only'>Open or download</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((f) => (
              <TableRow key={f.id}>
                <TableCell className='max-w-xs'>
                  <span className='block truncate font-medium'>
                    {f.filename ?? 'File'}
                  </span>
                  {f.task_title && (
                    <span className='text-muted-foreground block truncate text-xs'>
                      {f.task_title}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Kind file={f} />
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  <JobCell file={f} />
                </TableCell>
                <TableCell className='whitespace-nowrap'>
                  {f.added_at ? formatDate(f.added_at) : '-'}
                  <span className='text-muted-foreground block text-xs'>
                    {[f.added_by_name, formatBytes(f.size_bytes)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </TableCell>
                <TableCell>
                  <div className='flex justify-end'>
                    <EvidenceLinks id={f.id} filename={f.filename} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className='flex flex-col gap-2 md:hidden'>
        {files.map((f) => (
          <li
            key={f.id}
            className='bg-card flex flex-col gap-2 rounded-lg border p-3'
          >
            <div className='flex items-start justify-between gap-2'>
              <span className='min-w-0 truncate font-medium'>
                {f.filename ?? 'File'}
              </span>
              <Badge variant='outline'>
                {evidenceCategoryLabel(f.category)}
              </Badge>
            </div>
            <JobCell file={f} />
            <p className='text-muted-foreground text-xs'>
              {meta(f).join(' · ')}
            </p>
            <EvidenceLinks id={f.id} filename={f.filename} />
          </li>
        ))}
      </ul>

      {(hasPrevious || hasNext) && (
        <nav
          aria-label='Pages of results'
          className='flex items-center justify-between gap-2'
        >
          {hasPrevious ? (
            <Button asChild variant='outline' size='sm'>
              <Link
                href={filesHref({
                  ...query,
                  offset: Math.max(query.offset - pageSize, 0)
                })}
              >
                Previous
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {hasNext && (
            <Button asChild variant='outline' size='sm'>
              <Link href={filesHref({ ...query, offset: end })}>Next</Link>
            </Button>
          )}
        </nav>
      )}
    </div>
  );
}
