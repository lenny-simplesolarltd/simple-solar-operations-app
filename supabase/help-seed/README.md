# Help Center seed articles

These files are the SOURCE of the initial Help Center articles. They are not
read at runtime: `node scripts/build-help-seed.mjs` compiles them into a seed
migration, and from then on the database is the source of truth (staff edit
articles in the app, not here). The seed only ever creates articles that are
missing; it never overwrites an article that already exists.

One article per file: `articles/<slug>.md`.

## File format

```
---
slug: move-a-job
title: How to move a job
summary: One plain sentence (max 200 characters) saying what this article helps you do.
category: booking
roles: []
release_function: FN-07
routes: ["/dashboard/jobs/[jobId]/move"]
tools: ["find_job"]
keywords: ["move", "dates", "reschedule"]
aliases: ["move job", "reschedule job", "change install date"]
related: ["change-installer", "book-a-job"]
common_task: true
sort: 20
sources: ["src/app/dashboard/jobs/[jobId]/move/page.tsx", "supabase/migrations/2026...sql (MOVE_JOB)"]
---
Body in Markdown.
```

Every frontmatter value is JSON (strings quoted with double quotes, arrays in
`[...]`), except `slug`, `title`, `summary`, `category`, `release_function`
which are bare text on one line. Use `release_function: none` when no release
function applies.

- `category`: exactly one of `getting-started`, `tasks`, `jobs`, `sales`,
  `booking`, `planning`, `installation`, `commissioning`, `materials`,
  `cancellations`, `files`, `forms`, `simplebot`, `administration`.
- `roles`: who the article is for. `[]` means every member of staff. Otherwise
  role codes from `src/lib/roles.ts` (`Admin`, `Manager`, `Director`, `Office`,
  `VariationApprover`, `Surveyor`, `Finance`, `Store`, `Installer`,
  `Scaffolder`, `ReadOnly`). Restrict only when the procedure is genuinely only
  for those roles (the screen or the action is refused to everyone else).
  Explanatory articles ("What Ready to Book means") stay `[]`.
- `release_function`: the `FN-xx` release function that must be switched on for
  the procedure to work, or `none`.
- `routes`: app routes this article helps with, written exactly as the folder
  under `src/app` (`/dashboard/jobs/[jobId]/move`).
- `tools`: SimpleBot tool names (from `src/features/assistant/server/tools`)
  that can genuinely help with this task. Only tools registered as AVAILABLE.
  Usually `[]` or a read tool such as `find_job`.
- `aliases`: the words staff would actually type or say, including loose
  wording ("move job", "customer cancelling", "cant finish job").
- `related`: slugs of related articles (they may be written by someone else;
  unknown slugs are reported by the build script).
- `common_task`: true for the dozen or so tasks staff do most.
- `sources`: where each fact was verified. Editor-only; never shown to staff.

## Body rules

Allowed Markdown only: `## Heading`, `### Heading`, paragraphs, numbered lists,
`-` bullets, `**bold**`, `[text](/help/<slug>)` and `[text](/dashboard/...)`
links, and `> **Warning:** ...` / `> **Note:** ...` callouts. No HTML, no
images, no tables, no code blocks, no external links.

Structure (skip a section when it has nothing useful to say):

```
Short explanation: one or two sentences.

## Before you start
## Steps
1. Open ...
2. Choose ...
## What happens next
## If you can't do it
## Related   <- do NOT write this; related links are generated from `related`.
```

## Writing style

- For ordinary office, survey, store and installation staff. Not developers.
- Plain British English. Short sentences. Numbered steps. 120-350 words.
- Use the exact labels on the screen, in **bold**: menu names, buttons, tabs.
- Never mention command names, RPCs, SQL, tables, RLS, migrations, "expected
  version", error codes or file paths in the body.
- Say "switched on / switched off" for release functions. If a feature is
  behind a release function, include under "If you can't do it": "This feature
  may not be switched on yet. Ask an administrator."
- Describe only what the application does TODAY. If a screen or button does not
  exist, do not describe it. If something is unfinished, leave it out and list
  it in your report.
- Refusals: explain the real reasons the system refuses (wrong role, wrong job
  stage, installer conflict, missing prerequisite) using the wording staff see.
