-- Spusť celé v Supabase → SQL Editor. Jde pouštět opakovaně.
-- Tabulky jsou pro veřejný (anon) klíč zamčené; veškerý přístup vede přes funkce api_* níž.
-- Identita = tajný token člena (members.token), který zná jen jeho prohlížeč / osobní odkaz.

create table if not exists grp(id text primary key, name text not null check (length(name) between 1 and 60));
create table if not exists members(
  id bigserial primary key, group_id text not null references grp on delete cascade,
  name text not null check (length(name) between 1 and 30), color text not null,
  token text not null unique default gen_random_uuid()::text, unique(group_id, name));
-- slot = den * 96 + 15min slot v dni (den 0 = pondělí)
create table if not exists busy(
  member_id bigint not null references members on delete cascade, slot int not null check (slot between 0 and 671),
  primary key(member_id, slot));
create table if not exists events(
  id bigserial primary key, group_id text not null references grp on delete cascade,
  title text not null check (length(title) between 1 and 80), date date not null,
  start_t time not null, stop_t time not null check (stop_t > start_t),
  note text not null default '' check (length(note) <= 500),
  created_by bigint references members on delete set null);
create table if not exists rsvps(
  event_id bigint not null references events on delete cascade, member_id bigint not null references members on delete cascade,
  primary key(event_id, member_id));

-- migrace starších instalací: události přežijí odchod autora
alter table events alter column created_by drop not null;
alter table events drop constraint if exists events_created_by_fkey;
alter table events add constraint events_created_by_fkey foreign key (created_by) references members on delete set null;

alter table grp enable row level security;
alter table members enable row level security;
alter table busy enable row level security;
alter table events enable row level security;
alter table rsvps enable row level security;
revoke all on grp, members, busy, events, rsvps from anon, authenticated;

create or replace function _me(p_id text, p_token text) returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  select id into v from members where group_id = p_id and token = p_token;
  if v is null then raise exception 'Nejsi přihlášen/á'; end if;
  return v;
end $$;
revoke all on function _me(text, text) from public, anon, authenticated;

create or replace function api_create_group(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
begin
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 60 then raise exception 'Název: 1–60 znaků'; end if;
  insert into grp values (v_id, p_name);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function api_get_group(p_id text, p_token text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare g grp; v_me bigint;
begin
  select * into g from grp where id = p_id;
  if not found then raise exception 'Skupina neexistuje'; end if;
  select id into v_me from members where group_id = p_id and token = p_token;
  return jsonb_build_object(
    'group', jsonb_build_object('id', g.id, 'name', g.name),
    'me', v_me,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'color', m.color,
        'busy', coalesce((select jsonb_agg(b.slot order by b.slot) from busy b where b.member_id = m.id), '[]'::jsonb)) order by m.id)
      from members m where m.group_id = p_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'date', e.date,
        'start', to_char(e.start_t, 'HH24:MI'), 'stop', to_char(e.stop_t, 'HH24:MI'), 'note', e.note, 'createdBy', e.created_by,
        'going', coalesce((select jsonb_agg(r.member_id) from rsvps r where r.event_id = e.id), '[]'::jsonb)) order by e.date, e.start_t)
      from events e where e.group_id = p_id), '[]'::jsonb));
end $$;

create or replace function api_join(p_id text, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; v_n int;
begin
  perform 1 from grp where id = p_id;
  if not found then raise exception 'Skupina neexistuje'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 30 then raise exception 'Jméno: 1–30 znaků'; end if;
  select count(*) into v_n from members where group_id = p_id;
  insert into members(group_id, name, color)
    values (p_id, p_name, (array['#2563eb','#dc2626','#9333ea','#ea580c','#0891b2','#db2777','#65a30d','#ca8a04','#4f46e5','#0d9488','#be123c','#7c3aed'])[v_n % 12 + 1])
    returning token into v_token;
  return jsonb_build_object('token', v_token);
exception when unique_violation then raise exception 'Toto jméno už ve skupině je';
end $$;

create or replace function api_set_busy(p_id text, p_token text, p_busy int[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  if exists (select 1 from unnest(coalesce(p_busy, array[]::int[])) s where s < 0 or s > 671) then raise exception 'Neplatný rozvrh'; end if;
  delete from busy where member_id = v_me;
  insert into busy select v_me, s from unnest(coalesce(p_busy, array[]::int[])) s group by s;
  return '{}'::jsonb;
end $$;

create or replace function _check_event(p_title text, p_note text, p_start time, p_stop time) returns void language plpgsql as $$
begin
  if length(btrim(coalesce(p_title, ''))) not between 1 and 80 then raise exception 'Název: 1–80 znaků'; end if;
  if length(coalesce(p_note, '')) > 500 then raise exception 'Popis: nejvýše 500 znaků'; end if;
  if p_stop <= p_start then raise exception 'Konec musí být po začátku'; end if;
end $$;
revoke all on function _check_event(text, text, time, time) from public, anon, authenticated;

create or replace function api_create_event(p_id text, p_token text, p_title text, p_date date, p_start time, p_stop time, p_note text, p_going boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token); v_id bigint;
begin
  perform _check_event(p_title, p_note, p_start, p_stop);
  insert into events(group_id, title, date, start_t, stop_t, note, created_by)
    values (p_id, btrim(p_title), p_date, p_start, p_stop, btrim(coalesce(p_note, '')), v_me) returning id into v_id;
  if p_going then insert into rsvps values (v_id, v_me); end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function api_update_event(p_id text, p_token text, p_event bigint, p_title text, p_date date, p_start time, p_stop time, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  perform _check_event(p_title, p_note, p_start, p_stop);
  update events set title = btrim(p_title), date = p_date, start_t = p_start, stop_t = p_stop, note = btrim(coalesce(p_note, ''))
    where id = p_event and group_id = p_id and created_by = v_me;
  if not found then raise exception 'Upravit může jen autor události'; end if;
  return '{}'::jsonb;
end $$;

create or replace function api_set_going(p_id text, p_token text, p_event bigint, p_going boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  perform 1 from events where id = p_event and group_id = p_id;
  if not found then raise exception 'Událost neexistuje'; end if;
  if p_going then insert into rsvps values (p_event, v_me) on conflict do nothing;
  else delete from rsvps where event_id = p_event and member_id = v_me; end if;
  return '{}'::jsonb;
end $$;

create or replace function api_delete_event(p_id text, p_token text, p_event bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  delete from events where id = p_event and group_id = p_id and created_by = v_me;
  if not found then raise exception 'Smazat může jen autor události'; end if;
  return '{}'::jsonb;
end $$;

create or replace function api_rename_member(p_id text, p_token text, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 30 then raise exception 'Jméno: 1–30 znaků'; end if;
  update members set name = p_name where id = v_me;
  return '{}'::jsonb;
exception when unique_violation then raise exception 'Toto jméno už ve skupině je';
end $$;

-- skupina nemá admina: název může změnit kterýkoli člen
create or replace function api_rename_group(p_id text, p_token text, p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) not between 1 and 60 then raise exception 'Název: 1–60 znaků'; end if;
  update grp set name = p_name where id = p_id;
  return '{}'::jsonb;
end $$;

create or replace function api_leave(p_id text, p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_me bigint := _me(p_id, p_token);
begin
  delete from members where id = v_me; -- rozvrh a účasti se smažou, události zůstanou
  return '{}'::jsonb;
end $$;
