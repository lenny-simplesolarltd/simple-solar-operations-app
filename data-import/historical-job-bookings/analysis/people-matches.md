# People matching — historical Job Booking export

Generated from the dry run. Do not edit by hand.

Historical staff values come from `Installers` (col 7), `Sparky` (col 31),
`2nd Sparky` (col 88) and `Salesman` (col 47). They are matched against
`public.people` on trimmed, case-folded, whitespace-normalised names.

The matcher fails closed. A value that could mean two people is never
resolved by picking one, and no `people` row is ever created automatically.

Merchant contacts (`Merchant Name`, `Merchant Email`) and scaffolder
addresses are supplier contacts, not staff, and are excluded from matching.
The shared `info@` mailbox is excluded: it is not an actor in this system.

**17 distinct staff values.**

| Classification | Distinct values | Rows affected |
| --- | --- | --- |
| EXACT MATCH | 0 | 0 |
| SAFE NORMALISED MATCH | 7 | 353 |
| AMBIGUOUS | 3 | 184 |
| NO MATCH | 7 | 75 |
| NON-PERSON VALUE | 0 | 0 |

## Exact match

The value equals a person's full display name or email address.

_None._

## Safe normalised match

The value is a first name held by exactly one active person. Safe to use.

| Value | Rows | Resolves to |
| --- | --- | --- |
| `James` | 169 | — |
| `John` | 88 | — |
| `Robbie` | 31 | — |
| `Mike` | 28 | — |
| `Ben` | 25 | — |
| `Anne` | 9 | — |
| `Josh` | 3 | — |

## Ambiguous — owner decision required

More than one active person could be meant, or the value matches only as a surname. These are never resolved automatically.

| Value | Rows | Resolves to |
| --- | --- | --- |
| `Lewis` | 112 | Josh Lewis |
| `Dave` | 65 | Dave Hopwood **or** Dave Gorman |
| `Dan` | 7 | Dan Barnes **or** Dan Anderson |

## No match — owner decision required

No active person carries this name. These may be former staff, subcontractors, or aliases. No `people` row is created automatically.

| Value | Rows | Resolves to |
| --- | --- | --- |
| `Des` | 54 | — |
| `Ben Q` | 8 | — |
| `Chris` | 5 | — |
| `Travis` | 4 | — |
| `Ryan` | 2 | — |
| `Jordan` | 1 | — |
| `Matt` | 1 | — |

## Non-person values

Placeholders written into a staff box.

_None._

## Effect on the import

`jobs.salesperson_id` is `NOT NULL`, so an unresolved salesperson blocks the
whole row. An unresolved installer or electrician does not block the job — it
blocks only that allocation, and the row goes to owner review.

See `owner-decisions.md`, decision 4, for the questions this raises.
