# R1 pilot runbook

The new-stack cutover procedure for R1. It **replaces the old S19 cutover**
deliberately: the old system (Sheets / AppSheet / Apps Script) never ran live,
so there is no in-flight production data to migrate and no Google-side import
to port. What remains is to make the hosted stack ready, switch R1 on for a
pilot, prove it, and know how to switch it off again.

The readiness conditions the app can check itself are evaluated live by
`app.release_readiness()` (Release control and System health: **R1 go-live
readiness**) - the replacement for the old S20 release contract. This runbook
covers those plus the conditions only a person can confirm.

Nothing in this runbook is done by migrations or seed data. Every release
function ships **Disabled**.

## 0. Preconditions

- `feature/dev` contains the converged state (`docs/FINAL_CONVERGENCE_REPORT.md`).
- The owner has authorised hosted deployment.

## 1. Hosted database

Follow `docs/HOSTED_MIGRATION_PLAN.md`: backup point, `supabase migration list`
(23 applied), `supabase db push --dry-run` (exactly the pending files),
`supabase db push`, then the read-only verification queries. Result: all
migrations applied, 21 release functions Disabled, audit coverage Verified,
five pg_cron jobs.

## 2. Hosted configuration (Supabase dashboard; the app cannot do these)

| Setting | Required value |
|---|---|
| Auth > Sign-ups | **disabled** (invitation only) |
| Auth > Site URL | the production app origin (= `NEXT_PUBLIC_SITE_URL`) |
| Auth > Redirect URLs | `<origin>/auth/confirm`, `<origin>/auth/callback` |
| Auth > SMTP | a real sender (custom SMTP). Supabase's built-in sender is rate-limited and for testing only. Invitations and password resets are the **only** emails the app sends today |
| Auth > Google provider | only if Google sign-in is wanted (button is shown only when the provider is on) |
| Database > Backups / PITR | on, with the retention the business needs |

## 3. Application environment (Vercel or host)

Names only; see `docs/ENVIRONMENT.md`: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only),
`NEXT_PUBLIC_SITE_URL`, `ASSISTANT_PROVIDER` + `GEMINI_API_KEY` (SimpleBot),
`ASSISTANT_ACTION_SECRET` (>= 32 chars), `FORMS_LINK_SECRET` (>= 32 chars, only
needed when Forms is switched on).

## 4. Staff accounts

1. People & access: check every pilot person exists, is active and has the
   right roles (**Give role / Remove role**, reasons recorded).
2. **Invite** each pilot person. They set their own password. Nobody else
   ever sees it.
3. Check task ownership: Release control readiness **Every R1 task has an
   owner** must be **Pass** (Tanya owns PRE/BKG/INS01/INS04/REM, Ben PRE03 with
   Dan as backup, Hannah ISS01; INS02 goes to the lead installer).

## 5. Scheduler (pg_cron)

R1 depends on `ss-s10-schedules` (creates INS01 installer-confirmation and
INS04 customer-happy call tasks; without it no job can reach operational
completion), `ss-resilience-sweep` and `ss-system-tasks`. Verify read only:

```sql
select jobname, schedule, active from cron.job order by jobname;
select jobname, status, start_time from cron.job_run_details d
join cron.job j using (jobid) order by start_time desc limit 20;
```

Readiness item **Background schedules (pg_cron)** must be **Pass**. The
schedules do nothing while their functions are Disabled; once FN-01 is on,
`ss-s10-schedules` runs at :05 and :35 every hour.

## 6. Backups and recovery evidence

The app cannot see the platform's backups; it records that a person checked.

1. In the Supabase dashboard confirm the latest daily backup / PITR window.
2. System health > **Record a check**: *Database backup checked*, Verified,
   when you checked, the backup time, how, where the proof is kept.
3. Do a **non-destructive restore drill** (restore into a scratch project or
   branch, check row counts and one job end to end) and record *Database
   recovery tested*.
4. Same for Storage (*File storage backup checked*, *File storage recovery
   tested*): download a sample of evidence objects from a backup/replica.

Readiness shows **Unknown** until these exist - never a pass.

## 7. Monitoring

Point an external uptime monitor (any HTTP checker) at `GET <origin>/api/health`
every 5 minutes. It answers with coarse states only (no names or data).
`GET /api/health?strict=1` returns 503 unless every item is Verified - use it
for alerting once backups/drills/schedules are all green.

## 8. Integrations in R1

| Integration | State in R1 | What staff do instead |
|---|---|---|
| Google Calendar | not configured; outbox rows are captured but no worker sends them (FN-02 Disabled) | planner in the app is the calendar of record |
| Xero | not configured (FN-09/12 Disabled, R4) | finance as today, outside the app |
| GHL | not configured (ids `NOT_CONFIGURED`, FN-11 Disabled) | GHL01 / S15-CAN-GHL are human tasks; GHL cancellation tasks are tracked when a cancellation is closed |
| Email to customers / merchants | not implemented (no sender) | phone / own mailbox; record calls in the app |

## 9. Switching R1 on (pilot)

In **Release control** (Admin / Manager), with a reason naming the approver:

1. **FN-01** office core - Pilot.
2. **FN-14** health monitoring (Automated) and **FN-16** daily authorisation /
   outage review - Pilot.
3. **FN-15** bank deposit confirmation, **FN-19** + **FN-11** operational
   completion (they work together), **FN-17** + **FN-20** cancellation and
   notices (they work together), **FN-18** missing-form reminders - Pilot.

Leave FN-02..FN-10, FN-12, FN-13 (R2-R4) and FN-21 (Forms) off unless
separately approved. Readiness must be **Ready** before step 1, or the
exceptions must be written into the reason.

## 10. Smoke test (pilot, real staff, one real or rehearsal job)

Job Sold -> PRE01..PRE04 (PRE02 with the signed contract uploaded) -> PRE03 by
Ben -> Ready to book -> booking form with installers -> BKG01-03 -> Confirm
booking -> (next :05/:35) INS01 calls appear -> installer confirmation ->
INS04 -> customer happy -> Electrical commissioning recorded with the
certificate -> Mark operationally complete. Check the job's Files tab and
Files & documents find the contract and the certificate. Check Issues, Calls
and Cancellations queues render. SimpleBot: "where is the signed contract for
<job ref>?".

## 11. Disable / rollback

- A feature misbehaves: **Switch off** its function in Release control (with a
  reason). Its commands are refused immediately; records stay.
- Everything: switch off the R1 functions in reverse order (FN-01 last; the
  app refuses to switch FN-01 off while others that need it are on).
- Database: forward-only. Fix with a new migration; restore from backup only
  as a last resort (then record a new restore drill).
