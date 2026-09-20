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
import { cn } from '@/lib/utils';
import { IconFolder, IconFolderOpen, IconLoader2 } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { listFolderTargets, type FolderTarget } from '../folder-targets';
import type { FileScope } from '../types';

// Move, without dragging.
//
// Everything the drag-and-drop layer can do has an equivalent here, reachable
// by keyboard alone: the destinations are a list of radio buttons, so arrow
// keys move between them and Enter confirms. A folder being moved hides itself
// and its own subtree, because a folder cannot go inside itself - the database
// refuses it too, but the choice should not be offered.

export function MoveDialog({
  open,
  onOpenChange,
  scope,
  jobId,
  title,
  description,
  /** Folders being moved: they and their descendants are not valid destinations. */
  excludeFolderIds = [],
  currentFolderId,
  onMove
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: FileScope;
  jobId: string | null;
  title: string;
  description: string;
  excludeFolderIds?: string[];
  currentFolderId: string | null;
  onMove: (folderId: string | null) => Promise<void> | void;
}) {
  const [targets, setTargets] = useState<FolderTarget[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(currentFolderId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargets(null);
    setChosen(currentFolderId);
    let cancelled = false;
    void listFolderTargets({ scope, jobId }).then((rows) => {
      if (!cancelled) setTargets(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [open, scope, jobId, currentFolderId]);

  const excluded = new Set(excludeFolderIds);
  const allowed = (targets ?? []).filter(
    (t) => !excluded.has(t.id) && !t.pathIds.some((id) => excluded.has(id))
  );

  async function confirm() {
    setBusy(true);
    try {
      await onMove(chosen);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-lg overflow-hidden'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {targets === null ? (
          <p className='text-muted-foreground flex items-center gap-2 py-6 text-sm'>
            <IconLoader2 className='size-4 animate-spin' aria-hidden />
            Loading folders…
          </p>
        ) : (
          <fieldset className='max-h-[45vh] overflow-y-auto'>
            <legend className='sr-only'>Choose a destination folder</legend>
            <label
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                'hover:bg-accent focus-within:ring-ring focus-within:ring-2'
              )}
            >
              <input
                type='radio'
                name='destination'
                className='size-4'
                checked={chosen === null}
                onChange={() => setChosen(null)}
              />
              <IconFolderOpen className='size-4 shrink-0' aria-hidden />
              <span className='font-medium'>
                {scope === 'Library' ? 'Company documents' : 'Top level'}
              </span>
            </label>

            {allowed.map((target) => (
              <label
                key={target.id}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm',
                  'hover:bg-accent focus-within:ring-ring focus-within:ring-2'
                )}
                style={{ paddingLeft: `${0.5 + target.depth * 1.25}rem` }}
              >
                <input
                  type='radio'
                  name='destination'
                  className='size-4'
                  checked={chosen === target.id}
                  onChange={() => setChosen(target.id)}
                />
                <IconFolder className='size-4 shrink-0' aria-hidden />
                <span className='truncate'>{target.name}</span>
              </label>
            ))}

            {allowed.length === 0 && (
              <p className='text-muted-foreground px-2 py-3 text-sm'>
                There are no other folders here yet. Moving to the top level is
                the only option.
              </p>
            )}
          </fieldset>
        )}

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type='button' onClick={confirm} disabled={busy}>
            {busy && (
              <IconLoader2 className='size-4 animate-spin' aria-hidden />
            )}
            Move here
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
