-- Backing table for furnis-site (furnis.databin.uk) and the Room Clone catalog scan
-- (extensions/rooms/room-clone.js) — every Gheloo user's scanned catalog offers land
-- here so scan progress is shared across everyone running the extension, instead of
-- each browser profile starting from zero and re-walking pages others already found.
-- Run once on the VM via psql, then `docker restart gheloo-db-postgrest-1`
-- (it caches the schema, won't see new tables until restarted).
--
-- Same trust model as the other gheloo_* / users tables: no RLS, reachable with the
-- public anon key shared across all gheloo-*-site app.js / room-clone.js.

create table if not exists furnis (
  offer_id    bigint primary key,
  name        text,
  page_id     int,
  page_title  text,
  ints        int[],
  updated_at  timestamptz not null default now()
);
