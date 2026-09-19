# Forms: architecture (v1)

Staff build forms and templates in a visual builder, publish immutable versions, send secure links
to customers, surveyors or others, and read responses. SimpleBot can do the same through typed tools.
**Both use one domain layer** - there are no SimpleBot-only rules.

```
Manual builder (server actions) ─┐
                                 ├─> Forms service (src/features/forms/server/service.ts)
SimpleBot tools (propose/confirm)┘      reads: RLS as the signed-in user
                                        writes: public.execute_command -> app.cmd_forms_*
Recipient page /f/<token> ──────────> public.forms_public_open / forms_public_submit
```

## Data (migration `20260919190000_forms.sql`)

| Table              | Meaning                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `forms`            | a form (`draft` → `published` → `closed`/`archived`) or a template (`active`/`archived`). `definition` is the editable **draft** |
| `form_revisions`   | **immutable** snapshot per publish (v1, v2 ...). Update/delete refused by trigger, even for the service role                     |
| `form_invitations` | one recipient link bound to **one revision**; revocable, optional expiry; stores only `sha256(token)`                            |
| `form_submissions` | **immutable**, one per link, answers keyed by that revision's field ids                                                          |

A response is always read against the revision it answered. Editing a published form edits the
draft; publishing makes a new revision; existing links keep theirs. Templates are copied into
forms (and forms into templates): copies are independent.

The definition is declarative JSON: `{fields: [{id, type, label, help?, required?, options?, min?,
max?, condition?}]}`. Field types: short/long text, email, phone, number, currency, date, time,
yes/no, single/multiple choice, dropdown, rating scale (0/1 to 2-10), address, confirmation,
section heading, text block. Conditions are declarative (`equals`, `not_equals`, `includes`,
`answered`) and may only refer to an earlier question - nothing is ever executed.
`app.forms_validate_definition` and `app.forms_validate_answers` enforce the rules in the
database; `src/features/forms/definition.ts` mirrors them for the builder, preview and SimpleBot.

## Commands (registered in `app.command_registry`, module `forms`)

`FORMS_CREATE`, `FORMS_UPDATE_DRAFT`, `FORMS_PUBLISH`, `FORMS_SET_STATUS`,
`FORMS_INVITATION_CREATE`, `FORMS_INVITATION_REVOKE`. Through `public.execute_command` they get the
command core's actor resolution, single-transaction semantics, `commands` idempotency (same
`command_id` = replay, never a second form or link) and audit context (`app.audit`, one event per
change; submissions are audited by id only, never their answers). Drafts use optimistic
concurrency (`expected_version`): a stale save is refused, not merged.

## Permissions (`role_permissions`)

| Permission                                                                            | Admin | Manager | Office | Director |
| ------------------------------------------------------------------------------------- | :---: | :-----: | :----: | :------: |
| `forms.read`                                                                          |   ✓   |    ✓    |   ✓    |    ✓     |
| `forms.create`, `forms.edit`, `forms.publish`, `forms.send`, `forms.templates.manage` |   ✓   |    ✓    |   ✓    |          |
| `forms.responses.read`                                                                |   ✓   |    ✓    |   ✓    |    ✓     |

Handlers check the permission (`app.has_permission`); RLS limits reads. Surveyors, Installers and
others have no Forms administration: they receive forms through links. Linking a job never grants
anything; a job can only be linked if the staff member can see it.

## Recipient links

`token = base64url(HMAC-SHA256(FORMS_LINK_SECRET, "form-invitation:" + link id))` - 256 bits, never
stored (the database keeps its SHA-256, and the column is not readable by clients). Staff with
`forms.send` re-derive a link on demand ("Copy link"). The recipient page calls two
`SECURITY DEFINER` functions with the raw token: malformed and unknown tokens are `not_found`;
revoked, expired, closed and already-submitted links say so; answers are validated against the
revision in the database, unknown fields are refused, hidden answers dropped, size capped; a
repeated submission id is recognised (double-click), a second submission refused. No service-role
key is used anywhere in Forms. There is **no email/SMS delivery** yet: the link is copied and sent
by the staff member, and nothing claims delivery.

## SimpleBot

Read tools: `list_forms`, `get_form`, `list_form_responses`, `get_form_response` (email, phone and
address answers withheld from the model). Mutation tools (each a proposal the staff member
confirms; the confirmed action id is the command id): `create_form`, `edit_form_draft`,
`publish_form`, `save_form_as_template`, `create_form_link`, `revoke_form_link`,
`set_form_status`. Edits re-read the form when proposed and save against that version. The model
never receives a link or token; cards show "Copy link", which asks the server when pressed.
Confirmed/cancelled outcomes are recorded in the stored conversation.

## Not in v1 (decisions needed)

- **File/photo uploads**: needs a storage decision (see the report). The existing `evidence` bucket
  is authenticated-only and job-scoped; recipients are anonymous.
- **Drawn signatures**; staff-authenticated (internal) forms; autosave/"started" state.
- **Email/SMS delivery** (no approved sender); **Forms release gate**; **retention**.
