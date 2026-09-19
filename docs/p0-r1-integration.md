# P0 / R1 integration

`feature/p0-r1-integration` combines the three P0 backend streams on top of
`origin/feature/dev` `685039d`:

| Order | Branch | Head | What it brings |
|---|---|---|---|
| 1 | `feature/p0-audit-health` | `aa219cb` | audit triggers restored (26 required tables), audit coverage, backup / restore evidence, health states, `/api/health`, System Health |
| 2 | `feature/p0-evidence` | `5a31dfd` | registered uploads, metadata-based Storage policies, cross-job refusal, open / download |
| 3 | `feature/p0-r1-completion` | `cf0cefb` | `COMMISSIONING_RECORD`, job-level calls, `JOB_OPERATIONS`, Operations tab |

Integration fixes live in `20260919220000_p0_r1_integration.sql` and the commits
after the three merges. No agent migration was renumbered or edited. Filename
order (Evidence 183000 -> audit 202000/202100 -> R1 210000 -> integration
220000) is valid: every function each one replaces exists by then, and the
catalogue rename chain uses distinct suffixes (`_pre_evidence`, `_pre_ops`,
`_pre_r1_completion`, `_pre_integration`).

## Overlap ledger and resolutions

| Overlap | Streams | Resolution |
|---|---|---|
| `docs/backend-port.md` table, `src/lib/supabase/data.ts` preview allow-list | all | both sides kept (`list_evidence` and the read-only `cancellation_preview`) |
| `EvidenceField` API (`jobId` -> `context` + `category`) | Evidence x R1 | the office commissioning upload uses the `Job` context with category `Commissioning`; `WorkPackage` is the R3 installer route and needs FN-06 |
| `COMMISSIONING_RECORD` on `app.ensure_evidence` / `app.job_evidence` | Evidence x R1 | now `app.evidence_attach` (`evidence_created` = first use of the registered upload; the old "no row existed" test was always false under registered uploads) |
| Re-recording with a file already linked | Evidence x R1 | the reference keeps one office record per work package (`CS-R1A-<wp>`), so a file on an earlier office record of the same package may be quoted again (never re-pointed); a file on any other submission is refused (`R1A_EVIDENCE_ALREADY_LINKED`). The current record shows the package's office files |
| `commissioning_templates` row trigger + explicit `app.audit` in the office-template helper | audit x R1 | one event per change: the trigger is the record, the reason travels in `app.reason` |
| `app.result_error_catalogue` grants | all (since `20260919167000`) | every link of the chain granted to `authenticated` / `service_role`; before, every refusal showed "Something went wrong" to signed-in staff |
| `TASK_EVIDENCE_ATTACH` audit reason | Evidence x `20260919144000` | reason names the evidence id, not the storage path |
| `SYSTEM_STATUS` vs Director evidence recording | audit/health | Director reads System Health (reference: System Status audience "Tanya/Ben/Admin", MAN-06 backup review by Ben). Release modes, calendar and resolve actions stay Admin / Manager / Office |
| Cancellation close / resolve / reopen review had no UI | R1 | `JOB_OPERATIONS.cancellation` + three controls on the Operations tab calling the existing S15 commands |

## Decisions recorded

- `InProgress` / `Aftercare`: obsolete for R1 (see `docs/backend-port.md`).
- First installer: assigned by the booking form (`BOOKING_INTAKE` roofer /
  sparky / second_sparky). After `Booked` there is no R1 path in the reference
  either (R2 `PLAN_WORK_PACKAGE`, FN-02); a business decision, not a port gap.
- Release modes: every R1 function stays `Disabled` in migrations; tests switch
  them on only in the isolated local stack.

## Running the full suite without touching a shared stack

`npm run test:db` runs `supabase db reset` in the current directory. From this
checkout that resets the shared local stack, so run the same steps from an
isolated stack directory:

```sh
W=<scratch>/stack; mkdir -p $W/supabase
sed -e 's/^project_id = .*/project_id = "ss-p0-r1-integ"/' -e 's/5532\([0-9]\)/5652\1/g' supabase/config.toml > $W/supabase/config.toml
ln -s $PWD/supabase/migrations $PWD/supabase/seeds $PWD/supabase/dev $W/supabase/
cd $W && supabase start -x studio,realtime,imgproxy,edge-runtime,logflare,vector,postgres-meta,supavisor,mailpit
supabase db reset && node <repo>/scripts/dev-preview-install.mjs
SUPABASE_TEST_WORKDIR=$W node --test --test-concurrency=1 <repo>/tests/*.test.mjs
supabase stop --no-backup
```

`tests/r1-p0-integration.test.mjs` is the synthetic R1 journey (Sold ->
OperationallyComplete, Evidence x commissioning, audit, cancellation from three
stages, Director System Health). It is named to run after
`preview-dev.test.mjs`, which counts the rows it can see.
