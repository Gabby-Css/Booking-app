# Booking Scheduler: the code, step by step

The interesting question in any booking system: **what if two people click the same slot at the same moment?**

## 1. `db.js` - the double-booking guard

```sql
CREATE UNIQUE INDEX uniq_active_slot ON bookings (date, time) WHERE status = 'confirmed';
```

A `UNIQUE` index tells the database: "never allow two rows with the same date and time". The `WHERE status = 'confirmed'` part makes it a *partial* index: cancelled bookings don't count, so a cancelled slot can be booked again, yet we still keep the cancelled row as history.

Why not just check first ("is it free? then insert")? Because two requests can both check at the same instant, both see "free", and both insert. A check-then-insert has a gap. The unique index closes the gap: the database processes the inserts one at a time and rejects the second. **Let the database be the referee.** (We tested this by firing 5 simultaneous bookings: exactly one succeeded, four got `409`.)

Other columns: `cancel_code` (random secret that lets the booker view or cancel), `status` ('confirmed' or 'cancelled').

## 2. `schedule.js` - when are bookings allowed?

All the rules in one object `SCHEDULE`: `open`/`close` times, `slotMinutes`, `breaks` (lunch), `workDays`, `daysAhead`. Change a value and the whole app adapts.

- `allSlotTimes()` loops from opening to closing in `slotMinutes` steps, skipping any slot that overlaps a break: `["09:00", "09:30", ... "11:30", "13:00", ... "16:30"]` (14 slots).
- **Time zones.** The server might run in a different time zone than the business (Render servers run in UTC). `nowAtBusiness()` asks `Intl.DateTimeFormat` with `timeZone: TIMEZONE` what the date and time are *at the business right now*. Dates are plain `"2026-10-19"` strings and times `"10:00"`, so string comparison (`date >= today`) works and no time-zone conversion bugs can sneak in.
- `isBookable(date, time)` combines every rule: valid date, inside the booking window, a working day, a real slot, and not already in the past today.

## 3. `server.js`

- `GET /api/config`: public settings for the page.
- `GET /api/days`: one query fetches all confirmed bookings in the window; we group them by date in a `Map` and count free slots per day. (One query instead of 22: far faster.)
- `GET /api/slots?date=`: every slot of that day with `available: true/false` (not taken **and** still in the future).
- **`POST /api/bookings`:**
  1. Clean and validate name, email, notes.
  2. `S.isBookable(...)`: never trust that the browser only offers valid slots; someone could send a request for 3 a.m. Sunday.
  3. Create a random `code` (`crypto.randomBytes(5)` -> 10 hex characters).
  4. `INSERT` inside `try/catch`. If the unique index rejects it, `err.code` starts with `SQLITE_CONSTRAINT`, and we answer `409 Sorry, someone just booked that slot`. Any other error is rethrown as a real 500.
- `GET /api/bookings/:code` returns **only** that booking's own details, never anyone else's. The code is the secret: don't hand out lists of bookings by email.
- `DELETE /api/bookings/:code`: `UPDATE ... SET status = 'cancelled'`, which instantly frees the slot through the partial index.
- Rate limit: 10 bookings per hour per IP.

## 4. `public/index.html`

Three numbered panels (day, time, details), a "your bookings" list, a lookup form, and a `<dialog>` for the confirmation. The details card uses `position: sticky` so it stays visible while you scroll slots on a big screen.

## 5. `public/app.js`

The flow mirrors the steps on screen:

1. `init()` loads config, calls `loadDays()` and auto-selects the first day with free slots.
2. **Days** `renderDays()` draws buttons; closed or full days get the `disabled` attribute. `selectDate()` clears the chosen time and calls `loadSlots()`.
3. **Slots** `renderSlots()` shows free ones as clickable, taken ones disabled with a strikethrough. If the slot you had selected disappears during a refresh, you get a toast: "That slot was just taken".
4. **Details** `updateSummary()` shows "Monday 19 October, 10:00 - 10:30" and enables the **Confirm** button only when both day and time are chosen.
5. **Confirm** `handleBooking()` posts to the server:
   - success -> save the code in `localStorage`, open the confirmation dialog;
   - `409` -> show the message, clear the selection, refresh slots.
6. `setInterval` refreshes days and slots every 15 s. `slotsRequest` counts requests so a slow, outdated answer can't overwrite a newer one.

**Calendar download.** `downloadCalendarFile()` builds an `.ics` text file by hand (`BEGIN:VCALENDAR ... BEGIN:VEVENT ... DTSTART;TZID=Africa/Accra:20261019T100000`), wraps it in a `Blob`, makes a temporary `<a download>` link and clicks it. Calendar apps open it. Commas and semicolons are escaped as the format requires.

**Your bookings.** Codes are kept in `localStorage`; `renderMine()` fetches each one from the server, keeps only confirmed ones, and forgets codes that were cancelled or no longer exist. The lookup form lets you recover a booking on a new device by typing its code.

**Formatting times.** `clock('14:00')` uses `toLocaleTimeString`, so people see "2:00 PM" or "14:00" depending on their locale automatically.

## 6. Ideas to extend

Multiple services with different durations, an admin calendar view, email confirmations (e.g. with a mail API), reminder emails the day before, per-day holidays.
