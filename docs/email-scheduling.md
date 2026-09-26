# Draining the outbox: how the email worker is scheduled

`/api/email-worker` sends whatever the database has already authorised. It is
driven from outside, and nothing in the repo calls it, so if nothing schedules
it a queued email waits for ever — which on every screen looks exactly like a
gate being shut.

## Today: Vercel Cron, once a day at 09:00 UTC

`vercel.json` declares it. The deployment registers the job; the secrets only
decide whether the call is accepted.

**Why daily, and why 09:00.** Vercel's Hobby plan allows cron jobs to run *once
per day*, and a more frequent expression **fails the deployment** rather than
being quietly downgraded — an hourly `20 * * * *` blocked every deploy until it
was changed. 09:00 UTC is chosen so the worker always runs after the reports
have been built, in both British seasons: `ss-reports` builds hourly from
07:10 local, which is 06:10 UTC in summer and 07:10 UTC in winter, so 09:00 UTC
is safely after either.

The cost is latency. A report is built within the hour and then waits until the
next 09:00 to leave, so a manual "Send now" is not immediate.

## On a Pro plan, or when latency matters

Change the schedule to `20 * * * *` — hourly, ten minutes after `ss-reports`
builds. That is the intended setting; it is only the Hobby limit that prevents
it.

## The alternative: pg_cron, in the database

Supabase already runs six `ss-*` jobs through `pg_cron`, and `pg_net` is
available (not installed). Scheduling the HTTP call there would be independent
of the hosting plan and would put the scheduling where the rest of it already
lives.

Not done, for one reason worth stating: it needs the worker secret readable by
the database in order to send the `Authorization` header. That puts a
credential in a table, where a schema dump or a broad `select` would expose it.
Supabase Vault is the right home for it if this route is taken.

## Checking it from outside

```
curl -s -o /dev/null -w '%{http_code}' https://<host>/api/email-worker         # GET
```

- `405` — the deployment predates the GET handler, so a deploy is failing
- `503` — deployed, but `CRON_SECRET` is not set
- `401` — deployed and the secret is set; the call was simply unauthenticated
