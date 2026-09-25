'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { IconLoader2, IconUpload } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { IMPORT_KEY_LABEL } from '../labels';
import {
  IMPORT_FILE_ACCEPT,
  importChunks,
  missingRequiredKeys,
  planImport
} from '../server/import-plan';
import { loadImportRowsAction } from '../server/preview';
import {
  addImportRowsAction,
  applyImportAction,
  createImportAction,
  discardImportAction,
  mapImportAction
} from '../server/actions';
import {
  IMPORT_KEYS,
  importKeyRequired,
  DEFAULT_IDENTITY_KEY,
  type IdentityKey,
  type ImportKey,
  type ImportRow,
  type ImportSummary
} from '../types';

/**
 * Property import: upload, parse, map columns, validate, preview, import.
 *
 * The browser parses the file because that is the only place the file exists, and
 * stages the rows POSITIONALLY - a header name is a label, the column index is
 * the identity, because real exports repeat header names. Everything after that
 * happens in the database: the mapping, the per-row validation, the create-or-
 * update decision and the import itself. So the preview is not a second opinion
 * about what would happen; it is a reading of what the database decided WILL
 * happen.
 *
 * Nothing about any particular spreadsheet's shape is assumed. The column
 * guesses are only a first offer, and a person confirms every one.
 *
 * What a property file IS - the accepted types, the size limit, the column
 * guesses, the notes about blank and ragged rows, and the chunk size - lives in
 * server/import-plan, because SimpleBot's upload route has to reach the same
 * conclusions about the same bytes. Two copies of guessMapping would mean the
 * screen guessing one column and chat another, with nobody able to say which
 * was right.
 */

type Stage = 'choose' | 'staging' | 'map' | 'preview' | 'done';

export function ImportWizard({
  programmeId,
  identityKey = DEFAULT_IDENTITY_KEY,
  existing,
  existingRows
}: {
  programmeId: string;
  /** Which column this programme identifies a property by. Marked required below. */
  identityKey?: IdentityKey;
  /** An import already in progress, so a reload does not lose the staged rows. */
  existing?: ImportSummary | null;
  existingRows?: ImportRow[];
}) {
  const required = importKeyRequired(identityKey);
  const router = useRouter();
  const picker = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>(
    existing?.status === 'Mapped' ? 'preview' : existing ? 'map' : 'choose'
  );
  const [summary, setSummary] = useState<ImportSummary | null>(
    existing ?? null
  );
  const [rows, setRows] = useState<ImportRow[]>(existingRows ?? []);
  const [header, setHeader] = useState<string[]>(existing?.header ?? []);
  const [mapping, setMapping] = useState<Partial<Record<ImportKey, number>>>(
    (existing?.mapping as Partial<Record<ImportKey, number>>) ?? {}
  );
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  async function choose(file: File | null | undefined) {
    if (!file) return;
    setProblem(null);
    setNotes([]);
    // The screen keeps the mapping step, so a file whose headings are
    // unfamiliar is still worth staging: requireMapping is left off here.
    const plan = planImport({
      filename: file.name,
      text: await file.text(),
      sizeBytes: file.size
    });
    if (!plan.ok) {
      setProblem(plan.message);
      return;
    }
    const table = plan.table;
    setNotes(plan.notes);

    setBusy(true);
    setStage('staging');
    setHeader(table.header);
    setMapping(plan.mapping);

    const importId = crypto.randomUUID();
    const created = await createImportAction(
      { importId, programmeId, filename: file.name, header: table.header },
      crypto.randomUUID()
    );
    if (!created.ok) {
      setBusy(false);
      setStage('choose');
      setProblem(created.outcome.message);
      return;
    }

    // Chunked so a 1,400-row file is not one enormous request, and so a failure
    // part-way through leaves the rows that did arrive.
    let staged = 0;
    for (const chunk of importChunks(table.rows)) {
      const added = await addImportRowsAction(
        { importId, fromIndex: chunk.fromIndex, rows: chunk.rows },
        crypto.randomUUID()
      );
      if (!added.ok) {
        setBusy(false);
        setStage('choose');
        setProblem(added.outcome.message);
        return;
      }
      staged += chunk.rows.length;
      setProgress(Math.round((staged / table.rows.length) * 100));
    }
    setBusy(false);
    setSummary({
      id: importId,
      programmeId,
      filename: file.name,
      header: table.header,
      rowCount: table.rows.length,
      mapping: null,
      status: 'Draft',
      validRows: null,
      invalidRows: null,
      createdCount: null,
      updatedCount: null,
      appliedAt: null,
      createdAt: new Date().toISOString(),
      version: 1
    });
    setStage('map');
  }

  async function validate() {
    if (!summary) return;
    setProblem(null);
    const missing = missingRequiredKeys(mapping);
    if (missing.length) {
      setProblem(
        `Choose the column for ${missing.map((k) => IMPORT_KEY_LABEL[k]).join(' and ')}.`
      );
      return;
    }
    setBusy(true);
    const mapped = await mapImportAction(
      {
        importId: summary.id,
        programmeId,
        mapping: mapping as Record<string, number>,
        expectedVersion: summary.version
      },
      crypto.randomUUID()
    );
    setBusy(false);
    if (!mapped.ok) {
      setProblem(mapped.outcome.message);
      return;
    }
    const result = mapped.result as {
      valid_rows: number;
      invalid_rows: number;
      version: number;
    };
    setSummary({
      ...summary,
      status: 'Mapped',
      mapping: mapping as Record<string, number>,
      validRows: result.valid_rows,
      invalidRows: result.invalid_rows,
      version: result.version
    });
    setStage('preview');
    router.refresh();
  }

  async function apply() {
    if (!summary) return;
    setProblem(null);
    setBusy(true);
    const applied = await applyImportAction(
      {
        importId: summary.id,
        programmeId,
        expectedVersion: summary.version
      },
      crypto.randomUUID()
    );
    setBusy(false);
    if (!applied.ok) {
      setProblem(applied.outcome.message);
      return;
    }
    const result = applied.result as { created: number; updated: number };
    toast.success(
      `${result.created} ${result.created === 1 ? 'property' : 'properties'} added, ${result.updated} updated.`
    );
    setStage('done');
    router.refresh();
  }

  async function discard() {
    if (!summary) return;
    setBusy(true);
    await discardImportAction(
      { importId: summary.id, programmeId, expectedVersion: summary.version },
      crypto.randomUUID()
    );
    setBusy(false);
    setSummary(null);
    setRows([]);
    setStage('choose');
    router.refresh();
  }

  const usedColumns = new Set(
    Object.values(mapping).filter((v): v is number => v !== undefined)
  );

  return (
    <div className='flex flex-col gap-5'>
      {problem && (
        <p
          role='alert'
          className='bg-destructive-soft text-destructive rounded-lg px-3 py-2 text-sm font-medium'
        >
          {problem}
        </p>
      )}
      {notes.length > 0 && (
        <ul className='bg-info-soft text-info flex flex-col gap-1 rounded-lg px-3 py-2 text-sm'>
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {stage === 'choose' && (
        <section className='flex flex-col gap-3'>
          <p className='text-muted-foreground text-sm'>
            Choose the property list as a CSV file. Nothing is imported until
            you have seen exactly what will happen.
          </p>
          <input
            ref={picker}
            id='import-file'
            type='file'
            accept={IMPORT_FILE_ACCEPT}
            className='sr-only'
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <Button
            type='button'
            className='h-12 w-fit'
            onClick={() => picker.current?.click()}
          >
            <IconUpload aria-hidden />
            Choose a CSV file
          </Button>
          <p className='text-muted-foreground text-xs'>
            Columns are matched by position, so repeated header names are not a
            problem. You choose what each column means in the next step.
          </p>
        </section>
      )}

      {stage === 'staging' && (
        <section className='flex flex-col gap-2'>
          <p className='flex items-center gap-2 text-sm'>
            <IconLoader2 aria-hidden className='size-4 animate-spin' />
            Staging rows…
          </p>
          <Progress value={progress} aria-label='Staging rows' />
        </section>
      )}

      {stage === 'map' && summary && (
        <section className='flex flex-col gap-4'>
          <div>
            <h3 className='text-sm font-semibold'>
              {summary.filename} · {summary.rowCount} rows
            </h3>
            <p className='text-muted-foreground text-sm'>
              Say what each column means. We have guessed from the headings —
              check them.
            </p>
          </div>
          <div className='grid gap-3 sm:grid-cols-2'>
            {IMPORT_KEYS.map((key) => (
              <div key={key} className='flex flex-col gap-1.5'>
                <Label htmlFor={`map-${key}`}>
                  {IMPORT_KEY_LABEL[key]}
                  {required.includes(key) && (
                    <span aria-hidden className='text-destructive ml-0.5'>
                      *
                    </span>
                  )}
                </Label>
                <select
                  id={`map-${key}`}
                  value={mapping[key] ?? ''}
                  onChange={(e) =>
                    setMapping((m) => {
                      const next = { ...m };
                      if (e.target.value === '') delete next[key];
                      else next[key] = Number(e.target.value);
                      return next;
                    })
                  }
                  className='border-input bg-background h-11 rounded-md border px-3 text-sm'
                >
                  <option value=''>Not in this file</option>
                  {header.map((label, index) => (
                    <option
                      key={index}
                      value={index}
                      disabled={
                        usedColumns.has(index) && mapping[key] !== index
                      }
                    >
                      Column {index + 1}: {label || '(no heading)'}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <div className='flex gap-2'>
            <Button
              type='button'
              disabled={busy}
              onClick={() => void validate()}
            >
              {busy && <IconLoader2 aria-hidden className='animate-spin' />}
              Check the rows
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => void discard()}
            >
              Start again
            </Button>
          </div>
        </section>
      )}

      {stage === 'preview' && summary && (
        <PreviewStep
          summary={summary}
          rows={rows}
          busy={busy}
          onLoadRows={setRows}
          onApply={() => void apply()}
          onBack={() => setStage('map')}
          onDiscard={() => void discard()}
        />
      )}

      {stage === 'done' && summary && (
        <section className='flex flex-col gap-2'>
          <p className='text-success text-sm font-medium'>
            Imported.{' '}
            {summary.invalidRows
              ? `${summary.invalidRows} rows were not imported because of the problems listed above.`
              : 'Every row was imported.'}
          </p>
          <Button
            type='button'
            variant='outline'
            className='w-fit'
            onClick={() => {
              setSummary(null);
              setRows([]);
              setStage('choose');
            }}
          >
            Import another file
          </Button>
        </section>
      )}
    </div>
  );
}

function PreviewStep({
  summary,
  rows,
  busy,
  onLoadRows,
  onApply,
  onBack,
  onDiscard
}: {
  summary: ImportSummary;
  rows: ImportRow[];
  busy: boolean;
  onLoadRows: (rows: ImportRow[]) => void;
  onApply: () => void;
  onBack: () => void;
  onDiscard: () => void;
}) {
  const [loaded, setLoaded] = useState(rows.length > 0);
  const [showInvalid, setShowInvalid] = useState(true);
  const loading = !loaded;

  // The staged rows are read BACK from the database rather than recomputed here,
  // so the preview is a reading of the decision, not a second opinion about it.
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadImportRowsAction(summary.id, { limit: 200 }).then((r) => {
      if (!live) return;
      if (r.ok) onLoadRows(r.rows);
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [loaded, summary.id, onLoadRows]);

  if (loading)
    return (
      <p className='flex items-center gap-2 text-sm'>
        <IconLoader2 aria-hidden className='size-4 animate-spin' />
        Reading what will happen…
      </p>
    );

  const invalid = rows.filter((r) => r.action === 'Invalid');
  const shown = showInvalid ? rows : rows.filter((r) => r.action !== 'Invalid');

  return (
    <section className='flex flex-col gap-4'>
      <div className='grid grid-cols-3 gap-3'>
        <div className='rounded-lg border p-3'>
          <p className='text-muted-foreground text-xs'>Will be added</p>
          <p className='text-success text-2xl font-semibold tabular-nums'>
            {rows.filter((r) => r.action === 'Create').length}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-muted-foreground text-xs'>Will be updated</p>
          <p className='text-info text-2xl font-semibold tabular-nums'>
            {rows.filter((r) => r.action === 'Update').length}
          </p>
        </div>
        <div className='rounded-lg border p-3'>
          <p className='text-muted-foreground text-xs'>Will be skipped</p>
          <p className='text-destructive text-2xl font-semibold tabular-nums'>
            {summary.invalidRows ?? invalid.length}
          </p>
        </div>
      </div>

      {(summary.invalidRows ?? 0) > 0 && (
        <p className='bg-warning-soft text-warning rounded-lg px-3 py-2 text-sm'>
          Rows with problems are skipped, not guessed at. Everything else is
          imported; fix these and import the file again — the rows already
          imported will simply be updated.
        </p>
      )}

      <label className='flex items-center gap-2 text-sm'>
        <input
          type='checkbox'
          className='accent-foreground size-4'
          checked={showInvalid}
          onChange={(e) => setShowInvalid(e.target.checked)}
        />
        Show rows with problems
      </label>

      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr className='text-left'>
              <th scope='col' className='px-3 py-2 font-medium'>
                Row
              </th>
              <th scope='col' className='px-3 py-2 font-medium'>
                What will happen
              </th>
              <th scope='col' className='px-3 py-2 font-medium'>
                Property ID
              </th>
              <th scope='col' className='px-3 py-2 font-medium'>
                Address
              </th>
              <th scope='col' className='px-3 py-2 font-medium'>
                Postcode
              </th>
              <th scope='col' className='px-3 py-2 font-medium'>
                Meter serial
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 200).map((r) => (
              <tr
                key={r.rowIndex}
                className={cn(
                  'border-t',
                  r.action === 'Invalid' && 'bg-destructive-soft/40'
                )}
              >
                <td className='px-3 py-1.5 tabular-nums'>{r.rowIndex}</td>
                <td className='px-3 py-1.5'>
                  {r.action === 'Invalid' ? (
                    <span className='text-destructive font-medium'>
                      Skipped —{' '}
                      {r.problems
                        .map((p) => `${p.field} ${p.problem}`)
                        .join('; ')}
                    </span>
                  ) : (
                    <span
                      className={
                        r.action === 'Create' ? 'text-success' : 'text-info'
                      }
                    >
                      {r.action === 'Create' ? 'Add' : 'Update'}
                    </span>
                  )}
                </td>
                <td className='px-3 py-1.5'>{r.mapped?.external_ref ?? '—'}</td>
                <td className='px-3 py-1.5'>
                  {r.mapped?.address_line1 ?? '—'}
                </td>
                <td className='px-3 py-1.5'>{r.mapped?.postcode ?? '—'}</td>
                <td className='px-3 py-1.5'>
                  {r.mapped?.expected_meter_serial ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 200 && (
        <p className='text-muted-foreground text-xs'>
          Showing the first 200 of {summary.rowCount} rows. All of them are
          checked; the counts above cover every row.
        </p>
      )}

      <div className='flex flex-wrap gap-2'>
        <Button
          type='button'
          disabled={busy || (summary.validRows ?? 0) === 0}
          onClick={onApply}
        >
          {busy && <IconLoader2 aria-hidden className='animate-spin' />}
          Import {summary.validRows ?? 0} rows
        </Button>
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={onBack}
        >
          Change the columns
        </Button>
        <Button
          type='button'
          variant='ghost'
          disabled={busy}
          onClick={onDiscard}
        >
          Discard this import
        </Button>
      </div>
    </section>
  );
}
