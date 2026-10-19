// app.js - the browser side of the booking app.
// Flow: load days -> pick a day -> load that day's slots -> pick a slot -> fill in details -> confirm.

const $ = (selector) => document.querySelector(selector);

const state = {
  config: null,
  days: [],
  date: null,         // the day the user picked, e.g. "2026-10-20"
  time: null,         // the slot they picked, e.g. "10:00"
  slots: [],
  lastBooking: null,  // used by the "Add to calendar" button
  slotsRequest: 0,    // counts slot requests so a slow, older answer can't overwrite a newer one
};

// ---------- helpers ----------

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : '');
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const longDate = (iso) => parseDate(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function endTime(hhmm) {
  const total = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) + state.config.slotMinutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Booking codes are kept in this browser so people can find their bookings again.
function savedCodes() {
  try { return JSON.parse(localStorage.getItem('booking-codes')) || []; } catch { return []; }
}
function saveCodes(codes) {
  try { localStorage.setItem('booking-codes', JSON.stringify([...new Set(codes)])); } catch { /* storage blocked */ }
}

// ---------- step 1: days ----------

async function loadDays() {
  const { days } = await api('/days');
  state.days = days;
  renderDays();
}

function renderDays() {
  $('#days').innerHTML = state.days.map((day) => {
    const d = parseDate(day.date);
    const full = day.open && day.free === 0;
    const label = !day.open ? 'Closed' : full ? 'Full' : `${day.free} free`;
    return `
      <button class="day ${day.date === state.date ? 'selected' : ''}" data-date="${day.date}" ${!day.open || full ? 'disabled' : ''}
              role="option" aria-selected="${day.date === state.date}">
        <span class="wd">${d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
        <span class="num">${d.getDate()}</span>
        <span class="mo">${d.toLocaleDateString(undefined, { month: 'short' })}</span>
        <span class="free">${label}</span>
      </button>`;
  }).join('');
}

function selectDate(date) {
  state.date = date;
  state.time = null;
  renderDays();
  updateSummary();
  loadSlots();
}

// ---------- step 2: slots ----------

async function loadSlots() {
  if (!state.date) return;
  const myRequest = ++state.slotsRequest;
  try {
    const { slots, date } = await api(`/slots?date=${state.date}`);
    if (myRequest !== state.slotsRequest || date !== state.date) return; // stale answer, ignore it
    state.slots = slots;
    // If the slot we had selected was grabbed by someone else meanwhile, say so.
    if (state.time && !slots.find((s) => s.time === state.time)?.available) {
      state.time = null;
      toast('That slot was just taken. Please pick another.', 'error');
    }
    renderSlots();
    updateSummary();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderSlots() {
  $('#slots-title').textContent = state.date ? longDate(state.date) : '';
  if (!state.date) {
    $('#slots').innerHTML = '<p class="note">Choose a day first.</p>';
    return;
  }
  if (!state.slots.some((s) => s.available)) {
    $('#slots').innerHTML = '<p class="note">No free slots left on this day. Try another day.</p>';
    return;
  }
  $('#slots').innerHTML = state.slots.map((s) => `
    <button class="slot ${s.time === state.time ? 'selected' : ''}" data-time="${s.time}" ${s.available ? '' : 'disabled'}>
      ${clock(s.time)}
    </button>`).join('');
}

function selectTime(time) {
  state.time = time;
  renderSlots();
  updateSummary();
  $('#booking-form').elements.name.focus({ preventScroll: true });
}

// ---------- step 3: details + confirm ----------

function updateSummary() {
  const summary = $('#summary');
  const ready = Boolean(state.date && state.time);
  $('#confirm-btn').disabled = !ready;
  summary.classList.toggle('empty', !ready);
  summary.innerHTML = ready
    ? `${longDate(state.date)}<small>${clock(state.time)} – ${clock(endTime(state.time))} (${state.config.slotMinutes} min)</small>`
    : state.date ? 'Now pick a time slot.' : 'Pick a day and a time to get started.';
}

async function handleBooking(event) {
  event.preventDefault();
  const f = event.target.elements;
  const error = $('#form-error');
  error.hidden = true;
  const button = $('#confirm-btn');
  button.disabled = true;
  button.textContent = 'Booking...';

  try {
    const { booking } = await api('/bookings', {
      method: 'POST',
      body: { date: state.date, time: state.time, name: f.name.value, email: f.email.value, notes: f.notes.value },
    });
    saveCodes([...savedCodes(), booking.code]);
    showConfirmation(booking);
    state.time = null;
    f.notes.value = '';
    await Promise.all([loadDays(), loadSlots(), renderMine()]);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    if (err.status === 409) { state.time = null; await Promise.all([loadDays(), loadSlots()]); }
  } finally {
    button.textContent = 'Confirm booking';
    updateSummary();
  }
}

function showConfirmation(booking) {
  state.lastBooking = booking;
  $('#done-when').textContent = `${longDate(booking.date)}, ${clock(booking.time)}`;
  $('#done-code').textContent = booking.code;
  $('#done-dialog').showModal();
}

// ---------- calendar file ----------

function downloadCalendarFile(booking) {
  const stamp = (date, time) => date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00';
  const clean = (text) => String(text).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Booking App//EN',
    'BEGIN:VEVENT',
    `UID:${booking.code}@booking-app`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART;TZID=${state.config.timezone}:${stamp(booking.date, booking.time)}`,
    `DTEND;TZID=${state.config.timezone}:${stamp(booking.date, endTime(booking.time))}`,
    `SUMMARY:${clean('Appointment: ' + state.config.businessName)}`,
    `DESCRIPTION:${clean('Booking code ' + booking.code + (booking.notes ? '\n' + booking.notes : ''))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `booking-${booking.code}.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------- "your bookings" ----------

async function renderMine() {
  const codes = savedCodes();
  const results = await Promise.all(codes.map((code) => api(`/bookings/${code}`).then((r) => r.booking).catch(() => null)));
  const bookings = results.filter((b) => b && b.status === 'confirmed')
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

  // forget codes that no longer exist or were cancelled
  saveCodes(bookings.map((b) => b.code));

  $('#mine').hidden = bookings.length === 0;
  const today = state.days[0]?.date ?? '';
  $('#mine-list').innerHTML = bookings.map((b) => `
    <li class="mine ${b.date < today ? 'past' : ''}">
      <div class="when"><b>${longDate(b.date)} · ${clock(b.time)}</b><small>${esc(b.name)}${b.notes ? ' · ' + esc(b.notes) : ''}</small></div>
      <code>${esc(b.code)}</code>
      <button class="btn ghost small" data-ics="${esc(b.code)}">📆 Calendar</button>
      ${b.date < today ? '' : `<button class="btn danger small" data-cancel="${esc(b.code)}">Cancel</button>`}
    </li>`).join('');
  state.mine = bookings;
}

async function cancelBooking(code) {
  if (!confirm('Cancel this booking? The slot will be released for someone else.')) return;
  try {
    await api(`/bookings/${code}`, { method: 'DELETE' });
    toast('Booking cancelled');
    await Promise.all([loadDays(), loadSlots(), renderMine()]);
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function handleLookup(event) {
  event.preventDefault();
  const input = event.target.elements.code;
  const code = input.value.trim().toUpperCase();
  if (!code) return;
  try {
    const { booking } = await api(`/bookings/${encodeURIComponent(code)}`);
    if (booking.status !== 'confirmed') return toast('That booking has been cancelled.', 'error');
    saveCodes([...savedCodes(), booking.code]);
    input.value = '';
    await renderMine();
    toast('Found it! It is listed above.');
    $('#mine').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ---------- start-up ----------

function wireUpEvents() {
  $('#days').addEventListener('click', (e) => {
    const btn = e.target.closest('.day');
    if (btn && !btn.disabled) selectDate(btn.dataset.date);
  });
  $('#slots').addEventListener('click', (e) => {
    const btn = e.target.closest('.slot');
    if (btn && !btn.disabled) selectTime(btn.dataset.time);
  });
  $('#booking-form').addEventListener('submit', handleBooking);
  $('#lookup-form').addEventListener('submit', handleLookup);
  $('#done-close').addEventListener('click', () => $('#done-dialog').close());
  $('#ics-btn').addEventListener('click', () => downloadCalendarFile(state.lastBooking));
  $('#mine-list').addEventListener('click', (e) => {
    const cancel = e.target.closest('[data-cancel]');
    const ics = e.target.closest('[data-ics]');
    if (cancel) cancelBooking(cancel.dataset.cancel);
    if (ics) downloadCalendarFile(state.mine.find((b) => b.code === ics.dataset.ics));
  });

  // Keep availability fresh while the page is open, so nobody picks a slot that's already gone.
  setInterval(() => { if (!document.hidden) { loadDays(); loadSlots(); } }, 15000);
}

async function init() {
  wireUpEvents();
  state.config = await api('/config');
  $('#business-name').textContent = state.config.businessName;
  $('#tz-note').textContent = `Times are in ${state.config.timezone.replace('_', ' ')} time`;
  document.title = `Book a slot - ${state.config.businessName}`;

  await loadDays();
  renderSlots();
  updateSummary();

  // jump straight to the first day that still has room
  const firstFree = state.days.find((d) => d.open && d.free > 0);
  if (firstFree) selectDate(firstFree.date);

  renderMine();
}

init();
