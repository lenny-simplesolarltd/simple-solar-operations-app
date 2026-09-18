# Developer "View as user" preview

Development/testing only. Lets a named developer-Admin see the application as
another member of staff - dashboard, navigation, jobs, tasks, My tasks,
permissions, Assistant - **read-only**, without ever knowing, setting or
resetting that person's password. It is **not** production impersonation.

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

## Why it cannot be on in production

`getPreviewRuntime()` fails closed unless ALL hold: `NODE_ENV !== 'production'`
(and not a Vercel production deployment); `DEV_USER_PREVIEW_ENABLED=true`
(server-only; a `NEXT_PUBLIC_*` flag is ignored); `NEXT_PUBLIC_SUPABASE_URL` is a
local stack; the local JWT secret is present; and the signed-in **Admin's email
is on the allow-list** (Admin alone is not enough). Independently, the hosted
database has no hook, and the hosted JWT secret is not available to the app - so
even a bug in the gate could not produce a preview there.

## Forgery resistance

The `ss_dev_preview` cookie is HttpOnly, SameSite=Lax, session-only, and carries
only `targetPersonId.expiry.HMAC`, keyed to the real auth user. Editing the
person or expiry, appending roles, reusing another account's cookie, or
hand-making one fails verification; query strings and localStorage are never
read. Every request re-decides from scratch; sign-out deletes the cookie.

## Writes are blocked at three layers

1. Command boundary: every server action / route handler calls
   `previewWriteBlock()` first -> "Preview mode is read-only. Return to your own
   account to make changes." (UI may still show the action.)
2. The preview data client is a proxy that throws on insert/update/upsert/delete,
   non-read RPCs, auth and storage.
3. Database: the hook adds statement triggers that raise
   `PREVIEW_MODE_READ_ONLY` for any write carrying a preview token.
   The Assistant offers no mutation tools in preview and its confirm endpoint
   returns 403.

**New commands must call `previewWriteBlock()` at the top.**

## Use it

```bash
supabase start && npm run dev:preview:install
# .env.local: local NEXT_PUBLIC_SUPABASE_URL / ANON_KEY + the three DEV_USER_PREVIEW_* values
npm run dev     # header -> "View as: Myself"
```

## Limits (where preview differs from a genuine login)

- Local stack only; it cannot preview against hosted data.
- Read-only: nothing that needs a write (draft autosave is browser-local and is
  per REAL person) is exercised as the target.
- Auth-level behaviour is not reproduced: the target's session, MFA, password
  state, email links, last-sign-in.
- `created_by`/audit attribution is never the target (nothing is written).
- A person with no active role cannot be previewed (they have no access anyway).
