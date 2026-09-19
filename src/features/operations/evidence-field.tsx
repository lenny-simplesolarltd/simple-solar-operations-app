'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { IconCheck, IconLoader2, IconUpload } from '@tabler/icons-react';
import { useId, useState } from 'react';
import { createEvidenceUpload } from './evidence-upload';

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Uploads one evidence file for a job to Storage and reports its path. The
 * path is only a candidate: the command that receives it checks the object
 * exists and belongs to the job before recording anything.
 */
export function EvidenceField({
  jobId,
  label,
  required,
  onUploaded
}: {
  jobId: string;
  label: string;
  required?: boolean;
  onUploaded: (path: string | null) => void;
}) {
  const id = useId();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'done'; name: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      setState({ kind: 'error', message: 'Files must be 25 MB or smaller.' });
      return;
    }
    setState({ kind: 'uploading' });
    onUploaded(null);
    const ticket = await createEvidenceUpload(jobId, file.name);
    if (!ticket.ok) {
      setState({ kind: 'error', message: ticket.message });
      return;
    }
    const { error } = await createClient()
      .storage.from('evidence')
      .uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type || undefined
      });
    if (error) {
      setState({ kind: 'error', message: 'The upload failed. Try again.' });
      return;
    }
    setState({ kind: 'done', name: file.name });
    onUploaded(ticket.path);
  }

  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={id}>
        {label}
        {required && <span className='text-destructive'> *</span>}
      </Label>
      <div className='flex items-center gap-2'>
        <Input
          id={id}
          type='file'
          accept='image/*,application/pdf'
          disabled={state.kind === 'uploading'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        {state.kind === 'uploading' && (
          <IconLoader2 className='size-4 shrink-0 animate-spin' />
        )}
        {state.kind === 'done' && (
          <IconCheck className='text-success size-4 shrink-0' />
        )}
      </div>
      {state.kind === 'done' && (
        <p className='text-muted-foreground text-xs'>Uploaded {state.name}</p>
      )}
      {state.kind === 'error' && (
        <p className='text-destructive flex items-center gap-2 text-xs'>
          {state.message}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-6 px-2'
            asChild
          >
            <label htmlFor={id}>
              <IconUpload className='size-3' /> Choose again
            </label>
          </Button>
        </p>
      )}
    </div>
  );
}
