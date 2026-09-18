# Simple Solar Operations

Internal operations application for Simple Solar.

This repository has been cleaned down to a minimal application shell. The
operations workflows, Supabase schema and Supabase Auth have not been built
yet.

## Stack

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS v4, shadcn/ui (Radix)
- React Hook Form + Zod
- Supabase (Postgres, Auth, Storage, RLS) - not wired up yet
- Sentry (optional, enabled when `NEXT_PUBLIC_SENTRY_DSN` is set)
- Deployed on Vercel

## Routes

| Route           | Purpose                                      |
| --------------- | -------------------------------------------- |
| `/`             | Redirects to `/dashboard` or `/auth/sign-in` |
| `/auth/sign-in` | Email + password sign-in (Supabase Auth)     |
| `/dashboard`    | Temporary authenticated application shell    |

## Authentication and identity

Supabase Auth, invite-only (public sign-up is disabled). `src/lib/auth.ts` is
the single place the app resolves the current user:

```
session -> auth.uid() -> people.auth_user_id -> person_roles -> RLS
```

- `people` may exist without a login; `person_roles` is the only role authority.
- A login links to the person whose email it has **verified**. Nothing creates
  logins automatically - invite the people who need access.
- It fails closed: a session that is not an active person with at least one
  active role has no access.
- The schema lives in `supabase/migrations`, the staff directory in
  `supabase/seeds`. Business semantics are ported from the reference
  implementation; see the header of each migration for citations.

## Getting started

The app runs against the **hosted** Supabase project with real Supabase Auth.

```bash
npm install
# .env needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# (Supabase dashboard > Project Settings > API keys)
npm run dev
```

Accounts are invite-only: create the login in Supabase Auth with the person's
work email; it links to their `people` row automatically once the email is
verified. People without a login stay in the directory for scheduling and tasks.

Schema changes are migrations in `supabase/migrations`, applied with
`supabase db push`. The local Supabase stack (`supabase start`, ports 5532x) is
used **only** by the automated tests, which reset it - never point tests at hosted.

## Scripts

- `npm run dev` - start the dev server
- `npm run build` - production build
- `npm run typecheck` - TypeScript check
- `npm run lint` - ESLint
- `npm run format` - Prettier
- `npm run test:db` - reset the LOCAL database and run the identity + Job Sold integration tests
- `npm run test:unit` - designer calculation tests
- `npm run db:types` - regenerate `src/types/database.ts` from the local schema

## Project structure

```
src/app            routes (/, /auth/sign-in, /dashboard)
src/components/ui  shadcn/ui components
src/components     layout shell, form field wrappers, data table, kbar
src/hooks          generic hooks
src/lib            utilities and the auth placeholder
```

UI scaffolding derived from next-shadcn-dashboard-starter (MIT, see `LICENSE`).
