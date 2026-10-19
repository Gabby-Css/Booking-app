// server.js - API for the booking app.
// Load settings (PORT, passwords...) from the private .env file before anything else reads them.
// On a host like Render there is no .env file: the host's own environment variables are used instead.
require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const S = require('./schedule');

const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => { req.body ??= {}; next(); });

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function rateLimit(max, windowMs, message) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip) || { count: 0, resetAt: now + windowMs };
    entry.count += 1;
    hits.set(req.ip, entry);
    if (entry.count > max) return next(new HttpError(429, message));
    next();
  };
}

// Which times on this date are already taken?
function bookedTimes(date) {
  const rows = db.prepare("SELECT time FROM bookings WHERE date = ? AND status = 'confirmed'").all(date);
  return new Set(rows.map((r) => r.time));
}

// The public view of a booking (we never send other people's details to the browser).
const publicBooking = (b) => ({ date: b.date, time: b.time, name: b.name, notes: b.notes, status: b.status, code: b.cancel_code });

// ---------- routes ----------

app.get('/api/config', (req, res) => {
  const { businessName, slotMinutes, open, close } = S.SCHEDULE;
  res.json({ businessName, slotMinutes, open, close, timezone: S.TIMEZONE });
});

// One row per upcoming day, with how many slots are still free, for the day picker.
app.get('/api/days', (req, res) => {
  const today = S.nowAtBusiness().date;
  const last = S.addDays(today, S.SCHEDULE.daysAhead);
  const everySlot = S.allSlotTimes();

  const rows = db.prepare("SELECT date, time FROM bookings WHERE status = 'confirmed' AND date BETWEEN ? AND ?").all(today, last);
  const takenByDate = new Map();
  for (const r of rows) {
    if (!takenByDate.has(r.date)) takenByDate.set(r.date, new Set());
    takenByDate.get(r.date).add(r.time);
  }

  const days = [];
  for (let date = today; date <= last; date = S.addDays(date, 1)) {
    const open = S.isWorkDay(date);
    const taken = takenByDate.get(date) ?? new Set();
    const free = open ? everySlot.filter((time) => S.isBookable(date, time) && !taken.has(time)).length : 0;
    days.push({ date, open, free, total: open ? everySlot.length : 0 });
  }
  res.json({ days });
});

app.get('/api/slots', (req, res) => {
  const { date } = req.query;
  if (!S.isValidDate(date)) throw new HttpError(400, 'Pick a valid date.');
  if (!S.isInBookingWindow(date) || !S.isWorkDay(date)) return res.json({ date, closed: true, slots: [] });

  const taken = bookedTimes(date);
  const slots = S.allSlotTimes().map((time) => ({
    time,
    available: S.isBookable(date, time) && !taken.has(time),
  }));
  res.json({ date, closed: false, slots });
});

app.post('/api/bookings',
  rateLimit(10, 60 * 60 * 1000, 'You have made a lot of bookings recently. Please try again later.'),
  (req, res) => {
    const { date, time } = req.body;
    const name = String(req.body.name ?? '').trim().replace(/\s+/g, ' ');
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const notes = String(req.body.notes ?? '').trim().slice(0, 300);

    if (!name || name.length > 60) throw new HttpError(400, 'Please enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 120) throw new HttpError(400, 'That email address does not look right.');
    if (!S.isBookable(date, time)) throw new HttpError(400, 'That time is not available. Please pick another.');

    const code = crypto.randomBytes(5).toString('hex').toUpperCase(); // e.g. "9F3A07C1B2"
    try {
      // If someone else grabbed this slot a moment ago, the unique index in the
      // database rejects this INSERT and we land in the catch block below.
      db.prepare(`
        INSERT INTO bookings (date, time, name, email, notes, cancel_code, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(date, time, name, email, notes, code, Date.now());
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) {
        throw new HttpError(409, 'Sorry, someone just booked that slot. Please choose another time.');
      }
      throw err;
    }

    res.status(201).json({ booking: { date, time, name, notes, status: 'confirmed', code } });
  });

app.get('/api/bookings/:code', (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE cancel_code = ?').get(String(req.params.code).toUpperCase());
  if (!booking) throw new HttpError(404, 'We could not find a booking with that code.');
  res.json({ booking: publicBooking(booking) });
});

app.delete('/api/bookings/:code', (req, res) => {
  const info = db.prepare("UPDATE bookings SET status = 'cancelled' WHERE cancel_code = ? AND status = 'confirmed'")
    .run(String(req.params.code).toUpperCase());
  if (info.changes === 0) throw new HttpError(404, 'That booking was not found or is already cancelled.');
  res.json({ ok: true });
});

// ---------- static files + errors ----------

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(PORT, () => console.log(`Booking app running at http://localhost:${PORT}`));
