// Wire protocol between the assistant drawer and the server. Safe to import
// from client components (types and Zod schemas only - no server code).
import { z } from 'zod';
import { assistantContextSchema } from './context';
import type { ConversationItem } from './lib/conversation';

// -- Transcript --------------------------------------------------------------
// The provider-neutral record of a conversation, as the model sees it.
// Persisted conversations keep it in the database and the server reads it back
// from there. Where conversations are not persisted (preview mode, or a
// database without the conversation tables) the browser holds it and the server
// treats it as untrusted input: validated, size-capped, and never able to
// authorize anything. Either way a transcript can only mislead its owner's own
// session - tools still run as the signed-in user, and mutations still need a
// server-signed pending action.

export const toolCallSchema = z.strictObject({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(80),
  args: z.unknown()
});

export const toolResultForModelSchema = z.strictObject({
  callId: z.string().min(1).max(120),
  name: z.string().min(1).max(80),
  ok: z.boolean(),
  /** JSON text the model reads. Retrieved content inside it is data, not instructions. */
  content: z.string().max(60_000)
});

export const transcriptMessageSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('user'), text: z.string().max(4_000) }),
  z.strictObject({
    role: z.literal('assistant'),
    text: z.string().max(40_000),
    toolCalls: z.array(toolCallSchema).max(16)
  }),
  z.strictObject({
    role: z.literal('tool'),
    results: z.array(toolResultForModelSchema).max(16)
  }),
  /** Application events, e.g. "the staff member confirmed action X". */
  z.strictObject({ role: z.literal('event'), text: z.string().max(4_000) })
]);

export type ToolCall = z.infer<typeof toolCallSchema>;
export type ToolResultForModel = z.infer<typeof toolResultForModelSchema>;
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;

export const MAX_TRANSCRIPT_MESSAGES = 80;

export const chatRequestSchema = z.strictObject({
  /** The conversation. Persisted conversations are created on their first message. */
  threadId: z.uuid(),
  /** One staff turn. Retrying a failed turn re-uses it, so a turn is never stored twice. */
  runId: z.uuid().optional(),
  message: z.string().trim().min(1).max(4_000),
  /**
   * Only used when conversations are NOT persisted (preview mode, or a database
   * without the conversation tables). A persisted conversation's history is
   * always read from the database; anything sent here is then ignored.
   */
  transcript: z
    .array(transcriptMessageSchema)
    .max(MAX_TRANSCRIPT_MESSAGES)
    .optional(),
  context: assistantContextSchema.optional()
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

// -- Conversations --------------------------------------------------------------
// Ids and titles only: nothing here identifies the owner. The server decides
// ownership from the session and RLS enforces it.

export const conversationUpdateSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(120).optional(),
    archived: z.boolean().optional()
  })
  .refine((v) => v.title !== undefined || v.archived !== undefined, {
    message: 'Nothing to change.'
  });
export type ConversationUpdate = z.infer<typeof conversationUpdateSchema>;

export const handoffRequestSchema = z.strictObject({
  /** False starts a clean conversation that only links back to the source. */
  withSummary: z.boolean()
});

/** Sent with a stored turn so the drawer can update its list and warnings. */
export interface ConversationTurnInfo {
  id: string;
  title: string | null;
  contextState: ContextState;
}

/** How full a conversation is, as the server estimates it. */
export interface ContextState {
  /** Estimated tokens of the whole stored conversation. */
  estimatedTokens: number;
  /** 'long': quality may start to suffer; suggest a fresh conversation. */
  level: 'ok' | 'long';
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  archived: boolean;
  messageCount: number;
  jobId: string | null;
}

export interface ConversationDetail extends ConversationListItem {
  /** Carried-in summary from a previous conversation, if any. */
  summary: string | null;
  sourceConversationId: string | null;
  contextState: ContextState;
  /** Everything the drawer needs to redraw the conversation. */
  items: ConversationItem[];
}

export const actionRequestSchema = z.strictObject({
  decision: z.enum(['confirm', 'cancel']),
  token: z.string().min(20).max(20_000)
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

// -- Structured results rendered by the drawer --------------------------------

export interface JobCardData {
  id: string;
  jobRef: string;
  customerName: string;
  postcode: string;
  workflowStage: string;
  soldAt?: string;
}

export interface TaskCardData {
  id: string;
  code: string;
  title: string;
  status: string;
  dueAt: string | null;
  ownerName: string;
  backupName: string | null;
  blockingReason: string | null;
  jobId: string | null;
  jobRef: string | null;
  jobName: string | null;
}

export type DisplayCard =
  | { kind: 'job_list'; jobs: JobCardData[]; total: number; query: string }
  | {
      kind: 'job_summary';
      job: JobCardData;
      facts: { label: string; value: string }[];
      taskCounts: { open: number; blocked: number; overdue: number };
    }
  | { kind: 'task_list'; title: string; tasks: TaskCardData[]; total: number }
  | {
      kind: 'workflow';
      title: string;
      steps: { label: string; detail?: string }[];
      footnote?: string;
    }
  /** A form as it stood when shown; the buttons open its live state. */
  | { kind: 'form'; form: FormCardData; note?: string }
  | { kind: 'form_list'; title: string; forms: FormCardData[]; total: number }
  /**
   * Recipient links. Never carries a link or token: "Copy link" fetches the
   * link from the server when pressed, for staff allowed to send forms.
   */
  | {
      kind: 'form_links';
      title: string;
      links: FormLinkCardData[];
      total: number;
    }
  /** Help Center guides (links only; the text stays in the Help Center). */
  | { kind: 'help_articles'; title: string; articles: HelpCardArticle[] }
  | {
      kind: 'help_article';
      article: HelpCardArticle;
      related: HelpCardArticle[];
    };

export interface HelpCardArticle {
  title: string;
  summary: string;
  /** In-app link (/dashboard/help/<slug>); never an id. */
  href: string;
  switchedOn: boolean;
}

export interface FormCardData {
  id: string;
  kind: 'form' | 'template';
  title: string;
  status: string;
  revision: number;
  questionCount: number;
  hasUnpublishedChanges: boolean;
  jobRef: string | null;
}

export interface FormLinkCardData {
  invitationId: string;
  formId: string;
  formTitle: string;
  recipient: string;
  jobRef: string | null;
  revision: number;
  status: string;
  expiresAt: string | null;
  submissionId: string | null;
}

/** What the confirmation card shows for a proposed mutation. Nothing has run yet. */
export interface PendingActionView {
  /** Server-signed; opaque to the browser. Sent back verbatim to confirm or cancel. */
  token: string;
  actionId: string;
  tool: string;
  title: string;
  summary: string;
  changes: { label: string; from?: string; to: string }[];
  warnings: string[];
  confirmLabel: string;
  expiresAt: string;
}

export interface AssistantErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

// -- Streamed turn events (newline-delimited JSON) -----------------------------

export type AssistantStreamEvent =
  | { type: 'turn_start'; turnId: string; provider: string; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; callId: string; tool: string; label: string }
  | {
      type: 'tool_result';
      callId: string;
      tool: string;
      ok: boolean;
      display?: DisplayCard;
      error?: { code: string; message: string };
    }
  | { type: 'proposal'; callId: string; action: PendingActionView }
  | {
      type: 'turn_end';
      /** Messages to append to the transcript for this turn (the user message first). */
      transcript: TranscriptMessage[];
      stopReason: 'complete' | 'step_limit' | 'truncated' | 'declined';
      /** Development diagnostics only: the concrete model that answered. */
      servedBy?: string;
      /** Present when the turn was stored: the conversation as it now stands. */
      conversation?: ConversationTurnInfo;
    }
  | ({ type: 'error' } & AssistantErrorInfo);

export type ActionResponse =
  | {
      ok: true;
      decision: 'confirm' | 'cancel';
      message: string;
      display?: DisplayCard;
      commandId: string;
      /** Appended to the transcript so the next turn knows what happened. */
      transcript: TranscriptMessage[];
      /** From the server-signed proposal (never from the request): where it was proposed, and by which tool. */
      threadId?: string;
      tool?: string;
    }
  | { ok: false; error: AssistantErrorInfo };

export interface AssistantCapabilities {
  configured: boolean;
  /** Set when the development router (no language model) is answering. */
  developmentMode: boolean;
  /** Staff-facing note when the assistant cannot answer yet. */
  notice?: string;
  /**
   * 'persistent': conversations are stored for this staff member and survive
   * reloads. 'ephemeral': this session only (preview mode, or the conversation
   * tables are not available in this environment).
   */
  conversations: 'persistent' | 'ephemeral';
  /** Development "View as user": who the assistant is answering AS. Read-only. */
  preview?: { name: string; roles: string[] };
  tools: { name: string; kind: 'read' | 'mutation'; summary: string }[];
  planned: { name: string; kind: 'read' | 'mutation'; summary: string }[];
  /** Present outside production only. Never contains credentials. */
  diagnostics?: { provider: string; model: string; pendingActions: string };
}
