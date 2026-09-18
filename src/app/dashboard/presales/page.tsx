import { EmptyState } from '@/components/empty-state';
import PageContainer from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import {
  getPermissions,
  getVisibleJobs
} from '@/features/presale/server/queries';
import { getCurrentUser } from '@/lib/auth';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Presales | Simple Solar Operations'
};

const pounds = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP'
});
const soldDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  day: '2-digit',
  month: 'short',
  year: 'numeric'
});
const FINANCE_LABEL: Record<string, string> = {
  Standard: 'No finance',
  Phoenix: 'Phoenix finance',
  OtherReview: 'Other finance'
};

export default async function PresalesPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/auth/sign-in');

  const [permissions, jobs] = await Promise.all([
    getPermissions(user),
    getVisibleJobs()
  ]);
  const seesAll = permissions.has('job.read.all');

  return (
    <PageContainer>
      <div className='flex w-full flex-col gap-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <Heading
            title={seesAll ? 'Sold jobs' : 'My presales'}
            description={
              seesAll
                ? 'Every job sold through the Presale form.'
                : 'Jobs you have sold. Office take it from here once a sale is submitted.'
            }
          />
          {permissions.has('presale.submit') && (
            <Button asChild>
              <Link href='/dashboard/presales/new'>New presale</Link>
            </Button>
          )}
        </div>

        {jobs.length === 0 ? (
          <EmptyState
            title='No jobs have been sold yet'
            description='Sold jobs appear here as soon as a presale is submitted.'
            action={
              permissions.has('presale.submit') && (
                <Button asChild size='sm'>
                  <Link href='/dashboard/presales/new'>New presale</Link>
                </Button>
              )
            }
          />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Sold</TableHead>
                  <TableHead>System</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead className='text-right'>Agreed price</TableHead>
                  <TableHead>Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className='font-mono font-semibold whitespace-nowrap'>
                      <Link
                        className='decoration-primary underline decoration-2 underline-offset-4'
                        href={`/dashboard/jobs/${job.id}`}
                      >
                        {job.jobRef}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {job.customerName}
                      <span className='text-muted-foreground block text-xs'>
                        {job.postcode}
                      </span>
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {soldDate.format(new Date(job.soldAt))}
                    </TableCell>
                    <TableCell className='whitespace-nowrap'>
                      {job.systemKwp === null
                        ? '-'
                        : `${job.systemKwp.toFixed(2)} kWp · ${job.netPanels} panels`}
                    </TableCell>
                    <TableCell>
                      {FINANCE_LABEL[job.financeRoute] ?? job.financeRoute}
                    </TableCell>
                    <TableCell className='text-right font-mono tabular-nums'>
                      {pounds.format(job.agreedPricePence / 100)}
                    </TableCell>
                    <TableCell>
                      <Badge variant='secondary'>{job.workflowStage}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
