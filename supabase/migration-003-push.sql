-- ============================================================
-- RUNGLES — Push Notification Trigger
-- Run this in: Supabase → SQL Editor → New Query
-- ============================================================
--
-- Reuses Wordy's public.push_subscriptions table. This migration
-- only adds the trigger for Rungles turn changes — the table and
-- its RLS policies are already set up by Wordy's migration.
--
-- Calls the rungles-push-notification Edge Function via pg_net
-- whenever a player's turn starts in an active Rungles game.

CREATE OR REPLACE FUNCTION public.rg_notify_turn_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/rungles-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Rungles push trigger failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_rg_turn_change ON public.rg_games;
CREATE TRIGGER on_rg_turn_change
AFTER UPDATE ON public.rg_games
FOR EACH ROW
WHEN (NEW.status = 'active' AND OLD.current_player_idx IS DISTINCT FROM NEW.current_player_idx)
EXECUTE FUNCTION public.rg_notify_turn_change();
