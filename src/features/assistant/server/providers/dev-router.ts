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
      const help = helpFollowUp(last.results, request);
      if (help) return help;
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

  // Help Center: "how do I ...", "what does ... mean", "why can't I ...",
  // "where can I find ...", "help with this page".
  if (/\b(this page|this screen)\b/.test(lower) && /\bhelp\b/.test(lower)) {
    const route = /"route":"([^"]{1,200})"/.exec(request.system.volatile)?.[1];
    if (route) return pick('get_help_for_route', { route });
  }
  if (
    /^\s*(how (do|can|should) (i|we|you)|how to|what (does|do|is)|why (can'?t|cannot|won'?t|isn'?t)|where (can|do|is|are)|what do i do)\b/i.test(
      text
    )
  ) {
    return pick('search_help_articles', {
      query: text.replace(/[?.!]+$/, '').slice(0, 200),
      limit: 5
    });
  }

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

/**
 * Chains the Help tools the way a model is instructed to: search -> read the
 * best guide -> answer from it, naming the guide and offering only the
 * actions the tool said are available.
 */
function helpFollowUp(
  results: { name: string; ok: boolean; content: string }[],
  request: ModelRequest
): ModelTurn | null {
  const r = results[0];
  if (!r || !r.ok) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(r.content)?.data ?? {};
  } catch {
    return null;
  }
  const offered = new Set(request.tools.map((t) => t.name));
  const list = (data.results as { slug: string; title: string }[]) ?? [];
  if (r.name === 'search_help_articles' || r.name === 'get_help_for_route') {
    if (list.length === 0 || !offered.has('get_help_article')) {
      return {
        text: "I couldn't find a guide for that in the Help Center. (Development router: no language model is configured.)",
        toolCalls: [],
        stopReason: 'end'
      };
    }
    return {
      text: '',
      toolCalls: [
        {
          id: `dev_${randomUUID()}`,
          name: 'get_help_article',
          args: { slug: list[0].slug }
        }
      ],
      stopReason: 'tool_use'
    };
  }
  if (r.name === 'get_help_article') {
    const actions =
      (data.actions_you_can_offer as { tool: string; summary: string }[]) ?? [];
    const lines = [
      `According to **${String(data.title)}**: ${String(data.summary)}`,
      data.switched_on === false
        ? 'This feature is not currently switched on.'
        : 'Open the guide for the full steps.',
      actions.length
        ? `I can help with part of this: ${actions.map((a) => a.summary.toLowerCase()).join('; ')}.`
        : "I can't do this for you; follow the guide in the app.",
      '(Development router: no language model is configured, so this is the guide summary, not a written answer.)'
    ];
    return { text: lines.join('\n\n'), toolCalls: [], stopReason: 'end' };
  }
  return null;
}
