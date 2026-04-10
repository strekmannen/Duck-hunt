create table if not exists public.leaderboard (
  email_hash text primary key,
  display_name text not null,
  full_name text not null default '',
  email text not null default '',
  score integer not null default 0 check (score >= 0),
  updated_at timestamptz not null default now()
);

alter table public.leaderboard enable row level security;

drop policy if exists "public_read_leaderboard" on public.leaderboard;
create policy "public_read_leaderboard"
on public.leaderboard
for select
using (true);

revoke insert, update, delete on public.leaderboard from anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

create or replace function public.submit_score(
  p_email_hash text,
  p_display_name text,
  p_full_name text,
  p_email text,
  p_score integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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
  if p_score is null or p_score < 0 then
    raise exception 'score must be >= 0';
  end if;

  insert into public.leaderboard (email_hash, display_name, full_name, email, score, updated_at)
  values (p_email_hash, p_display_name, p_full_name, p_email, p_score, now())
  on conflict (email_hash) do update
    set display_name = excluded.display_name,
        full_name = excluded.full_name,
        email = excluded.email,
        score = greatest(public.leaderboard.score, excluded.score),
        updated_at = now();
end;
$$;

grant execute on function public.submit_score(text, text, text, text, integer) to anon, authenticated;
