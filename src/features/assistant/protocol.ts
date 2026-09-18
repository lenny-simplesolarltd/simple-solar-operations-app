// Wire protocol between the assistant drawer and the server. Safe to import
// from client components (types and Zod schemas only - no server code).
import { z } from 'zod';
import { assistantContextSchema } from './context';

// -- Transcript --------------------------------------------------------------
// The provider-neutral record of a conversation, as the model sees it. v1 keeps
// it in the browser for the life of the dashboard session (no persistence), so
// the server treats every transcript it receives as untrusted input: it is
// validated, size-capped, and can never authorize anything. A forged transcript
// can only mislead the forger's own session - tools still run as the signed-in
// user, and mutations still need a server-signed pending action.

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
  threadId: z.uuid(),
  message: z.string().trim().min(1).max(4_000),
  transcript: z.array(transcriptMessageSchema).max(MAX_TRANSCRIPT_MESSAGES),
  context: assistantContextSchema.optional()
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

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
    };

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
    }
  | { ok: false; error: AssistantErrorInfo };

export interface AssistantCapabilities {
  configured: boolean;
  /** Set when the development router (no language model) is answering. */
  developmentMode: boolean;
  /** Staff-facing note when the assistant cannot answer yet. */
  notice?: string;
  tools: { name: string; kind: 'read' | 'mutation'; summary: string }[];
  planned: { name: string; kind: 'read' | 'mutation'; summary: string }[];
}
