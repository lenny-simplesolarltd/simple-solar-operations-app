'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import {
  IconArchive,
  IconArrowBackUp,
  IconDots,
  IconLoader2,
  IconPencil,
  IconPlus,
  IconTrash
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import type { ConversationList } from '../hooks/use-assistant-conversation';
import type { ConversationListItem } from '../protocol';

export interface ConversationHistoryProps {
  mode: 'persistent' | 'ephemeral';
  list: ConversationList;
  archived: ConversationList;
  activeId: string;
  workingIds: string[];
  onOpen(id: string): void;
  onNew(): void;
  onRefresh(options?: { archived?: boolean }): void;
  onRename(id: string, title: string): Promise<boolean>;
  onArchive(id: string, archived: boolean): Promise<boolean>;
  onDelete(id: string): Promise<boolean>;
}

const UNTITLED = 'Untitled conversation';

/** Today / Yesterday / Previous 7 days / Earlier, in the staff member's own timezone. */
function groupByDay(items: ConversationListItem[], now = new Date()) {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const day = 86_400_000;
  const groups: { label: string; items: ConversationListItem[] }[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Earlier', items: [] }
  ];
  for (const item of items) {
    const at = new Date(item.lastMessageAt ?? item.createdAt).getTime();
    const index =
      at >= startOfToday
        ? 0
        : at >= startOfToday - day
          ? 1
          : at >= startOfToday - 7 * day
            ? 2
            : 3;
    groups[index].items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

function shortTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const minutes = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60 && at.getDate() === now.getDate()) {
    return `${Math.round(minutes / 60)}h`;
  }
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short'
  }).format(at);
}

/**
 * The staff member's saved conversations, inside the drawer. Only their own:
 * the list comes from an owner-only endpoint.
 */
export function ConversationHistory(props: ConversationHistoryProps) {
  const { mode, list, archived, onRefresh } = props;
  const [showArchived, setShowArchived] = useState(false);
  const [deleting, setDeleting] = useState<ConversationListItem | null>(null);

  useEffect(() => {
    onRefresh();
  }, [onRefresh]);
  useEffect(() => {
    if (showArchived) onRefresh({ archived: true });
  }, [showArchived, onRefresh]);

  if (mode === 'ephemeral') {
    return (
      <div className='flex flex-col gap-3 text-sm'>
        <NewButton onNew={props.onNew} />
        <p className='text-muted-foreground'>
          Conversations are not saved in this environment, so there is no
          history to show. This conversation lasts until you reload the page.
        </p>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-4'>
      <NewButton onNew={props.onNew} />

      {list.status === 'loading' && list.items.length === 0 && (
        <p className='text-muted-foreground flex items-center gap-2 text-sm'>
          <IconLoader2 aria-hidden className='size-4 animate-spin' />
          Loading your conversations…
        </p>
      )}
      {list.status === 'error' && (
        <div
          className='text-destructive flex items-center justify-between gap-2 text-sm'
          role='alert'
        >
          Your conversations could not be loaded.
          <Button
            size='sm'
            variant='outline'
            className='h-7'
            onClick={() => onRefresh()}
          >
            Try again
          </Button>
        </div>
      )}
      {list.status === 'ready' && list.items.length === 0 && (
        <p className='text-muted-foreground text-sm'>
          No saved conversations yet. They appear here after your first
          question.
        </p>
      )}

      {groupByDay(list.items).map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className='text-muted-foreground mb-1 px-2 text-xs font-medium'>
            {group.label}
          </h3>
          <ul className='flex flex-col'>
            {group.items.map((item) => (
              <Row
                key={item.id}
                item={item}
                {...props}
                onAskDelete={setDeleting}
              />
            ))}
          </ul>
        </section>
      ))}

      <div className='border-t pt-3'>
        <button
          type='button'
          aria-expanded={showArchived}
          onClick={() => setShowArchived((v) => !v)}
          className='text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded px-2 text-xs font-medium outline-none focus-visible:ring-2'
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </button>
        {showArchived && (
          <div className='mt-2'>
            {archived.status === 'loading' && archived.items.length === 0 && (
              <p className='text-muted-foreground px-2 text-xs'>Loading…</p>
            )}
            {archived.status === 'ready' && archived.items.length === 0 && (
              <p className='text-muted-foreground px-2 text-xs'>
                Nothing archived.
              </p>
            )}
            <ul className='flex flex-col'>
              {archived.items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  {...props}
                  onAskDelete={setDeleting}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title ?? UNTITLED}” and all of its messages will be
              permanently deleted. This cannot be undone. Nothing in Simple
              Solar Operations is changed. To keep it out of the way instead,
              archive it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                if (deleting) void props.onDelete(deleting.id);
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NewButton({ onNew }: { onNew(): void }) {
  return (
    <Button
      variant='outline'
      size='sm'
      className='h-9 justify-start gap-2'
      onClick={onNew}
    >
      <IconPlus aria-hidden />
      New conversation
    </Button>
  );
}

function Row({
  item,
  activeId,
  workingIds,
  onOpen,
  onRename,
  onArchive,
  onAskDelete
}: ConversationHistoryProps & {
  item: ConversationListItem;
  onAskDelete(item: ConversationListItem): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.title ?? '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = item.id === activeId;
  const working = workingIds.includes(item.id);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const save = async () => {
    const title = draft.trim();
    if (!title || title === item.title) return setRenaming(false);
    setSaving(true);
    const ok = await onRename(item.id, title);
    setSaving(false);
    if (ok) setRenaming(false);
  };

  if (renaming) {
    return (
      <li className='px-1 py-0.5'>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className='flex items-center gap-1.5'
        >
          <label htmlFor={`rename-${item.id}`} className='sr-only'>
            Conversation name
          </label>
          <input
            id={`rename-${item.id}`}
            ref={inputRef}
            value={draft}
            maxLength={120}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(item.title ?? '');
                setRenaming(false);
              }
            }}
            className='border-input focus-visible:ring-ring/40 focus-visible:border-ring bg-background h-8 min-w-0 flex-1 rounded-md border px-2 text-base outline-none focus-visible:ring-[3px] md:text-sm'
          />
          <Button
            type='submit'
            size='sm'
            className='h-8'
            disabled={saving || !draft.trim()}
          >
            Save
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className='group/row relative'>
      <button
        type='button'
        onClick={() => onOpen(item.id)}
        aria-current={current ? 'true' : undefined}
        className={cn(
          'focus-visible:ring-ring flex w-full min-w-0 items-center gap-2 rounded-md py-2 pr-9 pl-2 text-left text-sm outline-none focus-visible:ring-2',
          current ? 'bg-accent font-medium' : 'hover:bg-accent/60'
        )}
      >
        {working && (
          <span
            className='bg-brand size-2 shrink-0 animate-pulse rounded-full'
            aria-hidden
          />
        )}
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            !item.title && 'text-muted-foreground italic'
          )}
        >
          {item.title ?? UNTITLED}
        </span>
        {working ? (
          <span className='text-muted-foreground shrink-0 text-xs'>
            Answering…
          </span>
        ) : (
          <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
            {shortTime(item.lastMessageAt ?? item.createdAt)}
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground absolute top-1/2 right-1 size-7 -translate-y-1/2'
          >
            <IconDots aria-hidden />
            <span className='sr-only'>
              Options for {item.title ?? UNTITLED}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          <DropdownMenuItem
            onSelect={() => {
              setDraft(item.title ?? '');
              setRenaming(true);
            }}
          >
            <IconPencil aria-hidden />
            Rename
          </DropdownMenuItem>
          {item.archived ? (
            <DropdownMenuItem onSelect={() => void onArchive(item.id, false)}>
              <IconArrowBackUp aria-hidden />
              Restore
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void onArchive(item.id, true)}>
              <IconArchive aria-hidden />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant='destructive'
            onSelect={() => onAskDelete(item)}
          >
            <IconTrash aria-hidden />
            Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
