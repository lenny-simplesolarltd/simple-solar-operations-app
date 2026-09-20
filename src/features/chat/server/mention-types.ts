// The suggestion shape, split out so client components can import it without
// pulling the server-only search module into the browser bundle.
export type MentionKind = 'person' | 'job' | 'task';

export interface MentionSuggestion {
  kind: MentionKind;
  id: string;
  /** What goes into the message when chosen. */
  insert: string;
  /** What the menu shows. */
  label: string;
  detail: string | null;
}
