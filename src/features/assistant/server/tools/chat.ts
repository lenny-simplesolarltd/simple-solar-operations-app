import 'server-only';

import { listChatPeople } from '@/features/chat/queries';
import { runCommand } from '@/lib/backend/command';
import { z } from 'zod';
import type { MutationTool } from '../registry';

/**
 * Sending a colleague a message.
 *
 * "list roofers" then "josh email" went off and searched JOBS for Josh,
 * because knowing who somebody is and being able to reach them were two
 * different things and SimpleBot only had the first. Answering "who are the
 * installers" and then being unable to do anything about it is a dead end.
 *
 * Internal chat, not email, and that is deliberate rather than a shortcut:
 * chat is where staff already talk to each other, it needs no allow-list and
 * no sending domain, and it cannot leave the company. An email to a colleague
 * would go through the outbox and its four gates for no benefit.
 *
 * The address is never involved. The model names a PERSON; the server resolves
 * that to the directory entry and the conversation, so a mailbox never reaches
 * the model and a mistyped address cannot exist.
 *
 * Like every mutation here it only ever PROPOSES. Nothing is sent until a
 * person reads the message on the confirmation card and presses Confirm.
 */

const ENFORCED =
  'CHAT_START + CHAT_SEND (communications.chat.use): membership and visibility decided by the database; the recipient is resolved from the directory, never from the model';

const input = z.strictObject({
  person: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .describe('The colleague by name, as list_people spells it'),
  message: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('Exactly what to send. It is sent word for word.')
});

type Input = z.infer<typeof input>;

const refuse = (code: string, message: string) => ({
  ok: false as const,
  code,
  message
});

/** One person, or a refusal that says which of the two problems it is. */
async function resolvePerson(name: string) {
  const result = await listChatPeople(name);
  if (!result.ok)
    return refuse(
      'NOT_FOUND',
      'The staff directory could not be read for this person.'
    );

  const wanted = name.trim().toLowerCase();
  const all = result.data;
  const exact = all.filter((p) => p.displayName.toLowerCase() === wanted);
  const matches = exact.length > 0 ? exact : all;

  if (matches.length === 0)
    return refuse(
      'NOT_FOUND',
      `No colleague named "${name}" is visible to this staff member. Use list_people to see who there is.`
    );
  if (matches.length > 1)
    return refuse(
      'AMBIGUOUS',
      `More than one colleague matches "${name}": ${matches
        .map((p) => p.displayName)
        .join(', ')}. Ask which one, by full name.`
    );
  return { ok: true as const, person: matches[0] };
}

export const messageColleagueTool: MutationTool<Input> = {
  name: 'message_colleague',
  summary: 'Send a colleague a message in team chat',
  description:
    'Send one colleague a message in the internal team chat - "tell Josh the meter serial did not match", "ask Dan to look at the review queue". Name the person as list_people spells them. The message is sent word for word, so write it as it should read. This is internal chat, not email: it never leaves the company. Nothing is sent until the staff member confirms.',
  domain: 'communications',
  kind: 'mutation',
  status: 'available',
  inputSchema: input,
  authorization: {
    permissions: ['communications.chat.use'],
    enforcedBy: ENFORCED
  },
  async prepare(args) {
    const found = await resolvePerson(args.person);
    if (!found.ok) return found;
    return {
      ok: true,
      preview: {
        title: `Message ${found.person.displayName}`,
        summary:
          'Sent in team chat, from you. It stays inside the company, and it can be edited or deleted afterwards like any other message.',
        // The message in full, because the person confirming is agreeing to
        // these exact words going to a colleague under their own name.
        changes: [
          { label: 'To', to: found.person.displayName },
          { label: 'Message', to: args.message }
        ],
        warnings: [],
        confirmLabel: 'Send message',
        // Nothing to race: a chat message is an append, not an edit of a
        // record somebody else may have changed since this was proposed.
        expectedVersion: null
      }
    };
  },
  async execute(args, ctx) {
    const found = await resolvePerson(args.person);
    if (!found.ok) return found;

    // Direct conversations are unique per pair in the database, so this opens
    // the existing one rather than making a second.
    const started = await runCommand({
      command_id: ctx.commandId,
      command_type: 'CHAT_START',
      payload: { kind: 'Direct', person_ids: [found.person.personId] }
    });
    if (!started.ok) return refuse('COMMAND_REFUSED', started.outcome.message);

    const conversationId = (started.result as { conversation_id?: string })
      .conversation_id;
    if (!conversationId)
      return refuse(
        'COMMAND_REFUSED',
        'That conversation could not be opened, so nothing was sent.'
      );

    const sent = await runCommand({
      command_id: crypto.randomUUID(),
      command_type: 'CHAT_SEND',
      payload: { conversation_id: conversationId, body: args.message }
    });
    if (!sent.ok) return refuse('COMMAND_REFUSED', sent.outcome.message);

    return {
      ok: true,
      data: {
        sent_to: found.person.displayName,
        // Where it went, so the answer can point at it rather than only
        // claiming success.
        conversation: `/dashboard/communications/chat?conversation=${conversationId}`,
        note: 'Sent in team chat, from this staff member.'
      }
    };
  }
};
