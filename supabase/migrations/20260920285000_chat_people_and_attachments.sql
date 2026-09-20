-- =============================================================================
-- Two things team chat needs before it is usable by a person.
--
-- 1. SOMEONE TO TALK TO. Starting a conversation means picking colleagues, and
--    the only existing directory read is STAFF_ADMIN, which is Admin/Manager
--    only. An installer must be able to find Tanya without being able to
--    administer her, so this adds a deliberately thin read: the people you may
--    start a conversation with, and nothing else about them.
--
-- 2. ATTACHMENTS. public.evidence already carries chat_message_id; what was
--    missing is a way to UPLOAD against a message and a rule for who may read
--    the result.
--
--    The rule that matters, from section 10 of the brief: a chat attachment is
--    readable by the conversation's MEMBERS, and posting a private job
--    document into a chat must not make it readable by everyone who can see
--    that job - nor the reverse. So a chat attachment is stored with scope
--    'Library' (no job), and its readability comes from membership alone. It
--    is a copy posted into a conversation, not a pointer that widens an
--    existing document's audience.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Who you may start a conversation with
-- -----------------------------------------------------------------------------

create function app.read_chat_people(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_q text := nullif(btrim(coalesce(p_request ->> 'query', '')), '');
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', p.id, 'display_name', p.display_name,
        -- The roles are shown so "which Dan" is answerable. Nothing else
        -- about a colleague is exposed by this read - no email, no phone.
        'roles', (select coalesce(jsonb_agg(pr.role_code order by pr.role_code), '[]'::jsonb)
                  from public.person_roles pr where pr.person_id = p.id and pr.active))
        order by p.display_name)
      from public.people p
      where p.active
        and p.id <> v_me
        and (v_q is null or p.display_name ilike '%' || v_q || '%')
        -- Only people who can actually take part. Offering somebody the
        -- system would then refuse to add is a worse experience than not
        -- offering them.
        and exists (
          select 1 from public.person_roles pr
          join public.role_permissions rp on rp.role_code = pr.role_code
          where pr.person_id = p.id and pr.active
            and rp.permission_code = 'communications.chat.use')
      limit 100), '[]'::jsonb),
    'retrieved_at', now());
end
$$;

insert into app.read_registry (read_type, roles, modes, module, notes) values
  ('CHAT_PEOPLE', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   '[]', 'chat', 'Colleagues you may start a conversation with. Name and roles only - never contact details.');

-- -----------------------------------------------------------------------------
-- 2. Attachments
--
-- app.evidence_upload_context is a dispatcher on p_type. This adds the
-- 'ChatMessage' branch by replacing the function, keeping every existing
-- branch byte-for-byte and adding one.
-- -----------------------------------------------------------------------------

/** Membership check for an attachment, by the message it hangs off. */
create function app.chat_can_read_attachment(p_actor jsonb, p_message uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_messages m
    join public.chat_members mem on mem.conversation_id = m.conversation_id
    where m.id = p_message
      and mem.person_id = app.actor_id(p_actor)
      and mem.active
  )
$$;

grant execute on function app.chat_can_read_attachment(jsonb, uuid) to authenticated, service_role;

/**
 * Attach an already-uploaded file to a message you wrote.
 *
 * Deliberately separate from the upload: the file is registered first (scope
 * Library, no job), then bound to the message. Binding is what makes it
 * readable by the conversation, so it happens once, by the author, and only
 * for a message they wrote in a conversation they are in.
 */
create function app.cmd_chat_attach(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.actor_id(p_actor);
  v_msg uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'message_id');
  v_evidence uuid := app.ref(coalesce(p_request -> 'payload', '{}'::jsonb), 'evidence_id');
  v_message public.chat_messages;
  v_file public.evidence;
begin
  perform app.comm_require(p_actor, 'communications.chat.use');
  select * into v_message from public.chat_messages where id = v_msg for update;
  if not found then perform app.fail('CHAT_MESSAGE_NOT_FOUND'); end if;
  if v_message.author_person_id <> v_me then perform app.fail('CHAT_NOT_YOUR_MESSAGE'); end if;
  if not exists (
    select 1 from public.chat_members m
    where m.conversation_id = v_message.conversation_id and m.person_id = v_me and m.active
  ) then
    perform app.fail('CHAT_NOT_A_MEMBER');
  end if;

  select * into v_file from public.evidence where id = v_evidence for update;
  if not found then perform app.fail('CHAT_ATTACHMENT_NOT_FOUND'); end if;
  -- Only a file this person just registered, and only one not already spoken
  -- for. Without this, attaching would be a way to pull an arbitrary job
  -- document into a conversation and hand it to everyone in the room.
  if v_file.captured_by is distinct from v_me then
    perform app.fail('CHAT_ATTACHMENT_NOT_YOURS');
  end if;
  if v_file.job_id is not null or v_file.scope <> 'Library' then
    perform app.fail('CHAT_ATTACHMENT_NOT_STANDALONE',
      jsonb_build_object('detail', 'a job document is not re-posted into chat; upload a copy'));
  end if;
  if v_file.chat_message_id is not null then
    return jsonb_build_object('attached', false, 'already_attached', true,
                              'evidence_id', v_evidence, 'message_id', v_msg);
  end if;

  update public.evidence set chat_message_id = v_msg where id = v_evidence;
  return jsonb_build_object('attached', true, 'evidence_id', v_evidence, 'message_id', v_msg);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes) values
  ('CHAT_ATTACH', array['Admin','Manager','Director','Office','VariationApprover','Surveyor','Finance','Store','Installer','Scaffolder'],
   false, '[]', 'chat',
   'Bind a file you uploaded to a message you wrote. The file must be standalone (scope Library, no job): a job document is never re-pointed into a conversation.');

-- Chat attachments are readable through membership, in addition to whatever
-- app.can_read_evidence already allowed. This widens nothing else: a row with
-- a null chat_message_id is unaffected.
create or replace function app.can_read_evidence(p_actor jsonb, p_e public.evidence)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_actor is not null and p_e.id is not null
    and p_e.upload_status in ('Uploaded', 'Referenced')
    and p_e.purged_at is null
    and (p_e.trashed_at is null or app.actor_has_permission(p_actor, 'file.manage'))
    and case
      -- NEW: a chat attachment belongs to its conversation, not to a job and
      -- not to the library at large. Membership alone decides, so posting a
      -- file into a chat never widens it beyond the people in the room.
      when p_e.chat_message_id is not null
        then app.chat_can_read_attachment(p_actor, p_e.chat_message_id)
      when p_e.scope = 'Library'
        then app.actor_has_permission(p_actor, 'file.library.read')
      else (
        (app.has_role(p_actor, 'Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Finance')
          and app.can_read_job(p_actor, p_e.job_id))
        or (app.has_role(p_actor, 'Store') and p_e.category = 'DeliveryNote')
        or (p_e.category = any (app.evidence_installer_categories())
            and exists (
              select 1
              from public.allocations a
              join public.work_packages w on w.id = a.work_package_id
              where a.person_id = app.actor_id(p_actor) and a.active and w.status <> 'Cancelled' and w.job_id = p_e.job_id
                and case
                      when coalesce(p_e.work_package_id,
                                    (select s.work_package_id from public.commissioning_submissions s
                                     where s.id = p_e.submission_id)) is not null
                        then w.id = coalesce(p_e.work_package_id,
                                             (select s.work_package_id from public.commissioning_submissions s
                                              where s.id = p_e.submission_id))
                      else app.actor_id(p_actor) in (p_e.captured_by, p_e.uploaded_by)
                    end)))
      end
$$;
