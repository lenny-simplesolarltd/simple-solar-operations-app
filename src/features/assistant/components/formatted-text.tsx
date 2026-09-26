import { Fragment } from 'react';

// The model writes light Markdown. This renders the subset that suits a narrow
// drawer as React elements - never HTML, so nothing the model writes can be
// injected. Anything unrecognised falls through as plain text.
//
// The list here is not a matter of taste: every item is something the model
// actually produced and a reader saw raw. Comparing a form against a
// screenshot came back as `| Meter Reading | Yes | ... |` with the pipes
// showing, `<br>` printed as four characters, and `---` as three dashes.

/** `<br>` is the model's way of breaking a line inside a table cell. */
const BR = /<br\s*\/?>/gi;

function inline(text: string): React.ReactNode[] {
  // Split on the marks first, then break each piece on <br>, so a line break
  // inside bold text still works.
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g)
    .flatMap((part, i): React.ReactNode[] => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
        return [<strong key={i}>{part.slice(2, -2)}</strong>];
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
        return [
          <code
            key={i}
            className='bg-muted rounded px-1 py-0.5 font-mono text-[0.8em]'
          >
            {part.slice(1, -1)}
          </code>
        ];
      // A single * pair is emphasis. Bullets are handled per line before this
      // runs, so a leading "* " never reaches here as italics.
      if (
        part.startsWith('*') &&
        part.endsWith('*') &&
        part.length > 2 &&
        !part.startsWith('**')
      )
        return [<em key={i}>{part.slice(1, -1)}</em>];

      return part
        .split(BR)
        .flatMap((piece, j) =>
          j === 0
            ? [<Fragment key={`${i}-${j}`}>{piece}</Fragment>]
            : [
                <br key={`${i}-${j}-br`} />,
                <Fragment key={`${i}-${j}`}>{piece}</Fragment>
              ]
        );
    });
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
/** The |---|:--:| line under a table's header. */
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;

/** "| a | b |" -> ["a", "b"], without the empty edges the pipes create. */
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * A markdown table.
 *
 * Kept narrow deliberately: this renders inside a drawer, so the table scrolls
 * sideways rather than squeezing every column into a few characters. Showing
 * the pipes was the alternative, and that is not a table at all.
 */
function Table({ rows }: { rows: string[] }) {
  const header = cells(rows[0]);
  const body = rows.slice(TABLE_DIVIDER.test(rows[1] ?? '') ? 2 : 1);
  return (
    <div className='-mx-1 overflow-x-auto px-1'>
      <table className='w-full border-collapse text-xs'>
        <thead>
          <tr>
            {header.map((c, i) => (
              <th
                key={i}
                className='border-b px-2 py-1 text-left align-top font-semibold'
              >
                {inline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => {
            const value = cells(row);
            return (
              <tr key={r}>
                {header.map((_, i) => (
                  <td key={i} className='border-b px-2 py-1 align-top'>
                    {inline(value[i] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FormattedText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className='flex flex-col gap-2 text-sm leading-relaxed break-words'>
      {blocks.flatMap((block, b) => {
        const lines = block.split('\n').filter((line) => line.trim() !== '');
        if (lines.length === 0) return [];

        // A table can sit in the same block as the sentence introducing it, so
        // the rows are pulled out rather than requiring a block of their own.
        const firstRow = lines.findIndex((l) => TABLE_ROW.test(l));
        if (firstRow >= 0) {
          const before = lines.slice(0, firstRow);
          const rows: string[] = [];
          let i = firstRow;
          while (i < lines.length && TABLE_ROW.test(lines[i]))
            rows.push(lines[i++]);
          const after = lines.slice(i);
          return [
            ...(before.length
              ? [<FormattedText key={`${b}-pre`} text={before.join('\n')} />]
              : []),
            <Table key={`${b}-table`} rows={rows} />,
            ...(after.length
              ? [<FormattedText key={`${b}-post`} text={after.join('\n')} />]
              : [])
          ];
        }

        if (lines.every((line) => RULE.test(line)))
          return [<hr key={b} className='border-border my-1' />];

        if (lines.every((line) => BULLET.test(line)))
          return [
            <ul key={b} className='flex list-disc flex-col gap-1 pl-5'>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(BULLET, ''))}</li>
              ))}
            </ul>
          ];

        if (lines.every((line) => NUMBERED.test(line)))
          return [
            <ol key={b} className='flex list-decimal flex-col gap-1 pl-5'>
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(NUMBERED, ''))}</li>
              ))}
            </ol>
          ];

        return [
          <p key={b}>
            {lines.map((line, i) => (
              <Fragment key={i}>
                {i > 0 && <br />}
                {inline(line.replace(/^#{1,6}\s+/, ''))}
              </Fragment>
            ))}
          </p>
        ];
      })}
    </div>
  );
}
