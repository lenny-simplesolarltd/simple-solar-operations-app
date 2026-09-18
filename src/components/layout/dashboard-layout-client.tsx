'use client';

import KBar from '@/components/kbar';
import AppSidebar from '@/components/layout/app-sidebar';
import Header from '@/components/layout/header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AssistantDrawer } from '@/features/assistant/components/assistant-drawer';
import { AssistantProvider } from '@/features/assistant/components/assistant-provider';
import { PreviewBanner } from '@/features/dev-preview/preview-banner';
import type { PreviewTarget } from '@/features/dev-preview/queries';
import type { AppUser } from '@/lib/auth';
import React from 'react';

interface DashboardLayoutClientProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
  user: AppUser;
  /** Development "View as user": null unless this runtime and account may preview. */
  previewTargets?: PreviewTarget[] | null;
}

export function DashboardLayoutClient({
  children,
  defaultOpen = true,
  user,
  previewTargets = null
}: DashboardLayoutClientProps) {
  return (
    <KBar user={user}>
      <AssistantProvider>
        <SidebarProvider defaultOpen={defaultOpen}>
          <AppSidebar user={user} />
          <SidebarInset>
            {/* Banner + header stick together so the banner can never scroll away or cover the header. */}
            <div className='sticky top-0 z-30'>
              {user.preview && (
                <PreviewBanner
                  name={user.fullName ?? user.email}
                  roles={user.roles}
                  realName={user.preview.realName}
                />
              )}
              <Header user={user} previewTargets={previewTargets} />
            </div>
            {/* On wide screens the page makes room for the open assistant; below that the assistant overlays it. */}
            <div className='flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-out motion-reduce:transition-none min-[1400px]:group-data-[assistant-open=true]/assistant:pr-[27.5rem]'>
              {/* page main content */}
              {children}
              {/* page main content ends */}
            </div>
          </SidebarInset>
          <AssistantDrawer />
        </SidebarProvider>
      </AssistantProvider>
    </KBar>
  );
}
