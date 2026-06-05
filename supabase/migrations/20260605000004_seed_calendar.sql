-- Seed: hand-curated Indian calendar events (region = 'IN').
--
-- IMPORTANT: these dates are a STARTER set and are approximate for the
-- festival/lunar holidays. Verify against an authoritative 2026/2027 calendar
-- and refresh annually before relying on them in production (spec §8, §10).
-- Covers mid-2026 onward (the app's first live window) plus early 2027.

insert into public.calendar_events (name, type, date, region) values
  -- 2026 — national holidays & festivals
  ('Independence Day',      'holiday',      date '2026-08-15', 'IN'),
  ('Raksha Bandhan',        'festival',     date '2026-08-28', 'IN'),
  ('Janmashtami',           'festival',     date '2026-09-04', 'IN'),
  ('Ganesh Chaturthi',      'festival',     date '2026-09-14', 'IN'),
  ('Gandhi Jayanti',        'holiday',      date '2026-10-02', 'IN'),
  ('Gandhi Jayanti weekend','long_weekend', date '2026-10-02', 'IN'),
  ('Dussehra',              'festival',     date '2026-10-20', 'IN'),
  ('Karwa Chauth',          'festival',     date '2026-10-29', 'IN'),
  ('Diwali',                'festival',     date '2026-11-08', 'IN'),
  ('Bhai Dooj',             'festival',     date '2026-11-11', 'IN'),
  ('Guru Nanak Jayanti',    'festival',     date '2026-11-24', 'IN'),
  ('Christmas',             'holiday',      date '2026-12-25', 'IN'),
  ('Christmas weekend',     'long_weekend', date '2026-12-25', 'IN'),

  -- 2027 — early-year set
  ('New Year''s Day',       'holiday',      date '2027-01-01', 'IN'),
  ('Republic Day',          'holiday',      date '2027-01-26', 'IN'),
  ('Holi',                  'festival',     date '2027-03-22', 'IN'),
  ('Eid al-Fitr',           'festival',     date '2027-03-10', 'IN');
