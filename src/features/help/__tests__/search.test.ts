import { describe, expect, it } from 'vitest';
// The real seeded articles, exactly as the seed migration installs them.
import { loadArticles } from '../../../../scripts/build-help-seed.mjs';
import {
  editDistance,
  normalise,
  searchArticles,
  stem,
  terms,
  type SearchableArticle
} from '../search';

type SeedArticle = {
  slug: string;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  aliases: string[];
  common_task: boolean;
  audience_roles: string[];
};

const { articles: seed, errors } = loadArticles() as {
  articles: SeedArticle[];
  errors: string[];
};
const corpus: (SearchableArticle & { audience: string[] })[] = seed.map(
  (a) => ({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    body: a.body,
    keywords: a.keywords,
    aliases: a.aliases,
    commonTask: a.common_task,
    audience: a.audience_roles
  })
);

// Staff wording -> the guide(s) that must come first (any of them, in the top 3).
// This table is the search-quality record for the Help Center.
export const SEARCH_EXPECTATIONS: [string, string[]][] = [
  ['move job', ['move-a-job']],
  ['reschedule', ['move-a-job']],
  ['change install date', ['move-a-job']],
  ['move installation', ['move-a-job']],
  ['How do I move a job?', ['move-a-job']],
  ['installer unavailable', ['capacity-conflicts', 'change-installer']],
  ['change installer', ['change-installer']],
  ['How do I change installer?', ['change-installer']],
  ['cancel customer', ['cancel-a-job']],
  ['customer cancelled', ['cancel-a-job']],
  ['customer cancelling', ['cancel-a-job']],
  ['What do I do when a customer cancels?', ['cancel-a-job']],
  ['How do I cancel a job?', ['cancel-a-job']],
  ['reinstate', ['reinstate-a-job']],
  ['signed contract', ['signed-contract', 'pre02-check-contract-signed']],
  ['upload contract', ['signed-contract', 'pre02-check-contract-signed']],
  ['where is contract', ['signed-contract']],
  [
    'How do I upload a signed contract?',
    ['signed-contract', 'pre02-check-contract-signed']
  ],
  ['Where can I find the signed contract?', ['signed-contract']],
  ['ready to book', ['ready-to-book']],
  ['What does Ready to Book mean?', ['ready-to-book']],
  ['How do I complete PRE02?', ['pre02-check-contract-signed']],
  ["can't complete task", ['task-blocked']],
  ["can't finish job", ['why-cant-i-complete-a-job']],
  [
    "Why can't I complete this job?",
    ['why-cant-i-complete-a-job', 'electrical-completion']
  ],
  [
    "Why can't I complete this Electrical job?",
    ['electrical-completion', 'why-cant-i-complete-a-job']
  ],
  [
    'commissioning',
    [
      'record-commissioning',
      'commissioning-review',
      'office-commissioning-record'
    ]
  ],
  [
    'How do I record commissioning?',
    ['record-commissioning', 'office-commissioning-record']
  ],
  ['electrical completion', ['electrical-completion']],
  ['goods arrived', ['goods-in']],
  ['What do I do when goods arrive?', ['goods-in']],
  ['stock', ['stock', 'stock-for-a-job']],
  ['scaffold', ['scaffold-bookings']],
  ['staff holiday', ['staff-availability']],
  ['customer photos', ['find-customer-files', 'installation-photos']],
  ['installation photos', ['installation-photos']],
  ['where are photos', ['installation-photos', 'find-customer-files']],
  ["How do I find a customer's files?", ['find-customer-files']],
  ['How do I book an installation?', ['book-a-job']],
  ['SimpleBot confirmation', ['simplebot-confirmations']],
  ['forgot password', ['signing-in']],
  ['merchant order', ['merchant-orders']],
  // Typos and loose spelling.
  ['reshedule job', ['move-a-job']],
  [
    'comissioning',
    [
      'record-commissioning',
      'commissioning-review',
      'office-commissioning-record'
    ]
  ],
  ['cancell job', ['cancel-a-job']],
  ['instalation photos', ['installation-photos']]
];

describe('seed articles', () => {
  it('all validate', () => {
    expect(errors).toEqual([]);
    expect(corpus.length).toBeGreaterThanOrEqual(40);
  });
});

describe('search quality (real articles)', () => {
  it.each(SEARCH_EXPECTATIONS)('"%s"', (query, expected) => {
    const top = searchArticles(corpus, query, 3).map((h) => h.article.slug);
    expect(
      expected.some((slug) => top.includes(slug)),
      `top 3 for "${query}": ${top.join(', ')}`
    ).toBe(true);
  });

  it('puts the flagship answer first for the commonest questions', () => {
    for (const [q, slug] of [
      ['move job', 'move-a-job'],
      ['customer cancelled', 'cancel-a-job'],
      ['goods arrived', 'goods-in'],
      ['ready to book', 'ready-to-book'],
      ['change installer', 'change-installer']
    ]) {
      expect(searchArticles(corpus, q, 1)[0]?.article.slug, q).toBe(slug);
    }
  });

  it('only ranks what it is given (audience filtering happens first, in the database)', () => {
    const installerOnly = corpus.filter(
      (a) => a.audience.length === 0 || a.audience.includes('Installer')
    );
    const top = searchArticles(installerOnly, 'cancel a job', 5).map(
      (h) => h.article.slug
    );
    expect(top).not.toContain('cancel-a-job');
  });

  it('never presents an off-topic guide as a strong answer', () => {
    for (const q of [
      'How do I order new printer toner?',
      'where is the nearest train station',
      'what is the wifi password'
    ]) {
      const strong = searchArticles(corpus, q, 5).filter(
        (h) => h.strength === 'strong'
      );
      expect(
        strong.map((h) => h.article.slug),
        q
      ).toEqual([]);
    }
    // ...while the real questions are strong matches.
    for (const [q] of SEARCH_EXPECTATIONS.slice(0, 12)) {
      expect(searchArticles(corpus, q, 1)[0]?.strength, q).toBe('strong');
    }
  });

  it('returns nothing for noise and stop words', () => {
    expect(searchArticles(corpus, 'the and of', 5)).toEqual([]);
    expect(searchArticles(corpus, '', 5)).toEqual([]);
    expect(searchArticles(corpus, 'zzqx vvbn', 5)).toEqual([]);
  });

  it('is fast enough to run per request', () => {
    const started = performance.now();
    for (let i = 0; i < 20; i++)
      searchArticles(corpus, 'move the install date please', 5);
    expect((performance.now() - started) / 20).toBeLessThan(50);
  });
});

describe('text helpers', () => {
  it('normalises apostrophes and punctuation', () => {
    expect(normalise("Can't finish JOB!")).toBe('cant finish job');
  });
  it('stems plurals and tenses together', () => {
    expect(stem('cancelled')).toBe('cancel');
    expect(stem('photos')).toBe('photo');
    expect(stem('booking')).toBe('book');
  });
  it('maps everyday words to the words guides use', () => {
    expect(terms('reschedule the holiday')).toEqual(['move', 'leave']);
  });
  it('counts a transposition as one edit', () => {
    expect(editDistance('recieve', 'receive')).toBe(1);
    expect(editDistance('abc', 'xyz', 1)).toBeGreaterThan(1);
  });
});
