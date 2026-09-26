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
import { cn } from '@/lib/utils';
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconLoader2,
  IconSend
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Sharing a SimpleBot conversation.
 *
 * A link, not a pasted transcript. A transcript is a copy: it goes stale the
 * moment the conversation continues, and once pasted it cannot be taken back.
 * The link points at the conversation itself, stays current, and can be turned
 * off - and opening it still requires being signed in as staff, so one
 * forwarded outside the company opens nothing.
 *
 * Sending in team chat sends that same link. Download is kept for the case a
 * link cannot serve: something to attach to an email, or to keep.
 */

interface Person {
  personId: string;
  displayName: string;
  roles: string[];
}

export function ConversationShare({
  conversationId,
  onClose
}: {
  conversationId: string;
  onClose(): void;
}) {
  const [transcript, setTranscript] = useState<{
    title: string;
    markdown: string;
    lines: number;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * The share link request, tagged with the conversation it belongs to.
   *
   * One piece of state rather than a link plus a "still working" flag, so that
   * neither the effect nor a stale response can set the two out of step: a
   * response that arrives after the dialog has moved to another conversation
   * is ignored because its tag no longer matches.
   */
  const [share, setShare] = useState<{
    conversationId: string;
    url: string | null;
  }>({ conversationId, url: null });
  const link = share.conversationId === conversationId ? share.url : null;
  const linking = link === null && problem === null;
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [chosen, setChosen] = useState<Person[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    void fetch(`/api/assistant/conversations/${conversationId}/transcript`)
      .then((r) => r.json())
      .then((body) => {
        if (!live) return;
        if (body?.ok) setTranscript(body);
        else setProblem('That conversation could not be read.');
      })
      .catch(() => live && setProblem('That conversation could not be read.'));
    return () => {
      live = false;
    };
  }, [conversationId]);

  useEffect(() => {
    let live = true;
    void fetch(`/api/assistant/conversations/${conversationId}/share`, {
      method: 'POST'
    })
      .then((r) => r.json())
      .then((body) => {
        if (!live) return;
        if (body?.ok)
          setShare({
            conversationId,
            url: `${window.location.origin}/simplebot/shared/${body.shareId}`
          });
        else setProblem(body?.message ?? 'A link could not be made.');
      })
      .catch(() => live && setProblem('A link could not be made.'));
    return () => {
      live = false;
    };
  }, [conversationId]);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      void fetch(`/api/chat/people?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then((body) => live && setPeople(body?.people ?? []))
        .catch(() => live && setPeople([]));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setProblem('Your browser would not let the page copy that.');
    }
  };

  const download = () => {
    if (!transcript) return;
    const safe =
      transcript.title.replace(/[^\w\- ]+/g, '').trim() || 'conversation';
    const url = URL.createObjectURL(
      new Blob([transcript.markdown], { type: 'text/markdown' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safe}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (person: Person) =>
    setChosen((current) =>
      current.some((p) => p.personId === person.personId)
        ? current.filter((p) => p.personId !== person.personId)
        : [...current, person]
    );

  const send = async () => {
    if (!link || chosen.length === 0) return;
    setProblem(null);
    setSending(true);
    // One conversation with everyone chosen, not one each: they are being shown
    // the same thing and will have the same questions about it.
    const started = await runCommand({
      command_id: crypto.randomUUID(),
      command_type: 'CHAT_START',
      payload: {
        kind: chosen.length > 1 ? 'Group' : 'Direct',
        person_ids: chosen.map((p) => p.personId)
      }
    });
    if (!started.ok) {
      setSending(false);
      return setProblem(started.outcome.message);
    }
    const chatId = (started.result as { conversation_id?: string })
      .conversation_id;
    if (!chatId) {
      setSending(false);
      return setProblem('That conversation could not be opened.');
    }
    const sent = await runCommand({
      command_id: crypto.randomUUID(),
      command_type: 'CHAT_SEND',
      payload: {
        conversation_id: chatId,
        // The link, with enough words to say what it is. Not the transcript:
        // a chat full of pasted conversations is unreadable, and a link stays
        // current and can be turned off.
        body: `Shared a SimpleBot conversation — ${transcript?.title ?? 'conversation'}\n${link}`
      }
    });
    setSending(false);
    if (!sent.ok) return setProblem(sent.outcome.message);
    toast.success(
      chosen.length === 1
        ? `Sent to ${chosen[0].displayName}.`
        : `Sent to ${chosen.length} people.`
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Share this conversation</DialogTitle>
          <DialogDescription>
            {transcript
              ? `${transcript.title} · ${transcript.lines} ${transcript.lines === 1 ? 'entry' : 'entries'}. What tools SimpleBot used is named; what they returned is not included.`
              : 'Reading the conversation…'}
          </DialogDescription>
        </DialogHeader>

        {problem && (
          <p role='alert' className='text-destructive text-sm'>
            {problem}
          </p>
        )}

        <div className='flex gap-2'>
          <Input
            readOnly
            value={link ?? (linking ? 'Making a link…' : '')}
            aria-label='Link to this conversation'
            onFocus={(e) => e.target.select()}
            className='font-mono text-xs'
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          Anyone signed in to Simple Solar Operations can open this. Nobody else
          can, whoever the link reaches.
        </p>

        <div className='flex flex-wrap gap-2'>
          <Button
            type='button'
            variant='outline'
            disabled={!link}
            onClick={() => void copy()}
          >
            {copied ? <IconCheck aria-hidden /> : <IconCopy aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={!transcript}
            onClick={download}
          >
            <IconDownload aria-hidden />
            Download
          </Button>
        </div>

        <div className='flex flex-col gap-2 border-t pt-3'>
          <p className='text-sm font-medium'>Send in team chat</p>
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='Search your team'
              aria-label='Search for people to send this to'
            />
            {chosen.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {chosen.map((p) => (
                  <button
                    key={p.personId}
                    type='button'
                    onClick={() => toggle(p)}
                    className='bg-secondary text-secondary-foreground rounded-md px-2 py-0.5 text-xs'
                  >
                    {p.displayName} ×
                  </button>
                ))}
              </div>
            )}
            <ul className='max-h-48 divide-y overflow-y-auto rounded-md border'>
              {people === null && (
                <li className='text-muted-foreground px-3 py-3 text-sm'>
                  Looking…
                </li>
              )}
              {people?.length === 0 && (
                <li className='text-muted-foreground px-3 py-3 text-sm'>
                  Nobody matched that.
                </li>
              )}
              {people?.map((person) => {
                const picked = chosen.some(
                  (p) => p.personId === person.personId
                );
                return (
                  <li key={person.personId}>
                    <button
                      type='button'
                      onClick={() => toggle(person)}
                      className={cn(
                        'hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm',
                        picked && 'bg-accent'
                      )}
                    >
                      <span>
                        {person.displayName}
                        {person.roles.length > 0 && (
                          <span className='text-muted-foreground'>
                            {' '}
                            · {person.roles.join(', ')}
                          </span>
                        )}
                      </span>
                      {picked && <IconCheck aria-hidden className='size-4' />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        </div>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={onClose}>
            Close
          </Button>
          <Button
            type='button'
            disabled={!link || chosen.length === 0 || sending}
            onClick={() => void send()}
          >
            {sending && <IconLoader2 aria-hidden className='animate-spin' />}
            <IconSend aria-hidden />
            Send link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
