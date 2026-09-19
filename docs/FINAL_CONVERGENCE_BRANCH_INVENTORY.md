# Final convergence: branch inventory

Taken 2026-09-20 after `git fetch origin --prune`, before any merge.
Baseline: `origin/feature/dev` = `685039d` (PR #5). "Ahead/behind" is against
that baseline. "Contained" = an ancestor of `feature/help-center` `0179c81`
(checked with `git merge-base --is-ancestor` for every local and remote
branch: **all of them are contained**, so nothing was merged twice and no
branch holds unique work outside the converged tip).

| Branch | SHA | Ahead / behind | Migrations added | What it holds | Superseded by | Unique work | Merge? |
|---|---|---|---|---|---|---|---|
| `feature/p0-audit-health` | `aa219cb` | +3 / 0 | 202000, 202100 | audit coverage, backup evidence, health, `/api/health` | `p0-r1-integration` | no | via integration |
| `feature/p0-evidence` | `5a31dfd` | +3 / 0 | 183000 | registered uploads, metadata Storage policies, open/download | `p0-r1-integration` | no | via integration |
| `feature/p0-r1-completion` | `cf0cefb` | +4 / 0 | 210000 | COMMISSIONING_RECORD, job-level calls, Operations tab | `p0-r1-integration` | no | via integration |
| `feature/p0-r1-integration` | `298b3fb` | +19 / 0 | the three above + 220000 | P0 reconciliation, cancellation UI, E2E | local `feature/dev` `3429fdc` | no | contained |
| `feature/auth-login-ux` | `379fa7a` | +1 / 0 | - | sign-in UX, Google button | local `feature/dev` | no | contained |
| `feature/gemini-assistant-live` (local) | `67d854f` | +2 / 0 | - | Gemini key alias, "SimpleBot" name | `simplebot-conversations` | no | contained |
| `origin/feature/gemini-assistant-live` | `61a295d` | +1 / 0 | - | Gemini key alias | local branch above | no | contained |
| `feature/simplebot-conversations` | `6b2d322` | +7 / 0 | 180000, 185000 | persistent owner-only conversations, durable pending actions (BD-07/09) | `forms-builder`, `feature/dev` | no | contained |
| `feature/forms-builder` | `e8b289f` | +13 / 0 | + 190000 | Forms v1, SimpleBot Forms tools, FN-21 gate; already contains SimpleBot (merge `ed9bb58`) | `feature/dev` | no | contained |
| local `feature/dev` = `origin/convergence/feature-dev` | `3429fdc` | +36 / 0 | 8 | P0 integration + auth + SimpleBot + Forms merged by an earlier session | `help-center` | no | contained |
| `feature/help-center` | `0179c81` | +38 / 0 | + 100000, 100100 | database Help Center, 80 seeded articles, SimpleBot help tools; built on `3429fdc` | - | **yes (tip)** | fast-forward base of `feature/final-convergence` |
| `feature/quotes-documents` | `3bf954f` | 0 / 18 | - | older assistant branch (quote tools planned only) | `feature/dev` history | no | no |
| `feature/assistant-gemini`, `feature/ai-assistant` | `1110f4f`, `ddf8edf` | 0 / 19, 0 / 21 | - | earlier assistant work | merged (PRs #1-#3) | no | no |
| `feature/dev-user-preview` | `f8472cd` | 0 / 20 | - | View-as-user (local only hook) | merged (PR #2) | no | no |
| `feature/appsheet-view-port` | `7c1b417` | 0 / 1 | - | view-port reads, booking crash fix | merged (PR #5) | no | no |
| `feature/identity-auth-job-sold`, `foundation/identity` | `3544a79`, `ec1d3b5` | 0 / 26, 0 / 31 | - | identity and Job Sold foundation | in `main` | no | no |
| `main` / `origin/main` | `ff2b03a` | 0 / 1 | - | stable | - | - | **not touched** |

No "frontend / AppSheet parity" branch existed: that work was done in this
convergence (see `APPSHEET_FRONTEND_PARITY.md`). The Help Center stream was
finished (clean worktree, idle session) and is the fast-forward base.

## Worktrees found

`simple-solar-operations-app` (feature/dev), `simple-solar-ai-assistant`
(quotes-documents), `simple-solar-appsheet-audit`, `simple-solar-auth-login-ux`,
`simple-solar-dev-user-preview`, `simple-solar-help-center`,
`simple-solar-p0-audit-health`, `simple-solar-p0-evidence`,
`simple-solar-p0-r1-completion`, `simple-solar-p0-r1-integration`. None were
modified by the convergence. Convergence worktree:
`/Users/lennybeadle/simple-solar-final-convergence` (`feature/final-convergence`).

## Expected conflicts (found none textual)

Because every branch is an ancestor of `0179c81`, the convergence is a
fast-forward. Semantic conflicts were checked instead (database types stale
against 45 migrations, test ordering, fallback handling, release_modes write
path) - see `FINAL_CONVERGENCE_REPORT.md`.

## Safe to archive after `feature/dev` carries the converged state

All branches in the table except `main`: each is fully contained. Deletion is
the owner's decision; nothing was deleted.
