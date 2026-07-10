-- ============================================================
-- Rungles — played_daily check function for the hub daily-reminder
-- registry (sq_unplayed_dailies). Returns true iff the user has a
-- completed solo daily (rg_solo_games row) for the given Atlantic-date
-- ymd. Mirrors yahdle_played_daily / snibble_played_daily.
--
-- Pre-daily free-play history rows have play_date = NULL; filtering on
-- play_date = ymd correctly ignores them (NULL never matches ymd).
-- ============================================================

create or replace function public.rungles_played_daily(uid uuid, ymd date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.rg_solo_games
    where user_id = uid and play_date = ymd
  );
$$;

grant execute on function public.rungles_played_daily(uuid, date)
  to authenticated, service_role;
