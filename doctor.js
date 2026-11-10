'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const DAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];

let mode = 'urgency';
let data = { appointments: [], emergencies: [], doctor: null };
let lastJson = '';
let first = true;
const expanded = new Set();
const seen = new Set();
const arrivedUntil = new Map();

function dayLabel(iso) {
  const d = new Date(iso), now = new Date();
  const sod = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((sod(d) - sod(now)) / 864e5);
  return diff === 0 ? '' : diff === 1 ? 'מחר' : DAYS[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1);
}
const hhmm = (iso) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const TIER_COLOR = { 0: '#D32F2F', 1: '#F57C00', 2: '#F9A825', 3: '#1863D3', 4: '#78849E' };

function sorted() {
  const a = data.appointments.slice();
  if (mode === 'booking') return a.sort((x, y) => new Date(x.bookedAt) - new Date(y.bookedAt));
  const w = (x) => (x.when ? new Date(x.when).getTime() : Infinity);
  return a.sort((x, y) => x.tier - y.tier || w(x) - w(y) || new Date(x.bookedAt) - new Date(y.bookedAt));
}

function rowHtml(a, idx) {
  const s = a.summary || {};
  const arrive = (arrivedUntil.get(a.id) || 0) > Date.now();
  const when = a.when ? '<b>' + (dayLabel(a.when) ? dayLabel(a.when) + ' ' : '') + hhmm(a.when) + '</b>' : '<b>ללא תור</b>';
  const qa = (s.qa || []).map((x) => '<li class="' + (x.flag ? 'flag' : '') + '"><span>' + esc(x.q) + '</span><b>' + esc(x.a) + '</b></li>').join('');
  const denied = (s.denied || []).map((x) => '<span class="tag ok">' + esc(x) + '</span>').join('') || '<span class="muted">אין</span>';
  const pflags = (s.profileFlags || []).map((x) => '<span class="tag">' + esc(x) + '</span>').join('');
  return '<div class="item' + (expanded.has(a.id) ? ' open' : '') + (arrive ? ' arrive' : '') + (first ? ' enter' : '') + '" data-id="' + a.id + '" style="--tc:' + TIER_COLOR[a.tier] + ';animation-delay:' + (first ? idx * 40 : 0) + 'ms">' +
    '<button class="row"><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' +
    '<span class="nm">' + esc(a.name) + (arrive ? '<span class="new-tag">חדש</span>' : '') + '</span><span class="muted">' + a.age + '</span><span>' + esc(a.complaint) + '</span>' +
    '<span><span class="uchip t' + a.tier + '">' + esc(a.tierLabel) + '</span></span><span>' + esc(a.channelLabel) + '</span>' +
    '<span class="time">' + when + '<small>הוזמן ב-' + hhmm(a.bookedAt) + '</small></span></button>' +
    '<div class="detail">' +
    '<div class="box sumtext"><h4>סיכום לפני הביקור</h4>' + esc(s.text || '') + (s.photo ? ' (צורפה תמונה)' : '') + '</div>' +
    '<div class="box"><h4>במילים של המבוטח/ת</h4><div class="words">"' + esc(s.words) + '"</div></div>' +
    '<div class="box"><h4>למה נותב לכאן</h4><div class="why">' + esc(s.why) + '</div></div>' +
    '<div class="box"><h4>שאלות ותשובות</h4><ul class="qa">' + (qa || '<li><span>לא נשאלו שאלות נוספות</span></li>') + '</ul></div>' +
    '<div class="box"><h4>סימני אזהרה שנבדקו ונשללו</h4><div class="tags">' + denied + '</div><h4 style="margin-top:14px">פרופיל רלוונטי</h4><div class="tags">' + pflags + '</div></div>' +
    '</div></div>';
}

function render() {
  const list = sorted();
  if (data.doctor) {
    $('#title').textContent = 'התורים שלי היום – ' + data.doctor.name;
    $('#subtitle').textContent = data.doctor.specialty + ' · ' + new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  $('#sTotal').textContent = list.length;
  $('#sUrgent').textContent = list.filter((a) => a.tier === 1).length;
  $('#sEm').textContent = data.emergencies.length;
  $('#caption').textContent = mode === 'booking'
    ? 'כך נראה התור היום: לפי שעת ההזמנה, בלי סדר דחיפות.'
    : 'כך נראה התור עם ההכוונה: לפי דחיפות, ואחר כך לפי שעת התור.';
  $('#rows').innerHTML = list.length ? list.map(rowHtml).join('') : '<div class="empty">אין תורים כרגע</div>';
  const strip = $('#emStrip');
  strip.hidden = !data.emergencies.length;
  $('#emList').innerHTML = data.emergencies.map((e) => '<span class="em-pill' + ((arrivedUntil.get(e.id) || 0) > Date.now() ? ' new' : '') + '">' + esc(e.name) + ', ' + e.age + ' · ' + esc(e.complaint) + ' · ' + hhmm(e.bookedAt) + '</span>').join('');
}

async function poll() {
  try {
    const j = await (await fetch('/api/queue', { cache: 'no-store' })).json();
    const all = j.appointments.concat(j.emergencies);
    if (!first) all.forEach((a) => { if (!seen.has(a.id)) arrivedUntil.set(a.id, Date.now() + 3200); });
    all.forEach((a) => seen.add(a.id));
    const ids = new Set(all.map((a) => a.id));
    [...seen].forEach((id) => { if (!ids.has(id)) { seen.delete(id); expanded.delete(id); } });
    const json = JSON.stringify(j);
    const animating = [...arrivedUntil.values()].some((t) => t > Date.now());
    if (json !== lastJson || animating !== poll.wasAnimating) {
      lastJson = json; data = j; render(); first = false;
    }
    poll.wasAnimating = animating;
    first = false;
  } catch (_) { /* server unreachable: keep last view */ }
}

$('#rows').addEventListener('click', (e) => {
  const it = e.target.closest('.item'); if (!it) return;
  if (!e.target.closest('.row')) return;
  const id = it.dataset.id;
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  it.classList.toggle('open');
});
function setMode(m) {
  mode = m;
  $('#modeBooking').classList.toggle('on', m === 'booking');
  $('#modeUrgency').classList.toggle('on', m === 'urgency');
  render();
}
$('#modeBooking').onclick = () => setMode('booking');
$('#modeUrgency').onclick = () => setMode('urgency');

setMode('urgency');
poll();
setInterval(poll, 1500);
