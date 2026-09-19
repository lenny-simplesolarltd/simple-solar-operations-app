'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EvidenceField } from './evidence-field';
import { JOB_UPLOAD_CATEGORIES } from './evidence-groups';
import { evidenceCategoryLabel } from './evidence-rules';
import { SelectField } from './fields';

type JobUploadCategory = (typeof JOB_UPLOAD_CATEGORIES)[number];

/**
 * Adds a file straight to a job (evidence_upload_begin, Job context). The
 * database allows it for office staff assigned to the job and checks the
 * category; the file is stored and confirmed before it is listed, and the
 * page is then refreshed so it appears in its group.
 */
export function JobFileUpload({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<JobUploadCategory | ''>('');

  return (
    <div className='grid gap-3 md:grid-cols-2'>
      <SelectField
        label='What is it?'
        required
        value={category}
        onChange={setCategory}
        options={JOB_UPLOAD_CATEGORIES.map((c) => ({
          value: c,
          label: evidenceCategoryLabel(c)
        }))}
      />
      {category ? (
        <EvidenceField
          // A new category starts a new upload.
          key={category}
          context={{ type: 'Job', id: jobId }}
          category={category}
          label='File (photo or PDF, up to 25 MB)'
          onUploaded={(path) => {
            if (path) router.refresh();
          }}
        />
      ) : (
        <p className='text-muted-foreground self-end pb-2 text-sm'>
          Choose what the file is, then pick the file.
        </p>
      )}
    </div>
  );
}
