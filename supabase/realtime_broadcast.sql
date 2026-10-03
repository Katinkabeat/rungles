-- Rungles: Realtime via "Broadcast from database" (realtime.send) instead of
-- postgres_changes. Idempotent; safe to re-run.
--
-- Topics (prefixed because the Supabase project is shared with other SQ games):
--   rungles:game:<game_id>   players (and creator) of that game; in-game events
--   rungles:user:<user_id>   lobby feed for one user
-- Event name: 'change'. Payload:
--   { table, event, game_id, user_id?, status, old_status?, new }
--   rg_games   (INSERT/UPDATE/DELETE): new = full row (client does setGame(new));
--              old_status = previous status on UPDATE (finish-toast detection)
--   rg_players (INSERT/UPDATE/DELETE): new = { id, game_id, user_id, player_idx, score }
--   rg_rungs   (INSERT, game topic only): new = full row
-- rg_racks is not broadcast: no client subscribes to it (racks are re-fetched
-- on rg_games UPDATE).

-- ── 1. Trigger function ──────────────────────────────────────
create or replace function public.rg_broadcast_game_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_status  text;
  v_creator uuid;
  v_invited uuid;
  v_payload jsonb;
  v_uid     uuid;
  v_row     jsonb;
  v_old_status text;
begin
  v_row := to_jsonb(coalesce(NEW, OLD));

  if TG_TABLE_NAME = 'rg_games' then
    v_game_id := (v_row ->> 'id')::uuid;
    v_status  := v_row ->> 'status';
    v_creator := (v_row ->> 'created_by')::uuid;
    v_invited := (v_row ->> 'invited_user_id')::uuid;
    if TG_OP = 'UPDATE' then v_old_status := to_jsonb(OLD) ->> 'status'; end if;
    v_payload := jsonb_build_object(
      'table',   'rg_games',
      'event',   TG_OP,
      'game_id', v_game_id,
      'status',  v_status,
      'old_status', v_old_status,
      'new',     v_row
    );
  else
    -- rg_players / rg_rungs: use OLD on DELETE (NEW is null there)
    v_game_id := (v_row ->> 'game_id')::uuid;
    if v_game_id is null then
      return coalesce(NEW, OLD);
    end if;
    select g.status, g.created_by, g.invited_user_id
      into v_status, v_creator, v_invited
      from public.rg_games g where g.id = v_game_id;

    if TG_TABLE_NAME = 'rg_players' then
      v_uid := (v_row ->> 'user_id')::uuid;
      v_payload := jsonb_build_object(
        'table',   'rg_players',
        'event',   TG_OP,
        'game_id', v_game_id,
        'user_id', v_uid,
        'status',  v_status,
        'new', jsonb_build_object(
          'id',         v_row -> 'id',
          'game_id',    v_row -> 'game_id',
          'user_id',    v_row -> 'user_id',
          'player_idx', v_row -> 'player_idx',
          'score',      v_row -> 'score'
        )
      );
    else
      -- rg_rungs: in-game only, game topic below (no lobby fan-out)
      v_payload := jsonb_build_object(
        'table',   'rg_rungs',
        'event',   TG_OP,
        'game_id', v_game_id,
        'status',  v_status,
        'new',     v_row
      );
    end if;
  end if;

  begin
    perform realtime.send(v_payload, 'change', 'rungles:game:' || v_game_id::text, true);

    if TG_TABLE_NAME <> 'rg_rungs' then
      -- One lobby message per distinct user: every player in the game, the
      -- creator, the invited friend, and (rg_players events) the row's own
      -- user, who may have just been removed from the table.
      for v_uid in
        select gp.user_id from public.rg_players gp where gp.game_id = v_game_id
        union
        select v_creator where v_creator is not null
        union
        select v_invited where v_invited is not null
        union
        select (v_row ->> 'user_id')::uuid
          where TG_TABLE_NAME = 'rg_players' and (v_row ->> 'user_id') is not null
      loop
        perform realtime.send(v_payload, 'change', 'rungles:user:' || v_uid::text, true);
      end loop;
    end if;
  exception when others then
    -- A Realtime hiccup must never abort the game write.
    raise warning 'rg_broadcast_game_change failed: %', sqlerrm;
  end;

  return coalesce(NEW, OLD);
end;
$$;

-- ── 2. Triggers ──────────────────────────────────────────────
drop trigger if exists rg_games_broadcast on public.rg_games;
create trigger rg_games_broadcast
  after insert or update or delete on public.rg_games
  for each row execute function public.rg_broadcast_game_change();

drop trigger if exists rg_players_broadcast on public.rg_players;
create trigger rg_players_broadcast
  after insert or update or delete on public.rg_players
  for each row execute function public.rg_broadcast_game_change();

drop trigger if exists rg_rungs_broadcast on public.rg_rungs;
create trigger rg_rungs_broadcast
  after insert on public.rg_rungs
  for each row execute function public.rg_broadcast_game_change();

-- ── 3. Realtime authorization (private channels) ─────────────
-- SECURITY DEFINER helper so the policy doesn't recurse through rg_players
-- RLS. Ignores malformed topics instead of erroring.
create or replace function public.rg_can_read_game_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_topic ~ '^rungles:game:[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.rg_games g
      where g.id = substr(p_topic, 14)::uuid
        and (
          g.created_by = (select auth.uid())
          or g.invited_user_id = (select auth.uid())
          or exists (
            select 1 from public.rg_players gp
            where gp.game_id = g.id and gp.user_id = (select auth.uid())
          )
        )
    );
$$;

drop policy if exists "rungles_realtime_game_topic_select" on realtime.messages;
create policy "rungles_realtime_game_topic_select"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and public.rg_can_read_game_topic(realtime.topic())
  );

drop policy if exists "rungles_realtime_user_topic_select" on realtime.messages;
create policy "rungles_realtime_user_topic_select"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and realtime.topic() = 'rungles:user:' || (select auth.uid())::text
  );

-- ── 4. NOT EXECUTED: run only AFTER the broadcast client has shipped ──
-- Removes the old postgres_changes sources (WAL decode load). Running this
-- earlier would break clients still on the old build.
-- alter publication supabase_realtime drop table public.rg_games, public.rg_players, public.rg_racks, public.rg_rungs;
