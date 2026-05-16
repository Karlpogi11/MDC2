-- Seed active parts: iPhone 13–17 Battery and Display
-- Uses ON CONFLICT DO NOTHING so re-running is safe

insert into public.parts (part_number, part_name, category, part_type, is_active) values
  -- iPhone 13 series
  ('661-20198', 'Battery - iPhone 13',              'Battery', 'product', true),
  ('661-20199', 'Battery - iPhone 13 Mini',         'Battery', 'product', true),
  ('661-20200', 'Battery - iPhone 13 Pro',          'Battery', 'product', true),
  ('661-20201', 'Battery - iPhone 13 Pro Max',      'Battery', 'product', true),
  ('661-20202', 'Display Assembly - iPhone 13',     'Display', 'product', true),
  ('661-20203', 'Display Assembly - iPhone 13 Mini','Display', 'product', true),
  ('661-20204', 'Display Assembly - iPhone 13 Pro', 'Display', 'product', true),
  ('661-20205', 'Display Assembly - iPhone 13 Pro Max','Display','product',true),

  -- iPhone 14 series
  ('661-21000', 'Battery - iPhone 14',              'Battery', 'product', true),
  ('661-21001', 'Battery - iPhone 14 Plus',         'Battery', 'product', true),
  ('661-21002', 'Battery - iPhone 14 Pro',          'Battery', 'product', true),
  ('661-21003', 'Battery - iPhone 14 Pro Max',      'Battery', 'product', true),
  ('661-21004', 'Display Assembly - iPhone 14',     'Display', 'product', true),
  ('661-21005', 'Display Assembly - iPhone 14 Plus','Display', 'product', true),
  ('661-21006', 'Display Assembly - iPhone 14 Pro', 'Display', 'product', true),
  ('661-21007', 'Display Assembly - iPhone 14 Pro Max','Display','product',true),

  -- iPhone 15 series
  ('661-22000', 'Battery - iPhone 15',              'Battery', 'product', true),
  ('661-22001', 'Battery - iPhone 15 Plus',         'Battery', 'product', true),
  ('661-22002', 'Battery - iPhone 15 Pro',          'Battery', 'product', true),
  ('661-22003', 'Battery - iPhone 15 Pro Max',      'Battery', 'product', true),
  ('661-22004', 'Display Assembly - iPhone 15',     'Display', 'product', true),
  ('661-22005', 'Display Assembly - iPhone 15 Plus','Display', 'product', true),
  ('661-22006', 'Display Assembly - iPhone 15 Pro', 'Display', 'product', true),
  ('661-22007', 'Display Assembly - iPhone 15 Pro Max','Display','product',true),

  -- iPhone 16 series
  ('661-23000', 'Battery - iPhone 16',              'Battery', 'product', true),
  ('661-23001', 'Battery - iPhone 16 Plus',         'Battery', 'product', true),
  ('661-23002', 'Battery - iPhone 16 Pro',          'Battery', 'product', true),
  ('661-23003', 'Battery - iPhone 16 Pro Max',      'Battery', 'product', true),
  ('661-23004', 'Display Assembly - iPhone 16',     'Display', 'product', true),
  ('661-23005', 'Display Assembly - iPhone 16 Plus','Display', 'product', true),
  ('661-23006', 'Display Assembly - iPhone 16 Pro', 'Display', 'product', true),
  ('661-23007', 'Display Assembly - iPhone 16 Pro Max','Display','product',true),

  -- iPhone 17 series (anticipated part numbers)
  ('661-24000', 'Battery - iPhone 17',              'Battery', 'product', true),
  ('661-24001', 'Battery - iPhone 17 Plus',         'Battery', 'product', true),
  ('661-24002', 'Battery - iPhone 17 Pro',          'Battery', 'product', true),
  ('661-24003', 'Battery - iPhone 17 Pro Max',      'Battery', 'product', true),
  ('661-24004', 'Display Assembly - iPhone 17',     'Display', 'product', true),
  ('661-24005', 'Display Assembly - iPhone 17 Plus','Display', 'product', true),
  ('661-24006', 'Display Assembly - iPhone 17 Pro', 'Display', 'product', true),
  ('661-24007', 'Display Assembly - iPhone 17 Pro Max','Display','product',true)

on conflict (part_number) do nothing;
