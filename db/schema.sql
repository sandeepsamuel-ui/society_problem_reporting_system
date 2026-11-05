-- CivicPulse database schema (SQLite)

CREATE TABLE IF NOT EXISTS departments (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citizens (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  department    TEXT NOT NULL REFERENCES departments(code),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per real-world problem (duplicates are merged into the same row)
CREATE TABLE IF NOT EXISTS issues (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  category           TEXT NOT NULL,
  department         TEXT NOT NULL REFERENCES departments(code),
  image_path         TEXT NOT NULL,
  latitude           REAL NOT NULL,
  longitude          REAL NOT NULL,
  address            TEXT,
  status             TEXT NOT NULL DEFAULT 'Submitted'
                       CHECK (status IN ('Submitted', 'In Progress', 'Resolved')),
  ai_severity        INTEGER NOT NULL,          -- visual severity from the multimodal model (1-10)
  severity           INTEGER NOT NULL,          -- final prioritized severity (1-10)
  priority           TEXT NOT NULL,             -- Low / Medium / High / Critical
  severity_breakdown TEXT,                      -- JSON explaining how the score was built
  nearby_facilities  TEXT,                      -- JSON list of hospitals, fire stations... within 1 km
  report_count       INTEGER NOT NULL DEFAULT 1,
  ai_confidence      REAL,
  created_by         INTEGER NOT NULL REFERENCES citizens(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every individual citizen submission, including those merged as duplicates
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id    INTEGER NOT NULL REFERENCES issues(id),
  citizen_id  INTEGER NOT NULL REFERENCES citizens(id),
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  voice_text  TEXT,
  image_path  TEXT NOT NULL,
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  is_duplicate INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every AI analysis of an uploaded photo (also serves as the draft until the citizen submits)
CREATE TABLE IF NOT EXISTS ai_analyses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  citizen_id      INTEGER NOT NULL REFERENCES citizens(id),
  image_path      TEXT NOT NULL,
  media_type      TEXT NOT NULL,
  voice_text      TEXT,
  provider        TEXT NOT NULL,           -- gemini / local
  provider_label  TEXT,
  provider_error  TEXT,
  is_civic_issue  INTEGER NOT NULL,
  category        TEXT NOT NULL,
  department      TEXT NOT NULL,
  confidence      REAL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  visual_severity INTEGER NOT NULL,
  severity_reason TEXT,
  local_scores    TEXT,                    -- JSON: top local-model category scores
  embedding       TEXT,                    -- JSON: 512-d image fingerprint
  issue_id        INTEGER REFERENCES issues(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every completion photo an admin uploads, with the AI + GPS verification result
CREATE TABLE IF NOT EXISTS repair_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id      INTEGER NOT NULL REFERENCES issues(id),
  admin_id      INTEGER NOT NULL REFERENCES admins(id),
  image_path    TEXT NOT NULL,
  latitude      REAL,
  longitude     REAL,
  gps_distance  INTEGER,
  gps_ok        INTEGER NOT NULL,
  photo_method  TEXT,
  same_place    INTEGER,
  problem_fixed INTEGER,
  relevant      INTEGER,
  similarity    REAL,
  confidence    REAL,
  reason        TEXT,
  details       TEXT,                    -- JSON: full verdict
  verified      INTEGER NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id   INTEGER NOT NULL REFERENCES issues(id),
  status     TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  note       TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_issues_dept   ON issues(department, status);
CREATE INDEX IF NOT EXISTS idx_reports_cit   ON reports(citizen_id);
CREATE INDEX IF NOT EXISTS idx_reports_issue ON reports(issue_id);

INSERT OR IGNORE INTO departments (code, name) VALUES
  ('ROADS',       'Roads & Transport'),
  ('GARBAGE',     'Garbage & Sanitation'),
  ('WATER',       'Water Supply'),
  ('ELECTRICITY', 'Electricity & Streetlights'),
  ('DRAINAGE',    'Drainage & Sewerage'),
  ('GENERAL',     'General Administration');
