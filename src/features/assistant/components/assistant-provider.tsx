'use client';

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import type { AssistantContext, AssistantPageContext } from '../context';
import {
  useAssistantConversations,
  type AssistantConversations
} from '../hooks/use-assistant-conversation';
import type { AssistantCapabilities } from '../protocol';

interface AssistantShellValue {
  open: boolean;
  setOpen(open: boolean): void;
  toggle(): void;
  /** What the current page has published, or a route-derived fallback. */
  page: AssistantPageContext;
  publishPage(page: AssistantPageContext | null): void;
  capabilities: AssistantCapabilities | null;
  capabilitiesError: boolean;
  /** The open conversation (and, through it, the staff member's others). */
  conversation: AssistantConversations;
}

const AssistantShellContext = createContext<AssistantShellValue | null>(null);

/** Pages that publish nothing still get an honest, coarse context from the route. */
function pageFromRoute(pathname: string): AssistantPageContext {
  if (pathname === '/dashboard') return { kind: 'dashboard' };
  if (pathname.startsWith('/dashboard/presales/new'))
    return { kind: 'presale-new' };
  if (pathname.startsWith('/dashboard/people')) return { kind: 'people' };
  if (pathname === '/dashboard/jobs') return { kind: 'jobs' };
  if (pathname.startsWith('/dashboard/requests')) return { kind: 'requests' };
  return { kind: 'other' };
}

export function AssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState<{
    route: string;
    page: AssistantPageContext;
  } | null>(null);
  const [capabilities, setCapabilities] =
    useState<AssistantCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState(false);

  // A page's context only applies while that page is the current route.
  const page =
    published && published.route === pathname
      ? published.page
      : pageFromRoute(pathname);

  const contextRef = useRef<AssistantContext>({ route: pathname, page });
  useEffect(() => {
    contextRef.current = { route: pathname, page };
  }, [pathname, page]);
  const getContext = useCallback(() => contextRef.current, []);

  const publishPage = useCallback(
    (next: AssistantPageContext | null) => {
      setPublished(next ? { route: pathname, page: next } : null);
    },
    [pathname]
  );

  // Capabilities are fetched the first time the drawer opens, not on every page load.
  const requested = useRef(false);
  useEffect(() => {
    if (!open || requested.current) return;
    requested.current = true;
    fetch('/api/assistant/capabilities')
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status)))
      )
      .then((data: AssistantCapabilities) => setCapabilities(data))
      .catch(() => {
        requested.current = false;
        setCapabilitiesError(true);
      });
  }, [open]);

  const conversation = useAssistantConversations(
    getContext,
    capabilities?.conversations ?? 'ephemeral'
  );

  const toggle = useCallback(() => setOpen((value) => !value), []);

  const value = useMemo<AssistantShellValue>(
    () => ({
      open,
      setOpen,
      toggle,
      page,
      publishPage,
      capabilities,
      capabilitiesError,
      conversation
    }),
    [
      open,
      toggle,
      page,
      publishPage,
      capabilities,
      capabilitiesError,
      conversation
    ]
  );

  return (
    <AssistantShellContext.Provider value={value}>
      {/* display: contents - only carries the open state for the layout to react to. */}
      <div data-assistant-open={open} className='group/assistant contents'>
        {children}
      </div>
    </AssistantShellContext.Provider>
  );
}

export function useAssistantShell(): AssistantShellValue {
  const value = useContext(AssistantShellContext);
  if (!value) {
    throw new Error(
      'useAssistantShell must be used inside <AssistantProvider>'
    );
  }
  return value;
}

/** For components that may render outside the dashboard shell. */
export function useOptionalAssistantShell(): AssistantShellValue | null {
  return useContext(AssistantShellContext);
}
