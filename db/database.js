// SQLite connection using Node's built-in driver (no native build needed).
// All data is stored in db/civicpulse.db and survives server restarts.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'civicpulse.db');
const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Lightweight migrations for databases created by an older version.
function addColumn(table, column, type) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('issues', 'ai_provider', 'TEXT');
addColumn('issues', 'image_embedding', 'TEXT');
addColumn('reports', 'analysis_id', 'INTEGER');
addColumn('reports', 'duplicate_method', 'TEXT');
addColumn('reports', 'duplicate_reason', 'TEXT');
addColumn('reports', 'duplicate_score', 'REAL');
addColumn('issues', 'resolution_image', 'TEXT');
addColumn('issues', 'resolution_check_id', 'INTEGER');
addColumn('issues', 'resolved_at', 'TEXT');

db.FILE = DB_FILE;
module.exports = db;
