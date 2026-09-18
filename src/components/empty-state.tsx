import { cn } from '@/lib/utils';

export function EmptyState({
  title,
  description,
  action,
  className
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'bg-card flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center',
        className
      )}
    >
      <span
        aria-hidden='true'
        className='bg-accent flex size-10 items-center justify-center rounded-full'
      >
        <span className='bg-brand size-3 rounded-full' />
      </span>
      <div>
        <p className='text-sm font-semibold'>{title}</p>
        {description && (
          <p className='text-muted-foreground mt-1 max-w-sm text-sm'>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
