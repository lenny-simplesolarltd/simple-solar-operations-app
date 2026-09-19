'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { AssistantPanel } from './assistant-panel';
import { useAssistantShell } from './assistant-provider';

export const ASSISTANT_TRIGGER_ID = 'assistant-trigger';

/** Tailwind's lg. Below it the assistant is a modal sheet; from it, a docked side panel. */
const DOCKED_QUERY = '(min-width: 1024px)';

function useDocked(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(DOCKED_QUERY);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => window.matchMedia(DOCKED_QUERY).matches,
    () => true
  );
}

/** Height of the visible viewport, so the composer stays above an on-screen keyboard. */
function useVisualViewportHeight(enabled: boolean): number | null {
  return useSyncExternalStore(
    (notify) => {
      const vv = enabled ? window.visualViewport : null;
      vv?.addEventListener('resize', notify);
      vv?.addEventListener('scroll', notify);
      return () => {
        vv?.removeEventListener('resize', notify);
        vv?.removeEventListener('scroll', notify);
      };
    },
    () => {
      const vv = enabled ? window.visualViewport : null;
      if (!vv) return null;
      // Only intervene when something (the keyboard) has taken real space.
      return window.innerHeight - vv.height > 80 ? Math.round(vv.height) : null;
    },
    () => null
  );
}

/**
 * The assistant drawer.
 *
 *   >= 1024px  a non-modal panel docked under the header on the right. Staff
 *              keep working in the page beside it. From 1400px the page makes
 *              room (see DashboardLayoutClient); below that it overlays.
 *   <  1024px  a modal sheet, full width on phones.
 *
 * Closed, it takes no space and is inert.
 */
export function AssistantDrawer() {
  const shell = useAssistantShell();
  const { open, setOpen, conversation } = shell;
  const docked = useDocked();
  const keyboardHeight = useVisualViewportHeight(open && !docked);
  const wasOpen = useRef(false);

  // Hand focus back to the header button when the docked panel closes.
  useEffect(() => {
    if (wasOpen.current && !open && docked) {
      document.getElementById(ASSISTANT_TRIGGER_ID)?.focus();
    }
    wasOpen.current = open;
  }, [open, docked]);

  const panel = (mode: 'docked' | 'sheet') => (
    <>
      {shell.capabilities?.preview && (
        <p
          role='status'
          data-testid='assistant-preview-notice'
          className='border-b-2 border-black bg-amber-400 px-3 py-1.5 text-center text-xs font-semibold text-black'
        >
          PREVIEW MODE — answering as {shell.capabilities.preview.name} (
          {shell.capabilities.preview.roles.join(', ')}). Read-only: no changes
          can be made.
        </p>
      )}
      <AssistantPanel
        conversation={conversation.state}
        page={shell.page}
        capabilities={shell.capabilities}
        capabilitiesError={shell.capabilitiesError}
        onSend={conversation.send}
        onStop={conversation.stop}
        onRetry={conversation.retry}
        onReset={conversation.reset}
        onDecide={conversation.decide}
        onHandoff={conversation.handoff}
        onDismissLong={conversation.dismissLong}
        history={{
          mode: conversation.mode,
          list: conversation.list,
          archived: conversation.archived,
          workingIds: conversation.workingIds,
          onOpen: conversation.open,
          onRefresh: conversation.refreshList,
          onRename: conversation.rename,
          onArchive: conversation.setArchived,
          onDelete: conversation.remove
        }}
        onClose={mode === 'docked' ? () => setOpen(false) : undefined}
        onNavigate={mode === 'sheet' ? () => setOpen(false) : undefined}
        active={open}
        headingId={`assistant-heading-${mode}`}
      />
    </>
  );

  if (docked) {
    return (
      <aside
        id='assistant-drawer'
        aria-label='SimpleBot'
        inert={!open}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) setOpen(false);
        }}
        className={cn(
          'fixed top-[calc(3.5rem+var(--preview-banner-h,0px))] right-0 bottom-0 z-30 w-[27.5rem] max-w-full border-l shadow-xl transition-[translate,visibility] duration-300 ease-out motion-reduce:transition-none min-[1400px]:shadow-none',
          open ? 'visible translate-x-0' : 'invisible translate-x-full'
        )}
      >
        {panel('docked')}
      </aside>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side='right'
        aria-describedby={undefined}
        style={
          keyboardHeight
            ? { height: keyboardHeight, bottom: 'auto' }
            : undefined
        }
        className='w-full gap-0 p-0 sm:max-w-[27.5rem] [&>button]:top-4.5'
      >
        <SheetTitle className='sr-only'>SimpleBot</SheetTitle>
        <SheetDescription className='sr-only'>
          Ask about jobs, customers and tasks.
        </SheetDescription>
        {panel('sheet')}
      </SheetContent>
    </Sheet>
  );
}
