'use client';
import type { VisibleNavGroup } from '@/types';
import {
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarProvider,
  KBarSearch
} from 'kbar';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import RenderResults from './render-result';
import useThemeSwitching from './use-theme-switching';

export default function KBar({
  children,
  nav
}: {
  children: React.ReactNode;
  /** The same server-built menu the sidebar shows. */
  nav: VisibleNavGroup[];
}) {
  const router = useRouter();

  // One navigation action per visible menu entry, grouped like the sidebar.
  const actions = useMemo(
    () =>
      nav.flatMap((group) =>
        group.items.map((item) => ({
          id: `nav:${item.url}`,
          name: item.title,
          shortcut: item.shortcut,
          keywords: `${item.title} ${group.label}`.toLowerCase(),
          section: group.label,
          subtitle: `Go to ${item.title}`,
          perform: () => router.push(item.url)
        }))
      ),
    [router, nav]
  );

  return (
    <KBarProvider actions={actions}>
      <KBarComponent>{children}</KBarComponent>
    </KBarProvider>
  );
}
const KBarComponent = ({ children }: { children: React.ReactNode }) => {
  useThemeSwitching();

  return (
    <>
      <KBarPortal>
        <KBarPositioner className='bg-background/80 fixed inset-0 z-99999 p-0! backdrop-blur-sm'>
          <KBarAnimator className='bg-card text-card-foreground relative mt-64! w-full max-w-[600px] -translate-y-12! overflow-hidden rounded-lg border shadow-lg'>
            <div className='bg-card border-border sticky top-0 z-10 border-b'>
              <KBarSearch className='bg-card w-full border-none px-6 py-4 text-lg outline-hidden focus:ring-0 focus:ring-offset-0 focus:outline-hidden' />
            </div>
            <div className='max-h-[400px]'>
              <RenderResults />
            </div>
          </KBarAnimator>
        </KBarPositioner>
      </KBarPortal>
      {children}
    </>
  );
};
