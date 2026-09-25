'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatBytes } from '@/features/files/format';
import { IconFileText, IconLoader2, IconPhoto } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import type { AttachableFile } from '../server/stored-files';

const ROUTE = '/api/assistant/stored-files';

/**
 * One request, and a reason when it does not arrive.
 *
 * A flat "could not be listed" hid the two failures that actually happen: the
 * route not being served at all (a dev server that has not picked it up yet),
 * and the library refusing the read. They need different actions, so they are
 * told apart here rather than collapsed into one sentence.
 */
const ask = async <T,>(
  params: string
): Promise<{ ok: true; body: T } | { ok: false; why: string }> => {
  let response: Response;
  try {
    response = await fetch(`${ROUTE}?${params}`);
  } catch {
    return { ok: false, why: 'The server could not be reached.' };
  }
  const text = await response.text();
  try {
    return { ok: true, body: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      why:
        response.status === 404
          ? 'This is a new screen and the server has not picked it up yet. Restart the dev server and try again.'
          : `The server answered ${response.status}.`
    };
  }
};

/**
 * Attaching something already filed in Files & documents.
 *
 * It hands back a File, not an attachment: the caller drops it into the same
 * reader a dropped or chosen file goes through, so a property list picked from
 * the library still stages as an import and a 5 MB photograph is still refused
 * for the same reason and with the same words.
 */
export function StoredFilePicker({
  onPick,
  onClose
}: {
  onPick(file: File): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<AttachableFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void ask<
        { ok: true; files: AttachableFile[] } | { ok: false; message?: string }
      >(`q=${encodeURIComponent(query)}`).then((r) => {
        if (!live) return;
        if (!r.ok) {
          setFiles([]);
          return setProblem(r.why);
        }
        if (!r.body.ok) {
          setFiles([]);
          return setProblem(
            r.body.message ??
              'Those files could not be listed. The file library refused the search.'
          );
        }
        setProblem(null);
        setFiles(r.body.files);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const choose = async (file: AttachableFile) => {
    setProblem(null);
    setBusy(file.id);
    const result = await ask<
      | { ok: true; name: string; mediaType: string; base64: string }
      | { ok: false; message: string }
    >(`id=${encodeURIComponent(file.id)}`);
    setBusy(null);
    if (!result.ok) return setProblem(result.why);
    if (!result.body.ok) return setProblem(result.body.message);
    const payload = result.body;
    // Rebuilt as an ordinary File so it takes the ordinary path from here.
    const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
    onPick(new File([bytes], payload.name, { type: payload.mediaType }));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>Attach from Files &amp; documents</DialogTitle>
          <DialogDescription>
            Photographs, screenshots, CSVs and text files you can already open.
            Attaching one does not move it or change it.
          </DialogDescription>
        </DialogHeader>

        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search by name, customer, job reference or postcode'
          aria-label='Search stored files'
        />

        {problem && (
          <p role='alert' className='text-destructive text-sm'>
            {problem}
          </p>
        )}

        <ul className='max-h-80 divide-y overflow-y-auto rounded-md border'>
          {files === null && (
            <li className='text-muted-foreground flex items-center gap-2 px-3 py-4 text-sm'>
              <IconLoader2 aria-hidden className='size-4 animate-spin' />
              Looking…
            </li>
          )}
          {files?.length === 0 && (
            <li className='text-muted-foreground px-3 py-4 text-center text-sm'>
              {query.trim()
                ? 'Nothing you can open matched that.'
                : 'No files you can attach yet.'}
            </li>
          )}
          {files?.map((file) => (
            <li key={file.id}>
              <button
                type='button'
                disabled={busy !== null}
                onClick={() => void choose(file)}
                className='hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2.5 px-3 py-2 text-left outline-none disabled:opacity-60'
              >
                {file.mediaType.startsWith('image/') ? (
                  <IconPhoto aria-hidden className='size-4 shrink-0' />
                ) : (
                  <IconFileText aria-hidden className='size-4 shrink-0' />
                )}
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {file.name}
                  </span>
                  <span className='text-muted-foreground block truncate text-xs'>
                    {[
                      file.category,
                      file.sizeBytes !== null && formatBytes(file.sizeBytes),
                      file.addedByName
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {busy === file.id && (
                  <IconLoader2 aria-hidden className='size-4 animate-spin' />
                )}
              </button>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
