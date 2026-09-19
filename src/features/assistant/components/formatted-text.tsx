import { Fragment } from 'react';

// The model writes light Markdown. This renders the small subset that suits a
// narrow drawer (paragraphs, lists, bold, inline code) as React elements - no
// HTML injection, and anything else shows as plain text.

function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={i}
          className='bg-muted rounded px-1 py-0.5 font-mono text-[0.8em]'
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;

export function FormattedText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className='flex flex-col gap-2 text-sm leading-relaxed break-words'>
      {blocks.map((block, b) => {
        const lines = block.split('\n').filter((line) => line.trim() !== '');
        if (lines.length > 0 && lines.every((line) => BULLET.test(line))) {
          return (
            <ul key={b} className='flex list-disc flex-col gap-1 pl-5'>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(BULLET, ''))}</li>
              ))}
            </ul>
          );
        }
        if (lines.length > 0 && lines.every((line) => NUMBERED.test(line))) {
          return (
            <ol key={b} className='flex list-decimal flex-col gap-1 pl-5'>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(NUMBERED, ''))}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={b}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(line.replace(/^#{1,6}\s+/, ''))}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
