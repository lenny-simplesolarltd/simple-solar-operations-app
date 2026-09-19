// Staff wording for Help Center refusals. Safe to import from client components.

const MESSAGES: Record<string, string> = {
  HELP_PERMISSION_DENIED:
    'You do not have permission to do that in the Help Center.',
  HELP_NOT_FOUND: 'That article no longer exists.',
  HELP_STALE_VERSION:
    'Someone else changed this article while you were editing. Reload it, then make your change again.',
  HELP_SLUG_TAKEN: 'Another article already uses that web address.',
  HELP_INVALID_SLUG:
    'The web address may only use lower-case letters, numbers and single hyphens.',
  HELP_SLUG_FIXED:
    'The web address of a published article cannot change, because other articles and SimpleBot link to it.',
  HELP_INVALID_TITLE: 'The title must be between 3 and 160 characters.',
  HELP_INVALID_SUMMARY: 'The summary must be 300 characters or fewer.',
  HELP_INVALID_BODY: 'The article text must be 20,000 characters or fewer.',
  HELP_INVALID_CATEGORY: 'Choose one of the listed categories.',
  HELP_INVALID_AUDIENCE_ROLES: 'One of the roles is not a real role.',
  HELP_INVALID_RELEASE_FUNCTION:
    'A release function looks like FN-07 (FN and two digits).',
  HELP_INVALID_ROUTES:
    'Screens must be app addresses starting with /dashboard, for example /dashboard/jobs/[jobId]/move.',
  HELP_INVALID_TOOLS:
    'SimpleBot tool names use lower-case letters, numbers and underscores.',
  HELP_INVALID_KEYWORDS:
    'Each keyword must be 80 characters or fewer (60 at most).',
  HELP_INVALID_ALIASES:
    'Each search phrase must be 80 characters or fewer (60 at most).',
  HELP_INVALID_RELATED_SLUGS:
    'Related articles must be article web addresses, and an article cannot be related to itself.',
  HELP_INVALID_SORT_ORDER: 'Order must be a whole number from 0 to 10000.',
  HELP_INVALID_CHANGE_NOTE: 'The change note must be 500 characters or fewer.',
  HELP_ARCHIVED: 'This article is archived. Restore it first.',
  HELP_NOT_ARCHIVED: 'This article is not archived.',
  HELP_NOT_PUBLISHED: 'Only a published article can be marked as reviewed.',
  HELP_NO_CHANGES: 'There are no changes to publish.',
  HELP_CATEGORY_REQUIRED: 'Choose a category before publishing.',
  HELP_SUMMARY_REQUIRED: 'Write a short summary before publishing.',
  HELP_BODY_REQUIRED: 'Write the article before publishing.',
  HELP_REVISION_NOT_FOUND: 'That revision does not exist.',
  PREVIEW_MODE_READ_ONLY:
    'You are previewing as another person, so nothing can be changed.',
  R1A_INVALID_FIELDS:
    'Something in the form was not recognised. Reload and try again.'
};

export function helpMessage(code: string): string {
  return (
    MESSAGES[code] ?? 'Something went wrong. Nothing was changed. Try again.'
  );
}
