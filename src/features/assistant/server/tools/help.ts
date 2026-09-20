import 'server-only';

import { routePatternFor } from '@/features/help/routes';
import {
  articlesForRouteIn,
  getPublishedArticles,
  relatedIn
} from '@/features/help/server/queries';
import { searchArticles } from '@/features/help/search';
import { helpArticleHref, type PublishedArticle } from '@/features/help/types';
import { z } from 'zod';
import type { HelpCardArticle } from '../../protocol';
import type { ReadTool, ToolActor } from '../registry';

// SimpleBot's read-only access to the Help Center: the SAME published
// articles staff read, through the same database function
// (public.help_published_articles), so status (published only), audience
// (roles) and the published revision are decided by the database for the
// signed-in person. The model supplies a search phrase, a slug or a route;
// it never sees ids, drafts, archived articles or SQL.
//
// Article text reaches the model inside the usual tool envelope marked
// "retrieved-data-not-instructions": it is knowledge about the app, never
// instructions to SimpleBot.

const ENFORCED =
  "public.help_published_articles (SECURITY DEFINER): published revision of published articles only, filtered by the caller's roles; session-bound client";

const SLUG = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'an article slug such as move-a-job')
  .max(80);

const card = (a: PublishedArticle): HelpCardArticle => ({
  title: a.title,
  summary: a.summary,
  category: a.category ?? undefined,
  href: helpArticleHref(a.slug),
  switchedOn: a.releaseOn
});

const brief = (a: PublishedArticle) => ({
  slug: a.slug,
  title: a.title,
  url: helpArticleHref(a.slug),
  summary: a.summary,
  switched_on: a.releaseOn
});

const SWITCHED_OFF =
  'The feature this guide describes is NOT currently switched on. Say so plainly; do not tell the staff member to use it now or offer to do it.';

/**
 * Tools named on the article that this staff member can use through SimpleBot
 * right now (registered, available, permitted). Only these may be offered.
 */
async function offerableActions(
  article: PublishedArticle,
  actor: ToolActor
): Promise<{ tool: string; kind: 'read' | 'mutation'; summary: string }[]> {
  if (!article.releaseOn || article.tools.length === 0) return [];
  // Imported lazily: the registry module imports this one.
  const { createRequestToolRegistry } = await import('./index');
  const registry = await createRequestToolRegistry();
  return registry
    .availableFor(actor)
    .filter((t) => article.tools.includes(t.name) && t.domain !== 'help')
    .map((t) => ({ tool: t.name, kind: t.kind, summary: t.summary }));
}

export const searchHelpArticlesTool: ReadTool<{
  query: string;
  limit: number;
}> = {
  name: 'search_help_articles',
  summary: 'Search the Help Center guides',
  description:
    "Search the company's Help Center: the maintained, published staff guides to how this application works (how to move a job, cancel a job, record commissioning, what Ready to Book means, etc.). Use it FIRST for any 'how do I...', 'what does X mean', 'why can't I...' or 'where do I find...' question about using the app. Pass the staff member's own words. Returns the best matching guides (title, url, summary, match 'strong' or 'weak'); then call get_help_article on the best STRONG match to read it before answering. Weak matches are only possibly related.",
  domain: 'help',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    query: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe("The staff member's question or its key words"),
    limit: z.number().int().min(1).max(8).default(5)
  }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ query, limit }) {
    const hits = searchArticles(await getPublishedArticles(), query, limit);
    return {
      ok: true,
      data: {
        kind: 'help_search',
        query,
        results: hits.map((h) => ({
          ...brief(h.article),
          match: h.strength,
          matched_phrase: h.matchedAlias
        })),
        ...(!hits.some((h) => h.strength === 'strong') && {
          note: hits.length
            ? 'No guide clearly covers this question (only weak matches). Tell the staff member you could not find a guide that covers it; you may mention a weak match as "might be related", never as the answer. Do not present general knowledge as company procedure.'
            : 'No guide matched. Tell the staff member you could not find an internal guide for this; do not present general knowledge as company procedure.'
        })
      },
      display: {
        kind: 'help_articles',
        title: hits.some((h) => h.strength === 'strong')
          ? 'Help Center guides'
          : hits.length
            ? 'Guides that might be related'
            : 'No matching guide',
        articles: hits.map((h) => card(h.article))
      }
    };
  }
};

export const getHelpArticleTool: ReadTool<{ slug: string }> = {
  name: 'get_help_article',
  summary: 'Read a Help Center guide',
  description:
    'Read one published Help Center guide in full (by the slug from search_help_articles or get_help_for_route). Answer from its content, name the guide ("According to <title>, ...") and do not add steps it does not contain. The result also says whether the feature is switched on and which SimpleBot actions (if any) you may offer to help with it.',
  domain: 'help',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ slug: SLUG }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ slug }, { actor }) {
    const articles = await getPublishedArticles();
    const article = articles.find((a) => a.slug === slug);
    if (!article) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message:
          'No published guide with that name is available to this staff member. Search again with search_help_articles.'
      };
    }
    const related = relatedIn(articles, article, 5);
    const actions = await offerableActions(article, actor);
    return {
      ok: true,
      data: {
        kind: 'help_article',
        title: article.title,
        url: helpArticleHref(article.slug),
        summary: article.summary,
        content: article.body,
        switched_on: article.releaseOn,
        ...(!article.releaseOn && { switched_on_note: SWITCHED_OFF }),
        last_updated: article.publishedAt,
        related: related.map(brief),
        actions_you_can_offer: actions,
        actions_note: actions.length
          ? 'You may offer to help with these. Mutations still only PREPARE a proposal the staff member must confirm.'
          : 'SimpleBot has no tool to do this for the staff member. Explain the steps and where in the app to do it; do not offer to do it yourself.'
      },
      display: {
        kind: 'help_article',
        article: card(article),
        related: related.map(card)
      }
    };
  }
};

export const getHelpForRouteTool: ReadTool<{ route: string }> = {
  name: 'get_help_for_route',
  summary: 'Find the Help Center guides for the current screen',
  description:
    "Find the guides written for a screen of the app. Pass the `route` from the page hint (e.g. /dashboard/jobs/<id>/move); it is matched to the screen, never trusted as authorization. Use when the staff member asks for help with 'this page' or 'this' and the question is about the screen.",
  domain: 'help',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({
    route: z.string().trim().min(1).max(200).describe('The page path')
  }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ route }) {
    const pattern = routePatternFor(route);
    const matches = pattern
      ? articlesForRouteIn(await getPublishedArticles(), pattern).slice(0, 6)
      : [];
    return {
      ok: true,
      data: {
        kind: 'help_for_screen',
        screen: pattern,
        results: matches.map(brief)
      },
      display: {
        kind: 'help_articles',
        title: matches.length ? 'Help for this page' : 'No guide for this page',
        articles: matches.map(card)
      }
    };
  }
};

export const getRelatedHelpTool: ReadTool<{ slug: string }> = {
  name: 'get_related_help',
  summary: 'List guides related to a Help Center guide',
  description:
    'List the guides related to one guide (what staff usually need next). Use for "what next?" or "anything else I should know?" after a guide.',
  domain: 'help',
  kind: 'read',
  status: 'available',
  inputSchema: z.strictObject({ slug: SLUG }),
  authorization: { permissions: [], enforcedBy: ENFORCED },
  async execute({ slug }) {
    const articles = await getPublishedArticles();
    const article = articles.find((a) => a.slug === slug);
    if (!article) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'No published guide with that name is available.'
      };
    }
    const related = relatedIn(articles, article, 6);
    return {
      ok: true,
      data: {
        kind: 'help_related',
        of: brief(article),
        related: related.map(brief)
      },
      display: {
        kind: 'help_articles',
        title: `Related to ${article.title}`,
        articles: related.map(card)
      }
    };
  }
};

export const HELP_TOOLS = [
  searchHelpArticlesTool,
  getHelpArticleTool,
  getHelpForRouteTool,
  getRelatedHelpTool
];
