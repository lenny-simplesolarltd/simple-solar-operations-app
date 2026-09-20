-- =============================================================================
-- Tagging a task in a conversation.
--
-- A job can already be tagged by typing its reference: SS-WDDG-5412 is stable,
-- human-readable text, and app.chat_job_refs resolves it against what the
-- AUTHOR may open. A task has no such handle - only a uuid, a template code and
-- a title, all scoped to a job - so there is nothing to type and nothing to
-- parse out of a sentence.
--
-- So task mentions are carried alongside the message rather than inside it:
-- the composer sends the ids it offered, and the server keeps only the ones the
-- author may actually read. The body stays ordinary prose.
--
-- The rule is the same one the whole feature runs on: the client may say what
-- it MEANT, never what is true. A task id the author cannot read is dropped
-- silently, so tagging can never become a way to discover that a task exists.
-- =============================================================================

alter table public.chat_messages
  add column mentioned_task_ids uuid[] not null default '{}';

comment on column public.chat_messages.mentioned_task_ids is
  'Tasks tagged in this message, filtered at send time to those the author may read.';

/**
 * The subset of the offered tasks this actor may actually read.
 *
 * Mirrors the tasks_select policy deliberately rather than calling it: this
 * runs SECURITY DEFINER, so the policy does not apply and the rule has to be
 * restated. task.read.all, or you own or back up the task.
 */
create function app.chat_task_refs(p_ids jsonb, p_actor jsonb)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(t.id order by t.id), '{}')
  from public.tasks t
  where t.id = any (
        array(select (value #>> '{}')::uuid
              from jsonb_array_elements(coalesce(p_ids, '[]'::jsonb))
              where value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    and (
      app.actor_has_permission(p_actor, 'task.read.all')
      or app.actor_id(p_actor) in (t.owner_id, t.backup_id)
    )
$$;

grant execute on function app.chat_task_refs(jsonb, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Send and edit keep the tagged tasks in step with the body.
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
  v_tasks uuid[];
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

  v_tasks := app.chat_task_refs(p_request -> 'payload' -> 'mention_task_ids', p_actor);

  insert into public.chat_messages (conversation_id, author_person_id, body, reply_to_id,
                                    mentioned_job_ids, mentioned_person_ids, mentioned_task_ids)
  values (v_conv, v_me, v_body, v_reply, app.chat_job_refs(v_body, p_actor), v_mentions, v_tasks)
  returning * into v_msg;

  update public.chat_conversations set last_message_at = v_msg.created_at where id = v_conv;
  update public.chat_members set last_read_at = v_msg.created_at
  where conversation_id = v_conv and person_id = v_me;

  return jsonb_build_object('message_id', v_msg.id, 'conversation_id', v_conv,
                            'created_at', v_msg.created_at,
                            'job_ids', to_jsonb(v_msg.mentioned_job_ids),
                            'task_ids', to_jsonb(v_msg.mentioned_task_ids),
                            'mentioned', to_jsonb(v_msg.mentioned_person_ids));
end
$$;

-- Editing re-resolves the body's job references; the tagged tasks stay as sent,
-- because an edit changes the wording, not what the message was about.

-- -----------------------------------------------------------------------------
-- The read: enough to render a chip, and nothing more.
--
-- Title, template code and job reference are what a person needs to recognise
-- the task. The task rows are filtered by the READER's own visibility as well,
-- so a task tagged by somebody with wider access does not leak through the
-- message to somebody without it.
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
        'tasks', coalesce((
          select jsonb_agg(jsonb_build_object('task_id', t.id, 'title', t.title,
                                              'template_code', t.template_code,
                                              'status', t.status,
                                              'job_ref', j.job_ref)
                           order by t.template_code, t.id)
          from public.tasks t
          left join public.jobs j on j.id = t.job_id
          where t.id = any (m.mentioned_task_ids)
            -- The READER's visibility, applied again.
            and (app.actor_has_permission(p_actor, 'task.read.all')
                 or v_me in (t.owner_id, t.backup_id))), '[]'::jsonb),
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
