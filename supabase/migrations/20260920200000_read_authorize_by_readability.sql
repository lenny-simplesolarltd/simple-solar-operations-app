-- =============================================================================
-- Reading a job and being allowed to work on it are two different questions.
--
-- app.read_authorize_job is the guard in front of the job READ models
-- (JOB_OVERVIEW, AUDIT_HISTORY, ACTION_AVAILABILITY, JOB_OPERATIONS,
-- TASK_DETAIL, the booking reads). It asked both questions at once: it refused
-- with R1A_OUTSIDE_PILOT anything app.job_in_scope excluded, before it ever got
-- to app.can_read_job.
--
-- That was harmless while job_in_scope was effectively "any job". Since
-- 20260920150000 made it false for record_class = 'HistoricalImport', opening
-- an imported job's detail page failed on the Work, Money, Operations and
-- History tabs with R1A_OUTSIDE_PILOT - a record staff are explicitly allowed
-- to read and are now given a screen to browse to.
--
-- The reads behind that guard are already written for this. app.read_job_operations
-- computes, in its own words, "Acting needs the reference assignment, not just
-- read visibility": it derives v_access from app.job_in_scope and
-- app.is_assigned, and v_active from app.job_actionable, so an out-of-scope job
-- yields no available action. ACTION_AVAILABILITY does the same. They never
-- needed the guard to do that for them; they needed it to let them run.
--
-- So the read guard now asks only what a read guard should: may this person
-- read this job. A job that does not exist is still R1A_JOB_NOT_FOUND, and one
-- this person may not see is still R1A_JOB_ACCESS_DENIED.
--
-- Nothing about operational scope changes:
--   * app.job_in_scope and app.job_actionable are untouched and stay false for
--     HistoricalImport;
--   * commands authorise through app.authorize_job, a different function, which
--     keeps its own R1A_OUTSIDE_PILOT check;
--   * app.assert_normal_work is untouched;
--   * no policy, grant or role changes here.
--
-- For a live job the outcome is identical: job_in_scope is true for every
-- record_class = 'Live' row, so the check this removes could only ever have
-- fired for a historical one.
-- =============================================================================

create or replace function app.read_authorize_job(p_actor jsonb, p_job_ref text)
returns public.jobs
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_id uuid := app.read_job_id(p_job_ref);
begin
  select * into v_job from public.jobs where id = v_id;
  if v_job.id is null then
    perform app.fail('R1A_JOB_NOT_FOUND');
  end if;
  -- Readability only. Whether the job may be acted on is decided by the read
  -- models themselves (app.job_in_scope / app.job_actionable), and by the
  -- command guard app.authorize_job, which is not this function.
  if not app.can_read_job(p_actor, v_job.id) then
    perform app.fail('R1A_JOB_ACCESS_DENIED');
  end if;
  return v_job;
end
$$;

comment on function app.read_authorize_job(jsonb, text) is
  'Read guard for the job read models: resolves the job and checks readability '
  '(app.can_read_job). It deliberately does NOT check operational scope - the '
  'read models derive availability from app.job_in_scope / app.job_actionable, '
  'and commands are guarded separately by app.authorize_job.';
