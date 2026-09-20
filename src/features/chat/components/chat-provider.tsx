'use client';

import {
  evidenceFileProblem,
  evidenceMimeType
} from '@/features/operations/evidence-rules';
import {
  beginEvidenceUpload,
  completeEvidenceUpload
} from '@/features/operations/evidence-upload';
import { runCommand } from '@/lib/backend/command';
import { createClient } from '@/lib/supabase/client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { toast } from 'sonner';
import { newlyUnread, notificationBody, playMessageChime } from '../notify';
import { totalUnread, type ChatSurface } from '../unread';
import { conversationName } from '../types';
import type { ChatConversationRow, ChatMessageRow } from '../types';
import { newCommandId } from './avatar';

// THE single owner of chat state.
//
// Chat is presented three ways - a launcher, a floating panel, and the
// full-screen page - and they are presentations of ONE conversation list, ONE
// message list and ONE realtime subscription. Before this, the full-screen page
// owned all of that itself; adding a floating panel that did the same would
// have meant two subscriptions delivering the same event twice, two unread
// counts disagreeing, and a draft that vanished when you switched surface.
//
// So it all lives here, at dashboard-layout level, and the surfaces are thin.
//
// WHAT IS DELIBERATELY NOT PERSISTED
//
// Drafts, reply targets and message bodies stay in memory. They are colleagues'
// words about real jobs and customers; writing them to localStorage would leave
// them on a shared machine after sign-out for no benefit. Only the surface
// (minimised / list / thread) survives a reload, and that is a UI preference
// carrying no content.

const SURFACE_KEY = 'ss.chat.surface';
const LAUNCHER_KEY = 'ss.chat.launcher';

type Pending = {
  localId: string;
  body: string;
  replyToId: string | null;
  failed?: boolean;
};

interface ChatState {
  enabled: boolean;
  viewerPersonId: string;
  viewerName: string;
  conversations: ChatConversationRow[];
  messages: ChatMessageRow[];
  jobRefs: Record<string, string>;
  pending: Pending[];
  selected: string | null;
  surface: ChatSurface;
  /** False once the person dismisses the floating launcher with the × control. */
  launcherVisible: boolean;
  unreadTotal: number;
  loadingThread: boolean;
  attaching: boolean;
  /** Per-conversation draft, so switching conversations does not lose typing. */
  draft: string;
  replyTo: ChatMessageRow | null;
  setDraft: (value: string) => void;
  setReplyTo: (message: ChatMessageRow | null) => void;
  setSurface: (surface: ChatSurface) => void;
  /** The × control: put the floating launcher away entirely. */
  dismissLauncher: () => void;
  /** The header control: bring chat back, launcher and all. */
  showChat: () => void;
  openConversation: (id: string) => void;
  backToList: () => void;
  send: () => Promise<void>;
  react: (messageId: string, emoji: string, on: boolean) => Promise<void>;
  attach: (file: File) => Promise<void>;
  recoverPending: (localId: string) => void;
  refresh: () => Promise<void>;
}

const ChatContext = createContext<ChatState | null>(null);

export function useChat(): ChatState {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}

/** True when chat is available at all, without throwing for pages outside it. */
export function useChatEnabled(): boolean {
  return useContext(ChatContext)?.enabled ?? false;
}

export function ChatProvider({
  enabled,
  viewerPersonId,
  viewerName,
  children
}: {
  enabled: boolean;
  viewerPersonId: string;
  viewerName: string;
  children: React.ReactNode;
}) {
  const [conversations, setConversations] = useState<ChatConversationRow[]>([]);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [jobRefs, setJobRefs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [surface, setSurfaceState] = useState<ChatSurface>('minimised');
  const [launcherVisible, setLauncherVisible] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replyTargets, setReplyTargets] = useState<
    Record<string, ChatMessageRow | null>
  >({});

  // The subscription is created once. This is how its callback reads the
  // current selection without being torn down every time it changes.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const loadConversations = useCallback(async () => {
    const res = await fetch('/api/chat/conversations', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as {
      conversations: ChatConversationRow[];
    };
    setConversations(data.conversations);
  }, []);

  const loadThread = useCallback(async (conversationId: string) => {
    const res = await fetch(`/api/chat/${conversationId}`, {
      cache: 'no-store'
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: ChatMessageRow[];
      conversations: ChatConversationRow[];
      jobRefs: Record<string, string>;
    };
    setMessages(data.messages);
    setConversations(data.conversations);
    setJobRefs(data.jobRefs);
    setLoadingThread(false);
  }, []);

  // First load, and the surface the person last used.
  useEffect(() => {
    if (!enabled) return;
    try {
      const saved = window.localStorage.getItem(SURFACE_KEY);
      // 'thread' is not restored: without a conversation it means nothing, and
      // restoring one would mark it read before anybody looked at it.
      if (saved === 'list') setSurfaceState('list');
      setLauncherVisible(
        window.localStorage.getItem(LAUNCHER_KEY) !== 'hidden'
      );
    } catch {
      // Private browsing, or storage refused. The default surface is fine.
    }
    void loadConversations();
  }, [enabled, loadConversations]);

  const setSurface = useCallback((next: ChatSurface) => {
    setSurfaceState(next);
    try {
      window.localStorage.setItem(
        SURFACE_KEY,
        next === 'thread' ? 'list' : next
      );
    } catch {
      // Not being able to remember the surface is not worth a failure.
    }
  }, []);

  const dismissLauncher = useCallback(() => {
    // × puts the whole floating messenger away. The header control is how it
    // comes back, so this is never a one-way door.
    setSurfaceState('minimised');
    setLauncherVisible(false);
    try {
      window.localStorage.setItem(LAUNCHER_KEY, 'hidden');
      window.localStorage.setItem(SURFACE_KEY, 'minimised');
    } catch {
      // Forgetting the preference is not worth a failure.
    }
  }, []);

  const showChat = useCallback(() => {
    setLauncherVisible(true);
    try {
      window.localStorage.removeItem(LAUNCHER_KEY);
    } catch {
      // As above.
    }
    setSurface(selectedRef.current ? 'thread' : 'list');
    // Permission is asked for here rather than on page load: this is a real
    // click, which is both the polite moment and the one browsers accept.
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    )
      void Notification.requestPermission().catch(() => {});
  }, [setSurface]);

  // Announcing an arrival. Decided from the REFRESHED conversation list, which
  // is authorized data, never from the realtime payload.
  const previousUnread = useRef<{ id: string; unread: number }[] | null>(null);
  const surfaceRef = useRef<ChatSurface>(surface);
  surfaceRef.current = surface;
  const viewerRef = useRef(viewerPersonId);
  viewerRef.current = viewerPersonId;

  useEffect(() => {
    const snapshot = conversations.map((c) => ({ id: c.id, unread: c.unread }));
    const before = previousUnread.current;
    previousUnread.current = snapshot;
    // The first load is the baseline, not an event: nobody wants six
    // notifications for messages that arrived while they were logged out.
    if (before === null) return;

    const visible =
      surfaceRef.current === 'thread' ? selectedRef.current : null;
    const arrivals = newlyUnread(
      before,
      conversations.map((c) => ({
        id: c.id,
        unread: c.unread,
        name: conversationName(c, viewerRef.current),
        preview: c.lastMessage?.deleted ? null : (c.lastMessage?.body ?? null)
      })),
      visible
    );
    if (arrivals.length === 0) return;

    playMessageChime();
    if (
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted'
    )
      return;
    for (const arrival of arrivals) {
      try {
        // tag: one notification per conversation, replaced rather than stacked.
        new Notification(arrival.name, {
          body: notificationBody(arrival.preview),
          tag: `ss-chat-${arrival.id}`
        });
      } catch {
        // Some browsers refuse the constructor outside a service worker.
      }
    }
  }, [conversations]);

  // ONE realtime subscription for the whole application.
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      // The websocket opens separately from HTTP and starts unauthenticated,
      // so RLS hides every row from it until the session is handed over.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      // No conversation filter: RLS already limits this to conversations the
      // viewer belongs to, and a message elsewhere still moves its unread
      // count while chat is minimised.
      channel = supabase
        .channel('chat')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'chat_messages' },
          (payload) => {
            const row = (payload.new ?? payload.old) as {
              conversation_id?: string;
            } | null;
            void loadConversations();
            if (
              row?.conversation_id &&
              row.conversation_id === selectedRef.current
            )
              void loadThread(row.conversation_id);
          }
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [enabled, loadConversations, loadThread]);

  /**
   * Opening a conversation only chooses it. Loading it and marking it read are
   * driven by the effects below, keyed on the THREAD BEING VISIBLE — because
   * there is more than one way to end up looking at a conversation (picking it
   * from the list, reopening the launcher onto the one you were in, or landing
   * on ?conversation= full screen) and every one of them has to count as
   * having seen it.
   */
  const openConversation = useCallback(
    (id: string) => {
      setSelected(id);
      setMessages([]);
      setPending([]);
      setLoadingThread(true);
      setSurface('thread');
    },
    [setSurface]
  );

  // Whatever brought the thread on screen, load it. Reopening after a few
  // minutes minimised must not show what was there when you left.
  useEffect(() => {
    if (surface !== 'thread' || !selected) return;
    void loadThread(selected);
  }, [surface, selected, loadThread]);

  // Seeing the thread is what marks it read - never merely opening the list.
  const unreadHere = conversations.find((c) => c.id === selected)?.unread ?? 0;
  useEffect(() => {
    if (surface !== 'thread' || !selected || unreadHere === 0) return;
    const id = selected;
    void runCommand({
      command_id: newCommandId(),
      command_type: 'CHAT_MARK_READ',
      payload: { conversation_id: id }
    }).then(() =>
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unread: 0 } : c))
      )
    );
  }, [surface, selected, unreadHere]);

  const backToList = useCallback(() => {
    setSurface('list');
  }, [setSurface]);

  const draft = selected ? (drafts[selected] ?? '') : '';
  const replyTo = selected ? (replyTargets[selected] ?? null) : null;

  const setDraft = useCallback((value: string) => {
    if (!selectedRef.current) return;
    setDrafts((prev) => ({ ...prev, [selectedRef.current as string]: value }));
  }, []);

  const setReplyTo = useCallback((message: ChatMessageRow | null) => {
    if (!selectedRef.current) return;
    setReplyTargets((prev) => ({
      ...prev,
      [selectedRef.current as string]: message
    }));
  }, []);

  const send = useCallback(async () => {
    const conversationId = selectedRef.current;
    if (!conversationId) return;
    const text = (drafts[conversationId] ?? '').trim();
    if (!text) return;
    const localId = newCommandId();
    const replyToId = replyTargets[conversationId]?.id ?? null;

    // Optimistic: on screen before the round trip, and the box clears at once.
    setPending((prev) => [...prev, { localId, body: text, replyToId }]);
    setDrafts((prev) => ({ ...prev, [conversationId]: '' }));
    setReplyTargets((prev) => ({ ...prev, [conversationId]: null }));

    const result = await runCommand({
      command_id: localId,
      command_type: 'CHAT_SEND',
      payload: {
        conversation_id: conversationId,
        body: text,
        ...(replyToId ? { reply_to_id: replyToId } : {})
      }
    });

    if (!result.ok) {
      setPending((prev) =>
        prev.map((p) => (p.localId === localId ? { ...p, failed: true } : p))
      );
      toast.error(result.outcome.message);
      return;
    }
    setPending((prev) => prev.filter((p) => p.localId !== localId));
    await loadThread(conversationId);
  }, [drafts, replyTargets, loadThread]);

  const react = useCallback(
    async (messageId: string, emoji: string, on: boolean) => {
      const result = await runCommand({
        command_id: newCommandId(),
        command_type: 'CHAT_REACT',
        payload: { message_id: messageId, emoji, on }
      });
      if (!result.ok) toast.error(result.outcome.message);
      else if (selectedRef.current) await loadThread(selectedRef.current);
    },
    [loadThread]
  );

  /**
   * Upload through the canonical evidence path as a standalone document, then
   * bind it to the message. No second storage system.
   */
  const attach = useCallback(
    async (file: File) => {
      const conversationId = selectedRef.current;
      if (!conversationId) return;

      // Check the file BEFORE posting anything. The message used to go first,
      // so a file evidence refuses (a .txt, say) left a message behind whose
      // whole content was a filename and no attachment.
      const problem = evidenceFileProblem(file);
      if (problem) {
        toast.error(problem);
        return;
      }

      setAttaching(true);
      try {
        const sent = await runCommand({
          command_id: newCommandId(),
          command_type: 'CHAT_SEND',
          payload: { conversation_id: conversationId, body: file.name }
        });
        if (!sent.ok) {
          toast.error(sent.outcome.message);
          return;
        }
        const messageId = (sent.result as { message_id?: string }).message_id;
        const ticket = await beginEvidenceUpload({
          uploadId: newCommandId(),
          context: { type: 'Library' },
          file: { name: file.name, type: file.type, size: file.size }
        });
        if (!ticket.ok) {
          toast.error(ticket.message);
          return;
        }
        if (ticket.token) {
          await createClient()
            .storage.from('evidence')
            .uploadToSignedUrl(ticket.path, ticket.token, file, {
              contentType: evidenceMimeType(file) ?? undefined
            });
          const done = await completeEvidenceUpload(ticket.evidenceId);
          if (!done.ok) {
            toast.error(done.message);
            return;
          }
        }
        const bound = await runCommand({
          command_id: newCommandId(),
          command_type: 'CHAT_ATTACH',
          payload: { message_id: messageId, evidence_id: ticket.evidenceId }
        });
        if (!bound.ok) toast.error(bound.outcome.message);
        await loadThread(conversationId);
      } finally {
        setAttaching(false);
      }
    },
    [loadThread]
  );

  const recoverPending = useCallback(
    (localId: string) => {
      const conversationId = selectedRef.current;
      if (!conversationId) return;
      const row = pending.find((p) => p.localId === localId);
      if (row) setDrafts((prev) => ({ ...prev, [conversationId]: row.body }));
      setPending((prev) => prev.filter((p) => p.localId !== localId));
    },
    [pending]
  );

  const value = useMemo<ChatState>(
    () => ({
      enabled,
      viewerPersonId,
      viewerName,
      conversations,
      messages,
      jobRefs,
      pending,
      selected,
      surface,
      launcherVisible,
      unreadTotal: totalUnread(conversations),
      loadingThread,
      attaching,
      draft,
      replyTo,
      setDraft,
      setReplyTo,
      setSurface,
      dismissLauncher,
      showChat,
      openConversation,
      backToList,
      send,
      react,
      attach,
      recoverPending,
      refresh: loadConversations
    }),
    [
      enabled,
      viewerPersonId,
      viewerName,
      conversations,
      messages,
      jobRefs,
      pending,
      selected,
      surface,
      launcherVisible,
      loadingThread,
      attaching,
      draft,
      replyTo,
      setDraft,
      setReplyTo,
      setSurface,
      dismissLauncher,
      showChat,
      openConversation,
      backToList,
      send,
      react,
      attach,
      recoverPending,
      loadConversations
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
