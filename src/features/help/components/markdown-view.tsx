import Link from 'next/link';
import { Fragment } from 'react';
import { parseMarkdown, type Block, type Inline } from '../markdown';

// Renders a Help article body as React elements only (no dangerouslySetInnerHTML).

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'text') return <Fragment key={i}>{n.text}</Fragment>;
        if (n.type === 'strong')
          return (
            <strong key={i} className='text-foreground font-semibold'>
              <Inlines nodes={n.children} />
            </strong>
          );
        return (
          <Link
            key={i}
            href={n.href}
            className='text-primary font-medium underline underline-offset-4'
          >
            <Inlines nodes={n.children} />
          </Link>
        );
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return b.level === 2 ? (
              <h2 key={i} className='mt-6 text-lg font-semibold first:mt-0'>
                <Inlines nodes={b.children} />
              </h2>
            ) : (
              <h3 key={i} className='mt-4 text-base font-semibold'>
                <Inlines nodes={b.children} />
              </h3>
            );
          case 'paragraph':
            return (
              <p key={i}>
                <Inlines nodes={b.children} />
              </p>
            );
          case 'list':
            return b.ordered ? (
              <ol key={i} className='flex list-decimal flex-col gap-2 pl-6'>
                {b.items.map((item, j) => (
                  <li key={j} className='pl-1'>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className='flex list-disc flex-col gap-1.5 pl-6'>
                {b.items.map((item, j) => (
                  <li key={j} className='pl-1'>
                    <Inlines nodes={item} />
                  </li>
                ))}
              </ul>
            );
          case 'callout':
            return (
              <div
                key={i}
                role='note'
                className={
                  b.tone === 'warning'
                    ? 'bg-warning-soft border-warning/40 flex flex-col gap-2 rounded-md border px-4 py-3'
                    : 'bg-muted/60 flex flex-col gap-2 rounded-md border px-4 py-3'
                }
              >
                <Blocks blocks={b.children} />
              </div>
            );
        }
      })}
    </>
  );
}

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className='text-foreground/90 flex flex-col gap-3 text-[15px] leading-7 break-words'>
      <Blocks blocks={parseMarkdown(source)} />
    </div>
  );
}
