import 'server-only';

import { getPermissions } from '@/features/presale/server/queries';
import { getCurrentUser, type AppUser } from '@/lib/auth';
import { cache } from 'react';
import { linkedSlugs } from '../markdown';
import { isAppRoute } from '../routes';
import { searchArticles, type SearchHit } from '../search';
import type {
  ArticleRevision,
  EditableArticle,
  HelpCategory,
  HelpHealthIssue,
  PublishedArticle
} from '../types';
import { helpDb } from './db';

/**
 * Help Center reads. Staff pages and SimpleBot's help tools use the SAME
 * function (getPublishedArticles), which calls public.help_published_articles:
 * the database returns only published revisions of published articles that
 * this person's roles may read. Nothing here widens that.
 */

export interface HelpAccess {
  user: AppUser;
  canEdit: boolean;
  canPublish: boolean;
}

export const getHelpAccess = cache(async (): Promise<HelpAccess | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const permissions = await getPermissions(user);
  return {
    user,
    // A development "view as" preview is read-only: never offer editing.
    canEdit: permissions.has('help.edit') && !user.preview,
    canPublish: permissions.has('help.publish') && !user.preview
  };
});

type PublishedRow = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string | null;
  audience_roles: string[];
  release_functions: string[];
  release_on: boolean;
  release_names: string[];
  routes: string[];
  tools: string[];
  keywords: string[];
  aliases: string[];
  related_slugs: string[];
  common_task: boolean;
  sort_order: number;
  revision_number: number;
  published_at: string | null;
  reviewed_at: string | null;
};

const toPublished = (r: PublishedRow): PublishedArticle => ({
  slug: r.slug,
  title: r.title,
  summary: r.summary,
  body: r.body,
  category: r.category,
  audienceRoles: r.audience_roles ?? [],
  releaseFunctions: r.release_functions ?? [],
  releaseOn: r.release_on !== false,
  releaseNames: r.release_names ?? [],
  routes: r.routes ?? [],
  tools: r.tools ?? [],
  keywords: r.keywords ?? [],
  aliases: r.aliases ?? [],
  relatedSlugs: r.related_slugs ?? [],
  commonTask: r.common_task,
  sortOrder: r.sort_order,
  revisionNumber: r.revision_number,
  publishedAt: r.published_at,
  reviewedAt: r.reviewed_at
});

/**
 * Every published article this person may read. Read fresh from the database
 * on each request (memoised within one request only), so a newly published
 * revision is live for staff and SimpleBot immediately.
 */
export const getPublishedArticles = cache(
  async (): Promise<PublishedArticle[]> => {
    const db = await helpDb();
    const { data, error } = await db.rpc<PublishedRow[]>(
      'help_published_articles',
      { p_slug: null }
    );
    if (error) throw new Error(`help_published_articles: ${error.message}`);
    return (data ?? []).map(toPublished);
  }
);

export async function getPublishedArticle(
  slug: string
): Promise<PublishedArticle | null> {
  return (await getPublishedArticles()).find((a) => a.slug === slug) ?? null;
}

export async function searchHelp(
  query: string,
  limit = 10
): Promise<SearchHit<PublishedArticle>[]> {
  return searchArticles(await getPublishedArticles(), query, limit);
}

/** Articles for a screen (route pattern), most specific first. */
export function articlesForRouteIn(
  articles: PublishedArticle[],
  route: string
): PublishedArticle[] {
  return articles
    .filter((a) => a.routes.includes(route))
    .sort(
      (a, b) =>
        a.routes.length - b.routes.length ||
        Number(b.commonTask) - Number(a.commonTask) ||
        a.sortOrder - b.sortOrder
    );
}

export async function articlesForRoute(
  route: string
): Promise<PublishedArticle[]> {
  return articlesForRouteIn(await getPublishedArticles(), route);
}

/**
 * Related articles: the editor's explicit list first (only those this person
 * may read), then generated ones that share a screen, then the same category.
 */
export function relatedIn(
  articles: PublishedArticle[],
  article: PublishedArticle,
  max = 5
): PublishedArticle[] {
  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  const out: PublishedArticle[] = [];
  const add = (a: PublishedArticle | undefined) => {
    if (a && a.slug !== article.slug && !out.includes(a) && out.length < max)
      out.push(a);
  };
  for (const slug of article.relatedSlugs) add(bySlug.get(slug));
  if (out.length < 3) {
    for (const a of articles)
      if (a.routes.some((r) => article.routes.includes(r))) add(a);
  }
  if (out.length < 3) {
    for (const a of articles)
      if (a.category && a.category === article.category && a.commonTask) add(a);
  }
  return out;
}

export async function getRelatedArticles(
  article: PublishedArticle,
  max = 5
): Promise<PublishedArticle[]> {
  return relatedIn(await getPublishedArticles(), article, max);
}

export const getHelpCategories = cache(async (): Promise<HelpCategory[]> => {
  const db = await helpDb();
  const { data, error } = await db
    .from<{
      code: string;
      title: string;
      description: string;
      icon: string;
      sort_order: number;
    }>('help_categories')
    .select('code, title, description, icon, sort_order')
    .order('sort_order');
  if (error) throw new Error(`help_categories: ${error.message}`);
  return (data ?? []).map((c) => ({
    code: c.code,
    title: c.title,
    description: c.description,
    icon: c.icon,
    sortOrder: c.sort_order
  }));
});

// -- Editor reads (RLS: help.edit) -------------------------------------------------

const ARTICLE_COLUMNS =
  'id, slug, status, title, summary, body, category, audience_roles, release_functions, routes, tools, keywords, aliases, related_slugs, common_task, sort_order, has_unpublished_changes, published_revision_number, published_at, reviewed_at, review_due_at, seed_version, seed_update_available, updated_at, version, reviewer:people!help_articles_reviewed_by_fkey(display_name), editor:people!help_articles_updated_by_fkey(display_name)';

type ArticleRow = {
  id: string;
  slug: string;
  status: EditableArticle['status'];
  title: string;
  summary: string;
  body: string;
  category: string | null;
  audience_roles: string[];
  release_functions: string[];
  routes: string[];
  tools: string[];
  keywords: string[];
  aliases: string[];
  related_slugs: string[];
  common_task: boolean;
  sort_order: number;
  has_unpublished_changes: boolean;
  published_revision_number: number | null;
  published_at: string | null;
  reviewed_at: string | null;
  review_due_at: string | null;
  seed_version: number | null;
  seed_update_available: number | null;
  updated_at: string;
  version: number;
  reviewer: { display_name: string } | null;
  editor: { display_name: string } | null;
};

const toEditable = (r: ArticleRow): EditableArticle => ({
  id: r.id,
  slug: r.slug,
  status: r.status,
  title: r.title,
  summary: r.summary,
  body: r.body,
  category: r.category,
  audienceRoles: r.audience_roles,
  releaseFunctions: r.release_functions,
  routes: r.routes,
  tools: r.tools,
  keywords: r.keywords,
  aliases: r.aliases,
  relatedSlugs: r.related_slugs,
  commonTask: r.common_task,
  sortOrder: r.sort_order,
  hasUnpublishedChanges: r.has_unpublished_changes,
  publishedRevisionNumber: r.published_revision_number,
  publishedAt: r.published_at,
  reviewedAt: r.reviewed_at,
  reviewedByName: r.reviewer?.display_name ?? null,
  reviewDueAt: r.review_due_at,
  seedVersion: r.seed_version,
  seedUpdateAvailable: r.seed_update_available,
  updatedAt: r.updated_at,
  updatedByName: r.editor?.display_name ?? null,
  version: r.version
});

/** Every article including drafts and archived ones. Empty for non-editors (RLS). */
export async function listAllArticles(): Promise<EditableArticle[]> {
  const db = await helpDb();
  const { data, error } = await db
    .from<ArticleRow>('help_articles')
    .select(ARTICLE_COLUMNS)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`help_articles: ${error.message}`);
  return (data ?? []).map(toEditable);
}

export async function getEditableArticle(
  id: string
): Promise<EditableArticle | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await helpDb();
  const { data, error } = await db
    .from<ArticleRow>('help_articles')
    .select(ARTICLE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`help_articles: ${error.message}`);
  return data ? toEditable(data) : null;
}

export async function getArticleHistory(
  articleId: string
): Promise<ArticleRevision[]> {
  const db = await helpDb();
  const { data, error } = await db
    .from<{
      revision_number: number;
      event: ArticleRevision['event'];
      status: ArticleRevision['status'];
      title: string;
      summary: string;
      body: string;
      change_note: string | null;
      created_at: string;
      author: { display_name: string } | null;
    }>('help_article_revisions')
    .select(
      'revision_number, event, status, title, summary, body, change_note, created_at, author:people!help_article_revisions_created_by_fkey(display_name)'
    )
    .eq('article_id', articleId)
    .order('revision_number', { ascending: false })
    .limit(200);
  if (error) throw new Error(`help_article_revisions: ${error.message}`);
  return (data ?? []).map((r) => ({
    revisionNumber: r.revision_number,
    event: r.event,
    status: r.status,
    title: r.title,
    summary: r.summary,
    body: r.body,
    changeNote: r.change_note,
    createdAt: r.created_at,
    createdByName: r.author?.display_name ?? null
  }));
}

// -- Help health ------------------------------------------------------------------------

/**
 * Checks the database cannot make: screens that no longer exist, SimpleBot
 * tools that are not registered, links inside the text to missing articles.
 * `knownTools` / `plannedTools` come from the SimpleBot registry.
 */
export function codeHealthIssues(
  articles: EditableArticle[],
  knownTools: ReadonlySet<string>,
  plannedTools: ReadonlySet<string>
): HelpHealthIssue[] {
  const slugs = new Map(articles.map((a) => [a.slug, a]));
  const issues: HelpHealthIssue[] = [];
  for (const a of articles) {
    if (a.status !== 'published') continue;
    const at = { slug: a.slug, title: a.title };
    for (const route of a.routes) {
      if (!isAppRoute(route))
        issues.push({
          ...at,
          code: 'UNKNOWN_ROUTE',
          severity: 'error',
          detail: `Refers to the screen ${route}, which does not exist.`
        });
    }
    for (const tool of a.tools) {
      if (plannedTools.has(tool))
        issues.push({
          ...at,
          code: 'TOOL_NOT_AVAILABLE',
          severity: 'warning',
          detail: `Names the SimpleBot tool ${tool}, which is planned but not available.`
        });
      else if (!knownTools.has(tool))
        issues.push({
          ...at,
          code: 'UNKNOWN_TOOL',
          severity: 'error',
          detail: `Names the SimpleBot tool ${tool}, which does not exist.`
        });
    }
    for (const slug of linkedSlugs(a.body)) {
      const target = slugs.get(slug);
      if (!target || target.status !== 'published')
        issues.push({
          ...at,
          code: 'BROKEN_LINK_IN_TEXT',
          severity: 'warning',
          detail: `The text links to "${slug}", which ${
            !target ? 'does not exist' : `is ${target.status}`
          }.`
        });
    }
  }
  return issues;
}

export async function getHelpHealth(
  articles: EditableArticle[],
  tools: { known: ReadonlySet<string>; planned: ReadonlySet<string> }
): Promise<{ checkedAt: string; issues: HelpHealthIssue[] }> {
  const db = await helpDb();
  const { data, error } = await db.rpc<{
    checked_at: string;
    issues: HelpHealthIssue[];
  }>('help_health');
  if (error) throw new Error(`help_health: ${error.message}`);
  const rank = { error: 0, warning: 1, info: 2 } as const;
  return {
    checkedAt: data!.checked_at,
    issues: [
      ...data!.issues,
      ...codeHealthIssues(articles, tools.known, tools.planned)
    ].sort(
      (a, b) =>
        rank[a.severity] - rank[b.severity] || a.title.localeCompare(b.title)
    )
  };
}
