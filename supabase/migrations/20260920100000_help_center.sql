-- =============================================================================
-- Help Center: the internal staff knowledge base. One source of truth for two
-- readers: staff reading articles in the app, and SimpleBot answering "how do
-- I ..." questions from the same published articles.
--
--   help_categories         the fixed category list shown on the landing page.
--   help_articles           one row per article. Its content columns are the
--                           editable WORKING COPY (draft). published_revision_id
--                           points at the immutable snapshot staff and SimpleBot
--                           actually read.
--   help_article_revisions  immutable history: every create, edit, publish,
--                           archive, restore, review and seed is a numbered row
--                           holding the full content at that moment, the editor
--                           and the time. Never updated or deleted.
--
-- Status: draft (never published) | published | archived. Staff and SimpleBot
-- only ever read the PUBLISHED REVISION of a PUBLISHED article, through
-- public.help_published_articles(), which also applies the article's audience
-- (roles) and reports whether its release function is switched on. There is no
-- other read path for non-editors: the tables themselves are editor-only (RLS).
--
-- Every change is a registered command through public.execute_command
-- (handlers app.cmd_help_article_*), so it inherits actor resolution,
-- idempotency on command_id, expected_version checks and audit_events. Editing
-- needs help.edit (Admin, Manager, Office); publishing, archiving, restoring
-- and marking reviewed need help.publish (Admin, Manager).
--
-- Content is Markdown in a small, safe subset. The database stores it as text
-- and never renders it; the app renders it without ever interpreting HTML.
--
-- Help is NOT release-gated: it documents gated features (with their switched-
-- on state), so it must always be readable.
--
-- Seeding: app.help_seed_article() creates missing canonical articles and
-- never overwrites an article staff have edited (see the seed migration).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Permissions
-- -----------------------------------------------------------------------------

insert into public.permissions (code, description) values
  ('help.edit',    'Create and edit Help Center article drafts; see drafts, archived articles and history.'),
  ('help.publish', 'Publish, archive, restore and mark Help Center articles reviewed.')
on conflict (code) do nothing;

insert into public.role_permissions (role_code, permission_code)
select r.role_code, p.code
from (values ('Admin'), ('Manager')) as r (role_code)
cross join (values ('help.edit'), ('help.publish')) as p (code)
union all
select 'Office', 'help.edit'
on conflict (role_code, permission_code) do nothing;

-- How long a published article may go without review before Help health flags it.
insert into public.settings (key, typed_value, scope, version, effective_from, reason)
select 'help.review_period_days', '180'::jsonb, 'Global', 1, '2026-01-01', 'Help Center default: review every 6 months'
where not exists (select 1 from public.settings where key = 'help.review_period_days' and scope = 'Global');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table public.help_categories (
  code        text primary key check (code ~ '^[a-z][a-z-]{1,39}$'),
  title       text not null,
  description text not null,
  icon        text not null,
  sort_order  integer not null
);
comment on table public.help_categories is 'Help Center categories (fixed list; articles reference one).';

insert into public.help_categories (code, title, description, icon, sort_order) values
  ('getting-started', 'Getting started',      'Signing in, finding your way around and searching.',              'dashboard',     10),
  ('tasks',           'Tasks',                'Your tasks, the team''s tasks, completing and evidence.',         'check',         20),
  ('jobs',            'Jobs',                 'Finding a job, the job page, stages, calls and issues.',           'search',        30),
  ('sales',           'Sales and presales',   'New job sold, job sales, the PRE tasks and Ready to Book.',        'page',          40),
  ('booking',         'Booking',              'The booking queue, booking, installers and moving dates.',         'booking',       50),
  ('planning',        'Planning',             'Planner, scaffold, staff availability and installer skills.',      'planner',       60),
  ('installation',    'Installation',         'My installs, progress on site and installation photos.',           'install',       70),
  ('commissioning',   'Commissioning',        'Recording and reviewing commissioning, and completing a job.',     'commissioning', 80),
  ('materials',       'Materials and stock',  'Materials, merchant orders, goods in and stock.',                  'materials',     90),
  ('cancellations',   'Cancellations',        'Cancelling a job, cancellation tasks and reinstating.',            'close',        100),
  ('files',           'Files and documents',  'Finding, uploading and opening customer files and photos.',        'page',         110),
  ('forms',           'Forms',                'Building forms and sending them to customers.',                    'forms',        120),
  ('simplebot',       'SimpleBot',            'What the assistant can do and how it asks before changing things.', 'sparkles',    130),
  ('administration',  'Administration',       'People and access, roles, System health and this Help Center.',    'system',       140)
on conflict (code) do nothing;

create table public.help_articles (
  id                        uuid primary key default gen_random_uuid(),
  -- Stable public identifier used in links (/dashboard/help/<slug>). Fixed once published.
  slug                      text not null unique
                              check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  status                    text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Working copy (the draft). What staff read is the published revision.
  title                     text not null check (char_length(btrim(title)) between 3 and 160),
  summary                   text not null default '' check (char_length(summary) <= 300),
  body                      text not null default '' check (char_length(body) <= 20000),
  category                  text references public.help_categories (code),
  -- Roles the article is for; empty = every member of staff.
  audience_roles            text[] not null default '{}' check (cardinality(audience_roles) <= 11),
  -- Release functions (release_modes.function_id) the procedure depends on;
  -- it works only while ALL of them are switched on.
  release_functions         text[] not null default '{}' check (cardinality(release_functions) <= 10),
  routes                    text[] not null default '{}' check (cardinality(routes) <= 20),
  tools                     text[] not null default '{}' check (cardinality(tools) <= 20),
  keywords                  text[] not null default '{}' check (cardinality(keywords) <= 60),
  aliases                   text[] not null default '{}' check (cardinality(aliases) <= 60),
  related_slugs             text[] not null default '{}' check (cardinality(related_slugs) <= 20),
  common_task               boolean not null default false,
  sort_order                integer not null default 100 check (sort_order between 0 and 10000),
  -- True when the working copy differs from the published revision (or none exists).
  has_unpublished_changes   boolean not null default true,
  published_revision_id     uuid,
  published_revision_number integer,
  published_at              timestamptz,
  published_by              uuid references public.people (id),
  archived_at               timestamptz,
  archived_by               uuid references public.people (id),
  reviewed_at               timestamptz,
  reviewed_by               uuid references public.people (id),
  review_due_at             timestamptz,
  -- Seed bookkeeping: the seed version the PUBLISHED content still equals
  -- (null once staff have published their own edit), and a newer seed version
  -- that was NOT applied because staff had edited the article.
  seed_version              integer,
  seed_update_available     integer,
  created_at                timestamptz not null default now(),
  created_by                uuid references public.people (id),
  updated_at                timestamptz not null default now(),
  updated_by                uuid references public.people (id),
  version                   integer not null default 1,
  constraint help_articles_published_has_revision
    check (status <> 'published' or published_revision_id is not null)
);
comment on table public.help_articles is
  'Help Center articles. Content columns are the editable draft; staff and SimpleBot read only the published revision (public.help_published_articles).';
create index help_articles_status_idx on public.help_articles (status, category, sort_order);

create trigger help_articles_touch before insert or update on public.help_articles
  for each row execute function app.touch_row();

create table public.help_article_revisions (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid not null references public.help_articles (id) on delete restrict,
  revision_number  integer not null check (revision_number >= 1),
  event            text not null check (event in ('created', 'edited', 'published', 'archived', 'restored',
                                                  'reviewed', 'reverted', 'seeded')),
  -- The article's status after this event.
  status           text not null check (status in ('draft', 'published', 'archived')),
  slug             text not null,
  title            text not null,
  summary          text not null,
  body             text not null,
  category         text,
  audience_roles   text[] not null,
  release_functions text[] not null,
  routes           text[] not null,
  tools            text[] not null,
  keywords         text[] not null,
  aliases          text[] not null,
  related_slugs    text[] not null,
  common_task      boolean not null,
  sort_order       integer not null,
  change_note      text check (change_note is null or char_length(change_note) <= 500),
  seed_version     integer,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.people (id),
  unique (article_id, revision_number)
);
comment on table public.help_article_revisions is
  'Immutable Help Center history: the full article content at every create, edit, publish, archive, restore, review and seed.';

alter table public.help_articles
  add constraint help_articles_published_revision_fkey
  foreign key (published_revision_id) references public.help_article_revisions (id) on delete restrict;

create function app.help_forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'HELP_HISTORY_IMMUTABLE' using errcode = 'P0001';
end
$$;
create trigger help_article_revisions_immutable before update or delete on public.help_article_revisions
  for each row execute function app.help_forbid_change();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Signed-in, active staff only (inactive people resolve to no person).
create function app.help_is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.current_person_id() is not null $$;

create function app.help_can_edit()
returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.current_person_id() is not null and app.has_permission('help.edit') $$;

-- May the caller read an article written for these roles? Editors see all.
create function app.help_audience_ok(p_audience text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.current_person_id() is not null
     and (cardinality(p_audience) = 0
          or p_audience && app.current_roles()
          or app.has_permission('help.edit'))
$$;

-- Switched on = every listed release function is in Manual or Automated for
-- Pilot/All (an unknown function counts as off).
create function app.help_release_on(p_function_ids text[])
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(bool_and(app.mode_available(f, 'Manual') or app.mode_available(f, 'Automated')), true)
  from unnest(p_function_ids) as f
$$;

create function app.help_require(p_permission text)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if app.current_person_id() is null or not app.has_permission(p_permission) then
    perform app.fail('HELP_PERMISSION_DENIED', jsonb_build_object('permission', p_permission));
  end if;
end
$$;

-- A text list from the payload: trimmed, blanks and duplicates removed, each
-- item checked against a pattern and a length, the whole list capped.
create function app.help_text_list(p_payload jsonb, p_key text, p_max_items integer, p_max_len integer,
                                   p_pattern text default null, p_lower boolean default false)
returns text[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_payload -> p_key;
  v_item jsonb;
  v_text text;
  v_out text[] := '{}';
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return '{}';
  end if;
  if jsonb_typeof(v_value) <> 'array' then
    perform app.fail('HELP_INVALID_' || upper(p_key));
  end if;
  for v_item in select value from jsonb_array_elements(v_value) loop
    if jsonb_typeof(v_item) <> 'string' then
      perform app.fail('HELP_INVALID_' || upper(p_key));
    end if;
    v_text := regexp_replace(btrim(v_item #>> '{}'), '\s+', ' ', 'g');
    if p_lower then v_text := lower(v_text); end if;
    continue when v_text = '';
    if char_length(v_text) > p_max_len or (p_pattern is not null and v_text !~ p_pattern) then
      perform app.fail('HELP_INVALID_' || upper(p_key), jsonb_build_object('value', left(v_text, 100)));
    end if;
    if not v_text = any (v_out) then
      v_out := v_out || v_text;
    end if;
  end loop;
  if cardinality(v_out) > p_max_items then
    perform app.fail('HELP_INVALID_' || upper(p_key), jsonb_build_object('max_items', p_max_items));
  end if;
  return v_out;
end
$$;

-- Applies the content fields present in a payload to an article row (the
-- working copy). Absent keys leave the field unchanged.
create function app.help_apply_fields(p_article public.help_articles, p_payload jsonb)
returns public.help_articles
language plpgsql
set search_path = ''
as $$
declare
  a public.help_articles := p_article;
  v_role text;
begin
  if p_payload ? 'title' then
    a.title := coalesce(app.txt(p_payload, 'title'), '');
    if char_length(a.title) not between 3 and 160 then perform app.fail('HELP_INVALID_TITLE'); end if;
  end if;
  if p_payload ? 'summary' then
    a.summary := coalesce(app.txt(p_payload, 'summary'), '');
    if char_length(a.summary) > 300 then perform app.fail('HELP_INVALID_SUMMARY'); end if;
  end if;
  if p_payload ? 'body' then
    if jsonb_typeof(p_payload -> 'body') not in ('string', 'null') then perform app.fail('HELP_INVALID_BODY'); end if;
    a.body := coalesce(replace(p_payload ->> 'body', E'\r\n', E'\n'), '');
    if char_length(a.body) > 20000 then perform app.fail('HELP_INVALID_BODY'); end if;
  end if;
  if p_payload ? 'category' then
    a.category := app.txt(p_payload, 'category');
    if a.category is not null and not exists (select 1 from public.help_categories c where c.code = a.category) then
      perform app.fail('HELP_INVALID_CATEGORY');
    end if;
  end if;
  if p_payload ? 'audience_roles' then
    a.audience_roles := app.help_text_list(p_payload, 'audience_roles', 11, 40, '^[A-Za-z][A-Za-z0-9]*$');
    foreach v_role in array a.audience_roles loop
      if not exists (select 1 from public.roles r where r.code = v_role) then
        perform app.fail('HELP_INVALID_AUDIENCE_ROLES', jsonb_build_object('value', v_role));
      end if;
    end loop;
  end if;
  if p_payload ? 'release_functions' then
    a.release_functions := app.help_text_list(p_payload, 'release_functions', 10, 5, '^FN-[0-9]{2}$');
  end if;
  if p_payload ? 'routes' then
    a.routes := app.help_text_list(p_payload, 'routes', 20, 200, '^/dashboard(/[A-Za-z0-9_\[\]-]+)*$');
  end if;
  if p_payload ? 'tools' then
    a.tools := app.help_text_list(p_payload, 'tools', 20, 64, '^[a-z][a-z0-9_]{2,63}$');
  end if;
  if p_payload ? 'keywords' then
    a.keywords := app.help_text_list(p_payload, 'keywords', 60, 80, null, true);
  end if;
  if p_payload ? 'aliases' then
    a.aliases := app.help_text_list(p_payload, 'aliases', 60, 80, null, true);
  end if;
  if p_payload ? 'related_slugs' then
    a.related_slugs := app.help_text_list(p_payload, 'related_slugs', 20, 80, '^[a-z0-9]+(-[a-z0-9]+)*$');
    if a.slug = any (a.related_slugs) then perform app.fail('HELP_INVALID_RELATED_SLUGS'); end if;
  end if;
  if p_payload ? 'common_task' then
    if jsonb_typeof(p_payload -> 'common_task') <> 'boolean' then perform app.fail('HELP_INVALID_COMMON_TASK'); end if;
    a.common_task := (p_payload ->> 'common_task')::boolean;
  end if;
  if p_payload ? 'sort_order' then
    if jsonb_typeof(p_payload -> 'sort_order') <> 'number' or (p_payload ->> 'sort_order') !~ '^[0-9]{1,5}$'
       or (p_payload ->> 'sort_order')::int > 10000 then
      perform app.fail('HELP_INVALID_SORT_ORDER');
    end if;
    a.sort_order := (p_payload ->> 'sort_order')::int;
  end if;
  return a;
end
$$;

-- Whether two article rows carry the same content (ignores status/bookkeeping).
create function app.help_same_content(p_a public.help_articles, p_rev public.help_article_revisions)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_rev.id is not null
     and p_a.title = p_rev.title and p_a.summary = p_rev.summary and p_a.body = p_rev.body
     and p_a.category is not distinct from p_rev.category
     and p_a.audience_roles = p_rev.audience_roles
     and p_a.release_functions = p_rev.release_functions
     and p_a.routes = p_rev.routes and p_a.tools = p_rev.tools
     and p_a.keywords = p_rev.keywords and p_a.aliases = p_rev.aliases
     and p_a.related_slugs = p_rev.related_slugs
     and p_a.common_task = p_rev.common_task and p_a.sort_order = p_rev.sort_order
$$;

-- Appends a history row holding the article's content as it now stands.
create function app.help_record(p_article public.help_articles, p_event text, p_note text default null,
                                p_seed_version integer default null)
returns public.help_article_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rev public.help_article_revisions;
begin
  if p_note is not null and char_length(p_note) > 500 then perform app.fail('HELP_INVALID_CHANGE_NOTE'); end if;
  insert into public.help_article_revisions (
    article_id, revision_number, event, status, slug, title, summary, body, category, audience_roles,
    release_functions, routes, tools, keywords, aliases, related_slugs, common_task, sort_order,
    change_note, seed_version, created_by)
  values (
    p_article.id,
    coalesce((select max(r.revision_number) from public.help_article_revisions r where r.article_id = p_article.id), 0) + 1,
    p_event, p_article.status, p_article.slug, p_article.title, p_article.summary, p_article.body,
    p_article.category, p_article.audience_roles, p_article.release_functions, p_article.routes,
    p_article.tools, p_article.keywords, p_article.aliases, p_article.related_slugs,
    p_article.common_task, p_article.sort_order, p_note, p_seed_version, app.current_person_id())
  returning * into v_rev;
  return v_rev;
end
$$;

create function app.help_review_due(p_from timestamptz default now())
returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select p_from + make_interval(days => coalesce((app.setting('help.review_period_days') #>> '{}')::int, 180))
$$;

create function app.help_summary(p_article public.help_articles)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('slug', p_article.slug, 'title', p_article.title, 'status', p_article.status,
                            'category', p_article.category, 'published_revision', p_article.published_revision_number,
                            'version', p_article.version)
$$;

create function app.help_result(p_article public.help_articles)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('article_id', p_article.id, 'slug', p_article.slug, 'status', p_article.status,
                            'published_revision', p_article.published_revision_number,
                            'has_unpublished_changes', p_article.has_unpublished_changes,
                            'version', p_article.version)
$$;

-- Loads an article for change, locked, checking the caller's expected version.
create function app.help_lock(p_payload jsonb, p_request jsonb)
returns public.help_articles
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_article public.help_articles;
begin
  begin
    v_id := app.txt(p_payload, 'article_id')::uuid;
  exception when others then
    perform app.fail('HELP_NOT_FOUND');
  end;
  if v_id is null then perform app.fail('HELP_NOT_FOUND'); end if;
  select * into v_article from public.help_articles where id = v_id for update;
  if not found then perform app.fail('HELP_NOT_FOUND'); end if;
  if app.expected_version(p_request) <> v_article.version then
    perform app.fail('HELP_STALE_VERSION', jsonb_build_object('current_version', v_article.version));
  end if;
  return v_article;
end
$$;

-- Makes the working copy the published revision.
create function app.help_publish_row(p_article public.help_articles, p_note text, p_seed_version integer)
returns public.help_articles
language plpgsql
set search_path = ''
as $$
declare
  a public.help_articles := p_article;
  v_rev public.help_article_revisions;
begin
  a.status := 'published';
  v_rev := app.help_record(a, case when p_seed_version is null then 'published' else 'seeded' end,
                           p_note, p_seed_version);
  update public.help_articles set
    status = 'published',
    published_revision_id = v_rev.id,
    published_revision_number = v_rev.revision_number,
    published_at = v_rev.created_at,
    published_by = v_rev.created_by,
    has_unpublished_changes = false,
    archived_at = null,
    archived_by = null,
    reviewed_at = v_rev.created_at,
    reviewed_by = v_rev.created_by,
    review_due_at = app.help_review_due(v_rev.created_at),
    seed_version = p_seed_version,
    seed_update_available = case when p_seed_version is null then seed_update_available end
  where id = a.id
  returning * into a;
  return a;
end
$$;

-- -----------------------------------------------------------------------------
-- Command handlers: app.cmd_<type>(request, actor) -> result
-- -----------------------------------------------------------------------------

-- HELP_ARTICLE_CREATE {slug, title, summary?, body?, category?, audience_roles?,
--   release_functions?, routes?, tools?, keywords?, aliases?, related_slugs?,
--   common_task?, sort_order?, change_note?}
create function app.cmd_help_article_create(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['slug', 'title', 'summary', 'body', 'category', 'audience_roles',
                                            'release_functions', 'routes', 'tools', 'keywords', 'aliases',
                                            'related_slugs', 'common_task', 'sort_order', 'change_note'],
                           array['slug', 'title']);
  v_slug text := lower(app.txt(v_p, 'slug'));
  a public.help_articles;
begin
  perform app.help_require('help.edit');
  if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 80 then
    perform app.fail('HELP_INVALID_SLUG');
  end if;
  if exists (select 1 from public.help_articles where slug = v_slug) then
    perform app.fail('HELP_SLUG_TAKEN');
  end if;
  a.slug := v_slug;
  a.title := '';
  a.summary := '';
  a.body := '';
  a.audience_roles := '{}';
  a.release_functions := '{}';
  a.routes := '{}';
  a.tools := '{}';
  a.keywords := '{}';
  a.aliases := '{}';
  a.related_slugs := '{}';
  a.common_task := false;
  a.sort_order := 100;
  a := app.help_apply_fields(a, v_p);

  insert into public.help_articles (slug, status, title, summary, body, category, audience_roles, release_functions,
                                    routes, tools, keywords, aliases, related_slugs, common_task, sort_order)
  values (a.slug, 'draft', a.title, a.summary, a.body, a.category, a.audience_roles, a.release_functions,
          a.routes, a.tools, a.keywords, a.aliases, a.related_slugs, a.common_task, a.sort_order)
  returning * into a;

  perform app.help_record(a, 'created', app.txt(v_p, 'change_note'));
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_CREATE', null, app.help_summary(a));
  return app.help_result(a);
end
$$;

-- HELP_ARTICLE_UPDATE {article_id, <content fields>?, slug? (never-published only), change_note?}
-- + expected_version. Edits the working copy only; staff keep reading the
-- published revision until someone publishes.
create function app.cmd_help_article_update(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['article_id', 'slug', 'title', 'summary', 'body', 'category',
                                            'audience_roles', 'release_functions', 'routes', 'tools', 'keywords',
                                            'aliases', 'related_slugs', 'common_task', 'sort_order', 'change_note'],
                           array['article_id']);
  v_before public.help_articles;
  a public.help_articles;
  v_published public.help_article_revisions;
  v_slug text;
begin
  perform app.help_require('help.edit');
  v_before := app.help_lock(v_p, p_request);
  if v_before.status = 'archived' then perform app.fail('HELP_ARCHIVED'); end if;
  a := app.help_apply_fields(v_before, v_p);

  if v_p ? 'slug' then
    v_slug := lower(app.txt(v_p, 'slug'));
    if v_slug is distinct from v_before.slug then
      if v_before.published_revision_id is not null then perform app.fail('HELP_SLUG_FIXED'); end if;
      if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(v_slug) > 80 then
        perform app.fail('HELP_INVALID_SLUG');
      end if;
      if exists (select 1 from public.help_articles where slug = v_slug) then perform app.fail('HELP_SLUG_TAKEN'); end if;
      a.slug := v_slug;
    end if;
  end if;
  if a.slug = any (a.related_slugs) then perform app.fail('HELP_INVALID_RELATED_SLUGS'); end if;

  select * into v_published from public.help_article_revisions where id = v_before.published_revision_id;
  update public.help_articles set
    slug = a.slug, title = a.title, summary = a.summary, body = a.body, category = a.category,
    audience_roles = a.audience_roles, release_functions = a.release_functions, routes = a.routes,
    tools = a.tools, keywords = a.keywords, aliases = a.aliases, related_slugs = a.related_slugs,
    common_task = a.common_task, sort_order = a.sort_order,
    has_unpublished_changes = not app.help_same_content(a, v_published)
  where id = a.id
  returning * into a;

  perform app.help_record(a, 'edited', app.txt(v_p, 'change_note'));
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_UPDATE', app.help_summary(v_before), app.help_summary(a));
  return app.help_result(a);
end
$$;

-- HELP_ARTICLE_PUBLISH {article_id, change_note?} + expected_version.
create function app.cmd_help_article_publish(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['article_id', 'change_note'], array['article_id']);
  v_before public.help_articles;
  a public.help_articles;
begin
  perform app.help_require('help.publish');
  v_before := app.help_lock(v_p, p_request);
  if v_before.status = 'archived' then perform app.fail('HELP_ARCHIVED'); end if;
  if v_before.category is null then perform app.fail('HELP_CATEGORY_REQUIRED'); end if;
  if btrim(v_before.summary) = '' then perform app.fail('HELP_SUMMARY_REQUIRED'); end if;
  if btrim(v_before.body) = '' then perform app.fail('HELP_BODY_REQUIRED'); end if;
  if v_before.status = 'published' and not v_before.has_unpublished_changes then
    perform app.fail('HELP_NO_CHANGES');
  end if;
  a := app.help_publish_row(v_before, app.txt(v_p, 'change_note'), null);
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_PUBLISH', app.help_summary(v_before), app.help_summary(a));
  return app.help_result(a);
end
$$;

-- HELP_ARTICLE_ARCHIVE {article_id, change_note?} + expected_version.
-- Archived articles keep their history but are never shown to staff or SimpleBot.
create function app.cmd_help_article_archive(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['article_id', 'change_note'], array['article_id']);
  v_before public.help_articles;
  a public.help_articles;
begin
  perform app.help_require('help.publish');
  v_before := app.help_lock(v_p, p_request);
  if v_before.status = 'archived' then perform app.fail('HELP_ARCHIVED'); end if;
  update public.help_articles set status = 'archived', archived_at = now(), archived_by = app.current_person_id()
  where id = v_before.id
  returning * into a;
  perform app.help_record(a, 'archived', app.txt(v_p, 'change_note'));
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_ARCHIVE', app.help_summary(v_before), app.help_summary(a));
  return app.help_result(a);
end
$$;

-- HELP_ARTICLE_RESTORE {article_id, change_note?} + expected_version.
-- Back to published (its last published revision) or, if never published, draft.
create function app.cmd_help_article_restore(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['article_id', 'change_note'], array['article_id']);
  v_before public.help_articles;
  a public.help_articles;
begin
  perform app.help_require('help.publish');
  v_before := app.help_lock(v_p, p_request);
  if v_before.status <> 'archived' then perform app.fail('HELP_NOT_ARCHIVED'); end if;
  update public.help_articles set
    status = case when published_revision_id is null then 'draft' else 'published' end,
    archived_at = null, archived_by = null
  where id = v_before.id
  returning * into a;
  perform app.help_record(a, 'restored', app.txt(v_p, 'change_note'));
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_RESTORE', app.help_summary(v_before), app.help_summary(a));
  return app.help_result(a);
end
$$;

-- HELP_ARTICLE_REVIEW {article_id, change_note?} + expected_version.
-- "Still correct": records who checked the published article and when.
create function app.cmd_help_article_review(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['article_id', 'change_note'], array['article_id']);
  v_before public.help_articles;
  a public.help_articles;
begin
  perform app.help_require('help.publish');
  v_before := app.help_lock(v_p, p_request);
  if v_before.status <> 'published' then perform app.fail('HELP_NOT_PUBLISHED'); end if;
  update public.help_articles set
    reviewed_at = now(), reviewed_by = app.current_person_id(), review_due_at = app.help_review_due(now())
  where id = v_before.id
  returning * into a;
  perform app.help_record(a, 'reviewed', app.txt(v_p, 'change_note'));
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_REVIEW', app.help_summary(v_before), app.help_summary(a));
  return app.help_result(a);
end
$$;

-- HELP_ARTICLE_REVERT {article_id, revision_number, change_note?} + expected_version.
-- Copies an earlier revision's content into the working copy (a draft change;
-- publishing it is a separate step).
create function app.cmd_help_article_revert(p_request jsonb, p_actor jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p jsonb := app.payload(p_request, array['article_id', 'revision_number', 'change_note'],
                           array['article_id', 'revision_number']);
  v_before public.help_articles;
  a public.help_articles;
  v_from public.help_article_revisions;
  v_published public.help_article_revisions;
begin
  perform app.help_require('help.edit');
  v_before := app.help_lock(v_p, p_request);
  if v_before.status = 'archived' then perform app.fail('HELP_ARCHIVED'); end if;
  if (v_p ->> 'revision_number') !~ '^[0-9]{1,9}$' then perform app.fail('HELP_REVISION_NOT_FOUND'); end if;
  select * into v_from from public.help_article_revisions
  where article_id = v_before.id and revision_number = (v_p ->> 'revision_number')::int;
  if not found then perform app.fail('HELP_REVISION_NOT_FOUND'); end if;
  select * into v_published from public.help_article_revisions where id = v_before.published_revision_id;

  a := v_before;
  a.title := v_from.title; a.summary := v_from.summary; a.body := v_from.body; a.category := v_from.category;
  a.audience_roles := v_from.audience_roles; a.release_functions := v_from.release_functions;
  a.routes := v_from.routes; a.tools := v_from.tools; a.keywords := v_from.keywords; a.aliases := v_from.aliases;
  a.related_slugs := v_from.related_slugs; a.common_task := v_from.common_task; a.sort_order := v_from.sort_order;
  update public.help_articles set
    title = a.title, summary = a.summary, body = a.body, category = a.category,
    audience_roles = a.audience_roles, release_functions = a.release_functions, routes = a.routes,
    tools = a.tools, keywords = a.keywords, aliases = a.aliases, related_slugs = a.related_slugs,
    common_task = a.common_task, sort_order = a.sort_order,
    has_unpublished_changes = not app.help_same_content(a, v_published)
  where id = a.id
  returning * into a;
  perform app.help_record(a, 'reverted',
                          coalesce(app.txt(v_p, 'change_note'), 'Copied from revision ' || v_from.revision_number));
  perform app.audit('help_article', a.id::text, 'HELP_ARTICLE_REVERT', app.help_summary(v_before), app.help_summary(a));
  return app.help_result(a);
end
$$;

insert into app.command_registry (command_type, roles, job_scoped, modes, module, notes)
select t, array['Admin', 'Manager', 'Director', 'Office', 'VariationApprover', 'Surveyor', 'Installer',
                'Store', 'Finance', 'Scaffolder', 'ReadOnly'],
       false, '[]'::jsonb, 'help',
       'Any active staff role may call; the handler requires help.edit or help.publish (role_permissions). Not release-gated.'
from unnest(array['HELP_ARTICLE_CREATE', 'HELP_ARTICLE_UPDATE', 'HELP_ARTICLE_PUBLISH', 'HELP_ARTICLE_ARCHIVE',
                  'HELP_ARTICLE_RESTORE', 'HELP_ARTICLE_REVIEW', 'HELP_ARTICLE_REVERT']) as t
on conflict (command_type) do nothing;

-- -----------------------------------------------------------------------------
-- Staff / SimpleBot read path
-- -----------------------------------------------------------------------------

-- The published articles the caller may read: published status, the PUBLISHED
-- revision's content (never the draft, never an older revision), filtered by
-- that revision's audience. Optionally one slug. Returns nothing to anyone
-- who is not an active staff member. SimpleBot's tools call exactly this.
create function public.help_published_articles(p_slug text default null)
returns table (
  slug text, title text, summary text, body text, category text, audience_roles text[],
  release_functions text[], release_on boolean, release_names text[], routes text[], tools text[],
  keywords text[], aliases text[], related_slugs text[], common_task boolean, sort_order integer,
  revision_number integer, published_at timestamptz, reviewed_at timestamptz, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.slug, r.title, r.summary, r.body, r.category, r.audience_roles,
         r.release_functions, app.help_release_on(r.release_functions),
         (select coalesce(array_agg(m.function_name order by m.function_id), '{}')
          from public.release_modes m where m.function_id = any (r.release_functions)),
         r.routes, r.tools, r.keywords, r.aliases, r.related_slugs, r.common_task, r.sort_order,
         r.revision_number, a.published_at, a.reviewed_at, a.published_at
  from public.help_articles a
  join public.help_article_revisions r on r.id = a.published_revision_id
  where a.status = 'published'
    and (p_slug is null or a.slug = p_slug)
    and app.help_audience_ok(r.audience_roles)
  order by r.sort_order, r.title
$$;

-- Help health (editors). Database-side checks; the app adds route, tool and
-- in-body link checks against its own code.
create function public.help_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_issues jsonb := '[]'::jsonb;
begin
  if not app.help_can_edit() then
    perform app.fail('HELP_PERMISSION_DENIED', jsonb_build_object('permission', 'help.edit'));
  end if;
  select coalesce(jsonb_agg(i order by i ->> 'slug', i ->> 'code'), '[]'::jsonb) into v_issues
  from (
    -- Published without a category.
    select jsonb_build_object('slug', r.slug, 'title', r.title, 'code', 'NO_CATEGORY', 'severity', 'error',
                              'detail', 'The published article has no category.') as i
    from public.help_articles a join public.help_article_revisions r on r.id = a.published_revision_id
    where a.status = 'published' and r.category is null
    union all
    -- Refers to a release function that does not exist.
    select jsonb_build_object('slug', r.slug, 'title', r.title, 'code', 'UNKNOWN_RELEASE_FUNCTION', 'severity', 'error',
                              'detail', 'Release function ' || f.fn || ' does not exist.')
    from public.help_articles a join public.help_article_revisions r on r.id = a.published_revision_id
    cross join lateral unnest(r.release_functions) as f (fn)
    where a.status = 'published'
      and not exists (select 1 from public.release_modes m where m.function_id = f.fn)
    union all
    -- Related link to an article that is missing, never published or archived.
    select jsonb_build_object('slug', r.slug, 'title', r.title, 'code', 'BROKEN_RELATED_LINK', 'severity', 'warning',
                              'detail', 'Related article "' || s.rel || '" '
                                || case when t.id is null then 'does not exist.'
                                        when t.status = 'archived' then 'is archived.'
                                        else 'is not published.' end)
    from public.help_articles a join public.help_article_revisions r on r.id = a.published_revision_id
    cross join lateral unnest(r.related_slugs) as s (rel)
    left join public.help_articles t on t.slug = s.rel
    where a.status = 'published' and (t.id is null or t.status <> 'published')
    union all
    -- Review overdue.
    select jsonb_build_object('slug', a.slug, 'title', a.title, 'code', 'REVIEW_OVERDUE', 'severity', 'warning',
                              'detail', coalesce('Not reviewed since '
                                || to_char(a.reviewed_at at time zone 'Europe/London', 'DD Mon YYYY') || '.',
                                'Never reviewed.'))
    from public.help_articles a
    where a.status = 'published' and (a.review_due_at is null or a.review_due_at < now())
    union all
    -- A newer canonical seed exists but was not applied because staff edited the article.
    select jsonb_build_object('slug', a.slug, 'title', a.title, 'code', 'SEED_UPDATE_AVAILABLE', 'severity', 'info',
                              'detail', 'A newer standard version (' || a.seed_update_available
                                || ') was not applied because this article has been edited here.')
    from public.help_articles a
    where a.seed_update_available is not null
    union all
    -- Unpublished edits waiting.
    select jsonb_build_object('slug', a.slug, 'title', a.title, 'code', 'UNPUBLISHED_CHANGES', 'severity', 'info',
                              'detail', 'Has draft changes that are not published yet.')
    from public.help_articles a
    where a.status = 'published' and a.has_unpublished_changes
  ) x;
  return jsonb_build_object('checked_at', now(), 'issues', v_issues,
    'release_functions', (select coalesce(jsonb_agg(m.function_id order by m.function_id), '[]'::jsonb)
                          from public.release_modes m));
end
$$;

-- -----------------------------------------------------------------------------
-- Seeding (migrations only; never granted to clients)
-- -----------------------------------------------------------------------------

-- Creates a canonical article if it is missing and publishes it as seed
-- version p_seed_version. An existing article is updated ONLY while it is
-- still exactly the seed content (published from an older seed, never edited
-- or republished by staff, no pending draft). Otherwise the newer seed is not
-- applied; the article is flagged (seed_update_available) for an editor.
-- Returns 'created' | 'updated' | 'flagged' | 'unchanged'.
create function app.help_seed_article(p jsonb, p_seed_version integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.help_articles;
  v_slug text := p ->> 'slug';
begin
  select * into a from public.help_articles where slug = v_slug for update;
  if not found then
    a.slug := v_slug;
    a.title := ''; a.summary := ''; a.body := '';
    a.audience_roles := '{}'; a.release_functions := '{}'; a.routes := '{}'; a.tools := '{}'; a.keywords := '{}'; a.aliases := '{}';
    a.related_slugs := '{}'; a.common_task := false; a.sort_order := 100;
    a := app.help_apply_fields(a, p - 'slug');
    insert into public.help_articles (slug, status, title, summary, body, category, audience_roles, release_functions,
                                      routes, tools, keywords, aliases, related_slugs, common_task, sort_order)
    values (a.slug, 'draft', a.title, a.summary, a.body, a.category, a.audience_roles, a.release_functions,
            a.routes, a.tools, a.keywords, a.aliases, a.related_slugs, a.common_task, a.sort_order)
    returning * into a;
    perform app.help_publish_row(a, 'Standard article', p_seed_version);
    return 'created';
  end if;

  if a.seed_version is not null and a.seed_version >= p_seed_version then
    return 'unchanged';
  end if;
  if a.seed_version is null or a.has_unpublished_changes or a.status <> 'published' then
    if a.seed_update_available is distinct from p_seed_version then
      update public.help_articles set seed_update_available = p_seed_version where id = a.id;
    end if;
    return 'flagged';
  end if;
  a := app.help_apply_fields(a, p - 'slug');
  update public.help_articles set
    title = a.title, summary = a.summary, body = a.body, category = a.category,
    audience_roles = a.audience_roles, release_functions = a.release_functions, routes = a.routes,
    tools = a.tools, keywords = a.keywords, aliases = a.aliases, related_slugs = a.related_slugs,
    common_task = a.common_task, sort_order = a.sort_order
  where id = a.id
  returning * into a;
  perform app.help_publish_row(a, 'Standard article update', p_seed_version);
  return 'updated';
end
$$;

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------

revoke all on public.help_categories, public.help_articles, public.help_article_revisions from public, anon, authenticated;
grant select on public.help_categories, public.help_articles, public.help_article_revisions to authenticated;
grant all on public.help_categories, public.help_articles, public.help_article_revisions to service_role;

alter table public.help_categories        enable row level security;
alter table public.help_articles          enable row level security;
alter table public.help_article_revisions enable row level security;

-- Categories: any active staff member.
create policy help_categories_select on public.help_categories
  for select to authenticated using ((select app.help_is_staff()));
-- Articles and history (drafts included): editors only. Everyone else reads
-- through public.help_published_articles().
create policy help_articles_select on public.help_articles
  for select to authenticated using ((select app.help_can_edit()));
create policy help_article_revisions_select on public.help_article_revisions
  for select to authenticated using ((select app.help_can_edit()));

revoke execute on function public.help_published_articles(text), public.help_health() from public, anon;
grant execute on function public.help_published_articles(text), public.help_health() to authenticated, service_role;
grant execute on function app.help_is_staff(), app.help_can_edit() to authenticated;
