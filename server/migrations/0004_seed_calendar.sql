-- Hand-curated Indian calendar events (region = 'IN') used by the long-weekend trigger.
--
-- IMPORTANT: a STARTER set. Dates for lunar/festival holidays are approximate; verify against an
-- authoritative calendar and add new rows (new migration) before the last date here passes.
-- Coverage ends 2027-03-22.

insert into calendar_events (name, type, date, region) values
  ('Republic Day weekend',   'long_weekend', date '2026-01-26', 'IN'),
  ('Independence Day',       'holiday',      date '2026-08-15', 'IN'),
  ('Raksha Bandhan',         'festival',     date '2026-08-28', 'IN'),
  ('Janmashtami',            'festival',     date '2026-09-04', 'IN'),
  ('Ganesh Chaturthi',       'festival',     date '2026-09-14', 'IN'),
  ('Gandhi Jayanti',         'holiday',      date '2026-10-02', 'IN'),
  ('Gandhi Jayanti weekend', 'long_weekend', date '2026-10-02', 'IN'),
  ('Dussehra',               'festival',     date '2026-10-20', 'IN'),
  ('Karwa Chauth',           'festival',     date '2026-10-29', 'IN'),
  ('Diwali',                 'festival',     date '2026-11-08', 'IN'),
  ('Diwali break',           'long_weekend', date '2026-11-08', 'IN'),
  ('Bhai Dooj',              'festival',     date '2026-11-11', 'IN'),
  ('Guru Nanak Jayanti',     'festival',     date '2026-11-24', 'IN'),
  ('Christmas',              'holiday',      date '2026-12-25', 'IN'),
  ('Christmas weekend',      'long_weekend', date '2026-12-25', 'IN'),
  ('New Year''s Day',        'holiday',      date '2027-01-01', 'IN'),
  ('Republic Day',           'holiday',      date '2027-01-26', 'IN'),
  ('Eid al-Fitr',            'festival',     date '2027-03-10', 'IN'),
  ('Holi',                   'festival',     date '2027-03-22', 'IN'),
  ('Holi weekend',           'long_weekend', date '2027-03-22', 'IN')
on conflict do nothing;
