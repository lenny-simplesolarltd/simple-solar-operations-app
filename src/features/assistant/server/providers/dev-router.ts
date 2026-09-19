import 'server-only';

import { randomUUID } from 'node:crypto';
import type { AssistantModelProvider, ModelRequest, ModelTurn } from './types';

/**
 * DEVELOPMENT ONLY. Not a language model: a keyword router that lets the
 * drawer, the real tools and the result cards be exercised locally without any
 * paid API. It is refused in production (see ./index.ts) and the drawer labels
 * it. It only ever requests tools that the orchestrator offered for this user,
 * so it goes through exactly the same gates as a real model.
 */
export class DevRouterProvider implements AssistantModelProvider {
  readonly id = 'dev-router';
  readonly model = 'keyword-router';

  async generate(request: ModelRequest): Promise<ModelTurn> {
    const last = request.messages[request.messages.length - 1];

    if (last?.role === 'tool') {
      const failed = last.results.filter((r) => !r.ok);
      return {
        text: failed.length
          ? `That didn't work: ${safeMessage(failed[0].content)}`
          : 'Here is what the application returned. (Development router: no language model is configured, so there is no written summary.)',
        toolCalls: [],
        stopReason: 'end'
      };
    }

    const text = last?.role === 'user' ? last.text : '';
    const offered = new Set(request.tools.map((t) => t.name));
    const call = route(text, request, offered);
    if (!call) {
      return {
        text: 'Development router: no language model is configured. I can only route a few phrases - try "find <customer or job ref>", "my tasks", "overdue tasks", "team tasks", or "explain the presale workflow".',
        toolCalls: [],
        stopReason: 'end'
      };
    }
    return {
      text: '',
      toolCalls: [{ id: `dev_${randomUUID()}`, ...call }],
      stopReason: 'tool_use'
    };
  }
}

function route(
  text: string,
  request: ModelRequest,
  offered: Set<string>
): { name: string; args: unknown } | null {
  const lower = text.toLowerCase();
  const due = lower.includes('overdue')
    ? 'overdue'
    : lower.includes('today')
      ? 'today'
      : 'any';
  const pageJobId = /"jobId":"([0-9a-f-]{36})"/i.exec(
    request.system.volatile
  )?.[1];

  const pick = (name: string, args: unknown) =>
    offered.has(name) ? { name, args } : null;

  // Forms (development only): list, create from the template on screen, and
  // "make <question id> optional/required" on the form on screen.
  const pageFormId = /"formId":"([0-9a-f-]{36})"/i.exec(
    request.system.volatile
  )?.[1];
  if (/\btemplates\b/.test(lower) && /\b(list|show)\b/.test(lower))
    return pick('list_forms', { kind: 'template' });
  if (/\bforms\b/.test(lower) && /\b(list|show)\b/.test(lower))
    return pick('list_forms', {});
  const fromTemplate =
    /create (?:a )?(?:new )?(?:form|draft) from this template(?: called (.{1,100}))?/i.exec(
      text
    );
  if (pageFormId && fromTemplate)
    return pick('create_form', {
      template_id: pageFormId,
      title: (fromTemplate[1] ?? 'New form from template').replace(
        /[?.!]+$/,
        ''
      )
    });
  const requirement =
    /make (?:question )?([a-z][a-z0-9_]{0,39}) (optional|required)/i.exec(text);
  if (pageFormId && requirement)
    return pick('edit_form_draft', {
      form_id: pageFormId,
      operations: [
        {
          op: 'update_field',
          field_id: requirement[1].toLowerCase(),
          changes: { required: requirement[2].toLowerCase() === 'required' }
        }
      ]
    });
  const linkFor = /create (?:a )?link for (.{1,80})/i.exec(text);
  if (pageFormId && linkFor)
    return pick('create_form_link', {
      form_id: pageFormId,
      recipient: 'other',
      recipient_name: linkFor[1].replace(/[?.!]+$/, '')
    });
  if (pageFormId && /\b(this form|describe)\b/.test(lower))
    return pick('get_form', { form_id: pageFormId });

  const find = /\bfind\s+(?:the\s+job\s+for\s+|job\s+)?(.{2,80})/i.exec(text);
  if (find) return pick('find_job', { query: find[1].replace(/[?.!]+$/, '') });
  if (lower.includes('presale workflow'))
    return pick('get_presale_workflow', {});
  if (lower.includes('team')) return pick('get_team_tasks', { due });
  if (pageJobId && /\b(tasks?|block)/.test(lower)) {
    return pick('get_job_tasks', { jobId: pageJobId, include: 'open' });
  }
  if (pageJobId && /\b(summar|this job)/.test(lower)) {
    return pick('get_job', { jobId: pageJobId });
  }
  if (/\b(tasks?|work on)\b/.test(lower)) return pick('get_my_tasks', { due });
  return null;
}

function safeMessage(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return String(
      parsed?.error?.message ?? parsed?.message ?? 'the tool reported an error.'
    );
  } catch {
    return 'the tool reported an error.';
  }
}
