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
  /**
   * Capabilities, waiting for the first fetch if it has not landed yet.
   *
   * Anything that DECIDES something from capabilities must await this rather
   * than read `capabilities`, which is null until the drawer's fetch resolves.
   * Attaching a property list within that window used to silently take the
   * ordinary text path, because the import capability had not arrived yet.
   */
  ensureCapabilities(): Promise<AssistantCapabilities | null>;
  /** The open conversation (and, through it, the staff member's others). */
  conversation: AssistantConversations;
  /**
   * Override mode. Off every time the app loads - it is not remembered - so a
   * mode switched on to clear a backlog cannot quietly still be on tomorrow.
   * It removes the confirmation step for administrative task overrides only.
   */
  overrideMode: boolean;
  setOverrideMode(on: boolean): void;
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

  // Capabilities are fetched the first time the drawer opens, not on every page
  // load. The in-flight promise is kept so a caller that needs the answer NOW
  // can await the same request instead of racing it.
  const inFlight = useRef<Promise<AssistantCapabilities | null> | null>(null);
  const ensureCapabilities = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const request = fetch('/api/assistant/capabilities')
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status)))
      )
      .then((data: AssistantCapabilities) => {
        setCapabilities(data);
        return data;
      })
      .catch(() => {
        // Cleared so a later attempt retries rather than caching the failure.
        inFlight.current = null;
        setCapabilitiesError(true);
        return null;
      });
    inFlight.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (open) void ensureCapabilities();
  }, [open, ensureCapabilities]);

  const [overrideMode, setOverrideMode] = useState(false);
  // Read at send time rather than captured, so toggling applies to the next
  // message. Synced in an effect because a ref must not be written in render.
  const overrideRef = useRef(overrideMode);
  useEffect(() => {
    overrideRef.current = overrideMode;
  }, [overrideMode]);

  const conversation = useAssistantConversations(
    getContext,
    capabilities?.conversations ?? 'ephemeral',
    () => overrideRef.current
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
      ensureCapabilities,
      conversation,
      overrideMode,
      setOverrideMode
    }),
    [
      open,
      toggle,
      page,
      publishPage,
      capabilities,
      capabilitiesError,
      ensureCapabilities,
      conversation,
      overrideMode
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
