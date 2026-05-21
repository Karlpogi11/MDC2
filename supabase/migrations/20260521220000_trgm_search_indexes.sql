-- Enable trigram extension for fast ILIKE search
-- pg_trgm breaks text into 3-character chunks and indexes them.
-- This turns ILIKE '%abc%' from a full table scan into an index lookup.
create extension if not exists pg_trgm;

-- Trigram indexes on the columns users search most
create index if not exists idx_parts_part_name_trgm
  on public.parts using gin (part_name gin_trgm_ops);

create index if not exists idx_parts_part_number_trgm
  on public.parts using gin (part_number gin_trgm_ops);

create index if not exists idx_serial_numbers_serial_trgm
  on public.serial_numbers using gin (serial_number gin_trgm_ops);

-- inventory_snapshot is a view — trigram search hits the base tables above
-- so the indexes above cover snapshot queries too.
