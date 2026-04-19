# Loading the Rungles dictionary

The `rg_words` table is created by `migration-001-initial.sql` but left empty —
the migration would balloon to many MB if it included the word list inline, and
re-running the migration shouldn't have to reload 172K rows.

Source list: `rungles/data/words.txt` (172,041 words, one per line, uppercase).

## Option A — Supabase SQL Editor (easiest, one-time)

Supabase doesn't support `\copy` in the web SQL editor. Use option B or C
instead, or import via the Table Editor's CSV import on the `rg_words` table.

## Option B — `psql` with `\copy` (recommended)

Get the connection string from Supabase dashboard → Project Settings → Database
→ Connection string (URI). Then:

```bash
psql "postgresql://postgres.<ref>:<pw>@<host>:6543/postgres" \
  -c "TRUNCATE rg_words;" \
  -c "\copy rg_words(word) FROM 'rungles/data/words.txt' WITH (FORMAT text);"
```

`\copy` runs client-side, so the file path is your local path, not a server path.

## Option C — Supabase MCP (one-shot, slow)

Inside a Claude Code session with the Supabase MCP connected, ask:

> Load `rungles/data/words.txt` into `rg_words` (column `word`), batched.

This issues batched `INSERT ... ON CONFLICT DO NOTHING` calls. Slower than
`\copy` (multiple round trips) but doesn't require psql.

## Verify

```sql
SELECT count(*) FROM rg_words;          -- expect ~172041
SELECT count(*) FROM rg_words WHERE length(word) >= 4;  -- words usable in Rungles
SELECT EXISTS (SELECT 1 FROM rg_words WHERE word = 'STORM');  -- should be true
```

## Re-loading

The migration's `IF NOT EXISTS` keeps existing rows. To replace the dictionary:

```sql
TRUNCATE rg_words;
-- then re-run \copy
```
