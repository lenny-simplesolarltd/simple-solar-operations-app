// Staff- and recipient-facing wording for Forms refusals (codes raised by the
// database). Safe to import anywhere.

const MESSAGES: Record<string, string> = {
  FORMS_PERMISSION_DENIED: 'You do not have permission to do that with forms.',
  FORMS_NOT_FOUND: 'That form could not be found.',
  FORMS_STALE_VERSION:
    'Someone else changed this form since you opened it. Reload to see their changes; nothing was saved.',
  FORMS_INVALID_DEFINITION:
    'The form has a problem that needs fixing before it can be saved.',
  FORMS_INVALID_TITLE: 'Give the form a title of up to 200 characters.',
  FORMS_INVALID_KIND: 'That is not a kind of form.',
  FORMS_ONE_SOURCE_ONLY: 'Start from a template or from a form, not both.',
  FORMS_SOURCE_NOT_FOUND: 'The form or template to copy could not be found.',
  FORMS_SOURCE_NOT_TEMPLATE: 'That is not a template.',
  FORMS_TEMPLATE_ARCHIVED: 'That template is archived. Restore it first.',
  FORMS_TEMPLATE_NO_JOB: 'Templates are not linked to jobs.',
  FORMS_JOB_NOT_FOUND: 'That job could not be found, or you cannot see it.',
  FORMS_ARCHIVED: 'This form is archived. Restore it before editing.',
  FORMS_TEMPLATE_NOT_PUBLISHABLE:
    'Templates are not published. Create a form from it instead.',
  FORMS_NOT_PUBLISHABLE_STATUS:
    'This form cannot be published in its current state. Reopen it first.',
  FORMS_NO_QUESTIONS: 'Add at least one question before publishing.',
  FORMS_NO_CHANGES: 'Nothing has changed since the last published version.',
  FORMS_INVALID_STATUS_CHANGE:
    'That change of status is not possible from here.',
  FORMS_TEMPLATE_NOT_SENDABLE:
    'Templates cannot be sent. Create a form from it first.',
  FORMS_NOT_PUBLISHED: 'Publish the form before creating a link.',
  FORMS_NOT_LINKABLE:
    'This form has photo or lookup questions, which need a signed-in person. It can be completed in the app, but not sent as a recipient link.',
  FORMS_REVISION_NOT_FOUND:
    'The version of this form being answered no longer exists. Reload the page and try again.',
  FORMS_CUSTOMER_NEEDS_JOB: 'Choose the job whose customer this is for.',
  FORMS_SURVEYOR_NOT_FOUND: 'Choose an active surveyor.',
  FORMS_RECIPIENT_LABEL_REQUIRED: 'Say who this link is for.',
  FORMS_INVALID_RECIPIENT_TYPE: 'Choose who this link is for.',
  FORMS_INVALID_RECIPIENT_LABEL: 'The recipient name is too long.',
  FORMS_INVALID_EXPIRY: 'Choose an expiry date in the future, within a year.',
  FORMS_INVITATION_NOT_FOUND: 'That link could not be found.',
  FORMS_ALREADY_REVOKED: 'That link has already been revoked.',
  FORMS_ALREADY_SUBMITTED:
    'That link has already been used to submit a response.',
  FORMS_INVALID_REASON: 'The reason is too long.',
  FORMS_LINKS_NOT_CONFIGURED:
    'Recipient links are not set up on this server yet (FORMS_LINK_SECRET). Nothing was created.',
  FORMS_REQUIRED_MISSING: 'Please answer the required questions.',
  FORMS_INVALID_ANSWER: 'Please check your answers.',
  FORMS_UNKNOWN_FIELD: 'This form has changed. Reload the page and try again.',
  R1A_COMMAND_CONFLICT:
    'That request was already used for a different change. Try again.',
  PREVIEW_MODE_READ_ONLY:
    'Preview mode is read-only. Return to your own account to make changes.'
};

export function formsMessage(code: string): string {
  return (
    MESSAGES[code] ?? 'Something went wrong. Nothing was changed. Try again.'
  );
}
