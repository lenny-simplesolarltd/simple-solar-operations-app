import { DashboardLayoutClient } from '@/components/layout/dashboard-layout-client';
import { navItems as defaultNavItems } from '@/constants/data';
import type { UserRole } from '@/lib/userRoles';
import { getUserRole } from '@/lib/userRoles';
import type { NavItem } from '@/types';
import { currentUser } from '@clerk/nextjs/server';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
  title: 'Next Shadcn Dashboard Starter',
  description: 'Basic dashboard with Next.js and Shadcn'
};

const accountSection: NavItem = {
  title: 'Account',
  url: '#',
  icon: 'billing',
  isActive: true,
  items: [
    {
      title: 'Profile',
      url: '/dashboard/profile',
      icon: 'userPen',
      shortcut: ['m', 'm']
    },
    {
      title: 'Login',
      shortcut: ['l', 'l'],
      url: '/',
      icon: 'login'
    }
  ]
};

function buildNavItems(role: UserRole): NavItem[] {
  if (role === 'company') {
    return [
      {
        title: 'Metrics',
        url: '/dashboard/company/metrics',
        icon: 'dashboard',
        shortcut: ['d', 'c'],
        items: []
      },
      {
        title: 'Scanner',
        url: '/dashboard/company/scanner',
        icon: 'scan',
        shortcut: ['q', 's'],
        items: []
      },
      {
        title: 'Codes',
        url: '/dashboard/company/codes',
        icon: 'post',
        shortcut: ['c', 'd'],
        items: []
      },
      {
        title: 'Clients',
        url: '/dashboard/company/clients',
        icon: 'user',
        shortcut: ['c', 'l'],
        items: []
      },
      accountSection
    ];
  }

  if (role === 'client') {
    return [
      {
        title: 'Metrics',
        url: '/dashboard/client/metrics',
        icon: 'dashboard',
        shortcut: ['d', 'c'],
        items: []
      },
      {
        title: 'Codes',
        url: '/dashboard/client/codes',
        icon: 'post',
        shortcut: ['c', 'd'],
        items: []
      },
      accountSection
    ];
  }

  return defaultNavItems;
}

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Persisting the sidebar state in the cookie.
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';
  const user = await currentUser();
  const { role } = await getUserRole(user);
  const navItems = buildNavItems(role);

  return (
    <DashboardLayoutClient defaultOpen={defaultOpen} navItems={navItems}>
      {children}
    </DashboardLayoutClient>
  );
}
