import 'server-only';

import { readOps } from '@/lib/backend/read';
import type { ReadResult } from '@/lib/backend/types';
import type { ChatConversationRow, ChatMessageRow, ChatMember } from './types';

// Both reads check MEMBERSHIP inside the database handler, not by role, so a
// Director calling CHAT_MESSAGES for a conversation they are not in is refused
// rather than quietly given an empty list.

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const list = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

function toMember(raw: Json): ChatMember {
  return {
    personId: String(raw.person_id),
    displayName: str(raw.display_name) ?? 'Someone'
  };
}

export async function listConversations(): Promise<
  ReadResult<ChatConversationRow[]>
> {
  const result = await readOps<Json>('CHAT_CONVERSATIONS');
  if (!result.ok) return result;
  const rows = list((result.data ?? {}).conversations).map((raw) => {
    const last = raw.last_message as Json | null | undefined;
    return {
      id: String(raw.conversation_id),
      kind: raw.kind === 'Group' ? 'Group' : 'Direct',
      title: str(raw.title),
      jobId: str(raw.job_id),
      lastMessageAt: str(raw.last_message_at),
      unread: num(raw.unread),
      members: list(raw.members).map(toMember),
      lastMessage: last
        ? {
            body: str(last.body),
            authorPersonId: str(last.author_person_id),
            createdAt: str(last.created_at),
            deleted: last.deleted === true
          }
        : null
    } satisfies ChatConversationRow;
  });
  return { ok: true, data: rows };
}

export async function listMessages(
  conversationId: string
): Promise<ReadResult<ChatMessageRow[]>> {
  const result = await readOps<Json>('CHAT_MESSAGES', {
    conversation_id: conversationId,
    limit: 200
  });
  if (!result.ok) return result;
  const rows = list((result.data ?? {}).messages).map(
    (raw) =>
      ({
        id: String(raw.message_id),
        authorPersonId: String(raw.author_person_id),
        authorName: str(raw.author_name) ?? 'Someone',
        body: str(raw.body),
        deleted: raw.deleted === true,
        replyToId: str(raw.reply_to_id),
        jobIds: strings(raw.job_ids),
        mentionedPersonIds: strings(raw.mentioned_person_ids),
        createdAt: str(raw.created_at) ?? '',
        editedAt: str(raw.edited_at),
        reactions: list(raw.reactions).map((r) => ({
          emoji: str(r.emoji) ?? '',
          personId: String(r.person_id)
        })),
        attachments: list(raw.attachments).map((a) => ({
          evidenceId: String(a.evidence_id),
          name: str(a.name) ?? 'File'
        })),
        tasks: list(raw.tasks).map((t) => ({
          taskId: String(t.task_id),
          title: str(t.title) ?? 'Task',
          templateCode: str(t.template_code),
          status: str(t.status),
          jobRef: str(t.job_ref)
        }))
      }) satisfies ChatMessageRow
  );
  return { ok: true, data: rows };
}

export interface ChatPerson {
  personId: string;
  displayName: string;
  roles: string[];
}

/**
 * Colleagues you may start a conversation with. Name and roles only — this
 * read deliberately exposes no contact details, so finding Tanya to message
 * her is not also a way to harvest the directory.
 */
export async function listChatPeople(
  query?: string
): Promise<ReadResult<ChatPerson[]>> {
  const result = await readOps<Json>('CHAT_PEOPLE', { query });
  if (!result.ok) return result;
  return {
    ok: true,
    data: list((result.data ?? {}).people).map((raw) => ({
      personId: String(raw.person_id),
      displayName: str(raw.display_name) ?? 'Someone',
      roles: strings(raw.roles)
    }))
  };
}
