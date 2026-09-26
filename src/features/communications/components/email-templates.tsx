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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  IconLoader2,
  IconPlus,
  IconTemplate,
  IconTrash
} from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  deleteEmailTemplateAction,
  setEmailTemplateAction
} from '../server/actions';
import type { EmailTemplate, MergeField } from '../types';

/**
 * Opens the template list in a dialog, from wherever wording is being chosen.
 *
 * Templates are edited next to the thing that uses them rather than on a page
 * of their own: picking one and fixing its wording is the same errand.
 */
export function ManageTemplatesButton({
  templates,
  mergeFields,
  canManage
}: {
  templates: EmailTemplate[];
  mergeFields: MergeField[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        <IconTemplate aria-hidden />
        {canManage ? 'Templates' : 'View templates'}
        {templates.length ? (
          <span className='text-muted-foreground'>({templates.length})</span>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Email templates</DialogTitle>
            <DialogDescription>
              Wording worth keeping. A template sends nothing by itself — you
              pick one when you write an email.
            </DialogDescription>
          </DialogHeader>
          <EmailTemplatesManager
            templates={templates}
            mergeFields={mergeFields}
            canManage={canManage}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function EmailTemplatesManager({
  templates,
  mergeFields,
  canManage
}: {
  templates: EmailTemplate[];
  mergeFields: MergeField[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);

  return (
    <div className='flex flex-col gap-4'>
      {canManage ? (
        <div>
          <Button size='sm' onClick={() => setEditing('new')}>
            <IconPlus aria-hidden />
            New template
          </Button>
        </div>
      ) : (
        <p className='text-muted-foreground text-sm'>
          You can use these when writing an email, but not change them.
        </p>
      )}

      {templates.length === 0 ? (
        <p className='text-muted-foreground rounded-md border px-3 py-6 text-center text-sm'>
          No saved wording yet.
        </p>
      ) : (
        <ul className='flex flex-col gap-2'>
          {templates.map((t) => (
            <li key={t.id} className='rounded-lg border p-3'>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <p className='font-medium'>{t.name}</p>
                  {t.description ? (
                    <p className='text-muted-foreground text-sm'>
                      {t.description}
                    </p>
                  ) : null}
                  <p className='text-muted-foreground mt-1 truncate text-sm'>
                    {t.subject}
                  </p>
                </div>
                {canManage ? (
                  <div className='flex shrink-0 gap-2'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setEditing(t)}
                    >
                      Edit
                    </Button>
                    <DeleteTemplate template={t} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <TemplateDialog
          existing={editing === 'new' ? undefined : editing}
          mergeFields={mergeFields}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function DeleteTemplate({ template }: { template: EmailTemplate }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Button
        size='sm'
        variant='outline'
        aria-label={`Delete ${template.name}`}
        onClick={() => setConfirm(true)}
      >
        <IconTrash aria-hidden />
      </Button>
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{template.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              Emails already sent from this wording keep their own copy and are
              not touched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setConfirm(false)}
              disabled={busy}
            >
              Keep it
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await deleteEmailTemplateAction(
                  { id: template.id },
                  crypto.randomUUID()
                );
                setBusy(false);
                if (!r.ok) return toast.error(r.outcome.message);
                toast.success('Deleted.');
                setConfirm(false);
                router.refresh();
              }}
            >
              {busy ? (
                <IconLoader2 aria-hidden className='animate-spin' />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TemplateDialog({
  existing,
  mergeFields,
  onClose
}: {
  existing?: EmailTemplate;
  mergeFields: MergeField[];
  onClose(): void;
}) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [subject, setSubject] = useState(existing?.subject ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const r = await setEmailTemplateAction(
      {
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        subject: subject.trim(),
        body,
        description: description.trim() || null
      },
      crypto.randomUUID()
    );
    setBusy(false);
    if (!r.ok) return toast.error(r.outcome.message);
    toast.success(existing ? 'Saved.' : 'Template created.');
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {existing ? 'Edit template' : 'New template'}
          </DialogTitle>
          <DialogDescription>
            Use {'{{field}}'} where a name, address or reference should go. The
            list below is everything that can be filled in; anything else is
            refused when you save.
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-col gap-4'>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='t-name'>Name</Label>
            <Input
              id='t-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='t-desc'>What it is for (optional)</Label>
            <Input
              id='t-desc'
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='t-subject'>Subject</Label>
            <Input
              id='t-subject'
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='t-body'>Message</Label>
            <Textarea
              id='t-body'
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label>Fields you can use</Label>
            <div className='flex flex-wrap gap-1.5'>
              {mergeFields.map((f) => (
                <button
                  key={f.key}
                  type='button'
                  title={f.description}
                  onClick={() => setBody(`${body}{{${f.key}}}`)}
                  className='hover:bg-accent rounded-md border px-2 py-1 text-xs'
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !name.trim() || !subject.trim() || !body.trim()}
          >
            {busy ? <IconLoader2 aria-hidden className='animate-spin' /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
