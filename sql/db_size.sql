-- Exposes total Postgres data size (all tables combined) through PostgREST so the
-- hub (hub.databin.uk) can show a rough "database used" percentage against the
-- 200GB Oracle Cloud Always Free volume this VM runs on (see core/supabase.js for
-- the full self-host setup). A view (not a table) since it's a live computed value.
-- Run once on the VM via psql, then `docker restart gheloo-db-postgrest-1`.

create or replace view db_size as
select pg_database_size(current_database()) as bytes;

grant select on db_size to anon;
