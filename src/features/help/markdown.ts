// The Help Center's Markdown subset, parsed into a small tree. Pure and safe
// to import anywhere. Rendering (markdown-view.tsx) turns the tree into React
// elements, so nothing in an article is ever interpreted as HTML: a <script>
// in an article is shown as the text "<script>".
//
// Supported: ## / ### headings, paragraphs, numbered and bullet lists,
// **bold**, links to other articles ([text](/help/slug)) and to app screens
// ([text](/dashboard/...)), and "> **Warning:** ..." / "> **Note:** ..."
// callouts. Anything else is plain text. External, javascript:, data: and
// protocol-relative links are never links - only their text is shown.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'heading'; level: 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'callout'; tone: 'warning' | 'note'; children: Block[] };

const ARTICLE_LINK = /^\/help\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const APP_LINK = /^\/dashboard(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_=&-]*)?$/;

/** The in-app target of an article link, or null when it must not be a link. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  const article = ARTICLE_LINK.exec(href);
  if (article) return `/dashboard/help/${article[1]}`;
  if (APP_LINK.test(href)) return href;
  return null;
}

/** Article slugs linked from a body ([text](/help/slug)). */
export function linkedSlugs(body: string): string[] {
  const out = new Set<string>();
  Array.from(body.matchAll(/\]\((\/help\/[^)\s]*)\)/g)).forEach((m) => {
    const a = ARTICLE_LINK.exec(m[1]);
    if (a) out.add(a[1]);
  });
  return Array.from(out);
}

/** Link targets in a body that are not allowed (shown as text only). */
export function unsafeLinks(body: string): string[] {
  return Array.from(body.matchAll(/\[[^\]]*\]\(([^)]*)\)/g))
    .map((m) => m[1])
    .filter((href) => !safeHref(href));
}

/** HTML-looking tags in a body (they are shown as text; editors are warned). */
export function htmlTags(body: string): string[] {
  return Array.from(body.matchAll(/<\/?[a-z][^>]*>/gi)).map((m) => m[0]);
}

export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]*)\)/g;
  let last = 0;
  for (const m of Array.from(text.matchAll(pattern))) {
    if (m.index! > last)
      out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      out.push({
        type: 'strong',
        children:
          depth < 2
            ? parseInline(m[1], depth + 1)
            : [{ type: 'text', text: m[1] }]
      });
    } else {
      const href = safeHref(m[3]);
      const children: Inline[] =
        depth < 2
          ? parseInline(m[2], depth + 1)
          : [{ type: 'text', text: m[2] }];
      if (href) out.push({ type: 'link', href, children });
      else out.push(...children);
    }
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const ORDERED = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const BULLET = /^\s{0,3}[-*•]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const CALLOUT = /^\*\*(warning|note|important|tip)[:.]?\*\*[:.]?\s*/i;

export function parseMarkdown(source: string, depth = 0): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'paragraph', children: parseInline(para.join(' ')) });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map((i) => parseInline(i))
      });
      list = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      flushPara();
      flushList();
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote && depth === 0) {
      flushPara();
      flushList();
      const quoted = [quote[1]];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1])) {
        quoted.push(QUOTE.exec(lines[++i])![1]);
      }
      const text = quoted.join('\n');
      const tone = CALLOUT.exec(text.trim());
      blocks.push({
        type: 'callout',
        tone:
          tone &&
          tone[1].toLowerCase() !== 'note' &&
          tone[1].toLowerCase() !== 'tip'
            ? 'warning'
            : 'note',
        children: parseMarkdown(text.trim(), depth + 1)
      });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length <= 2 ? 2 : 3,
        children: parseInline(heading[2].replace(/\s+#+\s*$/, ''))
      });
      continue;
    }
    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    if (ordered || bullet) {
      flushPara();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push((ordered ?? bullet)![1]);
      continue;
    }
    // Indented continuation of a list item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

/** Plain text of inline nodes. */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => (n.type === 'text' ? n.text : inlineText(n.children)))
    .join('');
}
