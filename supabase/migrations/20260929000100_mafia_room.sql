create table if not exists public.mafia_room_state (
  room_id text primary key check (room_id = 'main'),
  version bigint not null default 1,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.mafia_room_members (
  user_id uuid primary key,
  room_id text not null default 'main' check (room_id = 'main')
);

alter table public.mafia_room_state enable row level security;
alter table public.mafia_room_members enable row level security;
revoke all on public.mafia_room_state, public.mafia_room_members from anon, authenticated;
grant all on public.mafia_room_state, public.mafia_room_members to service_role;

create or replace function public.is_mafia_room_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.mafia_room_members where user_id = auth.uid() and room_id = 'main');
$$;
revoke all on function public.is_mafia_room_member() from public, anon;
grant execute on function public.is_mafia_room_member() to authenticated, service_role;

create or replace function public.commit_mafia_room(p_expected_version bigint, p_next_state jsonb, p_member_ids uuid[])
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_version bigint;
begin
  select version into current_version from public.mafia_room_state where room_id = 'main' for update;
  if current_version is null or current_version <> p_expected_version then
    raise exception 'STALE_VERSION' using errcode = '40001';
  end if;
  update public.mafia_room_state set state = p_next_state, version = current_version + 1, updated_at = now() where room_id = 'main';
  delete from public.mafia_room_members where room_id = 'main';
  insert into public.mafia_room_members(user_id, room_id)
    select distinct x, 'main' from unnest(coalesce(p_member_ids, '{}'::uuid[])) as x;
  return current_version + 1;
end;
$$;
revoke all on function public.commit_mafia_room(bigint, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_mafia_room(bigint, jsonb, uuid[]) to service_role;

insert into public.mafia_room_state(room_id, version, state)
values ('main', 1, jsonb_build_object('gameId', gen_random_uuid()::text, 'host', null, 'settings', jsonb_build_object('mafia',1,'doctor',true,'police',true), 'resetPasswordHash', null, 'phase','lobby', 'stage','day', 'round',0, 'countdownAt',null, 'players','{}'::jsonb, 'notice','진행자 또는 플레이어를 선택해 주세요.', 'vote',null, 'result',null, 'endReason',null))
on conflict (room_id) do nothing;

-- Realtime private-channel authorization; Supabase manages this table and its RLS.
create policy mafia_member_receive on realtime.messages for select to authenticated
  using (extension in ('broadcast', 'presence') and (select public.is_mafia_room_member()) and split_part(realtime.topic(), ':', 1) = 'mafia-room');
create policy mafia_member_presence on realtime.messages for insert to authenticated
  with check (extension = 'presence' and (select public.is_mafia_room_member()) and split_part(realtime.topic(), ':', 1) = 'mafia-room');
