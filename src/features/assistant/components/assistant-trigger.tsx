'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { IconSunElectricity } from '@tabler/icons-react';
import { ASSISTANT_TRIGGER_ID } from './assistant-drawer';
import { useAssistantShell } from './assistant-provider';

/** The header entry point. A labelled toggle, so it reads as part of the toolbar rather than a chat bubble. */
export function AssistantTrigger() {
  const { open, toggle, conversation } = useAssistantShell();
  const working = conversation.state.status === 'working';

  return (
    <Button
      id={ASSISTANT_TRIGGER_ID}
      variant={open ? 'default' : 'outline'}
      size='sm'
      aria-expanded={open}
      aria-controls='assistant-drawer'
      onClick={toggle}
      className='h-8 gap-1.5 px-2.5'
    >
      <span className='relative flex'>
        <IconSunElectricity aria-hidden className='size-4' />
        {working && !open && (
          <span
            aria-hidden
            className={cn(
              'bg-brand ring-card absolute -top-0.5 -right-0.5 size-2 animate-pulse rounded-full ring-2'
            )}
          />
        )}
      </span>
      <span className='hidden sm:inline'>SimpleBot</span>
      <span className='sr-only sm:hidden'>SimpleBot</span>
    </Button>
  );
}
