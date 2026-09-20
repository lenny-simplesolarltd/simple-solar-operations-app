'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { evidenceCategoryLabel } from '@/features/operations/evidence-rules';
import { cn } from '@/lib/utils';
import {
  IconDots,
  IconDownload,
  IconEye,
  IconFile,
  IconFolder,
  IconFolderPlus,
  IconInfoCircle,
  IconLayoutGrid,
  IconList,
  IconLoader2,
  IconRestore,
  IconTrash,
  IconUpload
} from '@tabler/icons-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import {
  createFolder,
  moveFiles,
  moveFolder,
  purgeFiles,
  renameFile,
  renameFolder,
  restoreFiles,
  restoreFolder,
  trashFiles,
  trashFolder
} from '../actions';
import {
  DRAG_TYPE,
  fileDownloadUrl,
  fileTypeLabel,
  formatBytes,
  isFileDrag,
  plural,
  readDragPayload,
  whyNotDeletable
} from '../format';
import type {
  BrowseResult,
  FileRow,
  FileScope,
  FileSort,
  FolderRow,
  SortDirection
} from '../types';
import { DetailsSheet } from './details-sheet';
import { MoveDialog } from './move-dialog';
import { NameDialog } from './name-dialog';
import { PreviewDialog } from './preview-dialog';
import { UploadTray, useUploads } from './upload-tray';

// The file manager: one component, used by /dashboard/files and by a job's
// Files tab, over the same folders and the same documents.
//
// Three rules shape it.
//
//   * Dragging is never the only way. Every drag has a menu item beside it,
//     every menu item is a real button, and the Move dialog is a radio list -
//     so the whole surface works from the keyboard.
//   * What is offered comes from the server (canManage, canPurge,
//     evidenceLocked on each row). Hiding a button is a courtesy, not the
//     authorization: the command checks again and refuses whatever the UI let
//     through.
//   * The UI answers immediately and then reconciles. A move disappears from
//     the list at once; router.refresh() replaces the optimistic state with
//     what the server actually did, and a refusal restores it with the reason.

type Selection = { files: Set<string>; folders: Set<string> };

const emptySelection = (): Selection => ({
  files: new Set(),
  folders: new Set()
});

export interface FileManagerProps {
  result: BrowseResult;
  scope: FileScope;
  jobId: string | null;
  /** Where a folder, the trash or a search lives, so each host owns its URLs. */
  hrefFor: (to: {
    folderId?: string | null;
    view?: 'folder' | 'trash';
    q?: string | null;
  }) => string;
  /** The library and a job's tab title themselves. */
  heading?: string;
  /** Shown above the list; the job tab uses it for the read-only explanation. */
  notice?: string;
}

export function FileManager({
  result,
  scope,
  jobId,
  hrefFor,
  heading,
  notice
}: FileManagerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [layout, setLayout] = useState<'list' | 'grid'>('list');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pageDrop, setPageDrop] = useState(false);
  const [preview, setPreview] = useState<FileRow | null>(null);
  const [details, setDetails] = useState<FileRow | null>(null);
  const [naming, setNaming] = useState<
    | { kind: 'new-folder'; parent?: FolderRow }
    | { kind: 'rename-folder'; folder: FolderRow }
    | { kind: 'rename-file'; file: FileRow }
    | null
  >(null);
  const [moving, setMoving] = useState<{
    fileIds: string[];
    folderIds: string[];
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Hidden while the server catches up, so a move looks instant. */
  const [optimisticallyGone, setGone] = useState<Set<string>>(new Set());

  const trash = result.view === 'trash';
  const canManage = result.canManage;
  const folderId = result.folder?.id ?? null;

  const uploads = useUploads(
    useCallback(() => {
      startTransition(() => router.refresh());
    }, [router])
  );

  const refresh = useCallback(() => {
    setSelection(emptySelection());
    startTransition(() => {
      router.refresh();
      setGone(new Set());
    });
  }, [router]);

  /** Runs a command, says what happened, and reconciles with the server. */
  const run = useCallback(
    async (
      label: string,
      hide: string[],
      act: () => Promise<{ ok: boolean; message?: string }>
    ) => {
      if (hide.length > 0) setGone(new Set(hide));
      const outcome = await act();
      if (outcome.ok) {
        toast.success(label);
      } else {
        // The server won. Put everything back and say why.
        setGone(new Set());
        toast.error(outcome.message ?? 'That could not be done.');
      }
      refresh();
    },
    [refresh]
  );

  const folders = useMemo(
    () => result.folders.filter((f) => !optimisticallyGone.has(f.id)),
    [result.folders, optimisticallyGone]
  );
  const files = useMemo(
    () => result.files.filter((f) => !optimisticallyGone.has(f.id)),
    [result.files, optimisticallyGone]
  );

  const selectedCount = selection.files.size + selection.folders.size;
  const selectedFiles = files.filter((f) => selection.files.has(f.id));
  const allSelected =
    folders.length + files.length > 0 &&
    selectedCount === folders.length + files.length;

  function toggle(kind: 'files' | 'folders', id: string, only = false) {
    setSelection((current) => {
      if (only)
        return {
          ...emptySelection(),
          [kind]: new Set([id])
        } as Selection;
      const next: Selection = {
        files: new Set(current.files),
        folders: new Set(current.folders)
      };
      if (next[kind].has(id)) next[kind].delete(id);
      else next[kind].add(id);
      return next;
    });
  }

  function selectAll(checked: boolean) {
    setSelection(
      checked
        ? {
            files: new Set(files.map((f) => f.id)),
            folders: new Set(folders.map((f) => f.id))
          }
        : emptySelection()
    );
  }

  // -- Uploading -------------------------------------------------------------

  const uploadContext = useMemo(
    () =>
      scope === 'Library'
        ? ({ type: 'Library' } as const)
        : ({ type: 'Job', id: jobId ?? '' } as const),
    [scope, jobId]
  );

  const startUploads = useCallback(
    (list: FileList | File[], intoFolderId: string | null) => {
      const chosen = Array.from(list);
      if (chosen.length === 0) return;
      uploads.add(chosen, {
        context: uploadContext,
        folderId: intoFolderId,
        // A job document needs a category; "Other" is what the Files tab has
        // always used for a file that is not evidence of a specific step.
        category: 'Other'
      });
    },
    [uploads, uploadContext]
  );

  // -- Moving ----------------------------------------------------------------

  const doMove = useCallback(
    async (
      payload: { fileIds: string[]; folderIds: string[] },
      destination: string | null
    ) => {
      const moves: Promise<{ ok: boolean; message?: string }>[] = [];
      if (payload.fileIds.length > 0) {
        const expected = Object.fromEntries(
          files
            .filter((f) => payload.fileIds.includes(f.id))
            .map((f) => [f.id, f.filingVersion])
        );
        moves.push(
          moveFiles({
            fileIds: payload.fileIds,
            folderId: destination,
            expected
          })
        );
      }
      for (const id of payload.folderIds) {
        const folder = folders.find((f) => f.id === id);
        moves.push(
          moveFolder({
            folderId: id,
            parentId: destination,
            expectedVersion: folder?.version
          })
        );
      }
      const results = await Promise.all(moves);
      const failed = results.find((r) => !r.ok);
      return failed ?? { ok: true as const };
    },
    [files, folders]
  );

  const moveInto = useCallback(
    (
      payload: { fileIds: string[]; folderIds: string[] },
      destination: string | null,
      destinationName: string
    ) => {
      const count = payload.fileIds.length + payload.folderIds.length;
      void run(
        `Moved ${plural(count, 'item')} to ${destinationName}`,
        [...payload.fileIds, ...payload.folderIds],
        () => doMove(payload, destination)
      );
    },
    [doMove, run]
  );

  /** What a drag is carrying: the selection if the row is in it, else the row. */
  function dragPayloadFor(kind: 'files' | 'folders', id: string) {
    const inSelection = selection[kind].has(id);
    return inSelection
      ? {
          fileIds: Array.from(selection.files),
          folderIds: Array.from(selection.folders)
        }
      : {
          fileIds: kind === 'files' ? [id] : [],
          folderIds: kind === 'folders' ? [id] : []
        };
  }

  function onDragStart(
    event: React.DragEvent,
    kind: 'files' | 'folders',
    id: string
  ) {
    const payload = dragPayloadFor(kind, id);
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  }

  function onFolderDrop(event: React.DragEvent, folder: FolderRow) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    if (!canManage || trash) return;
    if (isFileDrag(event.dataTransfer)) {
      startUploads(event.dataTransfer.files, folder.id);
      return;
    }
    const payload = readDragPayload(event.dataTransfer);
    if (!payload) return;
    // A folder cannot be dropped into itself.
    const folderIds = payload.folderIds.filter((id) => id !== folder.id);
    if (payload.fileIds.length === 0 && folderIds.length === 0) return;
    moveInto({ ...payload, folderIds }, folder.id, folder.name);
  }

  // -- Row actions -----------------------------------------------------------

  const openFolderHref = (id: string) => hrefFor({ folderId: id });

  function fileMenu(file: FileRow): MenuEntry[] {
    const lockedReason = whyNotDeletable(file);
    return [
      {
        kind: 'item',
        label: 'Preview',
        icon: <IconEye className='size-4' aria-hidden />,
        onSelect: () => setPreview(file)
      },
      {
        kind: 'item',
        label: 'Download',
        icon: <IconDownload className='size-4' aria-hidden />,
        href: fileDownloadUrl(file.id),
        download: true
      },
      {
        kind: 'item',
        label: 'Details and history',
        icon: <IconInfoCircle className='size-4' aria-hidden />,
        onSelect: () => setDetails(file)
      },
      ...(file.jobId
        ? ([
            {
              kind: 'item',
              label: 'Open job',
              icon: <IconFile className='size-4' aria-hidden />,
              href: `/dashboard/jobs/${file.jobId}?tab=files`
            }
          ] as MenuEntry[])
        : []),
      ...(canManage && !trash
        ? ([
            { kind: 'separator' },
            {
              kind: 'item',
              label: 'Rename',
              onSelect: () => setNaming({ kind: 'rename-file', file })
            },
            {
              kind: 'item',
              label: 'Move to…',
              onSelect: () => setMoving({ fileIds: [file.id], folderIds: [] })
            },
            {
              kind: 'item',
              label: lockedReason
                ? 'Cannot delete (evidence)'
                : 'Move to Trash',
              icon: <IconTrash className='size-4' aria-hidden />,
              disabled: !!lockedReason,
              title: lockedReason ?? undefined,
              onSelect: () =>
                void run('Moved to Trash', [file.id], () =>
                  trashFiles({
                    fileIds: [file.id],
                    expected: { [file.id]: file.filingVersion }
                  })
                )
            }
          ] as MenuEntry[])
        : []),
      ...(canManage && trash
        ? ([
            { kind: 'separator' },
            {
              kind: 'item',
              label: 'Restore',
              icon: <IconRestore className='size-4' aria-hidden />,
              onSelect: () =>
                void run('Restored', [file.id], () =>
                  restoreFiles({ fileIds: [file.id] })
                )
            },
            ...(result.canPurge
              ? ([
                  {
                    kind: 'item',
                    label: 'Delete permanently',
                    icon: <IconTrash className='size-4' aria-hidden />,
                    disabled: !!lockedReason,
                    title: lockedReason ?? undefined,
                    onSelect: () => {
                      if (
                        !window.confirm(
                          `Permanently delete “${file.name}”? The stored file is destroyed and this cannot be undone.`
                        )
                      )
                        return;
                      void run('Permanently deleted', [file.id], () =>
                        purgeFiles({ fileIds: [file.id] })
                      );
                    }
                  }
                ] as MenuEntry[])
              : [])
          ] as MenuEntry[])
        : [])
    ];
  }

  function folderMenu(folder: FolderRow): MenuEntry[] {
    return [
      {
        kind: 'item',
        label: 'Open',
        icon: <IconFolder className='size-4' aria-hidden />,
        href: openFolderHref(folder.id)
      },
      ...(canManage && !trash
        ? ([
            { kind: 'separator' },
            {
              kind: 'item',
              label: 'Upload here',
              icon: <IconUpload className='size-4' aria-hidden />,
              onSelect: () => {
                // "Here" means into this folder, without opening it first.
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = true;
                input.onchange = () => {
                  if (input.files) startUploads(input.files, folder.id);
                };
                input.click();
              }
            },
            {
              kind: 'item',
              label: 'New subfolder',
              icon: <IconFolderPlus className='size-4' aria-hidden />,
              onSelect: () => setNaming({ kind: 'new-folder', parent: folder })
            },
            {
              kind: 'item',
              label: 'Rename',
              onSelect: () => setNaming({ kind: 'rename-folder', folder })
            },
            {
              kind: 'item',
              label: 'Move to…',
              onSelect: () => setMoving({ fileIds: [], folderIds: [folder.id] })
            },
            {
              kind: 'item',
              label: 'Move to Trash',
              icon: <IconTrash className='size-4' aria-hidden />,
              onSelect: () =>
                void run('Folder moved to Trash', [folder.id], () =>
                  trashFolder({
                    folderId: folder.id,
                    expectedVersion: folder.version
                  })
                )
            }
          ] as MenuEntry[])
        : []),
      ...(canManage && trash
        ? ([
            { kind: 'separator' },
            {
              kind: 'item',
              label: 'Restore',
              icon: <IconRestore className='size-4' aria-hidden />,
              onSelect: () =>
                void run('Folder restored', [folder.id], () =>
                  restoreFolder({ folderId: folder.id })
                )
            }
          ] as MenuEntry[])
        : [])
    ];
  }

  // -- Render ----------------------------------------------------------------

  return (
    <div
      className='flex flex-col gap-3'
      onDragOver={(event) => {
        if (!canManage || trash || !isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setPageDrop(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setPageDrop(false);
      }}
      onDrop={(event) => {
        if (!canManage || trash || !isFileDrag(event.dataTransfer)) return;
        event.preventDefault();
        setPageDrop(false);
        startUploads(event.dataTransfer.files, folderId);
      }}
    >
      <Toolbar
        heading={heading}
        result={result}
        hrefFor={hrefFor}
        layout={layout}
        onLayout={setLayout}
        canManage={canManage}
        trash={trash}
        pending={pending}
        onNewFolder={() => setNaming({ kind: 'new-folder' })}
        onUpload={() => fileInput.current?.click()}
      />

      <input
        ref={fileInput}
        type='file'
        multiple
        className='sr-only'
        onChange={(event) => {
          if (event.target.files) startUploads(event.target.files, folderId);
          event.target.value = '';
        }}
      />

      {notice && <p className='text-muted-foreground text-sm'>{notice}</p>}

      <UploadTray
        items={uploads.items}
        onRetry={uploads.retry}
        onDismiss={uploads.dismiss}
        onClearFinished={uploads.clearFinished}
      />

      {pageDrop && (
        <p className='border-primary text-primary rounded-lg border-2 border-dashed p-6 text-center text-sm'>
          Drop to upload into{' '}
          <strong>{result.folder?.name ?? 'this folder'}</strong>
        </p>
      )}

      {selectedCount > 0 && (
        <SelectionBar
          count={selectedCount}
          canManage={canManage}
          trash={trash}
          canPurge={result.canPurge}
          lockedCount={selectedFiles.filter((f) => f.evidenceLocked).length}
          onClear={() => setSelection(emptySelection())}
          onMove={() =>
            setMoving({
              fileIds: Array.from(selection.files),
              folderIds: Array.from(selection.folders)
            })
          }
          onDownload={() => {
            // One request per document: each opens its own 60-second link.
            for (const file of selectedFiles) {
              const a = document.createElement('a');
              a.href = fileDownloadUrl(file.id);
              a.download = file.name;
              a.click();
            }
          }}
          onTrash={() => {
            const ids = Array.from(selection.files);
            const folderIds = Array.from(selection.folders);
            void run(
              `Moved ${plural(ids.length + folderIds.length, 'item')} to Trash`,
              [...ids, ...folderIds],
              async () => {
                const results = await Promise.all([
                  ...(ids.length > 0
                    ? [
                        trashFiles({
                          fileIds: ids,
                          expected: Object.fromEntries(
                            selectedFiles.map((f) => [f.id, f.filingVersion])
                          )
                        })
                      ]
                    : []),
                  ...folderIds.map((id) =>
                    trashFolder({
                      folderId: id,
                      expectedVersion: folders.find((f) => f.id === id)?.version
                    })
                  )
                ]);
                return results.find((r) => !r.ok) ?? { ok: true as const };
              }
            );
          }}
          onRestore={() => {
            const ids = Array.from(selection.files);
            const folderIds = Array.from(selection.folders);
            void run(
              `Restored ${plural(ids.length + folderIds.length, 'item')}`,
              [...ids, ...folderIds],
              async () => {
                const results = await Promise.all([
                  ...(ids.length > 0 ? [restoreFiles({ fileIds: ids })] : []),
                  ...folderIds.map((id) => restoreFolder({ folderId: id }))
                ]);
                return results.find((r) => !r.ok) ?? { ok: true as const };
              }
            );
          }}
        />
      )}

      {folders.length === 0 && files.length === 0 ? (
        <Empty trash={trash} q={result.q} canManage={canManage} />
      ) : layout === 'list' ? (
        <ListView
          result={result}
          folders={folders}
          files={files}
          selection={selection}
          allSelected={allSelected}
          trash={trash}
          canManage={canManage}
          hrefFor={hrefFor}
          openFolderHref={openFolderHref}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onFolderDrop={onFolderDrop}
          onDragStart={onDragStart}
          onSelectAll={selectAll}
          onToggle={toggle}
          onPreview={setPreview}
          folderMenu={folderMenu}
          fileMenu={fileMenu}
        />
      ) : (
        <GridView
          folders={folders}
          files={files}
          selection={selection}
          trash={trash}
          canManage={canManage}
          openFolderHref={openFolderHref}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onFolderDrop={onFolderDrop}
          onDragStart={onDragStart}
          onToggle={toggle}
          onPreview={setPreview}
          folderMenu={folderMenu}
          fileMenu={fileMenu}
        />
      )}

      {result.totalFiles > files.length && (
        <p className='text-muted-foreground text-sm'>
          Showing {files.length} of {result.totalFiles} documents in this
          folder. Narrow it with the search box.
        </p>
      )}

      {/* Dialogs. Each is the keyboard route to something dragging also does. */}
      {naming && (
        <NameDialog
          open
          onOpenChange={(open) => !open && setNaming(null)}
          title={
            naming.kind === 'new-folder'
              ? naming.parent
                ? `New folder in ${naming.parent.name}`
                : 'New folder'
              : naming.kind === 'rename-folder'
                ? 'Rename folder'
                : 'Rename document'
          }
          label='Name'
          initialValue={
            naming.kind === 'new-folder'
              ? ''
              : naming.kind === 'rename-folder'
                ? naming.folder.name
                : naming.file.name
          }
          description={
            naming.kind === 'rename-file'
              ? 'This changes what staff see. The stored file keeps its own name, so every link to it from a task or a commissioning record still works.'
              : undefined
          }
          onSubmit={async (name) => {
            if (naming.kind === 'new-folder') {
              await run('Folder created', [], () =>
                createFolder({
                  scope,
                  jobId,
                  // "New subfolder" on a folder files it there; the toolbar
                  // button files it in the folder being looked at.
                  parentId: naming.parent?.id ?? folderId,
                  name
                })
              );
            } else if (naming.kind === 'rename-folder') {
              await run('Folder renamed', [], () =>
                renameFolder({
                  folderId: naming.folder.id,
                  name,
                  expectedVersion: naming.folder.version
                })
              );
            } else {
              await run('Renamed', [], () =>
                renameFile({
                  fileId: naming.file.id,
                  name,
                  expectedVersion: naming.file.filingVersion
                })
              );
            }
            setNaming(null);
          }}
        />
      )}

      {moving && (
        <MoveDialog
          open
          onOpenChange={(open) => !open && setMoving(null)}
          scope={scope}
          jobId={jobId}
          title={`Move ${plural(moving.fileIds.length + moving.folderIds.length, 'item')}`}
          description='Choose where they should live. Moving never changes which job a document belongs to, and never breaks a link to it.'
          excludeFolderIds={moving.folderIds}
          currentFolderId={folderId}
          onMove={async (destination) => {
            const name =
              destination === null
                ? scope === 'Library'
                  ? 'Company documents'
                  : 'the top level'
                : 'the chosen folder';
            moveInto(moving, destination, name);
            setMoving(null);
          }}
        />
      )}

      {preview && (
        <PreviewDialog
          file={preview}
          open
          onOpenChange={(open) => !open && setPreview(null)}
          onDetails={() => {
            setDetails(preview);
            setPreview(null);
          }}
        />
      )}

      {details && (
        <DetailsSheet
          fileId={details.id}
          open
          onOpenChange={(open) => !open && setDetails(null)}
        />
      )}
    </div>
  );
}

// -- Pieces -------------------------------------------------------------------

/**
 * A row's actions, described once. Right-clicking and the "..." button render
 * the same list through different primitives, so the two can never drift -
 * which is what keeps every drag gesture reachable from the keyboard.
 */
type MenuEntry =
  | { kind: 'separator' }
  | {
      kind: 'item';
      label: string;
      icon?: React.ReactNode;
      href?: string;
      download?: boolean;
      onSelect?: () => void;
      disabled?: boolean;
      title?: string;
    };

function renderMenu(entries: MenuEntry[], flavour: 'context' | 'dropdown') {
  const Item = flavour === 'context' ? ContextMenuItem : DropdownMenuItem;
  const Sep =
    flavour === 'context' ? ContextMenuSeparator : DropdownMenuSeparator;
  return entries.map((entry, index) => {
    if (entry.kind === 'separator') return <Sep key={`sep-${index}`} />;
    const body = (
      <>
        {entry.icon}
        {entry.label}
      </>
    );
    return (
      <Item
        key={entry.label}
        className='gap-2'
        disabled={entry.disabled}
        title={entry.title}
        onSelect={entry.onSelect}
        asChild={!!entry.href}
      >
        {entry.href ? (
          entry.download ? (
            <a href={entry.href} download>
              {body}
            </a>
          ) : (
            <Link href={entry.href}>{body}</Link>
          )
        ) : (
          body
        )}
      </Item>
    );
  });
}

function Toolbar({
  heading,
  result,
  hrefFor,
  layout,
  onLayout,
  canManage,
  trash,
  pending,
  onNewFolder,
  onUpload
}: {
  heading?: string;
  result: BrowseResult;
  hrefFor: FileManagerProps['hrefFor'];
  layout: 'list' | 'grid';
  onLayout: (v: 'list' | 'grid') => void;
  canManage: boolean;
  trash: boolean;
  pending: boolean;
  onNewFolder: () => void;
  onUpload: () => void;
}) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        {heading && (
          <h2 className='mr-auto text-lg font-semibold'>{heading}</h2>
        )}
        {pending && (
          <IconLoader2
            className='text-muted-foreground size-4 animate-spin'
            aria-label='Updating'
          />
        )}
        {canManage && !trash && (
          <>
            <Button type='button' variant='outline' onClick={onNewFolder}>
              <IconFolderPlus className='size-4' aria-hidden /> New folder
            </Button>
            <Button type='button' onClick={onUpload}>
              <IconUpload className='size-4' aria-hidden /> Upload
            </Button>
          </>
        )}
        <Button asChild variant={trash ? 'secondary' : 'ghost'}>
          <Link href={hrefFor({ view: trash ? 'folder' : 'trash' })}>
            <IconTrash className='size-4' aria-hidden />
            {trash ? 'Leave Trash' : 'Trash'}
          </Link>
        </Button>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Breadcrumbs result={result} hrefFor={hrefFor} />
        <form
          role='search'
          className='ml-auto flex items-center gap-2'
          action={hrefFor({ folderId: result.folder?.id ?? null })}
          method='get'
        >
          <label className='sr-only' htmlFor='file-search'>
            Search these files
          </label>
          <Input
            id='file-search'
            name='q'
            type='search'
            defaultValue={result.q ?? ''}
            placeholder='Search in this folder'
            className='w-56'
          />
          <Button type='submit' variant='outline' size='sm'>
            Search
          </Button>
        </form>
        <div
          className='flex rounded-md border'
          role='group'
          aria-label='Layout'
        >
          <Button
            type='button'
            size='icon'
            variant={layout === 'list' ? 'secondary' : 'ghost'}
            onClick={() => onLayout('list')}
            aria-pressed={layout === 'list'}
          >
            <IconList className='size-4' aria-hidden />
            <span className='sr-only'>List</span>
          </Button>
          <Button
            type='button'
            size='icon'
            variant={layout === 'grid' ? 'secondary' : 'ghost'}
            onClick={() => onLayout('grid')}
            aria-pressed={layout === 'grid'}
          >
            <IconLayoutGrid className='size-4' aria-hidden />
            <span className='sr-only'>Grid</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Breadcrumbs({
  result,
  hrefFor
}: {
  result: BrowseResult;
  hrefFor: FileManagerProps['hrefFor'];
}) {
  const root =
    result.scope === 'Library'
      ? 'Company documents'
      : (result.job?.jobRef ?? 'Files');
  return (
    <nav aria-label='Breadcrumb' className='min-w-0'>
      <ol className='text-muted-foreground flex flex-wrap items-center gap-1 text-sm'>
        <li>
          <Link
            className='hover:text-foreground underline'
            href={hrefFor({ folderId: null })}
          >
            {root}
          </Link>
        </li>
        {result.breadcrumbs.map((crumb) => (
          <li key={crumb.id} className='flex items-center gap-1'>
            <span aria-hidden>/</span>
            <Link
              className='hover:text-foreground underline'
              href={hrefFor({ folderId: crumb.id })}
            >
              {crumb.name}
            </Link>
          </li>
        ))}
        {result.folder && (
          <li className='flex items-center gap-1'>
            <span aria-hidden>/</span>
            <span className='text-foreground font-medium' aria-current='page'>
              {result.folder.name}
            </span>
          </li>
        )}
        {result.view === 'trash' && (
          <li className='flex items-center gap-1'>
            <span aria-hidden>/</span>
            <span className='text-foreground font-medium' aria-current='page'>
              Trash
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}

function SelectionBar({
  count,
  canManage,
  trash,
  canPurge,
  lockedCount,
  onClear,
  onMove,
  onDownload,
  onTrash,
  onRestore
}: {
  count: number;
  canManage: boolean;
  trash: boolean;
  canPurge: boolean;
  lockedCount: number;
  onClear: () => void;
  onMove: () => void;
  onDownload: () => void;
  onTrash: () => void;
  onRestore: () => void;
}) {
  return (
    <div
      role='region'
      aria-label='Actions for the selected items'
      className='bg-accent flex flex-wrap items-center gap-2 rounded-lg border p-2'
    >
      <span className='text-sm font-medium' aria-live='polite'>
        {plural(count, 'item')} selected
      </span>
      <Button type='button' size='sm' variant='ghost' onClick={onDownload}>
        <IconDownload className='size-4' aria-hidden /> Download
      </Button>
      {canManage && !trash && (
        <>
          <Button type='button' size='sm' variant='ghost' onClick={onMove}>
            Move to…
          </Button>
          <Button type='button' size='sm' variant='ghost' onClick={onTrash}>
            <IconTrash className='size-4' aria-hidden /> Move to Trash
          </Button>
        </>
      )}
      {canManage && trash && (
        <Button type='button' size='sm' variant='ghost' onClick={onRestore}>
          <IconRestore className='size-4' aria-hidden /> Restore
        </Button>
      )}
      {lockedCount > 0 && !trash && (
        <span className='text-muted-foreground text-xs'>
          {plural(lockedCount, 'document')} here{' '}
          {lockedCount === 1 ? 'is' : 'are'} evidence for recorded work and
          cannot be deleted.
        </span>
      )}
      {trash && !canPurge && (
        <span className='text-muted-foreground text-xs'>
          Only an administrator can delete permanently.
        </span>
      )}
      <Button
        type='button'
        size='sm'
        variant='ghost'
        className='ml-auto'
        onClick={onClear}
      >
        Clear selection
      </Button>
    </div>
  );
}

function Empty({
  trash,
  q,
  canManage
}: {
  trash: boolean;
  q: string | null;
  canManage: boolean;
}) {
  return (
    <div className='bg-card rounded-lg border p-8 text-center'>
      <p className='font-medium'>
        {q
          ? 'Nothing here matches that search'
          : trash
            ? 'The Trash is empty'
            : 'This folder is empty'}
      </p>
      <p className='text-muted-foreground mt-1 text-sm'>
        {q
          ? 'Try a different search, or look in another folder.'
          : trash
            ? 'Documents you move to the Trash appear here, with where they came from.'
            : canManage
              ? 'Drag files here to upload them, or use Upload and New folder above.'
              : 'You only see documents on work you can access.'}
      </p>
    </div>
  );
}

// -- List ---------------------------------------------------------------------

const SORTS: { key: FileSort; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'category', label: 'Type' },
  { key: 'modified', label: 'Modified' },
  { key: 'size', label: 'Size' }
];

interface ViewProps {
  folders: FolderRow[];
  files: FileRow[];
  selection: Selection;
  trash: boolean;
  canManage: boolean;
  openFolderHref: (id: string) => string;
  dropTarget: string | null;
  setDropTarget: (id: string | null) => void;
  onFolderDrop: (event: React.DragEvent, folder: FolderRow) => void;
  onDragStart: (
    event: React.DragEvent,
    kind: 'files' | 'folders',
    id: string
  ) => void;
  onToggle: (kind: 'files' | 'folders', id: string, only?: boolean) => void;
  onPreview: (file: FileRow) => void;
  folderMenu: (folder: FolderRow) => MenuEntry[];
  fileMenu: (file: FileRow) => MenuEntry[];
}

function ListView({
  result,
  allSelected,
  hrefFor,
  onSelectAll,
  ...props
}: ViewProps & {
  result: BrowseResult;
  allSelected: boolean;
  hrefFor: FileManagerProps['hrefFor'];
  onSelectAll: (checked: boolean) => void;
}) {
  const sortHref = (key: FileSort) => {
    const dir: SortDirection =
      result.sort === key && result.dir === 'asc' ? 'desc' : 'asc';
    const base = hrefFor({
      folderId: result.folder?.id ?? null,
      view: result.view,
      q: result.q
    });
    const join = base.includes('?') ? '&' : '?';
    return `${base}${join}sort=${key}&dir=${dir}`;
  };

  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full text-sm'>
        <caption className='sr-only'>
          Folders and documents. Each row has a menu of the actions you may
          take.
        </caption>
        <thead className='bg-muted/50'>
          <tr>
            <th scope='col' className='w-10 p-2'>
              <Checkbox
                checked={allSelected}
                onCheckedChange={(v) => onSelectAll(v === true)}
                aria-label='Select everything in this folder'
              />
            </th>
            {SORTS.map((sort) => (
              <th
                key={sort.key}
                scope='col'
                className={cn(
                  'p-2 text-left font-medium',
                  sort.key !== 'name' && 'hidden md:table-cell'
                )}
                aria-sort={
                  result.sort === sort.key
                    ? result.dir === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : 'none'
                }
              >
                <Link className='hover:underline' href={sortHref(sort.key)}>
                  {sort.label}
                  {result.sort === sort.key && (
                    <span aria-hidden> {result.dir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </Link>
              </th>
            ))}
            <th
              scope='col'
              className='hidden p-2 text-left font-medium lg:table-cell'
            >
              Job
            </th>
            <th scope='col' className='w-10 p-2'>
              <span className='sr-only'>Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className='divide-y'>
          {props.folders.map((folder) => (
            <FolderRowView key={folder.id} folder={folder} {...props} />
          ))}
          {props.files.map((file) => (
            <FileRowView key={file.id} file={file} {...props} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FolderRowView({
  folder,
  selection,
  canManage,
  trash,
  openFolderHref,
  dropTarget,
  setDropTarget,
  onFolderDrop,
  onDragStart,
  onToggle,
  folderMenu
}: ViewProps & { folder: FolderRow }) {
  const selected = selection.folders.has(folder.id);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr
          data-selected={selected}
          draggable={canManage && !trash}
          onDragStart={(e) => onDragStart(e, 'folders', folder.id)}
          onDragOver={(e) => {
            if (!canManage || trash) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = isFileDrag(e.dataTransfer)
              ? 'copy'
              : 'move';
            setDropTarget(folder.id);
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(e) => onFolderDrop(e, folder)}
          className={cn(
            'hover:bg-muted/50',
            selected && 'bg-accent',
            dropTarget === folder.id && 'ring-primary bg-primary/10 ring-2'
          )}
        >
          <td className='p-2'>
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggle('folders', folder.id)}
              aria-label={`Select folder ${folder.name}`}
            />
          </td>
          <td className='p-2'>
            <Link
              href={openFolderHref(folder.id)}
              className='flex items-center gap-2 font-medium hover:underline'
            >
              <IconFolder className='size-4 shrink-0' aria-hidden />
              <span className='truncate'>{folder.name}</span>
            </Link>
            {folder.originalLocation && (
              <span className='text-muted-foreground block text-xs'>
                was in {folder.originalLocation}
              </span>
            )}
          </td>
          <td className='hidden p-2 md:table-cell'>
            <Badge variant='outline'>Folder</Badge>
          </td>
          <td className='text-muted-foreground hidden p-2 md:table-cell'>
            {folder.fileCount > 0 || folder.folderCount > 0
              ? [
                  folder.folderCount > 0
                    ? plural(folder.folderCount, 'folder')
                    : null,
                  folder.fileCount > 0
                    ? plural(folder.fileCount, 'document')
                    : null
                ]
                  .filter(Boolean)
                  .join(', ')
              : 'Empty'}
          </td>
          <td className='hidden p-2 md:table-cell' />
          <td className='hidden p-2 lg:table-cell' />
          <td className='p-2'>
            <RowMenu
              label={`Actions for folder ${folder.name}`}
              entries={folderMenu(folder)}
            />
          </td>
        </tr>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenu(folderMenu(folder), 'context')}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileRowView({
  file,
  selection,
  canManage,
  trash,
  onDragStart,
  onToggle,
  onPreview,
  fileMenu
}: ViewProps & { file: FileRow }) {
  const selected = selection.files.has(file.id);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <tr
          data-selected={selected}
          draggable={canManage && !trash}
          onDragStart={(e) => onDragStart(e, 'files', file.id)}
          onDoubleClick={() => onPreview(file)}
          className={cn('hover:bg-muted/50', selected && 'bg-accent')}
        >
          <td className='p-2'>
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggle('files', file.id)}
              aria-label={`Select ${file.name}`}
            />
          </td>
          <td className='max-w-xs p-2'>
            <button
              type='button'
              onClick={() => onPreview(file)}
              className='flex w-full items-center gap-2 text-left hover:underline'
            >
              <IconFile className='size-4 shrink-0' aria-hidden />
              <span className='truncate'>{file.name}</span>
            </button>
            {file.originalLocation && (
              <span className='text-muted-foreground block text-xs'>
                was in {file.originalLocation}
              </span>
            )}
            {file.evidenceLocked && !trash && (
              <span className='text-muted-foreground block text-xs'>
                Evidence for recorded work
              </span>
            )}
          </td>
          <td className='hidden p-2 md:table-cell'>
            <Badge variant='outline'>{fileTypeLabel(file.mimeType)}</Badge>
            <span className='text-muted-foreground block text-xs'>
              {evidenceCategoryLabel(file.category)}
            </span>
          </td>
          <td className='text-muted-foreground hidden p-2 whitespace-nowrap md:table-cell'>
            {file.modifiedAt ? file.modifiedAt.slice(0, 10) : '—'}
            <span className='block text-xs'>{file.addedByName ?? ''}</span>
          </td>
          <td className='text-muted-foreground hidden p-2 whitespace-nowrap md:table-cell'>
            {formatBytes(file.sizeBytes) ?? '—'}
          </td>
          <td className='hidden p-2 lg:table-cell'>
            {file.jobId ? (
              <Link
                href={`/dashboard/jobs/${file.jobId}?tab=files`}
                className='font-mono text-xs underline'
              >
                {file.jobRef ?? 'Job'}
              </Link>
            ) : (
              <span className='text-muted-foreground text-xs'>Company</span>
            )}
          </td>
          <td className='p-2'>
            <RowMenu
              label={`Actions for ${file.name}`}
              entries={fileMenu(file)}
            />
          </td>
        </tr>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {renderMenu(fileMenu(file), 'context')}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The "..." button: the same actions as the right-click menu, for keyboard users. */
function RowMenu({ label, entries }: { label: string; entries: MenuEntry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' size='icon' variant='ghost' className='size-8'>
          <IconDots className='size-4' aria-hidden />
          <span className='sr-only'>{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        {renderMenu(entries, 'dropdown')}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// -- Grid ---------------------------------------------------------------------

function GridView({
  folders,
  files,
  selection,
  canManage,
  trash,
  openFolderHref,
  dropTarget,
  setDropTarget,
  onFolderDrop,
  onDragStart,
  onToggle,
  onPreview,
  folderMenu,
  fileMenu
}: ViewProps) {
  return (
    <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
      {folders.map((folder) => (
        <li key={folder.id}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                draggable={canManage && !trash}
                onDragStart={(e) => onDragStart(e, 'folders', folder.id)}
                onDragOver={(e) => {
                  if (!canManage || trash) return;
                  e.preventDefault();
                  setDropTarget(folder.id);
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(e) => onFolderDrop(e, folder)}
                className={cn(
                  'bg-card relative flex flex-col items-center gap-2 rounded-lg border p-4',
                  selection.folders.has(folder.id) && 'bg-accent',
                  dropTarget === folder.id && 'ring-primary ring-2'
                )}
              >
                <Checkbox
                  className='absolute top-2 left-2'
                  checked={selection.folders.has(folder.id)}
                  onCheckedChange={() => onToggle('folders', folder.id)}
                  aria-label={`Select folder ${folder.name}`}
                />
                <div className='absolute top-1 right-1'>
                  <RowMenu
                    label={`Actions for folder ${folder.name}`}
                    entries={folderMenu(folder)}
                  />
                </div>
                <IconFolder className='size-10' aria-hidden />
                <Link
                  href={openFolderHref(folder.id)}
                  className='line-clamp-2 text-center text-sm font-medium hover:underline'
                >
                  {folder.name}
                </Link>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {renderMenu(folderMenu(folder), 'context')}
            </ContextMenuContent>
          </ContextMenu>
        </li>
      ))}
      {files.map((file) => (
        <li key={file.id}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                draggable={canManage && !trash}
                onDragStart={(e) => onDragStart(e, 'files', file.id)}
                onDoubleClick={() => onPreview(file)}
                className={cn(
                  'bg-card relative flex flex-col items-center gap-2 rounded-lg border p-4',
                  selection.files.has(file.id) && 'bg-accent'
                )}
              >
                <Checkbox
                  className='absolute top-2 left-2'
                  checked={selection.files.has(file.id)}
                  onCheckedChange={() => onToggle('files', file.id)}
                  aria-label={`Select ${file.name}`}
                />
                <div className='absolute top-1 right-1'>
                  <RowMenu
                    label={`Actions for ${file.name}`}
                    entries={fileMenu(file)}
                  />
                </div>
                <IconFile className='size-10' aria-hidden />
                <button
                  type='button'
                  onClick={() => onPreview(file)}
                  className='line-clamp-2 text-center text-sm hover:underline'
                >
                  {file.name}
                </button>
                <span className='text-muted-foreground text-xs'>
                  {fileTypeLabel(file.mimeType)}
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              {renderMenu(fileMenu(file), 'context')}
            </ContextMenuContent>
          </ContextMenu>
        </li>
      ))}
    </ul>
  );
}
