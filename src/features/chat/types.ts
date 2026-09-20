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

/** A task tagged in a message. Filtered to what the READER may see. */
export interface ChatTaskTag {
  taskId: string;
  title: string;
  templateCode: string | null;
  status: string | null;
  jobRef: string | null;
}

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
  tasks: ChatTaskTag[];
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
