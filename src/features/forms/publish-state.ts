// What the person is actually looking at, said once.
//
// The editor and the preview used to describe the same form in different
// words: the editor showed "Published · Version 1 published" while the preview
// showed "Draft". Both were true of different things — the FORM was published,
// and the preview was rendering the editable draft copy — but together they
// read as a contradiction, and the obvious question ("is it published or
// not?") had no answer on screen.
//
// So both now derive their wording from here. A form cannot be described two
// ways at once if there is only one description.

export interface PublishState {
  /** Short label for a badge or chip. */
  label: string;
  /** The longer line beside it, or null when the label says enough. */
  detail: string | null;
  tone: 'live' | 'draft';
}

export function publishState(input: {
  isTemplate: boolean;
  /** The highest published version number; 0 when never published. */
  revision: number;
  /** Saved edits that have not been published. */
  hasUnpublishedChanges: boolean;
  /** Edits not yet even saved. */
  dirty: boolean;
}): PublishState {
  if (input.isTemplate)
    return {
      label: 'Template',
      detail: 'Templates are copied into forms; they are not published.',
      tone: 'draft'
    };

  if (input.revision <= 0)
    return {
      label: 'Not published yet',
      detail: 'Nobody can open this form until it is published.',
      tone: 'draft'
    };

  // Published, AND edited since. This is the state the old wording lost: the
  // form is live on v1 while what you are editing is the future v2.
  if (input.hasUnpublishedChanges || input.dirty)
    return {
      label: `Editing draft · v${input.revision + 1}`,
      detail: `Version ${input.revision} stays live until you publish.`,
      tone: 'draft'
    };

  return {
    label: `Live · v${input.revision}`,
    detail: 'The draft matches the published version.',
    tone: 'live'
  };
}
