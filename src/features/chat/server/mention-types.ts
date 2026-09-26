// The suggestion shape, split out so client components can import it without
// pulling the server-only search module into the browser bundle.
import type { ChatTagKind } from '../types';

/** A colleague, or one of the things a message can carry a tag for. */
export type MentionKind = 'person' | ChatTagKind;

export interface MentionSuggestion {
  kind: MentionKind;
  id: string;
  /** What goes into the message when chosen. */
  insert: string;
  /** What the menu shows. */
  label: string;
  detail: string | null;
}
