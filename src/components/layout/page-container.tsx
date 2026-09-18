import React from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function PageContainer({
  children,
  scrollable = true
}: {
  children: React.ReactNode;
  scrollable?: boolean;
}) {
  return (
    <>
      {scrollable ? (
        <ScrollArea className='h-[calc(100dvh-(--spacing(14)))] [&_[data-slot=scroll-area-viewport]>div]:!block'>
          <div className='mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col p-4 md:p-6'>
            {children}
          </div>
        </ScrollArea>
      ) : (
        <div className='mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col p-4 md:p-6'>
          {children}
        </div>
      )}
    </>
  );
}
