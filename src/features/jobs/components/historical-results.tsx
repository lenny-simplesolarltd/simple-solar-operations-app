import { Badge } from '@/components/ui/badge';
import type { JobSearchRow } from '@/lib/backend/models';
import Link from 'next/link';

/**
 * Historical matches for a search, shown under the operational results.
 *
 * Archived imports are kept out of the working queue on purpose (they are not
 * work, and `app.job_in_scope` is false for them), but staff still need to find
 * a job that predates this system. So they appear only when somebody actually
 * searches, in their own section, badged, and never mixed into the list of jobs
 * people are working on.
 */
export function HistoricalResults({ jobs }: { jobs: JobSearchRow[] }) {
  if (jobs.length === 0) return null;
  return (
    <section className='flex flex-col gap-2' aria-label='Historical records'>
      <div className='flex items-baseline gap-2'>
        <h2 className='text-sm font-semibold'>Historical records</h2>
        <p className='text-muted-foreground text-sm'>
          {jobs.length} {jobs.length === 1 ? 'match' : 'matches'} from before
          this system. Read-only: there is no active work on these.
        </p>
      </div>
      <ul className='flex flex-col gap-2'>
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={`/dashboard/jobs/${job.id}`}
              className='hover:bg-accent focus-visible:ring-ring flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 focus-visible:ring-2 focus-visible:outline-none'
            >
              <span className='font-medium'>{job.job_ref}</span>
              <span className='text-muted-foreground text-sm'>
                {[job.customer_name, job.town, job.postcode]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <Badge variant='secondary' className='ml-auto'>
                Historical record
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
