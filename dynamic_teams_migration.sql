-- Run this once on an existing Sig Tau hunt database before deploying the unlimited-team build.

alter table public.team_progress_sigtau
  add column if not exists sequence jsonb not null default '[]'::jsonb;

alter table public.team_progress_sigtau
  alter column started_at set default 0;

alter table public.team_progress_sigtau
  alter column last_updated_at set default 0;

update public.team_progress_sigtau
set sequence = case team_id
  when 'Team1' then '[1,2,3,4,5,6,7,8,9,10,11]'::jsonb
  when 'Team2' then '[5,1,8,2,9,3,6,4,10,7,11]'::jsonb
  when 'Team3' then '[7,4,2,10,1,9,5,8,3,6,11]'::jsonb
  when 'Team4' then '[3,6,1,9,4,7,10,2,8,5,11]'::jsonb
  when 'Team5' then '[8,10,5,7,2,6,4,1,9,3,11]'::jsonb
  else sequence
end
where team_id in ('Team1', 'Team2', 'Team3', 'Team4', 'Team5')
  and (sequence is null or sequence = '[]'::jsonb);

insert into public.team_progress_sigtau
  (team_id, team_name, sequence, progress_index, completed, scanned_tokens, used_hints, next_hint_at, finished, started_at, last_updated_at, map_enabled)
values
  ('__settings__', 'Shared Settings', '[]'::jsonb, 0, '[]'::jsonb, '[]'::jsonb, 0, null, false, 0, 0, true)
on conflict (team_id) do nothing;

delete from public.team_progress_sigtau
where team_id in ('Team1', 'Team2', 'Team3', 'Team4', 'Team5')
  and progress_index = 0
  and completed = '[]'::jsonb
  and scanned_tokens = '[]'::jsonb
  and used_hints = 0
  and next_hint_at is null
  and finished = false
  and started_at = 0
  and last_updated_at = 0
  and team_name in ('Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5');

delete from public.leaderboard_sigtau
where team_id in ('Team1', 'Team2', 'Team3', 'Team4', 'Team5')
  and found = 0
  and finished = false
  and last_updated_at = 0
  and team_name in ('Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5');
