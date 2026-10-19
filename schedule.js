// schedule.js - everything about WHEN bookings are allowed.
// Change the numbers below to change the opening hours; the rest of the app adapts.

const TIMEZONE = process.env.BUSINESS_TZ || 'Africa/Accra';

const SCHEDULE = {
  businessName: process.env.BUSINESS_NAME || 'Campus Office Hours',
  slotMinutes: 30,
  open: '09:00',
  close: '17:00',
  breaks: [{ from: '12:00', to: '13:00' }], // lunch
  workDays: [1, 2, 3, 4, 5],                // 0 = Sunday ... 6 = Saturday
  daysAhead: 21,                            // how far into the future people can book
};

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// "What date and time is it right now at the business?" (the server may be in another timezone)
function nowAtBusiness() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isValidDate(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === str;
}

function isWorkDay(date) {
  return SCHEDULE.workDays.includes(new Date(date + 'T00:00:00Z').getUTCDay());
}

// Every bookable start time on a normal working day: ["09:00", "09:30", ...]
function allSlotTimes() {
  const slots = [];
  const end = toMinutes(SCHEDULE.close);
  for (let t = toMinutes(SCHEDULE.open); t + SCHEDULE.slotMinutes <= end; t += SCHEDULE.slotMinutes) {
    const slotEnd = t + SCHEDULE.slotMinutes;
    const clashesWithBreak = SCHEDULE.breaks.some((b) => t < toMinutes(b.to) && slotEnd > toMinutes(b.from));
    if (!clashesWithBreak) slots.push(toHHMM(t));
  }
  return slots;
}

// Is this date inside the window people are allowed to book in?
function isInBookingWindow(date) {
  const today = nowAtBusiness().date;
  return date >= today && date <= addDays(today, SCHEDULE.daysAhead);
}

// Is this exact slot something a person may book right now?
function isBookable(date, time) {
  if (!isValidDate(date) || !/^\d{2}:\d{2}$/.test(time || '')) return false;
  if (!isInBookingWindow(date) || !isWorkDay(date)) return false;
  if (!allSlotTimes().includes(time)) return false;
  const now = nowAtBusiness();
  return !(date === now.date && time <= now.time); // can't book a time that has already started
}

module.exports = { TIMEZONE, SCHEDULE, nowAtBusiness, addDays, isValidDate, isWorkDay, allSlotTimes, isInBookingWindow, isBookable, toMinutes, toHHMM };
