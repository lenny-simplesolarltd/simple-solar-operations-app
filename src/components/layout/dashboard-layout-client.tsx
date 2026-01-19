'use client';

import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import type { NavItem } from '@/types';
import React from 'react';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  navItems?: NavItem[];
}

export function DashboardLayoutClient({
  children,
  defaultOpen = true,
  navItems
}: DashboardLayoutClientProps) {
  return (
    <KBar navItemsOverride={navItems}>
      <SidebarProvider defaultOpen={defaultOpen}>
        <AppSidebar navItems={navItems} />
        <SidebarInset>
          <Header />
          {/* page main content */}
          {children}
          {/* page main content ends */}
        </SidebarInset>
      </SidebarProvider>
    </KBar>
  );
}
