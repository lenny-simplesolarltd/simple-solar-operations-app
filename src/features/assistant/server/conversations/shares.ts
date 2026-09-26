import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Share links for a SimpleBot conversation.
 *
 * Every call is a database function running as the signed-in person: creating
 * and revoking require owning the conversation, and reading requires a live
 * share plus being active staff. Nothing here decides access itself.
 */

export interface SharedConversation {
  shareId: string;
  title: string | null;
  createdAt: string;
  sharedBy: string | null;
  messages: {
    role: string;
    text: string | null;
    tool: string | null;
    createdAt: string;
  }[];
}

type Json = Record<string, unknown>;

const rpc = async (fn: string, args: Json) => {
  const supabase = await createClient();
  return (
    supabase.rpc as unknown as (
      f: string,
      a: Json
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  ).call(supabase, fn, args);
};

/** The live share for a conversation the caller owns, creating one if needed. */
export async function shareConversation(
  conversationId: string
): Promise<{ ok: true; shareId: string } | { ok: false; message: string }> {
  const { data, error } = await rpc('assistant_share_conversation', {
    p_conversation_id: conversationId
  });
  if (error)
    return { ok: false, message: 'That conversation could not be shared.' };
  const shareId = (data as { share_id?: string } | null)?.share_id;
  return shareId
    ? { ok: true, shareId }
    : { ok: false, message: 'That conversation could not be shared.' };
}

/** Turns off every live link for a conversation the caller owns. */
export async function revokeConversationShare(
  conversationId: string
): Promise<{ ok: true; revoked: number } | { ok: false; message: string }> {
  const { data, error } = await rpc('assistant_revoke_conversation_share', {
    p_conversation_id: conversationId
  });
  if (error)
    return { ok: false, message: 'That link could not be turned off.' };
  return {
    ok: true,
    revoked: Number((data as { revoked?: number })?.revoked ?? 0)
  };
}

/** A shared conversation, for anyone signed in holding the link. */
export async function readSharedConversation(
  shareId: string
): Promise<SharedConversation | null> {
  const { data, error } = await rpc('assistant_shared_conversation', {
    p_share_id: shareId
  });
  if (error || !data) return null;
  const raw = data as Json;
  return {
    shareId,
    title: (raw.title as string | null) ?? null,
    createdAt: String(raw.created_at ?? ''),
    sharedBy: (raw.shared_by as string | null) ?? null,
    messages: Array.isArray(raw.messages)
      ? (raw.messages as Json[]).map((m) => ({
          role: String(m.role ?? ''),
          text: (m.text as string | null) ?? null,
          tool: (m.tool as string | null) ?? null,
          createdAt: String(m.created_at ?? '')
        }))
      : []
  };
}
