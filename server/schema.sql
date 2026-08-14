-- YardOS database schema
-- Run with: psql "$DATABASE_URL" -f server/schema.sql

CREATE TABLE IF NOT EXISTS carriers (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  free_days   INTEGER NOT NULL DEFAULT 0,
  basis       TEXT NOT NULL DEFAULT 'ETD'
);

CREATE TABLE IF NOT EXISTS carrier_tiers (
  id          SERIAL PRIMARY KEY,
  carrier_code TEXT NOT NULL REFERENCES carriers(code),
  day_from    INTEGER NOT NULL,
  day_to      INTEGER,
  rate        NUMERIC NOT NULL
);

CREATE TABLE IF NOT EXISTS depots (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  carrier_code TEXT REFERENCES carriers(code),
  risk        TEXT NOT NULL DEFAULT 'low',
  time_window TEXT
);

CREATE TABLE IF NOT EXISTS zones (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  blocks      INTEGER NOT NULL,
  rows        INTEGER NOT NULL,
  slots       INTEGER NOT NULL,
  max_tiers   INTEGER NOT NULL,
  ceiling     NUMERIC NOT NULL DEFAULT 0,
  hazmat      BOOLEAN NOT NULL DEFAULT FALSE,
  customs     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS equipment (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  model           TEXT NOT NULL,
  max_row_depth   INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'AVAILABLE',
  hour_meter      NUMERIC NOT NULL DEFAULT 0,
  maintenance_due TEXT
);

CREATE TABLE IF NOT EXISTS operators (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  equipment_id TEXT REFERENCES equipment(id),
  certs       TEXT[] NOT NULL DEFAULT '{}',
  shift       TEXT NOT NULL DEFAULT 'DAY',
  status      TEXT NOT NULL DEFAULT 'ON_SHIFT'
);

CREATE TABLE IF NOT EXISTS containers (
  id          TEXT PRIMARY KEY,
  zone_id     TEXT NOT NULL REFERENCES zones(id),
  block       INTEGER NOT NULL,
  row_num     INTEGER NOT NULL,
  slot        INTEGER NOT NULL,
  tier        INTEGER NOT NULL,
  address     TEXT NOT NULL,
  size        TEXT NOT NULL,
  gross_kg    NUMERIC NOT NULL DEFAULT 0,
  carrier_code TEXT REFERENCES carriers(code),
  carrier_name TEXT,
  consignee   TEXT,
  vessel      TEXT,
  terminal    TEXT,
  hazmat      BOOLEAN NOT NULL DEFAULT FALSE,
  imdg        TEXT,
  channel     TEXT NOT NULL DEFAULT 'GREEN',
  status      TEXT NOT NULL DEFAULT 'YARD',
  hours_to_lfd NUMERIC,
  dwell_days  NUMERIC NOT NULL DEFAULT 0,
  priority    TEXT NOT NULL DEFAULT 'NORMAL',
  empty       BOOLEAN NOT NULL DEFAULT FALSE,
  why_here    TEXT,
  seal        TEXT
);

CREATE TABLE IF NOT EXISTS moves (
  id          TEXT PRIMARY KEY,
  seq         INTEGER NOT NULL,
  type        TEXT NOT NULL,
  container_id TEXT REFERENCES containers(id),
  from_loc    TEXT NOT NULL,
  to_loc      TEXT NOT NULL,
  equipment_id TEXT REFERENCES equipment(id),
  operator_id TEXT REFERENCES operators(id),
  operator_name TEXT,
  est_min     NUMERIC NOT NULL DEFAULT 0,
  start_time  TEXT,
  end_time    TEXT,
  start_min   INTEGER,
  end_min     INTEGER,
  state       TEXT NOT NULL DEFAULT 'PLANNED',
  frozen      BOOLEAN NOT NULL DEFAULT FALSE,
  priority    TEXT NOT NULL DEFAULT 'NORMAL',
  reason      TEXT,
  reason_text TEXT
);

CREATE TABLE IF NOT EXISTS exceptions (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'low',
  subject     TEXT NOT NULL,
  detail      TEXT,
  action      TEXT
);

CREATE TABLE IF NOT EXISTS assumptions (
  k           TEXT PRIMARY KEY,
  v           TEXT NOT NULL,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS lanes (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'IDLE',
  visit_id    TEXT,
  since       TEXT
);

-- NOTE: visits.container_id and visits.lane_id are intentionally
-- not foreign-keyed — seed data may reference containers/lanes that
-- are absent from the tables (e.g. placeholder dash "—" lane values).
CREATE TABLE IF NOT EXISTS visits (
  id          TEXT PRIMARY KEY,
  plate       TEXT NOT NULL,
  carrier     TEXT,
  driver      TEXT,
  purpose     TEXT NOT NULL,
  appt_time   TEXT,
  queue_in    TEXT,
  check_in    TEXT,
  at_position TEXT,
  served      TEXT,
  gate_out    TEXT,
  state       TEXT NOT NULL DEFAULT 'QUEUED',
  turn        NUMERIC,
  lane_id     TEXT,
  container_id TEXT,
  excl        TEXT
);

CREATE TABLE IF NOT EXISTS appointments (
  appt_window TEXT PRIMARY KEY,
  capacity    INTEGER NOT NULL DEFAULT 0,
  booked      INTEGER NOT NULL DEFAULT 0,
  no_show     INTEGER NOT NULL DEFAULT 0,
  -- NOTE: 'over' is boolean in the seed data (true/false overbooking flag)
  over        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  time        TEXT NOT NULL,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'low',
  state       TEXT NOT NULL DEFAULT 'open',
  auto        TEXT,
  title       TEXT NOT NULL,
  detail      TEXT,
  diff        JSONB
);

CREATE TABLE IF NOT EXISTS diff_rows (
  id          SERIAL PRIMARY KEY,
  move_id     TEXT REFERENCES moves(id),
  action      TEXT NOT NULL,
  type        TEXT NOT NULL,
  before_val  TEXT,
  after_val   TEXT,
  note        TEXT
);

-- NOTE: operator_tasks.seq is a display string like "07 of 24", not a number.
-- weight and est_min are also strings ("27.8 t", "4.6") in the seed data.
CREATE TABLE IF NOT EXISTS operator_tasks (
  id          TEXT PRIMARY KEY,
  seq         TEXT NOT NULL,
  type        TEXT NOT NULL,
  container_id TEXT,
  from_loc    TEXT NOT NULL,
  to_loc      TEXT NOT NULL,
  weight      TEXT,
  size        TEXT,
  est_min     TEXT NOT NULL DEFAULT '0',
  reason      TEXT,
  warn        TEXT
);

CREATE TABLE IF NOT EXISTS turn_by_hour (
  hour        INTEGER PRIMARY KEY,
  p50         NUMERIC NOT NULL DEFAULT 0,
  p90         NUMERIC NOT NULL DEFAULT 0,
  visits      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cycle_by_type (
  type        TEXT PRIMARY KEY,
  p50         NUMERIC NOT NULL DEFAULT 0,
  p90         NUMERIC NOT NULL DEFAULT 0,
  n           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS capacity_forecast (
  month       TEXT PRIMARY KEY,
  volume      INTEGER NOT NULL DEFAULT 0,
  required    NUMERIC NOT NULL DEFAULT 0,
  available   NUMERIC NOT NULL DEFAULT 0,
  breach      BOOLEAN NOT NULL DEFAULT FALSE
);
