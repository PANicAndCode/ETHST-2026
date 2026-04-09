-- Sig Tau Easter Treasure Hunt setup
create table if not exists public.leaderboard_sigtau (
  team_id text primary key,
  team_name text not null,
  found integer not null default 0,
  finished boolean not null default false,
  last_updated_at bigint not null
);

create table if not exists public.team_progress_sigtau (
  team_id text primary key,
  team_name text not null,
  sequence jsonb not null default '[]'::jsonb,
  progress_index integer not null default 0,
  completed jsonb not null default '[]'::jsonb,
  scanned_tokens jsonb not null default '[]'::jsonb,
  used_hints integer not null default 0,
  next_hint_at bigint,
  finished boolean not null default false,
  started_at bigint not null default 0,
  last_updated_at bigint not null default 0,
  map_enabled boolean
);

alter table public.leaderboard_sigtau enable row level security;
alter table public.team_progress_sigtau enable row level security;

drop policy if exists "leaderboard_sigtau read" on public.leaderboard_sigtau;
create policy "leaderboard_sigtau read" on public.leaderboard_sigtau for select to anon using (true);

drop policy if exists "leaderboard_sigtau insert" on public.leaderboard_sigtau;
create policy "leaderboard_sigtau insert" on public.leaderboard_sigtau for insert to anon with check (true);

drop policy if exists "leaderboard_sigtau update" on public.leaderboard_sigtau;
create policy "leaderboard_sigtau update" on public.leaderboard_sigtau for update to anon using (true) with check (true);

drop policy if exists "progress_sigtau read" on public.team_progress_sigtau;
create policy "progress_sigtau read" on public.team_progress_sigtau for select to anon using (true);

drop policy if exists "progress_sigtau insert" on public.team_progress_sigtau;
create policy "progress_sigtau insert" on public.team_progress_sigtau for insert to anon with check (true);

drop policy if exists "progress_sigtau update" on public.team_progress_sigtau;
create policy "progress_sigtau update" on public.team_progress_sigtau for update to anon using (true) with check (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'leaderboard_sigtau'
  ) then
    alter publication supabase_realtime add table public.leaderboard_sigtau;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication p
    join pg_publication_rel pr on pr.prpubid = p.oid
    join pg_class c on c.oid = pr.prrelid
    join pg_namespace n on n.oid = c.relnamespace
    where p.pubname = 'supabase_realtime'
      and n.nspname = 'public'
      and c.relname = 'team_progress_sigtau'
  ) then
    alter publication supabase_realtime add table public.team_progress_sigtau;
  end if;
end $$;

insert into public.team_progress_sigtau
  (team_id, team_name, sequence, progress_index, completed, scanned_tokens, used_hints, next_hint_at, finished, started_at, last_updated_at, map_enabled)
values
  ('__settings__', 'Shared Settings', '[]'::jsonb, 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true)
on conflict (team_id) do nothing;

-- Reset script
-- delete from public.team_progress_sigtau where team_id <> '__settings__';
-- delete from public.leaderboard_sigtau;
-- update public.team_progress_sigtau set map_enabled = true where team_id = '__settings__';
