import React from 'react';
import { SidebarTrigger } from '../ui/sidebar';
import { Separator } from '../ui/separator';
import { Breadcrumbs } from '../breadcrumbs';
import SearchInput from '../search-input';
import { UserNav } from './user-nav';
import { ModeToggle } from './ThemeToggle/theme-toggle';
import type { AppUser } from '@/lib/auth';
import { AssistantTrigger } from '@/features/assistant/components/assistant-trigger';

export default function Header({ user }: { user: AppUser }) {
  return (
    <header className='bg-card sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b px-3 md:px-4'>
      <div className='flex min-w-0 items-center gap-2'>
        <SidebarTrigger className='-ml-1 size-9 md:size-8' />
        <Separator orientation='vertical' className='mr-1 h-4' />
        <div className='min-w-0 truncate'>
          <Breadcrumbs />
        </div>
      </div>

      <div className='flex shrink-0 items-center gap-2 md:gap-3'>
        <div className='hidden md:flex'>
          <SearchInput />
        </div>
        <AssistantTrigger />
        <ModeToggle />
        <UserNav user={user} />
      </div>
    </header>
  );
}
