create table if not exists public.leaderboard (
  email_hash text primary key,
  display_name text not null,
  full_name text not null default '',
  email text not null default '',
  score integer not null default 0 check (score >= 0),
  updated_at timestamptz not null default now()
);

alter table public.leaderboard
  add column if not exists full_name text not null default '';

alter table public.leaderboard
  add column if not exists email text not null default '';

create table if not exists public.game_sessions (
  session_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 minutes'),
  consumed boolean not null default false,
  hits_count integer not null default 0,
  last_hit_at timestamptz
);

alter table public.game_sessions
  add column if not exists hits_count integer not null default 0;

alter table public.game_sessions
  add column if not exists last_hit_at timestamptz;

alter table public.game_sessions enable row level security;

alter table public.leaderboard enable row level security;

drop policy if exists "public_read_leaderboard" on public.leaderboard;
drop policy if exists "authenticated_read_leaderboard" on public.leaderboard;
create policy "public_read_leaderboard"
on public.leaderboard
for select
using (true);

create policy "authenticated_read_leaderboard"
on public.leaderboard
for select
to authenticated
using (true);

revoke insert, update, delete on public.leaderboard from anon, authenticated;
revoke select on public.leaderboard from anon, authenticated;
grant select (display_name, score, updated_at) on public.leaderboard to anon, authenticated;
grant select (full_name, email) on public.leaderboard to authenticated;
grant select (email_hash) on public.leaderboard to authenticated;
revoke all on public.game_sessions from anon, authenticated;

create or replace function public.create_game_session()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  insert into public.game_sessions default values
  returning session_id into v_session_id;
  return v_session_id;
end;
$$;

create or replace function public.submit_score(
  p_session_id uuid,
  p_email_hash text,
  p_display_name text,
  p_full_name text,
  p_email text,
  p_client_score integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_at timestamptz;
  v_expires_at timestamptz;
  v_consumed boolean;
  v_hits_count integer;
  v_elapsed_seconds numeric;
  v_max_allowed_score integer;
  v_server_score integer;
begin
  if p_session_id is null then
    raise exception 'game session missing or expired';
  end if;
  if p_email_hash is null or length(trim(p_email_hash)) = 0 then
    raise exception 'email hash required';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'display name required';
  end if;
  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'full name required';
  end if;
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'email required';
  end if;
  if p_client_score is null or p_client_score < 0 then
    raise exception 'client score required';
  end if;
  select created_at, expires_at, consumed, hits_count
    into v_created_at, v_expires_at, v_consumed, v_hits_count
  from public.game_sessions
  where session_id = p_session_id
  for update;

  if not found or v_consumed or now() > v_expires_at then
    raise exception 'game session missing or expired';
  end if;

  v_elapsed_seconds := greatest(1, extract(epoch from (now() - v_created_at)));
  v_max_allowed_score := floor((v_elapsed_seconds / 0.8) + 2);
  v_server_score := greatest(0, v_hits_count);

  if v_server_score > v_max_allowed_score then
    raise exception 'score exceeds allowed pace';
  end if;

  -- Combojeger score is client-visible points. For anti-cheat we bound it by hit count:
  -- minimum points for n hits is n; maximum (perfect combo) is n^2 + 9n.
  if p_client_score < v_hits_count then
    raise exception 'client score below hit count';
  end if;
  if p_client_score > (v_hits_count * v_hits_count) + (9 * v_hits_count) then
    raise exception 'client score exceeds combo cap';
  end if;

  update public.game_sessions
  set consumed = true
  where session_id = p_session_id;

  insert into public.leaderboard (email_hash, display_name, full_name, email, score, updated_at)
  values (p_email_hash, p_display_name, p_full_name, p_email, p_client_score, now())
  on conflict (email_hash) do update
    set display_name = excluded.display_name,
        full_name = excluded.full_name,
        email = excluded.email,
        score = greatest(public.leaderboard.score, excluded.score),
        updated_at = now();
end;
$$;

create or replace function public.register_hit(
  p_session_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created_at timestamptz;
  v_expires_at timestamptz;
  v_consumed boolean;
  v_last_hit_at timestamptz;
  v_hits_count integer;
  v_elapsed_seconds numeric;
  v_max_hits_allowed integer;
begin
  if p_session_id is null then
    raise exception 'game session missing or expired';
  end if;

  select created_at, expires_at, consumed, last_hit_at, hits_count
    into v_created_at, v_expires_at, v_consumed, v_last_hit_at, v_hits_count
  from public.game_sessions
  where session_id = p_session_id
  for update;

  if not found or v_consumed or now() > v_expires_at then
    raise exception 'game session missing or expired';
  end if;

  if v_last_hit_at is not null and now() - v_last_hit_at < interval '700 milliseconds' then
    raise exception 'hit rate too high';
  end if;

  v_elapsed_seconds := greatest(1, extract(epoch from (now() - v_created_at)));
  v_max_hits_allowed := floor((v_elapsed_seconds / 0.8) + 2);
  if v_hits_count + 1 > v_max_hits_allowed then
    raise exception 'hit count exceeds elapsed time';
  end if;

  update public.game_sessions
  set hits_count = hits_count + 1,
      last_hit_at = now()
  where session_id = p_session_id
  returning hits_count into v_hits_count;

  return v_hits_count;
end;
$$;

create or replace function public.delete_highscore_entry(
  p_email_hash text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if p_email_hash is null or length(trim(p_email_hash)) = 0 then
    raise exception 'email hash required';
  end if;

  delete from public.leaderboard
  where email_hash = p_email_hash;
end;
$$;

grant execute on function public.create_game_session() to anon, authenticated;
grant execute on function public.register_hit(uuid) to anon, authenticated;
grant execute on function public.submit_score(uuid, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.delete_highscore_entry(text) to authenticated;
