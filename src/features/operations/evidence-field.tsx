'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/client';
import { IconCheck, IconLoader2, IconRefresh } from '@tabler/icons-react';
import { useId, useRef, useState } from 'react';
import {
  EVIDENCE_ACCEPT,
  evidenceFileProblem,
  evidenceMimeType,
  type EvidenceContext
} from './evidence-rules';
import { beginEvidenceUpload, completeEvidenceUpload } from './evidence-upload';

/**
 * Uploads one evidence file for a task, work package or delivery and reports
 * its registered storage path. The server decides the job, category and path;
 * the command that receives the path accepts it only for its own job and only
 * once the file is really stored.
 *
 * Each chosen file gets one upload id, kept across "Try again", so a retry
 * resumes the same registration instead of creating a second evidence record.
 */
export function EvidenceField({
  context,
  category,
  label,
  required,
  onUploaded
}: {
  context: EvidenceContext;
  category?: string;
  label: string;
  required?: boolean;
  onUploaded: (path: string | null) => void;
}) {
  const id = useId();
  const attempt = useRef<{ file: File; uploadId: string } | null>(null);
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'uploading' }
    | { kind: 'done'; name: string }
    | { kind: 'error'; message: string; retry: boolean }
  >({ kind: 'idle' });

  async function upload(file: File, uploadId: string) {
    const problem = evidenceFileProblem(file);
    if (problem) {
      attempt.current = null;
      onUploaded(null);
      setState({ kind: 'error', message: problem, retry: false });
      return;
    }
    attempt.current = { file, uploadId };
    setState({ kind: 'uploading' });
    onUploaded(null);

    const ticket = await beginEvidenceUpload({
      uploadId,
      context,
      category,
      file: { name: file.name, type: file.type, size: file.size }
    });
    if (!ticket.ok) {
      setState({ kind: 'error', message: ticket.message, retry: true });
      return;
    }
    if (ticket.token) {
      const { error } = await createClient()
        .storage.from('evidence')
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: evidenceMimeType(file) ?? undefined
        });
      // An error here is not final: the bytes may have arrived although the
      // answer was lost. The server check below is what decides.
      const done = await completeEvidenceUpload(ticket.evidenceId);
      if (!done.ok) {
        setState({
          kind: 'error',
          message: error ? 'The upload failed. Try again.' : done.message,
          retry: true
        });
        return;
      }
    }
    attempt.current = null;
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
          accept={EVIDENCE_ACCEPT}
          disabled={state.kind === 'uploading'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file, crypto.randomUUID());
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
        <p
          role='alert'
          className='text-destructive flex flex-wrap items-center gap-2 text-xs'
        >
          {state.message}
          {state.retry && (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-6 px-2'
              onClick={() => {
                const a = attempt.current;
                if (a) void upload(a.file, a.uploadId);
              }}
            >
              <IconRefresh className='size-3' /> Try again
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
