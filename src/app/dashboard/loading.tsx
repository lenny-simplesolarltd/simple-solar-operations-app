import PageContainer from '@/components/layout/page-container';
import { Skeleton } from '@/components/ui/skeleton';

// Shown while any dashboard screen's server reads are in flight.
export default function DashboardLoading() {
  return (
    <PageContainer>
      <div
        className='flex w-full flex-col gap-4'
        aria-busy='true'
        aria-label='Loading'
      >
        <Skeleton className='h-8 w-56' />
        <Skeleton className='h-4 w-80 max-w-full' />
        <div className='flex gap-2'>
          <Skeleton className='h-9 w-40' />
          <Skeleton className='h-9 w-32' />
        </div>
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className='h-14 w-full' />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
