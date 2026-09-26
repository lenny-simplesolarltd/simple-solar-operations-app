// Shapes for internal team chat. Safe to import from client components.

export interface ChatMember {
  personId: string;
  displayName: string;
}

export interface ChatConversationRow {
  id: string;
  kind: 'Direct' | 'Group';
  title: string | null;
  jobId: string | null;
  lastMessageAt: string | null;
  unread: number;
  members: ChatMember[];
  lastMessage: {
    body: string | null;
    authorPersonId: string | null;
    createdAt: string | null;
    deleted: boolean;
  } | null;
}

export interface ChatReaction {
  emoji: string;
  personId: string;
}

/**
 * The things a message points at. One shape for all six kinds, because a chip
 * needs the same four facts whatever it names, and the database already
 * filtered the list to what the READER may see.
 */
export type ChatTagKind =
  | 'job'
  | 'task'
  | 'form'
  | 'form_submission'
  | 'work_package'
  | 'scaffold_booking';

export interface ChatTag {
  kind: ChatTagKind;
  id: string;
  title: string;
  detail: string | null;
  status: string | null;
  /** The job this belongs to, where it belongs to one. */
  jobId: string | null;
  jobRef: string | null;
}

/**
 * Where a chip goes when it is clicked.
 *
 * Deliberately decided here and not in the database: a route is a fact about
 * this application's URLs, and a read that hard-coded them would have to be
 * migrated every time a page moved. Scheduled work and scaffold have no page
 * of their own, so they open the job at the tab that shows them.
 */
export function tagHref(tag: ChatTag): string {
  switch (tag.kind) {
    case 'job':
      return `/dashboard/jobs/${tag.id}`;
    case 'task':
      return `/dashboard/tasks/${tag.id}`;
    case 'form':
      return `/dashboard/forms/${tag.id}`;
    case 'form_submission':
      return `/dashboard/forms/responses/${tag.id}`;
    case 'work_package':
      return tag.jobId
        ? `/dashboard/jobs/${tag.jobId}?tab=work`
        : '/dashboard/planner';
    case 'scaffold_booking':
      return tag.jobId
        ? `/dashboard/jobs/${tag.jobId}?tab=operations`
        : '/dashboard/planner';
  }
}

/** What the chip calls this kind of thing, when the title alone is not enough. */
export const TAG_KIND_LABEL: Record<ChatTagKind, string> = {
  job: 'Job',
  task: 'Task',
  form: 'Form',
  form_submission: 'Response',
  work_package: 'Booked work',
  scaffold_booking: 'Scaffold'
};

export interface ChatAttachment {
  evidenceId: string;
  name: string;
}

export interface ChatMessageRow {
  id: string;
  authorPersonId: string;
  authorName: string;
  /** Null when the message was deleted. The row stays so replies still make sense. */
  body: string | null;
  deleted: boolean;
  replyToId: string | null;
  /** Jobs the SERVER resolved from the body, filtered to what the author may see. */
  jobIds: string[];
  mentionedPersonIds: string[];
  createdAt: string;
  editedAt: string | null;
  reactions: ChatReaction[];
  attachments: ChatAttachment[];
  /** Jobs, tasks, forms, responses, scheduled work and scaffold this message points at. */
  tags: ChatTag[];
}

/**
 * What a Direct conversation is called, which is nobody's stored title: it is
 * named by who is in it, from the reader's point of view.
 */
export function conversationName(
  conversation: Pick<ChatConversationRow, 'kind' | 'title' | 'members'>,
  viewerPersonId: string
): string {
  if (conversation.kind === 'Group')
    return conversation.title?.trim() || 'Group conversation';
  const other = conversation.members.find((m) => m.personId !== viewerPersonId);
  return other?.displayName ?? 'Just you';
}
