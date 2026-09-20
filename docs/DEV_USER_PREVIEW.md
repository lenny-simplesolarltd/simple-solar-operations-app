# Developer "View as user" preview

Lets a **named, allow-listed developer-Admin** see the application as another
member of staff - dashboard, navigation, jobs, tasks, My tasks, permissions,
Assistant - **read-only**, without ever knowing, setting or resetting that
person's password. It is **not** general impersonation: role alone never grants
it, and it can never write.

It runs in two modes, with different database mechanisms:

| Mode       | When                                                                  | How the database is told                             |
| ---------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| **local**  | development against a local Supabase stack                            | dev-only hook, JWT claim (not a migration)           |
| **hosted** | the deployed app, only under `DEV_USER_PREVIEW_ALLOW_PRODUCTION=true` | signed request header the database re-derives itself |

## Two actors, never merged

|                     | Who                                                                       | Used for                                                                      |
| ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| authenticated actor | the real Supabase session (`getAuthenticatedUser()`, `getSessionState()`) | every security decision, starting/ending preview, anything that writes, audit |
| effective actor     | the previewed person (`getCurrentUser()`, `user.preview` set)             | presentation + read authorization only                                        |

Production authority is unchanged: `auth.uid() -> people.auth_user_id -> person_roles -> permissions/RLS`.

## How visibility is honest (not cosmetic)

RLS resolves identity through `app.current_person_id()`, which reads the signed
JWT. A React-only switch would show the developer's own (Admin) rows under
someone else's name. Instead:

1. `supabase/dev/user_preview_hook.sql` - **not a migration**, installed only
   into the LOCAL stack by `npm run dev:preview:install` and wiped by every
   `supabase db reset` - makes `app.current_person_id()` honour a
   `preview_person_id` claim. `supabase db push` can never ship it to hosted.
2. The dev server mints a 2-minute JWT (`sub` = the REAL auth user,
   `preview_person_id` = target) with the local stack's JWT secret. The browser
   never holds that secret, so it cannot forge the claim; PostgREST rejects a
   badly signed token before any SQL runs.
3. The database re-checks: the real `sub` must be an active Admin and the target
   an active person - otherwise identity resolves to **nobody** (never to the
   real user). Roles/permissions are always read from `person_roles` /
   `role_permissions` for the target; none travel in the cookie or token.
4. All read queries go through `createDataClient()`; pages and Assistant read
   tools share the same query modules, so both see exactly what the real RLS
   policies return for the target.

## Production: two doors, both server-only

`getPreviewRuntime()` fails closed unless ALL hold:

- `DEV_USER_PREVIEW_ENABLED=true`, exactly that string;
- in a production runtime or a Vercel production deployment, **also**
  `DEV_USER_PREVIEW_ALLOW_PRODUCTION=true`, exactly that string. Absent, empty,
  `1`, `TRUE` or anything else refuses production exactly as before;
- Supabase is a local stack, **unless** production has been explicitly allowed;
- the signing secret is present (>= 32 chars);
- the allow-list is non-empty.

And then, per request, `mayStartPreview()` requires the **real** signed-in
person to hold `Admin` **and** to be named in `DEV_USER_PREVIEW_ALLOWED_EMAILS`.
Neither is a `NEXT_PUBLIC_*` value, so the browser cannot influence either.

Independently of all of that, the hosted database refuses unless it can itself
verify the request (below). Both flags off is the safe default, and setting
`DEV_USER_PREVIEW_ALLOW_PRODUCTION=false` ends every live preview on the very
next request.

## The hosted mechanism, and why the local hook is NOT it

The local hook trusts a `preview_person_id` claim inside the JWT. Using it in
production would mean giving the app **Supabase's own JWT signing secret** - a
secret that can mint a session for any user in the project. That is not migrated
and never will be.

Instead, in hosted mode (`supabase/migrations/20260920140000_dev_preview_hosted.sql`):

1. The request authenticates **completely normally**, with the developer's own
   Supabase session. `auth.uid()` is, and stays, the developer.
2. The server adds one header, `x-ss-dev-preview: v1.<person>.<expiry>.<hmac>`,
   signed with `DEV_USER_PREVIEW_JWT_SECRET` and bound to that developer's auth
   id. The browser never holds the secret, so it cannot mint, edit or extend one.
3. `app.current_person_id()` resolves to the target **only** when all four hold,
   and otherwise to **nobody** - never to the developer, so a half-working
   preview can never quietly show the developer their own Admin data under
   someone else's name:
   - **the transaction is READ ONLY** (PostgREST uses read-only transactions for
     GET and for `STABLE`/`IMMUTABLE` rpc calls). This one condition is what
     makes hosted preview physically incapable of writing: a write transaction
     resolves the actor to nobody, so RLS refuses it rather than writing as the
     target. No triggers, no application table touched, no other schema affected;
   - the real user is an active **Admin** _and_ is listed in
     `app_preview.allowed_developers` - the allow-list is enforced by the
     database too, not only by the app's env var;
   - the proof's HMAC is reproducible with the secret in `app_preview.config`,
     names that exact developer and target, and has not expired (2 minutes);
   - the target is an active person.
4. Roles and permissions are never in the proof: they are read from
   `person_roles` / `role_permissions` for the target, as for anybody else.

Nothing in that migration grants a write, weakens an RLS policy, or uses
`service_role`. `app_preview` is not an exposed schema, so neither table is
readable or writable through the API. **The migration ships preview switched
off**: both tables are empty, and an empty `app_preview.config` means every
preview resolves to nobody.

## Turning it on for one developer, in production

1. Add the four variables to Vercel (Production scope, plain env vars, **not**
   `NEXT_PUBLIC_*`): `DEV_USER_PREVIEW_ENABLED=true`,
   `DEV_USER_PREVIEW_ALLOW_PRODUCTION=true`,
   `DEV_USER_PREVIEW_ALLOWED_EMAILS=<your email>`,
   `DEV_USER_PREVIEW_JWT_SECRET=$(openssl rand -base64 48)`.
2. In the hosted SQL editor, store the SAME secret and name the account:
   ```sql
   insert into app_preview.config (only_row, secret) values (true, '<the same secret>')
     on conflict (only_row) do update set secret = excluded.secret, updated_at = now();
   insert into app_preview.allowed_developers (auth_user_id, note)
   select u.id, 'developer preview'
     from auth.users u where u.email = '<your email>'
     on conflict (auth_user_id) do nothing;
   ```
3. Redeploy so the runtime picks the variables up.
4. To switch it off: set `DEV_USER_PREVIEW_ALLOW_PRODUCTION=false` (immediate),
   and/or `delete from app_preview.config;`. Either alone is sufficient.

## Forgery resistance

The `ss_dev_preview` cookie is HttpOnly, SameSite=Lax, `Path=/`, `Secure` in
hosted mode, expires in 30 minutes there (8 hours locally), and carries only
`targetPersonId.expiry.HMAC`, keyed to the real auth user. Editing the
person or expiry, appending roles, reusing another account's cookie, or
hand-making one fails verification; query strings and localStorage are never
read. Every request re-decides from scratch; sign-out deletes the cookie.

## Writes are blocked at three layers

1. Command boundary: every server action / route handler calls
   `previewWriteBlock()` first -> "Preview mode is read-only. Return to your own
   account to make changes." (UI may still show the action.)
2. The preview data client is a proxy that throws on insert/update/upsert/delete,
   non-read RPCs, auth and storage.
3. Database. Locally, the hook adds statement triggers that raise
   `PREVIEW_MODE_READ_ONLY` for any write carrying a preview token. In hosted
   mode, a write transaction resolves the actor to **nobody**, so RLS refuses
   the write instead of performing it as the target. The Assistant offers no
   mutation tools in preview, `resolvePendingAction()` refuses at the choke
   point, and the durable pending-action store refuses to register or claim.

**New commands must call `previewWriteBlock()` at the top.** The guarded choke
points today are `runCommand`, the Forms and Help `command()` helpers,
`conversationRequest({write:true})`, `resolvePendingAction`, the pending-action
store, `beginEvidenceUpload` / `completeEvidenceUpload`, `submitPresale`,
`inviteStaff`, `updatePassword` and `submitPublicFormAction`.

## Use it

```bash
supabase start && npm run dev:preview:install
# .env.local: local NEXT_PUBLIC_SUPABASE_URL / ANON_KEY + the DEV_USER_PREVIEW_* values
#   (locally, DEV_USER_PREVIEW_JWT_SECRET is the local stack's JWT secret and
#    DEV_USER_PREVIEW_ALLOW_PRODUCTION stays false/absent)
npm run dev     # header -> "View as: Myself"
```

For production, see "Turning it on for one developer" above.

## Auditability

`logPreviewEvent()` writes a structured line to the platform log (Vercel runtime
logs) on start, end and refusal: real person id, real auth user id, real email,
previewed person id, mode, timestamp, request IP and user agent. It is
deliberately NOT an `audit_events` row: that table records changes to business
data, and a preview never makes one - no audit event may imply the previewed
person did something. Secrets, cookies and proofs are never logged.

## Limits (where preview differs from a genuine login)

- Hosted preview reads only through paths that use read-only transactions
  (`createDataClient()` selects and `STABLE` read RPCs). A read served by a
  `VOLATILE` function would resolve to nobody and return nothing - safe, but
  empty.
- Read-only: nothing that needs a write (draft autosave is browser-local and is
  per REAL person) is exercised as the target.
- Auth-level behaviour is not reproduced: the target's session, MFA, password
  state, email links, last-sign-in.
- `created_by`/audit attribution is never the target (nothing is written).
- A person with no active role cannot be previewed (they have no access anyway).
