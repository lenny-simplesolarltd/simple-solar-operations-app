'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { htmlTags, unsafeLinks } from '../markdown';
import {
  changeArticleState,
  createArticle,
  revertArticle,
  updateArticle,
  type HelpActionResult
} from '../server/actions';
import type {
  ArticleDraftInput,
  ArticleRevision,
  EditableArticle,
  HelpCategory
} from '../types';
import { MarkdownView } from './markdown-view';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
const commas = (text: string) =>
  text
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

const EVENT_LABEL: Record<ArticleRevision['event'], string> = {
  created: 'Created',
  edited: 'Draft saved',
  published: 'Published',
  archived: 'Archived',
  restored: 'Restored',
  reviewed: 'Marked as checked',
  reverted: 'Earlier version copied into draft',
  seeded: 'Standard article installed'
};

const STARTER = `Short explanation: one or two sentences.

## Before you start

## Steps
1. Open ...
2. Choose ...

## What happens next

## If you can't do it
- `;

const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Europe/London'
      }).format(new Date(iso))
    : '-';

const DONE: Record<string, string> = {
  created: 'Draft created.',
  saved:
    'Draft saved. Staff still see the published version until it is published.',
  publish: 'Published. Staff and SimpleBot now see this version.',
  review: 'Marked as checked and still correct.',
  archive: 'Archived. Staff and SimpleBot no longer see it.',
  restore: 'Restored.',
  reverted: 'Earlier version copied into the draft. Check it, then publish.'
};

export function ArticleEditor({
  done,
  article,
  history,
  canPublish,
  categories,
  roles,
  releaseFunctions,
  tools,
  routes
}: {
  done?: string;
  article: EditableArticle | null;
  history: ArticleRevision[];
  canPublish: boolean;
  categories: HelpCategory[];
  roles: readonly string[];
  releaseFunctions: string[];
  tools: { name: string; summary: string }[];
  routes: readonly string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(done && DONE[done] ? { tone: 'ok', text: DONE[done] } : null);

  const [slug, setSlug] = useState(article?.slug ?? '');
  const [title, setTitle] = useState(article?.title ?? '');
  const [summary, setSummary] = useState(article?.summary ?? '');
  const [body, setBody] = useState(article?.body ?? STARTER);
  const [category, setCategory] = useState(article?.category ?? '');
  const [audience, setAudience] = useState<string[]>(
    article?.audienceRoles ?? []
  );
  const [release, setRelease] = useState(
    (article?.releaseFunctions ?? []).join(', ')
  );
  const [routeText, setRouteText] = useState(
    (article?.routes ?? []).join('\n')
  );
  const [toolSet, setToolSet] = useState<string[]>(article?.tools ?? []);
  const [aliasText, setAliasText] = useState(
    (article?.aliases ?? []).join('\n')
  );
  const [keywordText, setKeywordText] = useState(
    (article?.keywords ?? []).join(', ')
  );
  const [relatedText, setRelatedText] = useState(
    (article?.relatedSlugs ?? []).join('\n')
  );
  const [commonTask, setCommonTask] = useState(article?.commonTask ?? false);
  const [sortOrder, setSortOrder] = useState(String(article?.sortOrder ?? 100));
  const [changeNote, setChangeNote] = useState('');
  const [dirty, setDirty] = useState(article === null);

  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setDirty(true);
    };

  const input = (): ArticleDraftInput => ({
    slug: slug.trim().toLowerCase(),
    title: title.trim(),
    summary: summary.trim(),
    body,
    category: category || null,
    audienceRoles: audience,
    releaseFunctions: commas(release.toUpperCase()),
    routes: lines(routeText),
    tools: toolSet,
    keywords: commas(keywordText),
    aliases: lines(aliasText),
    relatedSlugs: lines(relatedText),
    commonTask,
    sortOrder: Number.parseInt(sortOrder, 10) || 0,
    changeNote: changeNote.trim() || undefined
  });

  const warnings = useMemo(() => {
    const out: string[] = [];
    const tags = htmlTags(body);
    if (tags.length)
      out.push(
        `HTML is not used. ${tags.slice(0, 3).join(' ')} will be shown as plain text.`
      );
    const bad = unsafeLinks(body);
    if (bad.length)
      out.push(
        `Only links to other articles (/help/...) or app screens (/dashboard/...) work. These will show as text: ${bad.slice(0, 3).join(', ')}`
      );
    const unknownRoutes = lines(routeText).filter((r) => !routes.includes(r));
    if (unknownRoutes.length)
      out.push(`Unknown screens: ${unknownRoutes.join(', ')}`);
    return out;
  }, [body, routeText, routes]);

  const report = (r: HelpActionResult, done: string) => {
    if (r.ok) {
      setDirty(false);
      setChangeNote('');
      // Reloads the page with the new version; the message travels in the URL.
      router.replace(`/dashboard/help/manage/${r.articleId}?done=${done}`);
      router.refresh();
    } else {
      setMessage({ tone: 'error', text: r.message });
    }
    return r;
  };

  const save = () =>
    start(async () => {
      if (!article) {
        report(await createArticle(crypto.randomUUID(), input()), 'created');
        return;
      }
      report(
        await updateArticle(
          crypto.randomUUID(),
          article.id,
          article.version,
          input()
        ),
        'saved'
      );
    });

  const lifecycle = (action: 'publish' | 'archive' | 'restore' | 'review') =>
    start(async () => {
      if (!article) return;
      let version = article.version;
      if (dirty && action === 'publish') {
        const saved = await updateArticle(
          crypto.randomUUID(),
          article.id,
          version,
          input()
        );
        if (!saved.ok) {
          setMessage({ tone: 'error', text: saved.message });
          return;
        }
        version = saved.version;
      }
      report(
        await changeArticleState(
          crypto.randomUUID(),
          action,
          article.id,
          version,
          changeNote
        ),
        action
      );
    });

  const revert = (revision: number) =>
    start(async () => {
      if (!article) return;
      report(
        await revertArticle(
          crypto.randomUUID(),
          article.id,
          article.version,
          revision
        ),
        'reverted'
      );
    });

  const neverPublished = !article?.publishedRevisionNumber;
  const archived = article?.status === 'archived';

  return (
    <div className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'>
      <div className='flex min-w-0 flex-col gap-5'>
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={
              message.tone === 'error'
                ? 'bg-destructive-soft text-destructive rounded-md px-3 py-2 text-sm'
                : 'bg-success-soft text-success rounded-md px-3 py-2 text-sm'
            }
          >
            {message.text}
          </p>
        )}

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5 sm:col-span-2'>
            <Label htmlFor='title'>Title</Label>
            <Input
              id='title'
              value={title}
              maxLength={160}
              disabled={archived}
              onChange={(e) => edit(setTitle)(e.target.value)}
              placeholder='How to move a job'
            />
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='slug'>Web address</Label>
            <Input
              id='slug'
              value={slug}
              maxLength={80}
              disabled={!neverPublished || archived}
              onChange={(e) => edit(setSlug)(e.target.value)}
              placeholder='move-a-job'
            />
            <p className='text-muted-foreground text-xs'>
              /dashboard/help/{slug || '...'}
              {!neverPublished && ' (fixed once published)'}
            </p>
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='category'>Category</Label>
            <select
              id='category'
              value={category}
              disabled={archived}
              onChange={(e) => edit(setCategory)(e.target.value)}
              className='border-input bg-background h-9 rounded-md border px-3 text-sm'
            >
              <option value=''>Choose…</option>
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className='flex flex-col gap-1.5 sm:col-span-2'>
            <Label htmlFor='summary'>Summary (one sentence)</Label>
            <Input
              id='summary'
              value={summary}
              maxLength={300}
              disabled={archived}
              onChange={(e) => edit(setSummary)(e.target.value)}
            />
          </div>
        </div>

        <Tabs defaultValue='write'>
          <TabsList>
            <TabsTrigger value='write'>Write</TabsTrigger>
            <TabsTrigger value='preview'>Preview</TabsTrigger>
          </TabsList>
          <TabsContent value='write' className='flex flex-col gap-2'>
            <Textarea
              aria-label='Article text'
              value={body}
              disabled={archived}
              onChange={(e) => edit(setBody)(e.target.value)}
              className='min-h-[420px] font-mono text-sm'
            />
            <p className='text-muted-foreground text-xs'>
              ## for a heading · 1. for steps · - for bullets · **bold** ·
              [text](/help/other-article) · &gt; **Warning:** for a warning box
            </p>
          </TabsContent>
          <TabsContent value='preview'>
            <div className='bg-card flex flex-col gap-3 rounded-xl border p-5'>
              <h1 className='text-2xl font-bold'>{title || 'Untitled'}</h1>
              {summary && <p className='text-muted-foreground'>{summary}</p>}
              <MarkdownView source={body} />
            </div>
          </TabsContent>
        </Tabs>

        {warnings.length > 0 && (
          <ul className='bg-warning-soft flex flex-col gap-1 rounded-md px-4 py-3 text-sm'>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        <details className='bg-card rounded-lg border p-4'>
          <summary className='cursor-pointer text-sm font-semibold'>
            Search words, audience and links
          </summary>
          <div className='mt-4 grid gap-4 sm:grid-cols-2'>
            <div className='flex flex-col gap-1.5 sm:col-span-2'>
              <Label htmlFor='aliases'>
                Search phrases staff might use (one per line)
              </Label>
              <Textarea
                id='aliases'
                value={aliasText}
                onChange={(e) => edit(setAliasText)(e.target.value)}
                className='min-h-28'
                placeholder={'move job\nreschedule\nchange install date'}
              />
            </div>
            <div className='flex flex-col gap-1.5 sm:col-span-2'>
              <Label htmlFor='keywords'>Keywords (comma separated)</Label>
              <Input
                id='keywords'
                value={keywordText}
                onChange={(e) => edit(setKeywordText)(e.target.value)}
              />
            </div>
            <fieldset className='flex flex-col gap-2 sm:col-span-2'>
              <legend className='text-sm font-medium'>
                Who is it for? (none ticked = everyone)
              </legend>
              <div className='flex flex-wrap gap-x-4 gap-y-2'>
                {roles.map((r) => (
                  <label key={r} className='flex items-center gap-2 text-sm'>
                    <Checkbox
                      checked={audience.includes(r)}
                      onCheckedChange={(v) =>
                        edit(setAudience)(
                          v ? [...audience, r] : audience.filter((x) => x !== r)
                        )
                      }
                    />
                    {r}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='release'>
                Depends on release functions (comma separated)
              </Label>
              <Input
                id='release'
                value={release}
                onChange={(e) => edit(setRelease)(e.target.value)}
                placeholder='e.g. FN-01, FN-17 (leave blank if none)'
              />
              {releaseFunctions.length > 0 && (
                <p className='text-muted-foreground text-xs'>
                  Known: {releaseFunctions.join(', ')}
                </p>
              )}
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='sort'>Order in its category</Label>
              <Input
                id='sort'
                inputMode='numeric'
                value={sortOrder}
                onChange={(e) => edit(setSortOrder)(e.target.value)}
              />
            </div>
            <div className='flex flex-col gap-1.5 sm:col-span-2'>
              <Label htmlFor='routes'>
                Screens it helps with (one per line; used for “Help with this
                page”)
              </Label>
              <Textarea
                id='routes'
                value={routeText}
                onChange={(e) => edit(setRouteText)(e.target.value)}
                className='min-h-20 font-mono text-xs'
                placeholder='/dashboard/jobs/[jobId]/move'
              />
            </div>
            <div className='flex flex-col gap-1.5 sm:col-span-2'>
              <Label htmlFor='related'>
                Related articles (web addresses, one per line)
              </Label>
              <Textarea
                id='related'
                value={relatedText}
                onChange={(e) => edit(setRelatedText)(e.target.value)}
                className='min-h-20 font-mono text-xs'
              />
            </div>
            <fieldset className='flex flex-col gap-2 sm:col-span-2'>
              <legend className='text-sm font-medium'>
                SimpleBot can help with this using
              </legend>
              <div className='grid gap-2 sm:grid-cols-2'>
                {tools.map((t) => (
                  <label
                    key={t.name}
                    className='flex items-start gap-2 text-sm'
                  >
                    <Checkbox
                      className='mt-0.5'
                      checked={toolSet.includes(t.name)}
                      onCheckedChange={(v) =>
                        edit(setToolSet)(
                          v
                            ? [...toolSet, t.name]
                            : toolSet.filter((x) => x !== t.name)
                        )
                      }
                    />
                    <span>{t.summary}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className='flex items-center gap-2 text-sm sm:col-span-2'>
              <Switch
                checked={commonTask}
                onCheckedChange={edit(setCommonTask)}
              />
              Show under “Common tasks”
            </label>
          </div>
        </details>
      </div>

      <aside className='flex flex-col gap-4'>
        <div className='bg-card flex flex-col gap-3 rounded-lg border p-4'>
          <div className='flex flex-wrap items-center gap-2'>
            {article ? (
              <Badge
                variant={
                  article.status === 'published'
                    ? 'success'
                    : article.status === 'archived'
                      ? 'outline'
                      : 'info'
                }
              >
                {article.status === 'published'
                  ? 'Published'
                  : article.status === 'archived'
                    ? 'Archived'
                    : 'Draft'}
              </Badge>
            ) : (
              <Badge variant='info'>New</Badge>
            )}
            {article?.hasUnpublishedChanges &&
              article.status === 'published' && (
                <Badge variant='warning'>Unpublished changes</Badge>
              )}
            {dirty && <Badge variant='outline'>Not saved</Badge>}
          </div>
          <div className='flex flex-col gap-1.5'>
            <Label htmlFor='note'>Note about this change (optional)</Label>
            <Input
              id='note'
              value={changeNote}
              maxLength={500}
              onChange={(e) => setChangeNote(e.target.value)}
            />
          </div>
          {!archived && (
            <Button
              onClick={save}
              disabled={pending || !dirty}
              variant='outline'
            >
              {article ? 'Save draft' : 'Create draft'}
            </Button>
          )}
          {article && canPublish && !archived && (
            <Button
              onClick={() => lifecycle('publish')}
              disabled={
                pending ||
                (!dirty &&
                  article.status === 'published' &&
                  !article.hasUnpublishedChanges)
              }
            >
              {dirty ? 'Save and publish' : 'Publish'}
            </Button>
          )}
          {article && canPublish && article.status === 'published' && (
            <Button
              variant='outline'
              disabled={pending}
              onClick={() => lifecycle('review')}
            >
              Mark as checked
            </Button>
          )}
          {article && canPublish && !archived && (
            <Button
              variant='ghost'
              className='text-destructive'
              disabled={pending}
              onClick={() => lifecycle('archive')}
            >
              Archive
            </Button>
          )}
          {article && canPublish && archived && (
            <Button disabled={pending} onClick={() => lifecycle('restore')}>
              Restore
            </Button>
          )}
          {article && !canPublish && (
            <p className='text-muted-foreground text-xs'>
              A manager or administrator publishes your draft.
            </p>
          )}
          {article?.status === 'published' && (
            <Link
              href={`/dashboard/help/${article.slug}`}
              className='text-primary text-sm'
            >
              View the published article →
            </Link>
          )}
          {article && (
            <dl className='text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs'>
              <dt>Published</dt>
              <dd>
                {article.publishedRevisionNumber
                  ? `Revision ${article.publishedRevisionNumber}, ${when(article.publishedAt)}`
                  : 'Never'}
              </dd>
              <dt>Last checked</dt>
              <dd>
                {when(article.reviewedAt)}
                {article.reviewedByName ? ` by ${article.reviewedByName}` : ''}
              </dd>
              <dt>Check due</dt>
              <dd>{when(article.reviewDueAt)}</dd>
              {article.seedUpdateAvailable && (
                <>
                  <dt>Standard text</dt>
                  <dd>
                    A newer standard version exists but was not applied, because
                    this article has been edited here.
                  </dd>
                </>
              )}
            </dl>
          )}
        </div>

        {history.length > 0 && (
          <div className='bg-card flex flex-col gap-2 rounded-lg border p-4'>
            <h2 className='text-sm font-semibold'>History</h2>
            <ol className='flex max-h-[480px] flex-col gap-2 overflow-y-auto'>
              {history.map((h) => (
                <li
                  key={h.revisionNumber}
                  className='flex flex-col gap-0.5 border-b pb-2 text-xs last:border-0'
                >
                  <span className='font-medium'>
                    {h.revisionNumber}. {EVENT_LABEL[h.event]}
                  </span>
                  <span className='text-muted-foreground'>
                    {when(h.createdAt)}
                    {h.createdByName ? ` · ${h.createdByName}` : ''}
                  </span>
                  {h.changeNote && <span>“{h.changeNote}”</span>}
                  <details>
                    <summary className='text-primary cursor-pointer'>
                      Show this version
                    </summary>
                    <div className='mt-2 flex flex-col gap-2 rounded border p-2'>
                      <p className='font-semibold'>{h.title}</p>
                      <MarkdownView source={h.body} />
                      {!archived && (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={pending}
                          onClick={() => revert(h.revisionNumber)}
                        >
                          Copy this version into the draft
                        </Button>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>
    </div>
  );
}
