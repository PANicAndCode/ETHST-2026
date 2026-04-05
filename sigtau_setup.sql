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
  progress_index integer not null default 0,
  completed jsonb not null default '[]'::jsonb,
  scanned_tokens jsonb not null default '[]'::jsonb,
  used_hints integer not null default 0,
  next_hint_at bigint,
  finished boolean not null default false,
  started_at bigint not null,
  last_updated_at bigint not null,
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

alter publication supabase_realtime add table public.leaderboard_sigtau;
alter publication supabase_realtime add table public.team_progress_sigtau;

insert into public.team_progress_sigtau
  (team_id, team_name, progress_index, completed, scanned_tokens, used_hints, next_hint_at, finished, started_at, last_updated_at, map_enabled)
values
  ('Team1', 'Team 1', 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true),
  ('Team2', 'Team 2', 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true),
  ('Team3', 'Team 3', 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true),
  ('Team4', 'Team 4', 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true),
  ('Team5', 'Team 5', 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true),
  ('__settings__', 'Shared Settings', 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true)
on conflict (team_id) do nothing;

insert into public.leaderboard_sigtau
  (team_id, team_name, found, finished, last_updated_at)
values
  ('Team1', 'Team 1', 0, false, 0),
  ('Team2', 'Team 2', 0, false, 0),
  ('Team3', 'Team 3', 0, false, 0),
  ('Team4', 'Team 4', 0, false, 0),
  ('Team5', 'Team 5', 0, false, 0)
on conflict (team_id) do nothing;

-- Reset script
-- update public.team_progress_sigtau set progress_index = 0, completed = '[]'::jsonb, scanned_tokens = '[]'::jsonb, used_hints = 0, next_hint_at = null, finished = false, started_at = 0, last_updated_at = 0 where team_id <> '__settings__';
-- update public.leaderboard_sigtau set found = 0, finished = false, last_updated_at = 0;
-- update public.team_progress_sigtau set map_enabled = true where team_id = '__settings__';
