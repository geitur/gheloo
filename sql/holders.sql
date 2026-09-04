-- Backing table for deurwaarder-site (deurwaarder.databin.uk).
-- Run once in the Supabase.co project's SQL Editor (project qwcfsqsrtegyvvwkzcgb —
-- same project deurwaarder.js and marktplaats-notes.js already talk to). No VM/psql
-- step needed here — this is the managed Supabase project, not the self-hosted one.
--
-- Holders used to only ever exist as a byproduct of owning at least one ss_items row —
-- this table lets one exist standalone (a manually-added account with nothing yet) and
-- gives each holder an optional password field, shown/edited on the Holders page.
-- Same trust model as the rest of this project's tables: no RLS, reachable with the
-- public anon key already shipped in deurwaarder-site/deurwaarder.js.

create table if not exists holders (
  holder     text primary key,
  password   text,
  created_at timestamptz not null default now()
);
