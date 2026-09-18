import React from 'react';
import { SidebarTrigger } from '../ui/sidebar';
import { Separator } from '../ui/separator';
import { Breadcrumbs } from '../breadcrumbs';
import SearchInput from '../search-input';
import { UserNav } from './user-nav';
import { ThemeSelector } from '../theme-selector';
import { ModeToggle } from './ThemeToggle/theme-toggle';
import type { AppUser } from '@/lib/auth';

export default function Header({ user }: { user: AppUser }) {
  return (
    <header className='flex min-h-16 shrink-0 flex-col gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12 md:h-16 md:flex-row md:items-center md:justify-between'>
      <div className='flex w-full items-center gap-2 px-4 md:w-auto'>
        <SidebarTrigger className='-ml-1' />
        <Separator orientation='vertical' className='mr-2 h-4' />
        <Breadcrumbs />
      </div>

      <div className='flex w-full flex-wrap items-center justify-between gap-2 px-4 md:w-auto md:justify-end md:gap-3'>
        <div className='hidden md:flex'>
          <SearchInput />
        </div>
        <UserNav user={user} />
        <ModeToggle />
        <ThemeSelector />
      </div>
    </header>
  );
}
