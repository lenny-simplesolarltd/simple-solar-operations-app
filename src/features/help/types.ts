// Help Center types. Safe to import from client components.

export const HELP_CATEGORY_CODES = [
  'getting-started',
  'tasks',
  'jobs',
  'sales',
  'booking',
  'planning',
  'installation',
  'commissioning',
  'programmes',
  'materials',
  'cancellations',
  'files',
  'forms',
  'simplebot',
  'administration'
] as const;
export type HelpCategoryCode = (typeof HELP_CATEGORY_CODES)[number];

export interface HelpCategory {
  code: string;
  title: string;
  description: string;
  icon: string;
  sortOrder: number;
}

/** A published article as staff (and SimpleBot) read it: the published revision only. */
export interface PublishedArticle {
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: string | null;
  audienceRoles: string[];
  /** Release functions the procedure depends on (all must be on). */
  releaseFunctions: string[];
  /** False when any release function the procedure depends on is switched off. */
  releaseOn: boolean;
  releaseNames: string[];
  routes: string[];
  tools: string[];
  keywords: string[];
  aliases: string[];
  relatedSlugs: string[];
  commonTask: boolean;
  sortOrder: number;
  revisionNumber: number;
  publishedAt: string | null;
  reviewedAt: string | null;
}

export type ArticleStatus = 'draft' | 'published' | 'archived';

/** The editor's view of an article: the working copy plus bookkeeping. */
export interface EditableArticle {
  id: string;
  slug: string;
  status: ArticleStatus;
  title: string;
  summary: string;
  body: string;
  category: string | null;
  audienceRoles: string[];
  releaseFunctions: string[];
  routes: string[];
  tools: string[];
  keywords: string[];
  aliases: string[];
  relatedSlugs: string[];
  commonTask: boolean;
  sortOrder: number;
  hasUnpublishedChanges: boolean;
  publishedRevisionNumber: number | null;
  publishedAt: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewDueAt: string | null;
  seedVersion: number | null;
  seedUpdateAvailable: number | null;
  updatedAt: string;
  updatedByName: string | null;
  version: number;
}

export interface ArticleRevision {
  revisionNumber: number;
  event:
    | 'created'
    | 'edited'
    | 'published'
    | 'archived'
    | 'restored'
    | 'reviewed'
    | 'reverted'
    | 'seeded';
  status: ArticleStatus;
  title: string;
  summary: string;
  body: string;
  changeNote: string | null;
  createdAt: string;
  createdByName: string | null;
}

export interface HelpHealthIssue {
  slug: string;
  title: string;
  code: string;
  severity: 'error' | 'warning' | 'info';
  detail: string;
}

/** The fields an editor submits. */
export interface ArticleDraftInput {
  slug?: string;
  title: string;
  summary: string;
  body: string;
  category: string | null;
  audienceRoles: string[];
  releaseFunctions: string[];
  routes: string[];
  tools: string[];
  keywords: string[];
  aliases: string[];
  relatedSlugs: string[];
  commonTask: boolean;
  sortOrder: number;
  changeNote?: string;
}

/** Link to an article inside the app. Never an id. */
export const helpArticleHref = (slug: string) => `/dashboard/help/${slug}`;
