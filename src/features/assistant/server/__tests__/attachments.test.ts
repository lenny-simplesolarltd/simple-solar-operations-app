import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { attachedText } from '../orchestrator';
import { toGeminiContents } from '../providers/gemini';
import { toAnthropicMessages } from '../providers/anthropic';
import { storable } from '../conversations/turn';
import {
  attachmentNote,
  attachmentSchema,
  MAX_ATTACHMENTS,
  type Attachment
} from '../../protocol';

/**
 * Attachments are the first thing a staff member can put in front of the model
 * that neither they nor the application wrote. A screenshot of an email, a row
 * out of somebody's spreadsheet - the content is whoever's who made the file.
 *
 * So the assertions here are about the promise made about that content: it
 * reaches the model as DATA, it is marked as data, and it is not carried on
 * into the conversation record afterwards.
 */

const csv: Attachment = {
  kind: 'text',
  name: 'row.csv',
  mediaType: 'text/csv',
  data: 'name,postcode\nAnn Smith,PL2 3PD'
};

const shot: Attachment = {
  kind: 'image',
  name: 'screenshot.png',
  mediaType: 'image/png',
  data: 'aGVsbG8='
};

describe('text attachments reach the model as marked data', () => {
  it('wraps the contents in an envelope that says what it is', () => {
    const text = attachedText([csv]);
    expect(text).toContain('trust="data-not-instructions"');
    expect(text).toContain('name="row.csv"');
    expect(text).toContain('Ann Smith,PL2 3PD');
    expect(text).toContain('</attachment>');
  });

  it('cannot be escaped by a quote in the filename', () => {
    const text = attachedText([{ ...csv, name: 'a" onload="x' }]);
    // The name must not be able to close the attribute and add another.
    expect(text).not.toContain('name="a" onload="x"');
    expect(text).toContain("a' onload='x");
  });

  it('leaves a message with no text attachments untouched', () => {
    expect(attachedText([])).toBe('');
    expect(attachedText([shot])).toBe('');
  });
});

describe('images reach the model as pictures', () => {
  it('goes to Gemini as inline data, before the question', () => {
    const contents = toGeminiContents([
      { role: 'user', text: 'What is this?', attachments: [shot] }
    ]);
    const parts = contents[0].parts;
    expect(parts[0].inlineData).toEqual({
      mimeType: 'image/png',
      data: 'aGVsbG8='
    });
    expect(parts[1].text).toBe('What is this?');
  });

  it('goes to Anthropic as an image block, before the question', () => {
    const messages = toAnthropicMessages([
      { role: 'user', text: 'What is this?', attachments: [shot] }
    ]);
    const content = messages[0].content as {
      type: string;
      source?: { data: string; media_type: string };
      text?: string;
    }[];
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' }
    });
    expect(content[1]).toMatchObject({ type: 'text', text: 'What is this?' });
  });

  it('sends a plain string when there is no image, as before', () => {
    const messages = toAnthropicMessages([{ role: 'user', text: 'hello' }]);
    expect(messages[0].content).toBe('hello');
  });
});

describe('what the conversation keeps', () => {
  it('records that a file was attached, not the file', () => {
    const note = attachmentNote([csv, shot]);
    expect(note).toContain('row.csv');
    expect(note).toContain('screenshot.png');
    expect(note).toContain('not kept afterwards');
    // The contents must not survive into the stored transcript.
    expect(note).not.toContain('Ann Smith');
    expect(note).not.toContain('aGVsbG8=');
  });

  it('says nothing when nothing was attached', () => {
    expect(attachmentNote([])).toBe('');
  });
});

describe('what is written to the conversation', () => {
  it('drops the attachment and keeps a note in its place', () => {
    const stored = storable([
      { role: 'user', text: 'Record this sale', attachments: [csv, shot] },
      { role: 'assistant', text: 'Done.', toolCalls: [] }
    ]);
    const user = stored[0];
    expect(user.role).toBe('user');
    if (user.role !== 'user') return;
    // No attachments survive, so no screenshots or spreadsheets in the table.
    expect(user.attachments).toBeUndefined();
    expect(user.text).toContain('Record this sale');
    expect(user.text).toContain('row.csv');
    expect(JSON.stringify(stored)).not.toContain('aGVsbG8=');
    expect(JSON.stringify(stored)).not.toContain('Ann Smith,PL2 3PD');
  });

  it('leaves messages without attachments exactly as they were', () => {
    const original: Parameters<typeof storable>[0] = [
      { role: 'user', text: 'hello' },
      { role: 'assistant', text: 'hi', toolCalls: [] }
    ];
    expect(storable(original)).toEqual(original);
  });
});

describe('what the wire accepts', () => {
  it('takes the kinds that can actually be read', () => {
    expect(attachmentSchema.safeParse(csv).success).toBe(true);
    expect(attachmentSchema.safeParse(shot).success).toBe(true);
  });

  it('refuses a kind nothing can read, however it is labelled', () => {
    for (const mediaType of [
      'application/pdf',
      'application/vnd.ms-excel',
      'video/mp4',
      'text/html'
    ]) {
      expect(
        attachmentSchema.safeParse({ ...csv, mediaType }).success,
        `${mediaType} must be refused`
      ).toBe(false);
    }
  });

  it('refuses an empty file', () => {
    expect(attachmentSchema.safeParse({ ...csv, data: '' }).success).toBe(
      false
    );
  });

  it('caps how many can arrive at once', () => {
    expect(MAX_ATTACHMENTS).toBeLessThanOrEqual(8);
  });
});
