import 'server-only';

import { listChatPeople } from '@/features/chat/queries';
import { ROLE_CODES } from '@/lib/roles';
import { z } from 'zod';
import type { ReadTool } from '../registry';

/**
 * Who works here.
 *
 * "list surveyors" used to return the Presale workflow: there was no tool for
 * looking up a colleague at all, so the model reached for the nearest thing it
 * had. A question about people is one of the most ordinary things anybody
 * asks, and answering it with a nine-step wizard is worse than refusing.
 *
 * Built on CHAT_PEOPLE, whose own registry entry states the boundary: "Name
 * and roles only - never contact details." Every role may run it and the
 * database decides what comes back, so this adds no new visibility. An address
 * is never returned; when one is actually needed - adding somebody to a report -
 * the reporting tools resolve it server-side from the name, so the model
 * arranges the work without ever holding the mailbox.
 */

const ENFORCED =
  'app.read_chat_people via execute_operations_read: active colleagues, name and roles only, filtered for the signed-in person. No contact details.';

const roleFilter = z
  .enum(ROLE_CODES)
  .describe('A role to narrow to, spelled exactly as roles_available lists it');

export const listPeopleTool: ReadTool<{
  role?: (typeof ROLE_CODES)[number];
  query?: string;
}> = {
  name: 'list_people',
  summary: 'List colleagues, optionally those holding one role',
  description:
    'List active colleagues and the roles they hold - "who are the surveyors", "which installers are there", "is Dan a director". Narrow with role (exact spelling) or with a name fragment. Names and roles only: this never returns anybody\'s email address or phone number. To email a report to somebody, name them in report_recipients_change instead; it resolves the address itself.',
  domain: 'people',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    role: roleFilter.optional(),
    query: z.string().trim().min(1).max(80).optional()
  }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ role, query }) {
    const result = await listChatPeople(query);
    if (!result.ok)
      return {
        ok: false,
        code: 'NOT_FOUND',
        message:
          'The staff directory could not be read for this person. Say so rather than guessing at names.'
      };

    const everyone = result.data;
    const people = role
      ? everyone.filter((p) => p.roles.includes(role))
      : everyone;

    if (people.length === 0)
      return {
        ok: true,
        data: {
          total: 0,
          people: [],
          // Two different facts, and saying which one is true saves a wrong
          // conclusion: nobody holds that role, versus this person cannot see
          // the directory at all.
          note: role
            ? everyone.length === 0
              ? 'No colleagues are visible to this staff member at all.'
              : `Nobody active holds the ${role} role.`
            : 'No colleague matched.'
        }
      };

    return {
      ok: true,
      data: {
        total: people.length,
        ...(role && { role }),
        people: people.map((p) => ({ name: p.displayName, roles: p.roles })),
        note: 'Names and roles only. Contact details are never read here.'
      }
    };
  }
};
