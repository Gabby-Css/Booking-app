// db.js - SQLite setup for the booking app.
const Database = require('better-sqlite3');
const path = require('path');

const dataDir = process.env.DATA_DIR || __dirname;
const db = new Database(path.join(dataDir, 'bookings.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT NOT NULL,                  -- YYYY-MM-DD in the business's timezone
    time        TEXT NOT NULL,                  -- HH:MM, start of the slot
    name        TEXT NOT NULL,
    email       TEXT NOT NULL,
    notes       TEXT NOT NULL DEFAULT '',
    cancel_code TEXT NOT NULL UNIQUE,           -- the secret that lets the booker view or cancel it
    status      TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
    created_at  INTEGER NOT NULL
  );

  -- THE double-booking guard. The database itself refuses a second confirmed booking
  -- for the same date and time, even if two people click at the exact same moment.
  -- Cancelled bookings are left out of the index, so a cancelled slot can be booked again.
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_slot
    ON bookings (date, time) WHERE status = 'confirmed';
`);

module.exports = db;
