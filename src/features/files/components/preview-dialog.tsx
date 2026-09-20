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
import { evidenceCategoryLabel } from '@/features/operations/evidence-rules';
import {
  IconDownload,
  IconExternalLink,
  IconInfoCircle
} from '@tabler/icons-react';
import Link from 'next/link';
import { fileDownloadUrl, fileKind, fileOpenUrl, formatBytes } from '../format';
import type { FileRow } from '../types';

// Preview.
//
// Nothing here is public. The <img> and <iframe> point at /api/evidence/<id>,
// which authorizes the request again under the signed-in person's session and
// redirects to a URL that stops working after 60 seconds - so a preview cannot
// be turned into a shareable link by copying its address.

export function PreviewDialog({
  file,
  open,
  onOpenChange,
  onDetails
}: {
  file: FileRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetails: () => void;
}) {
  const kind = fileKind(file.mimeType);
  const src = fileOpenUrl(file.id);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[90vh] max-w-4xl flex-col'>
        <DialogHeader>
          <DialogTitle className='truncate'>{file.name}</DialogTitle>
          <DialogDescription>
            {[
              evidenceCategoryLabel(file.category),
              formatBytes(file.sizeBytes),
              file.addedByName ? `Added by ${file.addedByName}` : null,
              file.addedAt ? file.addedAt.slice(0, 10) : null
            ]
              .filter(Boolean)
              .join(' · ')}
          </DialogDescription>
        </DialogHeader>

        <div className='bg-muted/30 min-h-64 flex-1 overflow-auto rounded-md border'>
          {!file.canOpen ? (
            <p className='text-muted-foreground p-8 text-center text-sm'>
              This document is not available to open.
            </p>
          ) : kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={file.name}
              className='mx-auto max-h-[60vh] w-auto object-contain'
            />
          ) : kind === 'pdf' ? (
            <iframe src={src} title={file.name} className='h-[60vh] w-full' />
          ) : (
            <div className='p-8 text-center'>
              <p className='text-sm font-medium'>
                There is no preview for this kind of file.
              </p>
              <p className='text-muted-foreground mt-1 text-sm'>
                Download it to open it on your device.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className='sm:justify-between'>
          <div className='flex flex-wrap gap-2'>
            {file.jobId && (
              <Button asChild variant='outline' size='sm'>
                <Link href={`/dashboard/jobs/${file.jobId}?tab=files`}>
                  <IconExternalLink className='size-4' aria-hidden /> Open job
                </Link>
              </Button>
            )}
            <Button variant='outline' size='sm' onClick={onDetails}>
              <IconInfoCircle className='size-4' aria-hidden /> Details
            </Button>
          </div>
          <Button asChild size='sm'>
            <a href={fileDownloadUrl(file.id)} download>
              <IconDownload className='size-4' aria-hidden /> Download
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
