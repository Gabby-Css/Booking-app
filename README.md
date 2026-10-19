# Booking Scheduler

Pick a day, pick a free time slot, confirm it. The database makes double-booking impossible.

**Live demo:** _add your Render link here_

## Features

- Next 21 days with a "14 free" badge per day (weekends shown as closed)
- Time slots for the chosen day: free ones are clickable, taken or past ones are greyed out
- Details form (name, email, optional note) with a live summary of what you are booking
- Confirmation with a **booking code**, plus **Add to calendar** (.ics file)
- "Your bookings on this device", cancel any time, or look a booking up by code
- Availability refreshes every 15 seconds; if someone takes your slot first you are told right away
- Opening hours, slot length, lunch break, working days and time zone are all in one file: [schedule.js](schedule.js)

## Run it

```bash
npm install
npm start        # http://localhost:3005  (port comes from .env)
```

> **Settings:** the app reads `.env` (private, ignored by Git). `.env.example` is the safe template. On a new computer run `copy .env.example .env`.

| Variable | Purpose | Default |
|----------|---------|---------|
| `PORT` | port to listen on | `3000` (this folder's `.env` sets `3005`) |
| `BUSINESS_TZ` | IANA time zone the slots are in | `Africa/Accra` |
| `BUSINESS_NAME` | name shown in the header | `Campus Office Hours` |
| `DATA_DIR` | folder for `bookings.db` | the app folder |

## API

| Method & path | Does |
|---------------|------|
| `GET /api/config` | name, slot length, time zone |
| `GET /api/days` | upcoming days with free-slot counts |
| `GET /api/slots?date=YYYY-MM-DD` | every slot that day and whether it is available |
| `POST /api/bookings` | book `{ date, time, name, email, notes }` -> `201`, or `409` if taken |
| `GET /api/bookings/:code` | look up a booking by its code |
| `DELETE /api/bookings/:code` | cancel (frees the slot) |

Step-by-step code walkthrough: [EXPLAINED.md](EXPLAINED.md)
