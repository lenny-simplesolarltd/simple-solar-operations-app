'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IconLoader2, IconPlus } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createFormAction } from '../server/actions';

/**
 * Starts a new form (blank or from a template) or a new template. The
 * command id is minted when the dialog opens, so pressing Create twice, or
 * retrying after a dropped connection, creates one form.
 */
export function NewFormDialog({
  kind,
  templates,
  defaultTemplateId,
  trigger
}: {
  kind: 'form' | 'template';
  templates: { id: string; title: string }[];
  defaultTemplateId?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? '');
  const [commandId, setCommandId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setCommandId(crypto.randomUUID());
          setError(null);
          const template = templates.find((t) => t.id === defaultTemplateId);
          setTitle(template ? template.title : '');
          setTemplateId(defaultTemplateId ?? '');
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <IconPlus aria-hidden />
            {kind === 'form' ? 'New form' : 'New template'}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form
          className='flex flex-col gap-4'
          onSubmit={async (e) => {
            e.preventDefault();
            if (!title.trim()) return setError('Give it a title.');
            setBusy(true);
            const result = await createFormAction(
              {
                kind,
                title: title.trim(),
                ...(templateId && { sourceTemplateId: templateId })
              },
              commandId
            );
            setBusy(false);
            if (!result.ok) return setError(result.message);
            setOpen(false);
            router.push(`/dashboard/forms/${result.result.form_id}`);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {kind === 'form' ? 'New form' : 'New template'}
            </DialogTitle>
            <DialogDescription>
              {kind === 'form'
                ? 'Start blank or from a template. It stays a draft until you publish it.'
                : 'A reusable starting point for forms. Forms made from it are independent copies.'}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-2'>
            <Label htmlFor='new-form-title'>Title</Label>
            <Input
              id='new-form-title'
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === 'form'
                  ? 'e.g. Post-install feedback'
                  : 'e.g. Customer handover checklist'
              }
              autoFocus
            />
          </div>
          {kind === 'form' && templates.length > 0 && (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='new-form-template'>Start from</Label>
              <select
                id='new-form-template'
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t && !title.trim()) setTitle(t.title);
                }}
                className='border-input bg-background focus-visible:ring-ring/50 h-9 rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]'
              >
                <option value=''>A blank form</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Template: {t.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type='submit' disabled={busy}>
              {busy && <IconLoader2 aria-hidden className='animate-spin' />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
