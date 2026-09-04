-- Adds first_seen to inventory_items (items.databin.uk) so the Dashboard's growth chart
-- can tell "genuinely new item" apart from "re-imported, still the same item".
--
-- The import flow (items-site/app.js's importInventoryItems) deletes and re-inserts every
-- row for each owner on every re-import — without this column carried forward explicitly
-- in app.js (it fetches each item_id's existing first_seen before deleting, and reuses it),
-- a plain DEFAULT now() would silently reset to "just imported" on every single re-scan.
--
-- Run once on the VM via psql/Adminer, then NOTIFY pgrst to reload the schema cache.

alter table inventory_items add column if not exists first_seen timestamptz not null default now();

notify pgrst, 'reload schema';
