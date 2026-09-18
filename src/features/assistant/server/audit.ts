import 'server-only';

/**
 * Assistant activity metadata.
 *
 * The assistant is NOT the business audit trail - domain commands keep writing
 * the authoritative audit_events. This is the hook for recording how a command
 * came to be issued (initiated_via = assistant, thread, model, proposal,
 * confirmation, resulting command id) once there is somewhere agreed to put
 * it; see docs/assistant/BACKEND_DEPENDENCIES.md (BD-08). Today it logs
 * structured lines on the server and stores nothing.
 */
export interface AssistantAuditRecord {
  event:
    | 'tool_executed'
    | 'tool_rejected'
    | 'action_proposed'
    | 'action_confirmed'
    | 'action_cancelled'
    | 'action_rejected';
  initiatedVia: 'assistant';
  actorPersonId: string;
  threadId: string;
  tool: string;
  provider?: string;
  model?: string;
  /** Pending action id == domain command_id. */
  commandId?: string;
  outcome: 'ok' | 'error';
  code?: string;
}

export interface AssistantAuditSink {
  record(entry: AssistantAuditRecord): void | Promise<void>;
}

export const consoleAuditSink: AssistantAuditSink = {
  record(entry) {
    // Identifiers and codes only: no arguments, no customer data.
    // eslint-disable-next-line no-console -- the sink IS a server log for now
    console.info('[assistant]', JSON.stringify(entry));
  }
};
