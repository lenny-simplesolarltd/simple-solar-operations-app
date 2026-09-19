# Environment variables (names only)

Never commit values. Server-only variables must never be prefixed `NEXT_PUBLIC_`.

## Required in production

| Name                            | Scope  | Purpose                                                                                    |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | public | Supabase project URL                                                                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Supabase anon key (RLS applies)                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | server | staff invitations (People & access) only; never used by the assistant                      |
| `NEXT_PUBLIC_SITE_URL`          | public | canonical origin for auth emails and links                                                 |
| `ASSISTANT_PROVIDER`            | server | `gemini` (or `anthropic`); unset = assistant off                                           |
| `GEMINI_API_KEY`                | server | Gemini key when `ASSISTANT_PROVIDER=gemini` (legacy alias `GEMENI_API_KEY`)                |
| `ASSISTANT_ACTION_SECRET`       | server | ≥ 32 characters; signs SimpleBot proposal tokens. Without it, production refuses proposals |

## Optional

| Name                                   | Scope  | Purpose                                                                           |
| -------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `GEMINI_MODEL`                         | server | overrides the default `gemini-flash-latest`                                       |
| `ANTHROPIC_API_KEY`, `ASSISTANT_MODEL` | server | when `ASSISTANT_PROVIDER=anthropic`                                               |
| `ASSISTANT_PENDING_ACTIONS`            | server | `memory` for development without the pending-actions table; production refuses it |
| `NEXT_PUBLIC_SENTRY_*`                 | public | error reporting                                                                   |

Database migrations the application expects (apply in order, after review):
`20260919180000_assistant_conversations.sql`, `20260919185000_assistant_pending_actions.sql`.
