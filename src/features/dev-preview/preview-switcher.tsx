'use client';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { endPreview, startPreview } from './actions';
import type { PreviewTarget } from './queries';

export function PreviewSwitcher({
  targets,
  current
}: {
  targets: PreviewTarget[];
  current: { name: string } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setOpen(false);
      if (!result.ok)
        toast.error(result.message ?? 'Preview could not be changed.');
      router.refresh();
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          disabled={pending}
          aria-label='Developer preview: view as another member of staff'
          className='max-w-[11rem] border-dashed md:max-w-[15rem]'
        >
          <span className='text-muted-foreground hidden sm:inline'>
            View as:&nbsp;
          </span>
          <span className='truncate font-medium'>
            {current ? current.name : 'Myself'}
          </span>
          <span aria-hidden className='ml-1'>
            ▾
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align='end' className='w-80 p-0'>
        <Command>
          <CommandInput placeholder='Search staff…' />
          <CommandList>
            <CommandEmpty>No active staff match.</CommandEmpty>
            <CommandGroup heading='Developer preview (read-only)'>
              <CommandItem
                value='myself return'
                onSelect={() => run(endPreview)}
              >
                <span className='font-medium'>Myself</span>
                {current && (
                  <span className='text-muted-foreground ml-auto text-xs'>
                    Return
                  </span>
                )}
              </CommandItem>
              {targets.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.name} ${t.roles.join(' ')}`}
                  onSelect={() => run(() => startPreview(t.id))}
                >
                  <span className='truncate'>{t.name}</span>
                  <span className='text-muted-foreground ml-auto pl-2 text-xs whitespace-nowrap'>
                    {t.roles.join(', ')}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
