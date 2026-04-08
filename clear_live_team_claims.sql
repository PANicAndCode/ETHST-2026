-- Clears the current live team claim state and restores default team names.
-- Run this once in Supabase SQL Editor if the live site is still treating teams as locked.

update public.team_progress_sigtau
set
  team_name = case team_id
    when 'Team1' then 'Team 1'
    when 'Team2' then 'Team 2'
    when 'Team3' then 'Team 3'
    when 'Team4' then 'Team 4'
    when 'Team5' then 'Team 5'
    else team_name
  end,
  progress_index = 0,
  completed = '[]'::jsonb,
  scanned_tokens = '[]'::jsonb,
  used_hints = 0,
  next_hint_at = null,
  finished = false,
  started_at = 0,
  last_updated_at = 0
where team_id in ('Team1', 'Team2', 'Team3', 'Team4', 'Team5');

update public.leaderboard_sigtau
set
  team_name = case team_id
    when 'Team1' then 'Team 1'
    when 'Team2' then 'Team 2'
    when 'Team3' then 'Team 3'
    when 'Team4' then 'Team 4'
    when 'Team5' then 'Team 5'
    else team_name
  end,
  found = 0,
  finished = false,
  last_updated_at = 0
where team_id in ('Team1', 'Team2', 'Team3', 'Team4', 'Team5');
