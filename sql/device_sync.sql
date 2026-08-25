-- Cross-PC account sync for trade-sequencer.js / core/device-sync.js.
-- Run once in the Supabase project's SQL editor (Project > SQL Editor > New query).
--
-- Same trust model as the existing `users`/`figures` tables this project already has
-- (see core/supabase.js): no RLS, reachable with the public anon key shipped in the
-- extension. The sync_code column is what keeps different people's PCs from seeing each
-- other in the app's UI — it is NOT real access control, just isolation for normal usage.

create table if not exists gheloo_sync_presence (
  sync_code    text not null,
  device_id    text not null,
  tab_id       text not null,
  account_name text not null,
  last_seen    timestamptz not null default now(),
  primary key (sync_code, device_id, tab_id)
);

create index if not exists gheloo_sync_presence_code_idx
  on gheloo_sync_presence (sync_code, last_seen);

create table if not exists gheloo_sync_commands (
  id                bigint generated always as identity primary key,
  sync_code         text not null,
  target_device_id  text not null,
  target_tab_id     text not null,
  payload           text not null,
  created_at        timestamptz not null default now()
);

create index if not exists gheloo_sync_commands_target_idx
  on gheloo_sync_commands (sync_code, target_device_id, target_tab_id, id);

-- Commands are deleted right after the receiving tab executes them (see
-- core/device-sync.js pollCommands), but this is a backstop in case a tab never comes
-- back to pick up its queued packets (closed mid-sequence, etc).
create index if not exists gheloo_sync_commands_created_idx
  on gheloo_sync_commands (created_at);
