import 'server-only';

import { PREVIEW_READ_ONLY_MESSAGE } from './config';
import { getActivePreview } from './context';

/**
 * Call at the top of EVERY operational command (server action, route handler,
 * assistant mutation). Returns the refusal message while a preview is active,
 * otherwise null. This is the write boundary: disabled buttons are cosmetic.
 */
export async function previewWriteBlock(): Promise<string | null> {
  return (await getActivePreview()) ? PREVIEW_READ_ONLY_MESSAGE : null;
}
