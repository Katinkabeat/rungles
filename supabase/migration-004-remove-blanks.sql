-- migration-004-remove-blanks.sql
-- Removes blank ('_') tiles from the multiplayer tile bag.
-- Replaces rg_make_bag() so new games are dealt without wildcards.
-- Existing in-progress games keep whatever bag they were created with.

CREATE OR REPLACE FUNCTION rg_make_bag()
RETURNS text[]
LANGUAGE plpgsql
AS $func$
DECLARE
  v_bag text[] := ARRAY[]::text[];
  v_counts jsonb := '{
    "A":9,"B":2,"C":2,"D":4,"E":12,"F":2,"G":3,"H":2,"I":9,"J":1,
    "K":1,"L":4,"M":2,"N":6,"O":8,"P":2,"Q":1,"R":6,"S":4,"T":6,
    "U":4,"V":2,"W":2,"X":1,"Y":2,"Z":1
  }'::jsonb;
  v_letter text;
  v_count int;
  i int;
BEGIN
  FOR v_letter, v_count IN SELECT * FROM jsonb_each_text(v_counts) LOOP
    FOR i IN 1..v_count::int LOOP
      v_bag := array_append(v_bag, v_letter);
    END LOOP;
  END LOOP;
  SELECT array_agg(x ORDER BY random()) INTO v_bag FROM unnest(v_bag) x;
  RETURN v_bag;
END;
$func$;
