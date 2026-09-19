'use server';

import { previewWriteBlock } from '@/lib/preview/guard';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { helpMessage } from '../errors';
import type { ArticleDraftInput } from '../types';

// Help Center writes. Each is one registered command through
// public.execute_command, which resolves the person from the session, checks
// help.edit / help.publish, checks the version the editor read, records the
// revision and the audit event, and makes a retry with the same command id a
// replay. Nothing here decides who may do what.

export type HelpActionResult =
  | { ok: true; articleId: string; slug: string; version: number }
  | { ok: false; code: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message: string } | null;

async function command(
  type: string,
  commandId: string,
  payload: Record<string, unknown>,
  expectedVersion?: number
): Promise<HelpActionResult> {
  const blocked = await previewWriteBlock();
  if (blocked)
    return { ok: false, code: 'PREVIEW_MODE_READ_ONLY', message: blocked };
  if (!UUID.test(commandId))
    return {
      ok: false,
      code: 'R1A_INVALID_FIELDS',
      message: helpMessage('R1A_INVALID_FIELDS')
    };
  const request: Record<string, unknown> = {
    command_id: commandId,
    command_type: type,
    payload
  };
  if (expectedVersion != null) request.expected_version = expectedVersion;

  const supabase = await createClient();
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: unknown
    ) => Promise<{
      data: {
        result: { article_id: string; slug: string; version: number };
      } | null;
      error: RpcError;
    }>
  )('execute_command', { p_request: request });
  if (error) {
    const code =
      error.code === 'P0001'
        ? error.message.split(':')[0].trim()
        : 'UNEXPECTED';
    if (code === 'UNEXPECTED') {
      // eslint-disable-next-line no-console -- server-side diagnostics
      console.error(`help ${type} failed`, error);
    }
    return { ok: false, code, message: helpMessage(code) };
  }
  const result = data!.result;
  revalidatePath('/dashboard/help', 'layout');
  return {
    ok: true,
    articleId: result.article_id,
    slug: result.slug,
    version: result.version
  };
}

const content = (input: ArticleDraftInput) => ({
  title: input.title,
  summary: input.summary,
  body: input.body,
  category: input.category || null,
  audience_roles: input.audienceRoles,
  release_functions: input.releaseFunctions,
  routes: input.routes,
  tools: input.tools,
  keywords: input.keywords,
  aliases: input.aliases,
  related_slugs: input.relatedSlugs,
  common_task: input.commonTask,
  sort_order: input.sortOrder,
  ...(input.changeNote ? { change_note: input.changeNote } : {})
});

export async function createArticle(
  commandId: string,
  input: ArticleDraftInput
): Promise<HelpActionResult> {
  return command('HELP_ARTICLE_CREATE', commandId, {
    slug: input.slug ?? '',
    ...content(input)
  });
}

export async function updateArticle(
  commandId: string,
  articleId: string,
  version: number,
  input: ArticleDraftInput
): Promise<HelpActionResult> {
  return command(
    'HELP_ARTICLE_UPDATE',
    commandId,
    {
      article_id: articleId,
      ...(input.slug ? { slug: input.slug } : {}),
      ...content(input)
    },
    version
  );
}

type LifecycleType = 'publish' | 'archive' | 'restore' | 'review';
const LIFECYCLE: Record<LifecycleType, string> = {
  publish: 'HELP_ARTICLE_PUBLISH',
  archive: 'HELP_ARTICLE_ARCHIVE',
  restore: 'HELP_ARTICLE_RESTORE',
  review: 'HELP_ARTICLE_REVIEW'
};

export async function changeArticleState(
  commandId: string,
  action: LifecycleType,
  articleId: string,
  version: number,
  changeNote?: string
): Promise<HelpActionResult> {
  if (!(action in LIFECYCLE))
    return {
      ok: false,
      code: 'R1A_INVALID_FIELDS',
      message: helpMessage('R1A_INVALID_FIELDS')
    };
  return command(
    LIFECYCLE[action],
    commandId,
    {
      article_id: articleId,
      ...(changeNote?.trim() ? { change_note: changeNote.trim() } : {})
    },
    version
  );
}

export async function revertArticle(
  commandId: string,
  articleId: string,
  version: number,
  revisionNumber: number
): Promise<HelpActionResult> {
  return command(
    'HELP_ARTICLE_REVERT',
    commandId,
    { article_id: articleId, revision_number: revisionNumber },
    version
  );
}
