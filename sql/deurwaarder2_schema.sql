-- Backing tables for deurwaarder2-site (deurwaarder2.databin.uk) — a blank second instance
-- of deurwaarder-site, requested so a fresh/empty case-management dashboard exists
-- alongside the original without touching its data.
--
-- Unlike the original deurwaarder.databin.uk, which lives on a real managed Supabase.co
-- project (qwcfsqsrtegyvvwkzcgb — see sql/holders.sql), this one is a genuinely separate
-- database: the same self-hosted Postgres+PostgREST instance every other databin.uk site
-- already shares (see core/supabase.js) — no third-party project to sign up for, and
-- table names here don't collide with anything else already on that instance (mp_*,
-- bot_accounts, item_overview, inventory_items, users, ...).
--
-- Run once on the VM via psql/Adminer, then NOTIFY pgrst to reload the schema cache.
-- Same trust model as every other table on this instance: no RLS, reachable with the
-- shared public anon key.

create table if not exists ss_items (
  id                text primary key,              -- "SS-0001" style, see generateAssetId()
  item_name         text not null,
  current_holder    text,
  current_status    text not null default 'active', -- active | traded | pullbacked | lost
  count_in_inventory boolean not null default true,
  is_duped          boolean not null default false,
  acquired_via      text,
  item_holder       text,                            -- pullback claim: who's supposed to physically hold it
  linked_asset_id   text,                             -- the original asset a duped copy points back to
  pb_code           text,                             -- "PB-0001" style, see generatePbCode()
  notes             text,
  created_at        timestamptz not null default now()
);

create table if not exists ss_item_events (
  id                bigserial primary key,
  item_id           text,                             -- references ss_items.id, no FK (an item can be deleted
                                                        -- while its history stays, and a pure-BC event has none)
  event_type        text not null,                     -- manual_update | marketplace_sale | dupe | pullback
  reason            text,                               -- CREATED | EDITED | LOST | RESTORED | ...
  trade_code        text,
  scammed_user      text,
  from_holder        text,
  to_holder          text,
  bc_amount         bigint,
  bc_given          bigint,
  bc_counted        boolean not null default false,
  bc_given_counted  boolean not null default false,
  notes             text,
  items_given       text,
  items_received    text,
  scam_type         text,
  timestamp         timestamptz not null default now()
);

create table if not exists banned_holders (
  holder     text primary key,
  created_at timestamptz not null default now()
);

create table if not exists holders (
  holder     text primary key,
  password   text,
  created_at timestamptz not null default now()
);

create table if not exists bc_balances (
  holder text primary key,
  amount bigint not null default 0
);

create table if not exists dashboard_snapshots (
  date               date primary key,
  inventory_worth    bigint default 0,
  ready_for_pullback bigint default 0,
  in_inventory       bigint default 0,
  pulled_back        bigint default 0,
  lost               bigint default 0,
  unique_victims     bigint default 0,
  active_holders     bigint default 0
);

create table if not exists ss_item_catalog (
  item_name text primary key,
  image_url text,
  value     bigint
);

-- Legacy tables doClearDatabase still references (delete-only in the current app.js) —
-- created empty so that action doesn't 404 on a fresh instance; nothing else writes to them.
create table if not exists ss_trades (
  id bigserial primary key
);
create table if not exists ss_trade_items (
  id bigserial primary key
);

grant select, insert, update, delete on
  ss_items, ss_item_events, banned_holders, holders, bc_balances,
  dashboard_snapshots, ss_item_catalog, ss_trades, ss_trade_items
to anon;

notify pgrst, 'reload schema';
