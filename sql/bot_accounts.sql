-- Backing table for accounts-site (accounts.databin.uk).
-- Run once on the VM via psql/Adminer, then `docker compose restart postgrest`
-- (it caches the schema, won't see new tables until restarted) — see the matching
-- comment in core/supabase.js for the full self-host setup.
--
-- Same trust model as the other gheloo_* / users tables: no RLS, reachable with the
-- public anon key shipped in accounts-site/app.js.

create table if not exists bot_accounts (
  username    text primary key,
  password    text not null,
  account     bigint,
  vrienden    int,
  rank        int,
  category    text check (category in ('goud', 'groen', 'rood')),
  note        text,
  source_list text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
