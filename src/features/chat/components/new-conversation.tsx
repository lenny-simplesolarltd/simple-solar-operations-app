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
import { runCommand } from '@/lib/backend/command';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ChatPerson } from '../queries';
import { Avatar, newCommandId } from './avatar';

// Starting a conversation. Pick one person for a direct message, or several
// for a group; a group may be named.
//
// The picker searches the SERVER (CHAT_PEOPLE), which returns only colleagues
// who can actually take part and only their name and roles. Nothing about the
// directory is loaded into the browser to be filtered there.

export function NewConversation({
  onStarted
}: {
  onStarted: (conversationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [chosen, setChosen] = useState<ChatPerson[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/chat/people?q=${encodeURIComponent(query)}`,
        { cache: 'no-store' }
      );
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as { people: ChatPerson[] };
      setPeople(data.people);
      setSearched(true);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setChosen([]);
      setTitle('');
      setSearched(false);
    }
  };

  const toggle = (person: ChatPerson) =>
    setChosen((prev) =>
      prev.some((p) => p.personId === person.personId)
        ? prev.filter((p) => p.personId !== person.personId)
        : [...prev, person]
    );

  const start = async () => {
    if (chosen.length === 0 || busy) return;
    setBusy(true);
    // One person is a direct message; more than one is a group. The database
    // enforces both shapes, so this only picks the obvious default.
    const kind = chosen.length === 1 ? 'Direct' : 'Group';
    const result = await runCommand({
      command_id: newCommandId(),
      command_type: 'CHAT_START',
      payload: {
        kind,
        person_ids: chosen.map((p) => p.personId),
        ...(kind === 'Group' && title.trim() ? { title: title.trim() } : {})
      }
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.outcome.message);
      return;
    }
    const id = (result.result as { conversation_id?: string }).conversation_id;
    if (id) {
      // An existing direct conversation is reopened rather than duplicated;
      // say so, so nobody wonders why their old messages are there.
      if ((result.result as { created?: boolean }).created === false)
        toast.success('Opened your existing conversation.');
      onStarted(id);
    }
    close(false);
  };

  return (
    <>
      <Button size='sm' onClick={() => setOpen(true)}>
        <IconPlus />
        New conversation
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>New conversation</DialogTitle>
            <DialogDescription>
              Pick one person for a direct message, or several for a group.
            </DialogDescription>
          </DialogHeader>

          {chosen.length > 0 && (
            <div className='flex flex-wrap gap-1'>
              {chosen.map((p) => (
                <button
                  key={p.personId}
                  type='button'
                  onClick={() => toggle(p)}
                  className='bg-accent flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs'
                  aria-label={`Remove ${p.displayName}`}
                >
                  {p.displayName}
                  <IconX className='size-3' />
                </button>
              ))}
            </div>
          )}

          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Search people'
            aria-label='Search people'
          />

          <ul className='max-h-64 divide-y overflow-y-auto rounded-md border'>
            {people.length === 0 && searched && (
              <li className='text-muted-foreground px-3 py-6 text-center text-sm'>
                {query.trim()
                  ? `Nobody matching “${query.trim()}”.`
                  : 'No colleagues available to message.'}
              </li>
            )}
            {people.map((p) => {
              const picked = chosen.some((c) => c.personId === p.personId);
              return (
                <li key={p.personId}>
                  <button
                    type='button'
                    onClick={() => toggle(p)}
                    className={`hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left ${
                      picked ? 'bg-accent' : ''
                    }`}
                  >
                    <Avatar name={p.displayName} />
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate text-sm font-medium'>
                        {p.displayName}
                      </span>
                      {p.roles.length > 0 && (
                        <span className='text-muted-foreground block truncate text-xs'>
                          {p.roles.join(', ')}
                        </span>
                      )}
                    </span>
                    {picked && <span className='text-xs'>Selected</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          {chosen.length > 1 && (
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='Group name (optional)'
              aria-label='Group name'
            />
          )}

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => close(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void start()}
              disabled={chosen.length === 0 || busy}
            >
              {busy
                ? 'Starting…'
                : chosen.length > 1
                  ? `Start group (${chosen.length})`
                  : 'Start conversation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
