-- Two separate furni datasets, kept apart on purpose:
--   furnis        — only offers actually seen in the catalog (buyable), scanned by
--                   Room Clone (extensions/rooms/room-clone.js) walking real catalog pages.
--   furni_master  — EVERY furni type that exists in this hotel's furnidata, buyable or
--                   not (event/quest/wired-effect/etc. types never show up in a catalog
--                   scan at all). Synced straight from window.FurniData (core/parsers.js
--                   already fetches leet_furni.json in every player's browser — no VM-side
--                   fetch needed, which is good because Cloudflare challenges that CDN for
--                   datacenter IPs; a real player's browser is never a problem).
--
-- Run once on the VM via psql, then `docker restart gheloo-db-postgrest-1`.

alter table furnis add column if not exists furni_name text;

-- Composite key: 27 ids collide between floor and wall furnitype in this hotel's
-- furnidata, so type_id alone would let a wall item silently clobber a floor item.
create table if not exists furni_master (
  type_id     bigint not null,
  name        text,
  description text,
  classname   text,
  is_wall     boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (type_id, is_wall)
);

grant select,insert,update,delete on furni_master to anon;
