#!/usr/bin/env node
// Compiles supabase/help-seed/articles/*.md into the Help Center seed
// migration, after validating every article.
//
//   node scripts/build-help-seed.mjs            validate + write the migration
//   node scripts/build-help-seed.mjs --check    validate only (CI / tests)
//
// The generated migration only CREATES missing articles (app.help_seed_article
// never overwrites an article staff have edited). The files here are the
// origin of the standard articles, not the runtime source: once seeded, the
// database is the source of truth and staff edit in the app.
//
// To ship a corrected standard article later: edit the file, bump SEED_VERSION,
// write a NEW migration with --out <new file>. Untouched articles update; edited
// ones are only flagged for an editor (Help health: "newer standard version").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const articlesDir = path.join(root, 'supabase/help-seed/articles');
const SEED_VERSION = 3;
const DEFAULT_OUT = path.join(root, 'supabase/migrations/20260920100100_help_center_seed.sql');

const CATEGORIES = ['getting-started', 'tasks', 'jobs', 'sales', 'booking', 'planning', 'installation',
  'commissioning', 'programmes', 'materials', 'cancellations', 'files', 'forms', 'simplebot',
  'administration'];
const ROLES = ['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance', 'Store',
  'Installer', 'Scaffolder', 'ReadOnly'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Words staff should never meet in an ordinary article (developer vocabulary).
const JARGON = [
  [/\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b/, 'an internal code (e.g. MOVE_JOB)'],
  [/\bRPC\b|\bRLS\b|\bSQL\b|\bPostgREST\b|\bSupabase\b/i, 'database vocabulary'],
  [/\bmigration\b|expected_version|command_id|\bpayload\b|\bendpoint\b/i, 'developer vocabulary'],
  [/\bsrc\/|\.tsx?\b|\.sql\b|\.mjs\b/, 'a file path'],
  [/<\/?[a-z][^>]*>/i, 'HTML'],
  [/^```|^\s*\|.*\|\s*$/m, 'a code block or table'],
  [/!\[/, 'an image']
];

function readTs(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

// Route patterns and SimpleBot tools from the code, so an article can't name
// a screen or tool that does not exist.
const APP_ROUTES = new Set(Array.from(readTs('src/features/help/routes.ts').matchAll(/'(\/dashboard[^']*)'/g), (m) => m[1]));
const toolsDir = path.join(root, 'src/features/assistant/server/tools');
const TOOL_NAMES = new Set();
const PLANNED_TOOLS = new Set();
for (const f of fs.readdirSync(toolsDir)) {
  if (!f.endsWith('.ts')) continue;
  const src = fs.readFileSync(path.join(toolsDir, f), 'utf8');
  for (const m of src.matchAll(/\bname:\s*'([a-z][a-z0-9_]+)'/g)) TOOL_NAMES.add(m[1]);
  if (f === 'planned.ts') for (const m of src.matchAll(/planned\(\s*'([a-z][a-z0-9_]+)'/g)) PLANNED_TOOLS.add(m[1]);
}
const releaseFns = new Set();
for (const f of fs.readdirSync(path.join(root, 'supabase/migrations'))) {
  const src = fs.readFileSync(path.join(root, 'supabase/migrations', f), 'utf8');
  if (!/release_modes/.test(src)) continue;
  for (const m of src.matchAll(/\('(FN-\d{2})',\s*'/g)) releaseFns.add(m[1]);
}

export function parseArticle(file, text) {
  const errors = [];
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { errors: [`${file}: missing --- frontmatter ---`] };
  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    if (i < 0) { errors.push(`${file}: bad frontmatter line "${line}"`); continue; }
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    if (['slug', 'title', 'summary', 'category'].includes(key)) meta[key] = raw;
    else if (key === 'release_function') meta.release_functions = raw === 'none' || raw === '' ? [] : raw.split(/[,\s]+/).filter(Boolean);
    else {
      try { meta[key] = JSON.parse(raw); } catch { errors.push(`${file}: ${key} is not JSON`); }
    }
  }
  const body = m[2].trim() + '\n';
  const a = {
    slug: meta.slug, title: meta.title, summary: meta.summary, body, category: meta.category,
    audience_roles: meta.roles ?? [], release_functions: meta.release_functions ?? [],
    routes: meta.routes ?? [], tools: meta.tools ?? [], keywords: meta.keywords ?? [], aliases: meta.aliases ?? [],
    related_slugs: meta.related ?? [], common_task: meta.common_task === true, sort_order: meta.sort ?? 100,
    sources: meta.sources ?? []
  };
  const where = `${file}`;
  if (!SLUG.test(a.slug ?? '')) errors.push(`${where}: bad slug`);
  if (`${a.slug}.md` !== path.basename(file)) errors.push(`${where}: slug does not match file name`);
  if (!a.title || a.title.length < 3 || a.title.length > 160) errors.push(`${where}: title length`);
  if (!a.summary || a.summary.length > 300) errors.push(`${where}: summary missing or too long`);
  if (!CATEGORIES.includes(a.category)) errors.push(`${where}: unknown category ${a.category}`);
  for (const r of a.audience_roles) if (!ROLES.includes(r)) errors.push(`${where}: unknown role ${r}`);
  for (const f of a.release_functions) if (!releaseFns.has(f)) errors.push(`${where}: unknown release function ${f}`);
  for (const r of a.routes) if (!APP_ROUTES.has(r)) errors.push(`${where}: unknown route ${r}`);
  for (const t of a.tools) {
    if (!TOOL_NAMES.has(t)) errors.push(`${where}: unknown SimpleBot tool ${t}`);
    else if (PLANNED_TOOLS.has(t)) errors.push(`${where}: tool ${t} is only planned`);
  }
  for (const list of ['keywords', 'aliases']) {
    if (!Array.isArray(a[list]) || a[list].length > 60 || a[list].some((x) => typeof x !== 'string' || x.length > 80))
      errors.push(`${where}: ${list} must be up to 60 strings of up to 80 characters`);
  }
  if (a.body.length > 20000) errors.push(`${where}: body too long`);
  const words = a.body.split(/\s+/).filter(Boolean).length;
  if (words < 60 || words > 450) errors.push(`${where}: body has ${words} words (60-450)`);
  if (/^## Related\b/m.test(a.body)) errors.push(`${where}: do not write a Related section (generated from related)`);
  for (const [re, what] of JARGON) {
    if (a.category === 'administration' && what === 'an internal code (e.g. MOVE_JOB)') continue;
    const hit = re.exec(a.body);
    if (hit) errors.push(`${where}: body contains ${what}: "${hit[0]}"`);
  }
  for (const l of a.body.matchAll(/\[[^\]]*\]\(([^)]*)\)/g)) {
    if (!/^\/help\/[a-z0-9-]+$/.test(l[1]) && !/^\/dashboard(\/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_=&-]*)?$/.test(l[1]))
      errors.push(`${where}: link not allowed: ${l[1]}`);
  }
  return { article: a, errors };
}

export function loadArticles() {
  const files = fs.readdirSync(articlesDir).filter((f) => f.endsWith('.md')).sort();
  const articles = [];
  const errors = [];
  for (const f of files) {
    const r = parseArticle(f, fs.readFileSync(path.join(articlesDir, f), 'utf8'));
    errors.push(...r.errors);
    if (r.article) articles.push(r.article);
  }
  const slugs = new Set(articles.map((a) => a.slug));
  for (const a of articles) {
    for (const r of a.related_slugs) if (!slugs.has(r)) errors.push(`${a.slug}.md: related article "${r}" does not exist`);
    if (a.related_slugs.includes(a.slug)) errors.push(`${a.slug}.md: related to itself`);
    for (const l of a.body.matchAll(/\]\(\/help\/([a-z0-9-]+)\)/g))
      if (!slugs.has(l[1])) errors.push(`${a.slug}.md: links to missing article "${l[1]}"`);
  }
  return { articles, errors };
}

function sqlFor(articles) {
  const tag = '$help_seed$';
  const lines = [
    '-- =============================================================================',
    '-- Help Center: standard articles (seed version ' + SEED_VERSION + ').',
    '-- GENERATED by scripts/build-help-seed.mjs from supabase/help-seed/articles.',
    '-- Do not edit by hand.',
    '--',
    '-- app.help_seed_article() creates each article that does not exist yet and',
    '-- publishes it. It never overwrites an article that staff have edited; a',
    '-- newer standard version is then only flagged for an editor (Help health).',
    '-- Re-running this migration, or a later one, is therefore safe.',
    '-- =============================================================================',
    ''
  ];
  for (const a of articles) {
    const { sources, ...payload } = a;
    void sources;
    const json = JSON.stringify(payload);
    if (json.includes(tag)) throw new Error(`${a.slug}: contains the SQL quote tag`);
    lines.push(`select app.help_seed_article(${tag}${json}${tag}::jsonb, ${SEED_VERSION});`);
  }
  lines.push('');
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { articles, errors } = loadArticles();
  if (errors.length) {
    console.error(errors.join('\n'));
    console.error(`\n${errors.length} problem(s) in ${articles.length} articles.`);
    process.exit(1);
  }
  const outArg = process.argv.indexOf('--out');
  const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : DEFAULT_OUT;
  if (process.argv.includes('--check')) {
    console.log(`${articles.length} articles OK.`);
  } else {
    fs.writeFileSync(out, sqlFor(articles));
    console.log(`${articles.length} articles -> ${path.relative(root, out)}`);
  }
}
