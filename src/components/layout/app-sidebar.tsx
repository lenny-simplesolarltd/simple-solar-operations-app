'use client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from '@/components/ui/sidebar';
import { signOut } from '@/app/auth/actions';
import { UserAvatarProfile } from '@/components/user-avatar-profile';
import type { AppUser } from '@/lib/auth';
import type { VisibleNavGroup } from '@/types';
import { BrandLogo, BrandMark } from '@/components/brand-logo';
import { IconChevronsDown, IconLogout } from '@tabler/icons-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icons } from '../icons';

/**
 * The entry that best matches the current location: the longest URL whose path
 * is the current path (or an ancestor of it) and whose query parameters are all
 * present. So /dashboard/tasks?scope=team highlights "Team tasks", and a job
 * detail page keeps "Job search" highlighted.
 */
function bestMatch(
  nav: VisibleNavGroup[],
  pathname: string,
  search: URLSearchParams
): string | null {
  let best: { url: string; score: number } | null = null;
  for (const item of nav.flatMap((g) => g.items)) {
    const [path, query = ''] = item.url.split('?');
    const pathOk =
      pathname === path ||
      (path !== '/dashboard' && pathname.startsWith(`${path}/`));
    if (!pathOk) continue;
    const params: [string, string][] = [];
    new URLSearchParams(query).forEach((v, k) => params.push([k, v]));
    if (params.some(([k, v]) => search.get(k) !== v)) continue;
    // A bare path must not win while a more specific sibling's query matches.
    const score =
      path.length * 10 + params.length + (pathname === path ? 1 : 0);
    if (!best || score > best.score) best = { url: item.url, score };
  }
  return best?.url ?? null;
}

export default function AppSidebar({
  user,
  nav
}: {
  user: AppUser;
  nav: VisibleNavGroup[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeUrl = bestMatch(nav, pathname, searchParams);

  return (
    <Sidebar collapsible='icon'>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size='lg'
              asChild
              className='hover:bg-transparent active:bg-transparent'
            >
              <Link href='/dashboard' aria-label='Simple Solar Operations home'>
                <BrandMark className='hidden group-data-[collapsible=icon]:flex' />
                <div className='flex flex-col gap-1 px-1 group-data-[collapsible=icon]:hidden'>
                  <BrandLogo className='h-[22px]' />
                  <span className='text-muted-foreground text-[10px] leading-none font-semibold tracking-[0.18em] uppercase'>
                    Operations
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className='overflow-x-hidden'>
        {nav.map((group) => (
          <SidebarGroup key={group.label} className='py-1'>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = Icons[item.icon];
                const active = activeUrl === item.url;
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={active}
                    >
                      <Link
                        href={item.url}
                        aria-current={active ? 'page' : undefined}
                      >
                        <Icon />
                        <span>{item.title}</span>
                        {/* The website's nav marker: a sun dot on the current item. */}
                        {active && (
                          <span
                            aria-hidden='true'
                            className='bg-brand ml-auto size-2 shrink-0 rounded-full group-data-[collapsible=icon]:hidden'
                          />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size='lg'
                  className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
                >
                  <UserAvatarProfile
                    className='h-8 w-8 rounded-lg'
                    showInfo
                    user={user}
                  />
                  <IconChevronsDown className='ml-auto size-4' />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className='w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg'
                side='bottom'
                align='end'
                sideOffset={4}
              >
                <DropdownMenuLabel className='p-0 font-normal'>
                  <div className='px-1 py-1.5'>
                    <UserAvatarProfile
                      className='h-8 w-8 rounded-lg'
                      showInfo
                      user={user}
                    />
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => signOut()}>
                  <IconLogout className='mr-2 h-4 w-4' />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
