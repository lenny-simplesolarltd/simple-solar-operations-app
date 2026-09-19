// Help Center search. Pure functions, no I/O: the server passes in the
// published articles the signed-in person may read (the database has already
// applied status and audience), and this ranks them.
//
// Staff don't use our terminology, so matching is deliberately forgiving:
// - article aliases ("move job", "customer cancelling") are the strongest signal,
// - a small synonym table maps everyday words onto the words articles use,
// - light stemming ("cancelled" = "cancel", "photos" = "photo"),
// - one- or two-letter typos are tolerated on longer words.
//
// The corpus is small (tens to a few hundred articles), so ranking in process
// is simpler and more predictable than a database text index, and it is the
// same code for the Help Center page and for SimpleBot.

export interface SearchableArticle {
  slug: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  aliases: string[];
  commonTask?: boolean;
}

export interface SearchHit<T extends SearchableArticle> {
  article: T;
  score: number;
  /**
   * 'strong': the guide's phrases, title or headline fields cover the whole
   * question. 'weak': a partial or body-only match - a "might help", never
   * something to present as THE answer.
   */
  strength: 'strong' | 'weak';
  /** Which alias matched, when one did - useful when explaining a result. */
  matchedAlias: string | null;
}

const STOPWORDS = new Set(
  (
    'a an and are as at be been being but by could did do does doing for from get got had has have how i if ' +
    'im in into is it its itll ive just me my of on or our please should so some that the their them then there ' +
    'these they this those to up us was we were what whats when where which who why will with would you your ' +
    'yours about again also any am there here want need needs trying try go going let lets tell show help ' +
    'able way thing things someone'
  ).split(' ')
);

// Everyday word -> the word our articles use. Applied after stemming.
const SYNONYMS: Record<string, string> = {
  reschedule: 'move',
  rearrange: 'move',
  postpone: 'move',
  shift: 'move',
  bring: 'move',
  day: 'date',
  cancellation: 'cancel',
  pic: 'photo',
  picture: 'photo',
  image: 'photo',
  holiday: 'leave',
  absence: 'leave',
  absent: 'leave',
  vacation: 'leave',
  sick: 'leave',
  delivery: 'goods',
  deliver: 'goods',
  arrive: 'goods',
  arrival: 'goods',
  finish: 'complete',
  completion: 'complete',
  done: 'complete',
  agreement: 'contract',
  document: 'file',
  doc: 'file',
  paperwork: 'file',
  attachment: 'file',
  logon: 'login',
  signin: 'login',
  password: 'login',
  fitter: 'installer',
  engineer: 'installer',
  electrician: 'installer',
  client: 'customer',
  homeowner: 'customer',
  bot: 'simplebot',
  chatbot: 'simplebot',
  assistant: 'simplebot',
  ai: 'simplebot',
  stuck: 'block',
  cannot: 'cant',
  unable: 'cant',
  wont: 'cant',
  doesnt: 'cant',
  isnt: 'cant',
  commission: 'commissioning',
  scaffolding: 'scaffold',
  inventory: 'stock',
  warehouse: 'stock',
  purchase: 'order',
  po: 'order',
  supplier: 'merchant',
  wholesaler: 'merchant',
  sale: 'sold',
  sell: 'sold',
  staff: 'people',
  user: 'people',
  colleague: 'people',
  permission: 'access',
  role: 'access',
  diary: 'planner',
  calendar: 'planner',
  schedule: 'planner'
};

/** Lower-case, drop apostrophes ("can't" -> "cant"), everything else non-alphanumeric -> space. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Light English stemming: enough to make plurals and tenses meet. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && /(sh|ch|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss'))
    w = w.slice(0, -1);
  // "cancell" -> "cancel", "booking" -> "book" already; "planned" -> "plan".
  if (w.length > 4 && /([bdglmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

function term(word: string): string {
  const s = stem(word);
  return SYNONYMS[s] ?? SYNONYMS[word] ?? s;
}

/** Query / document words as matching terms (stopwords removed). */
export function terms(text: string): string[] {
  return normalise(text)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
    .map(term);
}

/** Damerau-Levenshtein distance (optimal string alignment), capped for speed. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0
    )
  );
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

const typoAllowance = (word: string) =>
  word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;

// Field weights: an alias is how staff actually phrase the task.
const WEIGHTS = {
  alias: 7,
  title: 6,
  keyword: 4,
  summary: 3,
  body: 1
} as const;
type Field = keyof typeof WEIGHTS;

interface IndexedArticle<T extends SearchableArticle> {
  article: T;
  fields: Record<Field, Set<string>>;
  aliasPhrases: { alias: string; normal: string; terms: string[] }[];
  titleNormal: string;
}

export interface HelpIndex<T extends SearchableArticle> {
  entries: IndexedArticle<T>[];
  vocabulary: string[];
}

export function buildIndex<T extends SearchableArticle>(
  articles: T[]
): HelpIndex<T> {
  const vocabulary = new Set<string>();
  const entries = articles.map((article) => {
    const fields: Record<Field, Set<string>> = {
      alias: new Set(article.aliases.flatMap(terms)),
      title: new Set(terms(article.title)),
      keyword: new Set(article.keywords.flatMap(terms)),
      summary: new Set(terms(article.summary)),
      body: new Set(terms(stripMarkdown(article.body)))
    };
    for (const set of Object.values(fields))
      set.forEach((t) => vocabulary.add(t));
    return {
      article,
      fields,
      aliasPhrases: article.aliases.map((alias) => ({
        alias,
        normal: terms(alias).join(' '),
        terms: terms(alias)
      })),
      titleNormal: terms(article.title).join(' ')
    };
  });
  return { entries, vocabulary: Array.from(vocabulary) };
}

/** Maps each query term to itself or, if unknown, to close vocabulary words (typos). */
function expandTerms(
  queryTerms: string[],
  vocabulary: string[]
): Map<string, { word: string; factor: number }[]> {
  const known = new Set(vocabulary);
  const out = new Map<string, { word: string; factor: number }[]>();
  for (const q of queryTerms) {
    if (out.has(q)) continue;
    const matches = [{ word: q, factor: 1 }];
    const allowance = typoAllowance(q);
    if (!known.has(q) && allowance > 0) {
      for (const v of vocabulary) {
        if (v.length < 3) continue;
        const d = editDistance(q, v, allowance);
        if (d <= allowance)
          matches.push({ word: v, factor: d === 1 ? 0.7 : 0.5 });
      }
      // A misspelt everyday word ("reshedule" -> reschedule -> move).
      for (const [word, mapped] of Object.entries(SYNONYMS)) {
        if (word.length < 4 || !known.has(mapped)) continue;
        const d = editDistance(q, word, allowance);
        if (d <= allowance)
          matches.push({ word: mapped, factor: d === 1 ? 0.7 : 0.5 });
      }
      // A query word that is a prefix of a longer word ("commiss" -> "commissioning").
      if (q.length >= 5) {
        for (const v of vocabulary) {
          if (v.startsWith(q) && v !== q)
            matches.push({ word: v, factor: 0.6 });
        }
      }
    }
    out.set(q, matches);
  }
  return out;
}

export function searchIndex<T extends SearchableArticle>(
  index: HelpIndex<T>,
  query: string,
  limit = 10
): SearchHit<T>[] {
  const queryTerms = Array.from(new Set(terms(query)));
  if (queryTerms.length === 0) return [];
  const queryPhrase = terms(query).join(' ');
  const expanded = expandTerms(queryTerms, index.vocabulary);

  const hits: SearchHit<T>[] = [];
  for (const entry of index.entries) {
    let score = 0;
    let matched = 0;
    let weakest = Infinity;
    for (const q of queryTerms) {
      let best = 0;
      for (const { word, factor } of expanded.get(q) ?? []) {
        for (const field of Object.keys(WEIGHTS) as Field[]) {
          if (entry.fields[field].has(word)) {
            best = Math.max(best, WEIGHTS[field] * factor);
          }
        }
      }
      if (best > 0) matched++;
      weakest = Math.min(weakest, best);
      score += best;
    }
    if (matched === 0) continue;

    const coverage = matched / queryTerms.length;
    // Less than half the question found: not about this guide.
    if (queryTerms.length >= 2 && coverage < 0.5) continue;
    score *= 0.5 + coverage;

    // Phrase matches: the staff member typed (most of) an alias or the title.
    let matchedAlias: string | null = null;
    let phrase = 0;
    for (const a of entry.aliasPhrases) {
      if (!a.normal) continue;
      let bonus = 0;
      if (a.normal === queryPhrase) bonus = 30;
      else if (a.terms.length >= 2 && containsSequence(queryPhrase, a.normal))
        bonus = 18;
      else if (
        queryTerms.length >= 2 &&
        containsSequence(a.normal, queryPhrase)
      )
        bonus = 12;
      if (bonus > phrase) {
        phrase = bonus;
        matchedAlias = a.alias;
      }
    }
    if (entry.titleNormal && entry.titleNormal === queryPhrase)
      phrase = Math.max(phrase, 25);
    else if (
      queryTerms.length >= 2 &&
      containsSequence(entry.titleNormal, queryPhrase)
    )
      phrase = Math.max(phrase, 10);
    score += phrase;
    if (entry.article.commonTask) score += 0.5;

    // Strong: a staff phrase / the title matched, or every word of the
    // question is in the guide's headline fields (summary or better).
    const strength =
      phrase >= 12 || (coverage === 1 && weakest >= WEIGHTS.summary * 0.7)
        ? 'strong'
        : 'weak';
    hits.push({ article: entry.article, score, matchedAlias, strength });
  }
  return hits
    .sort(
      (a, b) =>
        Number(b.strength === 'strong') - Number(a.strength === 'strong') ||
        b.score - a.score ||
        a.article.title.localeCompare(b.article.title)
    )
    .slice(0, limit);
}

/** Whole-word containment of one normalised phrase in another. */
function containsSequence(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Text of a Markdown body without its syntax (for indexing and snippets). */
export function stripMarkdown(body: string): string {
  return body
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|`/g, '');
}

export function searchArticles<T extends SearchableArticle>(
  articles: T[],
  query: string,
  limit = 10
): SearchHit<T>[] {
  return searchIndex(buildIndex(articles), query, limit);
}
