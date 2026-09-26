import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormattedText } from '../formatted-text';

// Every case here is something the model actually produced and a reader saw
// raw, comparing a form against a screenshot. There is no DOM, so these assert
// against the rendered markup.

const html = (text: string) =>
  renderToStaticMarkup(<FormattedText text={text} />);

describe('what the model writes, as a person should read it', () => {
  it('renders a table instead of showing the pipes', () => {
    const out = html(
      [
        '| Question | In the form | Notes |',
        '| --- | --- | --- |',
        '| Meter Reading | Yes | Present as "Meter reading" |',
        '| Did you change the Sim? | No | Implied by the outcome |'
      ].join('\n')
    );
    expect(out).toContain('<table');
    expect(out).toContain('Meter Reading');
    expect(out).toContain('Did you change the Sim?');
    // Three header cells, two data rows - the divider is structure, not data.
    expect(out.match(/<th class/g)).toHaveLength(3);
    expect(out.match(/<tr/g)).toHaveLength(3);
    expect(out).not.toContain('| ---');
  });

  it('keeps the sentence that introduces a table', () => {
    const out = html(
      'Here is the comparison:\n| A | B |\n| --- | --- |\n| 1 | 2 |'
    );
    expect(out).toContain('Here is the comparison:');
    expect(out).toContain('<table');
  });

  it('turns <br> into a line break rather than printing it', () => {
    const out = html('Options:<br>Yes<br/>No');
    expect(out).not.toContain('&lt;br');
    expect(out.match(/<br\/>/g)).toHaveLength(2);
  });

  it('renders --- as a rule, not as three dashes', () => {
    const out = html('One\n\n---\n\nTwo');
    expect(out).toContain('<hr');
    expect(out).not.toContain('---');
  });

  it('renders *emphasis* without showing the asterisks', () => {
    const out = html('The outcome was *Tenant not home*.');
    expect(out).toContain('<em>Tenant not home</em>');
    expect(out).not.toContain('*');
  });

  it('still treats a bullet list as a list, not as italics', () => {
    const out = html('* first\n* second');
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).not.toContain('*');
  });

  it('never renders HTML the model writes', () => {
    const out = html('<script>alert(1)</script> and <b>bold</b>');
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<b>');
    // It shows as the text it is, which is honest and harmless.
    expect(out).toContain('&lt;script&gt;');
  });
});
