-- =============================================================================
-- Tagging the work itself in a conversation.
--
-- Chat already carried two kinds of reference, and each arrived its own way:
-- a job by typing SS-XXXX-0000 (resolved out of the body by app.chat_job_refs)
-- and a task as a uuid travelling beside the message in mentioned_task_ids.
-- Adding forms, responses, scheduled work and scaffold the same way would mean
-- a column on chat_messages per kind, a resolver per kind, and a branch per
-- kind in the read - five times over, growing every time the business acquires
-- a new noun.
--
-- So references move to ONE table with a kind, and the rules move to two
-- functions:
--
--   app.chat_tag_visible(kind, id, actor)  may this actor see that thing?
--   app.chat_tag_card(kind, id)            what does a chip need to say?
--
-- The security rule is unchanged and is now stated once instead of six times:
-- the client may say what it MEANT, never what is true. A tag the author
-- cannot read is dropped at send, and the same predicate runs again for the
-- READER at read, so a tag placed by somebody with wider access does not leak
-- through the message to somebody without it. Tagging can never become a way
-- to discover that a job, a form or a booking exists.
--
-- WHY THERE ARE NO FOREIGN KEYS
--
-- target_id is polymorphic, so it cannot reference six tables at once. That is
-- deliberate rather than tolerated: a card is a reference to something at the
-- time it was sent, and if the thing later goes away the card should quietly
-- stop rendering rather than block the delete of a real business record. Both
-- the read and the RLS policy resolve through app.chat_tag_card, which returns
-- null for a row that no longer exists, so a dangling tag renders as nothing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The table
-- -----------------------------------------------------------------------------

create table public.chat_message_tags (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  kind       text not null check (kind in ('job', 'task', 'form', 'form_submission',
                                           'work_package', 'scaffold_booking')),
  target_id  uuid not null,
  created_at timestamptz not null default now(),
  primary key (message_id, kind, target_id)
);

comment on table public.chat_message_tags is
  'What a message points at: jobs, tasks, forms, responses, scheduled work and scaffold bookings. Filtered at send time to what the AUTHOR may read, and again at read time to what the READER may read.';
comment on column public.chat_message_tags.target_id is
  'The row in the table named by kind. Deliberately not a foreign key: one column cannot reference six tables, and a tag whose target has gone should render as nothing rather than prevent a delete.';

create index chat_message_tags_target_idx on public.chat_message_tags (kind, target_id);

alter table public.chat_message_tags enable row level security;
revoke all on public.chat_message_tags from anon, authenticated;
grant select on public.chat_message_tags to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Visibility - one predicate, six answers
--
-- Each branch MIRRORS the select policy of the table it names rather than
-- reading through it: these functions run SECURITY DEFINER (the read and the
-- send command both need them for an actor who is not necessarily the session),
-- so RLS does not apply and the rule has to be restated.
--
--   job              app.can_read_job: all jobs, your own sales, or assigned.
--   task             task.read.all, or you own or back up it.
--   form / response  forms.read / forms.responses.read, and only while Forms
--                    is switched on. This is narrower than who may COMPLETE a
--                    form: somebody who can fill one in but holds no forms.*
--                    permission cannot tag it. Narrow is the safe direction.
--   work_package     the job is visible, or you are allocated to the package.
--   scaffold_booking the job is visible.
-- -----------------------------------------------------------------------------

create function app.chat_tag_visible(p_kind text, p_id uuid, p_actor jsonb)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select case p_kind
    when 'job' then app.can_read_job(p_actor, p_id)

    when 'task' then exists (
      select 1 from public.tasks t
      where t.id = p_id
        and (app.actor_has_permission(p_actor, 'task.read.all')
             or app.actor_id(p_actor) in (t.owner_id, t.backup_id)))

    when 'form' then app.forms_on()
      and app.actor_has_permission(p_actor, 'forms.read')
      and exists (select 1 from public.forms f where f.id = p_id and f.kind = 'form')

    when 'form_submission' then app.forms_on()
      and app.actor_has_permission(p_actor, 'forms.responses.read')
      and exists (select 1 from public.form_submissions s where s.id = p_id)

    when 'work_package' then exists (
      select 1 from public.work_packages w
      where w.id = p_id
        and (app.can_read_job(p_actor, w.job_id)
             or exists (select 1 from public.allocations a
                        where a.work_package_id = w.id
                          and a.person_id = app.actor_id(p_actor)
                          and a.active)))

    when 'scaffold_booking' then exists (
      select 1 from public.scaffold_bookings b
      where b.id = p_id and app.can_read_job(p_actor, b.job_id))

    else false
  end
$$;

comment on function app.chat_tag_visible(text, uuid, jsonb) is
  'May this actor see the thing a chat tag points at? Mirrors each table''s select policy; the only place chat decides that question.';

grant execute on function app.chat_tag_visible(text, uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. The card
--
-- Enough to recognise the thing and decide whether to open it, and nothing
-- more. No answers, no costs, no notes: a chip in a conversation is a signpost,
-- and the page behind it is where the detail lives, behind its own checks.
--
-- Returns null when the target has gone, which is how a dangling tag renders
-- as nothing rather than as a broken chip.
-- -----------------------------------------------------------------------------

create function app.chat_tag_card(p_kind text, p_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case p_kind

    when 'job' then (
      select jsonb_build_object(
        'kind', 'job', 'id', j.id,
        'title', j.job_ref,
        'detail', nullif(concat_ws(' · ',
                    nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
                    nullif(c.postcode, '')), ''),
        'status', j.workflow_stage,
        'job_id', j.id, 'job_ref', j.job_ref)
      from public.jobs j
      left join public.customers c on c.id = j.customer_id
      where j.id = p_id)

    when 'task' then (
      select jsonb_build_object(
        'kind', 'task', 'id', t.id,
        'title', t.title,
        'detail', t.template_code,
        'status', t.status,
        'job_id', t.job_id, 'job_ref', j.job_ref)
      from public.tasks t
      left join public.jobs j on j.id = t.job_id
      where t.id = p_id)

    when 'form' then (
      select jsonb_build_object(
        'kind', 'form', 'id', f.id,
        'title', f.title,
        'detail', nullif(concat_ws(' · ',
                    'Form',
                    nullif(j.job_ref, '')), ''),
        'status', f.status,
        'job_id', f.job_id, 'job_ref', j.job_ref)
      from public.forms f
      left join public.jobs j on j.id = f.job_id
      where f.id = p_id)

    when 'form_submission' then (
      select jsonb_build_object(
        'kind', 'form_submission', 'id', s.id,
        'title', f.title,
        'detail', concat_ws(' · ',
                    'Response',
                    coalesce(i.recipient_label, p.display_name, i.recipient_type),
                    to_char(s.submitted_at, 'DD Mon YYYY')),
        'status', 'Submitted',
        'job_id', i.job_id, 'job_ref', j.job_ref)
      from public.form_submissions s
      join public.forms f on f.id = s.form_id
      left join public.form_invitations i on i.id = s.invitation_id
      left join public.people p on p.id = s.submitted_by
      left join public.jobs j on j.id = i.job_id
      where s.id = p_id)

    when 'work_package' then (
      select jsonb_build_object(
        'kind', 'work_package', 'id', w.id,
        'title', w.trade || ' visit',
        'detail', nullif(concat_ws(' · ',
                    nullif(j.job_ref, ''),
                    case when w.planned_start is null then 'Unscheduled'
                         when w.planned_end is null or w.planned_end = w.planned_start
                           then to_char(w.planned_start, 'DD Mon')
                         else to_char(w.planned_start, 'DD Mon') || '–' || to_char(w.planned_end, 'DD Mon')
                    end), ''),
        'status', w.status,
        'job_id', w.job_id, 'job_ref', j.job_ref)
      from public.work_packages w
      left join public.jobs j on j.id = w.job_id
      where w.id = p_id)

    when 'scaffold_booking' then (
      select jsonb_build_object(
        'kind', 'scaffold_booking', 'id', b.id,
        'title', coalesce(co.name, 'Scaffold'),
        'detail', nullif(concat_ws(' · ',
                    nullif(j.job_ref, ''),
                    case when coalesce(b.erect_actual_at, b.erect_planned_at) is not null
                         then 'Erect ' || to_char(coalesce(b.erect_actual_at, b.erect_planned_at), 'DD Mon')
                    end,
                    case when coalesce(b.strip_actual_at, b.strip_planned_at, b.strip_forecast_at) is not null
                         then 'Strip ' || to_char(coalesce(b.strip_actual_at, b.strip_planned_at, b.strip_forecast_at), 'DD Mon')
                    end), ''),
        'status', b.status,
        'job_id', b.job_id, 'job_ref', j.job_ref)
      from public.scaffold_bookings b
      left join public.companies co on co.id = b.company_id
      left join public.jobs j on j.id = b.job_id
      where b.id = p_id)

    else null
  end
$$;

comment on function app.chat_tag_card(text, uuid) is
  'What a chat chip says about the thing it points at. Never called without app.chat_tag_visible first; returns null when the target has gone.';

grant execute on function app.chat_tag_card(text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. RLS
--
-- Membership AND the reader's own visibility of the target. A direct select on
-- this table therefore says exactly what the read says, which is the property
-- the rest of chat already has.
-- -----------------------------------------------------------------------------

create policy chat_message_tags_select on public.chat_message_tags
  for select to authenticated
  using (
    exists (select 1 from public.chat_messages m
            where m.id = message_id and app.chat_is_member(m.conversation_id))
    and app.chat_tag_visible(kind, target_id, (select app.current_actor()))
  );

-- -----------------------------------------------------------------------------
-- 5. What the client offered, filtered to what is true
-- -----------------------------------------------------------------------------

create function app.chat_tag_refs(p_tags jsonb, p_actor jsonb)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with offered as (
    select distinct
           t ->> 'kind' as kind,
           (t ->> 'id')::uuid as target_id
    from jsonb_array_elements(case when jsonb_typeof(p_tags) = 'array'
                                   then p_tags else '[]'::jsonb end) t
    where t ->> 'kind' in ('job', 'task', 'form', 'form_submission',
                           'work_package', 'scaffold_booking')
      -- Malformed ids are dropped rather than fatal: a tag is a hint about a
      -- message, and rubbish in the payload must never lose somebody's words.
      and t ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'id', o.target_id)
                            order by o.kind, o.target_id), '[]'::jsonb)
  from offered o
  where app.chat_tag_visible(o.kind, o.target_id, p_actor)
$$;

grant execute on function app.chat_tag_refs(jsonb, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Send: tags are written, and a typed job reference tags itself
--
-- A job reference in the body already resolved to an id the author may open.
-- That same resolution now also puts a job tag on the message, so typing
-- SS-WDDG-5412 gives both the inline link (which reads naturally mid-sentence)
-- and the card (which says whose job it is without opening it). One resolution,
-- two renderings - not two places that could disagree about which jobs a
-- message is about.
-- -----------------------------------------------------------------------------

create or replace function app.cmd_chat_send(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_conv uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'conversation_id');
  v_body text := btrim(coalesce(p_request -> 'payload' ->> 'body', ''));
  v_reply uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'reply_to_id');
  v_mentions uuid[];
  v_offered jsonb;
  v_tags jsonb;
  v_msg public.chat_messages;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  if v_conv is null then
    perform app.fail('CHAT_REFUSED: conversation_id is required');
  end if;
  if v_body = '' then
    perform app.fail('CHAT_REFUSED: a message needs something in it');
  end if;
  if char_length(v_body) > 8000 then
    perform app.fail('CHAT_REFUSED: that message is too long');
  end if;
  if not exists (
    select 1 from public.chat_members m
    where m.conversation_id = v_conv and m.person_id = v_me and m.active
  ) then
    perform app.fail('CHAT_NOT_A_MEMBER');
  end if;
  if v_reply is not null and not exists (
    select 1 from public.chat_messages m where m.id = v_reply and m.conversation_id = v_conv
  ) then
    perform app.fail('CHAT_REPLY_NOT_IN_CONVERSATION');
  end if;

  select coalesce(array_agg(distinct m.person_id), '{}') into v_mentions
  from public.chat_members m
  where m.conversation_id = v_conv and m.active
    and m.person_id::text = any (
      array(select jsonb_array_elements_text(coalesce(p_request -> 'payload' -> 'mention_person_ids', '[]'::jsonb)))
    );

  insert into public.chat_messages (conversation_id, author_person_id, body, reply_to_id,
                                    mentioned_job_ids, mentioned_person_ids)
  values (v_conv, v_me, v_body, v_reply, app.chat_job_refs(v_body, p_actor), v_mentions)
  returning * into v_msg;

  -- Everything the message points at, from three sources that all end up in
  -- one place: the tags the composer sent, the older mention_task_ids payload
  -- (still accepted, so a client that has not caught up keeps working), and
  -- the job references the body itself resolved.
  v_offered := coalesce(
    case when jsonb_typeof(p_request -> 'payload' -> 'tags') = 'array'
         then p_request -> 'payload' -> 'tags' else '[]'::jsonb end, '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('kind', 'task', 'id', value))
                 from jsonb_array_elements_text(
                   case when jsonb_typeof(p_request -> 'payload' -> 'mention_task_ids') = 'array'
                        then p_request -> 'payload' -> 'mention_task_ids' else '[]'::jsonb end)), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('kind', 'job', 'id', id))
                 from unnest(v_msg.mentioned_job_ids) as jid(id)), '[]'::jsonb);

  v_tags := app.chat_tag_refs(v_offered, p_actor);

  insert into public.chat_message_tags (message_id, kind, target_id)
  select v_msg.id, t ->> 'kind', (t ->> 'id')::uuid
  from jsonb_array_elements(v_tags) t
  on conflict do nothing;

  update public.chat_conversations set last_message_at = v_msg.created_at where id = v_conv;
  update public.chat_members set last_read_at = v_msg.created_at
  where conversation_id = v_conv and person_id = v_me;

  return jsonb_build_object('message_id', v_msg.id, 'conversation_id', v_conv,
                            'created_at', v_msg.created_at,
                            'job_ids', to_jsonb(v_msg.mentioned_job_ids),
                            'tags', v_tags,
                            'mentioned', to_jsonb(v_msg.mentioned_person_ids));
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Edit: the wording changes, so the job references change with it
--
-- The tags the composer attached stay as sent - an edit changes how the message
-- reads, not what it was about. Job tags are the exception, because they are
-- derived from the body: removing a reference from the sentence must remove the
-- card it produced, or the message says one thing and shows another.
-- -----------------------------------------------------------------------------

create or replace function app.cmd_chat_edit(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'message_id');
  v_body text := btrim(coalesce(p_request -> 'payload' ->> 'body', ''));
  v_msg public.chat_messages;
  v_after public.chat_messages;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  select * into v_msg from public.chat_messages where id = v_id for update;
  if not found then perform app.fail('CHAT_MESSAGE_NOT_FOUND'); end if;
  if v_msg.author_person_id <> v_me then perform app.fail('CHAT_NOT_YOUR_MESSAGE'); end if;
  if v_msg.deleted_at is not null then perform app.fail('CHAT_MESSAGE_DELETED'); end if;
  if v_body = '' then perform app.fail('CHAT_REFUSED: a message needs something in it'); end if;

  update public.chat_messages
  set body = v_body,
      edited_at = now(),
      -- Only the first edit records what was originally said.
      original_body = coalesce(original_body, v_msg.body),
      mentioned_job_ids = app.chat_job_refs(v_body, p_actor)
  where id = v_id
  returning * into v_after;

  delete from public.chat_message_tags where message_id = v_id and kind = 'job';
  insert into public.chat_message_tags (message_id, kind, target_id)
  select v_id, 'job', jid.id from unnest(v_after.mentioned_job_ids) as jid(id)
  on conflict do nothing;

  return jsonb_build_object('message_id', v_after.id, 'edited_at', v_after.edited_at,
                            'job_ids', to_jsonb(v_after.mentioned_job_ids));
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Delete: the cards go with the words
--
-- A deleted message already gives up its body, its job references and its
-- mentions. Leaving the tags behind would leave a blanked message still
-- displaying the job, the form and the booking it was about.
-- -----------------------------------------------------------------------------

create or replace function app.cmd_chat_delete(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_id uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'message_id');
  v_msg public.chat_messages;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  select * into v_msg from public.chat_messages where id = v_id for update;
  if not found then perform app.fail('CHAT_MESSAGE_NOT_FOUND'); end if;
  -- Only the author, or a chat administrator acting for retention.
  if v_msg.author_person_id <> v_me and not app.has_permission('communications.chat.admin') then
    perform app.fail('CHAT_NOT_YOUR_MESSAGE');
  end if;
  if v_msg.deleted_at is not null then
    return jsonb_build_object('message_id', v_id, 'already_deleted', true);
  end if;

  update public.chat_messages
  set body = '', deleted_at = now(), deleted_by = v_me,
      mentioned_job_ids = '{}', mentioned_person_ids = '{}'
  where id = v_id;
  delete from public.chat_message_tags where message_id = v_id;
  -- Deleting a message IS worth auditing, unlike sending one.
  perform app.audit('ChatMessages', v_id::text, 'ChatMessageDeleted',
                    to_jsonb(v_msg), null,
                    nullif(btrim(coalesce(p_request -> 'payload' ->> 'reason', '')), ''));
  return jsonb_build_object('message_id', v_id, 'deleted', true);
end
$$;

-- -----------------------------------------------------------------------------
-- 9. The read: one 'tags' list, in the READER's own view
--
-- This replaces the 'tasks' list. A caller that wants the tasks in a message
-- now filters tags by kind, which is the same work it was doing before against
-- a list that could only ever hold one noun.
-- -----------------------------------------------------------------------------

create or replace function app.read_chat_messages(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_conv uuid := app.ref(p_request, 'conversation_id');
  v_limit int := case when coalesce((p_request ->> 'limit')::int, 0) > 0
                      then least((p_request ->> 'limit')::int, 200) else 60 end;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  if v_conv is null then perform app.fail('R1A_INVALID_FIELDS'); end if;
  -- Membership, not a role. An administrator reading this read gets nothing.
  if not exists (
    select 1 from public.chat_members m
    where m.conversation_id = v_conv and m.person_id = v_me and m.active
  ) then
    perform app.fail('CHAT_NOT_A_MEMBER');
  end if;

  return jsonb_build_object(
    'conversation_id', v_conv,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'message_id', m.id, 'author_person_id', m.author_person_id,
        'author_name', p.display_name,
        'body', case when m.deleted_at is null then m.body else null end,
        'deleted', m.deleted_at is not null,
        'reply_to_id', m.reply_to_id,
        'job_ids', to_jsonb(m.mentioned_job_ids),
        'mentioned_person_ids', to_jsonb(m.mentioned_person_ids),
        'created_at', m.created_at, 'edited_at', m.edited_at,
        'tags', coalesce((
          select jsonb_agg(card.c order by g.kind, g.target_id)
          from public.chat_message_tags g
          cross join lateral (select app.chat_tag_card(g.kind, g.target_id) c) card
          where g.message_id = m.id
            -- The READER's visibility, applied again.
            and app.chat_tag_visible(g.kind, g.target_id, p_actor)
            and card.c is not null), '[]'::jsonb),
        'reactions', (select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'person_id', r.person_id))
                      from public.chat_reactions r where r.message_id = m.id),
        'attachments', (select jsonb_agg(jsonb_build_object('evidence_id', e.id,
                                                            'name', coalesce(e.display_name, e.filename)))
                        from public.evidence e
                        where e.chat_message_id = m.id and e.purged_at is null))
        order by m.created_at, m.id)
      from (select * from public.chat_messages mm
            where mm.conversation_id = v_conv
            order by mm.created_at desc, mm.id desc limit v_limit) m
      join public.people p on p.id = m.author_person_id), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

-- -----------------------------------------------------------------------------
-- 10. What was already said
--
-- Every task tagged and every job referenced before today becomes a tag, so
-- older messages gain their cards rather than losing their references. Then the
-- task column goes: two places recording the same thing is how they come to
-- disagree.
-- -----------------------------------------------------------------------------

insert into public.chat_message_tags (message_id, kind, target_id)
select m.id, 'task', t
from public.chat_messages m, unnest(m.mentioned_task_ids) t
where m.deleted_at is null
on conflict do nothing;

insert into public.chat_message_tags (message_id, kind, target_id)
select m.id, 'job', j
from public.chat_messages m, unnest(m.mentioned_job_ids) j
where m.deleted_at is null
on conflict do nothing;

alter table public.chat_messages drop column mentioned_task_ids;

drop function if exists app.chat_task_refs(jsonb, jsonb);
