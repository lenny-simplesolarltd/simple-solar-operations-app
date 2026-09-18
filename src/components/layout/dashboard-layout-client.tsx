'use client';

import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { AppUser } from '@/lib/auth';
import React from 'react';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  user: AppUser;
}

export function DashboardLayoutClient({
  children,
  defaultOpen = true,
  user
}: DashboardLayoutClientProps) {
  return (
    <KBar>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar user={user} />
        <SidebarInset>
          <Header user={user} />
          {/* page main content */}
          {children}
          {/* page main content ends */}
        </SidebarInset>
      </SidebarProvider>
    </KBar>
  );
}
