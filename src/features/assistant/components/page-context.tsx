'use client';

import { useEffect } from 'react';
import type { AssistantPageContext as PageContext } from '../context';
import { useOptionalAssistantShell } from './assistant-provider';

/**
 * Publishes what this page is showing to the assistant. Render it from a page
 * with only safe, structured values the staff member can already see on that
 * page - ids, references, display names, stage, active filters. It renders
 * nothing. The server treats whatever arrives as a hint, never as authority.
 */
export function AssistantPageContext({ page }: { page: PageContext }) {
  const publishPage = useOptionalAssistantShell()?.publishPage;
  // Pages pass a fresh object each render; publish on value change only.
  const key = JSON.stringify(page);

  useEffect(() => {
    if (!publishPage) return;
    publishPage(JSON.parse(key) as PageContext);
    return () => publishPage(null);
  }, [publishPage, key]);

  return null;
}
