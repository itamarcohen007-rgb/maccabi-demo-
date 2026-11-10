'use strict';
/* Patient page. Routing decisions come only from Rules.decide (rules.js); the server's
   language model is used just to classify free text and to map typed answers onto options. */
const R = window.Rules;
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ICON = {
  clinic: '<svg viewBox="0 0 24 24"><path d="M4 21V9l8-6 8 6v12"/><path d="M12 10v6M9 13h6"/></svg>',
  video: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="13" height="12" rx="3"/><path d="M16 10l5-3v10l-5-3z"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>',
  digital: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="3"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  go: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 17-3-7z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  pill: '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M9 8.5l5 5"/></svg>',
  flask: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6L5 19a2 2 0 001.8 3h10.4A2 2 0 0019 19l-5-10V3"/></svg>',
  ref: '<svg viewBox="0 0 24 24"><path d="M7 3h8l4 4v14H7z"/><path d="M11 12h4M11 16h4"/></svg>',
  nurse: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.5-7 10-7 10z"/></svg>',
  cam: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
};

const DOCTOR = { name: 'ד"ר רונית שפירא', init: 'ר.ש', role: 'רפואת משפחה' };
const SCENARIOS = {
  1: 'יש לי כאב בטן מאתמול',
  2: 'אני צריכה לחדש מרשם לתרופה ללחץ דם',
  3: 'יש לי כאב בחזה שמקרין ליד שמאל ואני מזיעה',
  4: 'יש לי פריחה מגרדת בזרוע כבר שבוע, בלי חום',
};
const SUGGESTIONS = ['כאב בטן', 'כאב ראש', 'חום', 'שיעול או כאב גרון', 'כאב גב', 'פריחה', 'חידוש מרשם'];
const CH_INFO = {
  clinic: { name: 'תור במרפאה', desc: 'פגישה פנים אל פנים עם רופא/ה' },
  video: { name: 'תור וידאו', desc: 'שיחת וידאו עם רופא/ה מהבית' },
  phone: { name: 'תור טלפוני', desc: 'רופא/ה יתקשרו אליכם' },
  digital: { name: 'בקשה דיגיטלית', desc: 'בלי תור ובלי להגיע, מטפלים מרחוק' },
};

let S = null;
const profile = () => R.PROFILES.find((p) => p.id === S.profileId);

function freshState(profileId) {
  return { profileId, view: 'home', chat: [], chips: [], expect: null, busy: false, userText: '', complaintId: null,
    answers: {}, decision: null, channel: null, slot: null, photo: false, unknownTries: 0, token: (S ? S.token : 0) + 1, maxQ: 5 };
}

/* ---------- header / profile ---------- */
function renderHeader() {
  const p = profile();
  $('#avatar').textContent = p.name[0];
  $('#pName').textContent = p.name;
  const flags = [p.age + ' · ' + (p.sex === 'male' ? 'גבר' : 'אישה')].concat(p.pregnant ? ['בהריון'] : [], p.chronic);
  $('#pMeta').textContent = flags.join(' · ');
}
function openSheet() {
  const sh = $('#sheet');
  sh.hidden = false;
  sh.innerHTML = '<div class="sheet"><h3>מי מזמין/ה תור?</h3>' + R.PROFILES.map((p) =>
    '<button class="member ' + (p.id === S.profileId ? 'sel' : '') + '" data-id="' + p.id + '"><span class="avatar">' + esc(p.name[0]) + '</span><span><b>' + esc(p.name) + '</b><small>' +
    esc([p.age + ' · ' + (p.sex === 'male' ? 'גבר' : 'אישה')].concat(p.pregnant ? ['בהריון'] : [], p.chronic).join(' · ')) + '</small></span></button>').join('') + '</div>';
  sh.onclick = (e) => {
    const m = e.target.closest('.member');
    if (m) { closeSheet(); hardReset(m.dataset.id); }
    else if (e.target === sh) closeSheet();
  };
}
function closeSheet() { const sh = $('#sheet'); sh.hidden = true; sh.innerHTML = ''; }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2200);
}

/* ---------- view plumbing ---------- */
function setView(name, html) {
  S.view = name;
  $('#view').innerHTML = html;
  const emerg = $('#emerg'); if (emerg) emerg.remove();
}
const backBtn = (id) => '<button class="back" id="' + id + '" aria-label="חזרה">' + ICON.back + '</button>';

/* ---------- home ---------- */
function showHome() {
  S.token++;
  S.chat = []; S.chips = []; S.expect = null; S.busy = false;
  S.complaintId = null; S.answers = {}; S.decision = null; S.channel = null; S.slot = null; S.photo = false; S.unknownTries = 0;
  const first = profile().name.split(' ')[0];
  setView('home', '<div class="pane"><div class="hello">שלום, ' + esc(first) + '</div><div class="sub">במה נעזור היום?</div><div class="tiles">' +
    '<button class="tile main" id="tileBook"><span class="ti">' + ICON.cal + '</span><span>לזמן תורים<small>עוזר דיגיטלי ישאל כמה שאלות קצרות</small></span><span class="arrow">' + ICON.go + '</span></button>' +
    '<button class="tile" data-na><span class="ti">' + ICON.pill + '</span>התרופות שלי</button>' +
    '<button class="tile" data-na><span class="ti">' + ICON.flask + '</span>תוצאות בדיקות</button>' +
    '<button class="tile" data-na><span class="ti">' + ICON.ref + '</span>הפניות</button>' +
    '<button class="tile" id="tileNurse"><span class="ti">' + ICON.nurse + '</span>שיחה עם אחות</button>' +
    '</div><p class="home-note">הדגמה בלבד · נתונים בדויים</p></div>');
  $('#tileBook').onclick = () => startChat();
  $('#tileNurse').onclick = () => showNurse('home');
  document.querySelectorAll('[data-na]').forEach((b) => { b.onclick = () => toast('לא פעיל בהדגמה'); });
}

/* ---------- chat ---------- */
function renderChat() {
  setView('chat',
    '<div class="chat-head">' + backBtn('chatBack') + '<div class="bot-id"><b>העוזר הדיגיטלי</b><small>עוזר להזמין את סוג התור המתאים</small></div>' +
    '<div class="progress" id="progress" hidden><span id="progText"></span><div class="bar"><i id="progBar"></i></div></div></div>' +
    '<div class="msgs" id="msgs"></div><div class="chips" id="chips"></div>' +
    '<form class="composer" id="composer" autocomplete="off"><input id="inp" placeholder="כתבו כאן או בחרו תשובה" aria-label="הודעה"><button class="send" aria-label="שליחה">' + ICON.send + '</button></form>');
  S.chat.forEach((m) => appendBubble(m.from, m.text, true));
  renderChips();
  updateProgress();
  $('#chatBack').onclick = () => showHome();
  $('#composer').onsubmit = (e) => { e.preventDefault(); const v = $('#inp').value.trim(); if (v) { $('#inp').value = ''; onSend(v); } };
}
function appendBubble(from, text, isStatic) {
  const box = $('#msgs'); if (!box) return;
  const d = document.createElement('div');
  d.className = 'bubble ' + from + (isStatic ? ' static' : '');
  d.textContent = text;
  box.appendChild(d);
  box.scrollTop = box.scrollHeight;
}
function pushMsg(from, text) { S.chat.push({ from, text }); if (S.view === 'chat') appendBubble(from, text); }
function showTyping() {
  const box = $('#msgs'); if (!box || $('#typing')) return;
  const t = document.createElement('div'); t.className = 'typing'; t.id = 'typing'; t.innerHTML = '<i></i><i></i><i></i>';
  box.appendChild(t); box.scrollTop = box.scrollHeight;
}
function hideTyping() { const t = $('#typing'); if (t) t.remove(); }
async function say(text) {
  const tk = S.token;
  showTyping();
  await sleep(420 + Math.min(text.length * 9, 520));
  if (tk !== S.token) return false;
  hideTyping();
  pushMsg('bot', text);
  return true;
}
function setChips(list) { S.chips = list; renderChips(); }
function renderChips() {
  const c = $('#chips'); if (!c) return;
  c.innerHTML = '';
  S.chips.forEach((ch, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (ch.soft ? ' soft' : ''); b.textContent = ch.label; b.style.animationDelay = (i * 40) + 'ms';
    b.onclick = () => { if (!S.busy) ch.onClick(); };
    c.appendChild(b);
  });
  const box = $('#msgs'); if (box) box.scrollTop = box.scrollHeight;
}
function updateProgress() {
  const p = $('#progress'); if (!p) return;
  if (!S.complaintId || S.complaintId === 'unknown' || S.view !== 'chat' || !S.currentQ) { p.hidden = true; return; }
  const n = Math.min(Object.keys(S.answers).length + 1, S.maxQ);
  p.hidden = false;
  $('#progText').textContent = 'שאלה ' + n + ' (עד ' + S.maxQ + ')';
  $('#progBar').style.width = Math.round((n / S.maxQ) * 100) + '%';
}

async function startChat(prefill) {
  S.token++;
  S.chat = []; S.chips = []; S.expect = null; S.complaintId = null; S.answers = {}; S.currentQ = null; S.userText = '';
  renderChat();
  const first = profile().name.split(' ')[0];
  S.busy = true;
  const ok = await say('היי ' + first + ', אני כאן כדי לעזור לבחור את סוג התור המתאים. מה הבעיה שבגללה פונים היום?');
  if (!ok) return;
  askComplaint();
  if (prefill) { await sleep(350); if (S.expect === 'complaint') { $('#inp').value = prefill; await sleep(450); $('#inp').value = ''; onSend(prefill); } }
}
function askComplaint() {
  S.expect = 'complaint'; S.busy = false; S.currentQ = null; updateProgress();
  setChips(SUGGESTIONS.map((t) => ({ label: t, onClick: () => onSend(t) })));
}

function onSend(text) {
  if (S.busy) return;
  if (S.expect === 'complaint') return handleComplaint(text);
  if (S.expect && S.expect.qid) return handleTyped(text);
}

async function handleComplaint(text) {
  const tk = S.token;
  S.busy = true; setChips([]);
  pushMsg('user', text);
  let res = { complaintId: 'unknown', source: 'local' };
  try {
    showTyping();
    const r = await fetch('/api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    res = await r.json();
  } catch (_) { res = { complaintId: R.localClassify(text).complaintId, source: 'local' }; }
  if (tk !== S.token) return;
  hideTyping();
  setStatus(res.source === 'llm');
  if (!R.COMPLAINTS[res.complaintId]) {
    S.unknownTries++;
    if (S.unknownTries >= 2) {
      S.decision = R.decide('unknown', {}, profile()); S.complaintId = 'unknown'; S.userText = text;
      if (!(await say('לא הצלחתי להבין עד הסוף, ולכן לא אנחש. הכנתי לך אפשרויות בטוחות.'))) return;
      await sleep(400); return showResult();
    }
    if (!(await say('לא בטוח שהבנתי. אפשר לתאר במילים אחרות מה מפריע, או לדבר עם אחות במוקד.'))) return;
    S.busy = false; S.expect = 'complaint';
    return setChips(SUGGESTIONS.slice(0, 4).map((t) => ({ label: t, onClick: () => onSend(t) })).concat([{ label: 'שיחה עם אחות', soft: true, onClick: () => showNurse('chat') }]));
  }
  S.complaintId = res.complaintId; S.userText = text; S.answers = {};
  const c = R.COMPLAINTS[S.complaintId];
  S.maxQ = Math.min(c.questions.length, 5);
  if (!(await say('הבנתי, נתמקד ב"' + c.he + '". כמה שאלות קצרות, אפשר ללחוץ על תשובה או לכתוב.'))) return;
  askNext();
}

async function askNext() {
  const d = R.decide(S.complaintId, S.answers, profile());
  if (d.done) return finish(d);
  const qn = R.getQuestion(S.complaintId, d.next);
  S.currentQ = qn; S.busy = true; updateProgress();
  if (!(await say(qn.text))) return;
  S.expect = { qid: qn.id }; S.busy = false;
  setChips(qn.options.map((o) => ({ label: o.label, onClick: () => recordAnswer(qn, o.value, o.label, true) })));
}

function recordAnswer(qn, value, label, echo) {
  S.busy = true; setChips([]); S.expect = null;
  if (echo) pushMsg('user', label);
  S.answers[qn.id] = value;
  askNext();
}

async function handleTyped(text) {
  const tk = S.token, qn = S.currentQ;
  S.busy = true; setChips([]);
  pushMsg('user', text);
  let value = null;
  try {
    showTyping();
    const r = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ complaintId: S.complaintId, questionId: qn.id, text }) });
    const j = await r.json(); value = j.value; setStatus(j.source === 'llm');
  } catch (_) { value = R.localMapAnswer(qn, text); }
  if (tk !== S.token) return;
  hideTyping();
  if (value == null) {
    if (!(await say('לא בטוח שהבנתי. אפשר ללחוץ על אחת האפשרויות.'))) return;
    S.busy = false;
    return setChips(qn.options.map((o) => ({ label: o.label, onClick: () => recordAnswer(qn, o.value, o.label, true) })));
  }
  recordAnswer(qn, value, '', false);
}

async function finish(d) {
  S.decision = d; S.currentQ = null; updateProgress();
  if (d.restart) {
    if (!(await say('כשיש תסמין חדש או תופעת לוואי, נתחיל דווקא ממנו. מה התסמין?'))) return;
    S.complaintId = null; S.answers = {};
    return askComplaint();
  }
  if (d.emergency) {
    fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: S.profileId, complaintId: S.complaintId, userText: S.userText, answers: S.answers, channel: 'emergency' }) }).catch(() => {});
    await sleep(250);
    return showEmergency(d);
  }
  if (!(await say('תודה! על סמך התשובות הכנתי לך את האפשרויות.'))) return;
  await sleep(450);
  showResult();
}

/* ---------- emergency ---------- */
function showEmergency(d) {
  S.view = 'emergency';
  const e = document.createElement('div'); e.className = 'emerg'; e.id = 'emerg';
  e.innerHTML = '<div class="big">' + ICON.alert + '</div><h1>יש לפנות עכשיו לחירום</h1>' +
    '<p>התקשרו ל-101 או הגיעו מיד למיון הקרוב. אין צורך לקבוע תור, ולא כדאי להמתין.</p>' +
    '<div class="call"><a href="tel:101">חיוג 101</a></div>' +
    (d.eran ? '<div class="eran">ער"ן – עזרה ראשונה נפשית, זמינים עכשיו<b>1201</b></div>' : '') +
    '<p class="fine">ההפניה מבוססת על התשובות שלכם ואינה אבחנה רפואית. אם אפשר, אל תישארו לבד.</p>' +
    '<button class="close" id="emClose">הבנתי, חזרה לדף הבית</button>';
  $('#screen').appendChild(e);
  $('#emClose').onclick = () => showHome();
}

/* ---------- result ---------- */
function tierChip(t) { return '<span class="uchip t' + t + '">' + R.TIERS[t].he + '</span>'; }
function showResult() {
  const d = S.decision;
  const order = ['digital', 'clinic', 'video', 'phone'];
  const cards = order.filter((ch) => d.channelsAllowed.includes(ch) || d.locked.some((l) => l.channel === ch)).map((ch, i) => {
    const lock = d.locked.find((l) => l.channel === ch);
    const info = CH_INFO[ch], rec = d.recommended === ch;
    if (lock) return '<div class="card locked" style="animation-delay:' + (i * 90) + 'ms" aria-disabled="true"><span class="ci">' + ICON[ch] + '</span><span class="ct"><b>' + info.name + '</b><span>' + esc(lock.reason) + '</span></span><span class="lk">' + ICON.lock + '</span></div>';
    return '<button class="card ok' + (rec ? ' rec' : '') + '" data-ch="' + ch + '" style="animation-delay:' + (i * 90) + 'ms">' + (rec ? '<span class="tag">מומלץ עבורך</span>' : '') +
      '<span class="ci">' + ICON[ch] + '</span><span class="ct"><b>' + info.name + '</b><span>' + info.desc + '</span></span><span class="go">' + ICON.go + '</span></button>';
  }).join('');
  setView('result', '<div class="chat-head">' + backBtn('resBack') + '<div class="bot-id"><b>האפשרויות שלך</b><small>' + esc(d.complaint || '') + '</small></div></div>' +
    '<div class="pane"><div class="r-why">' + tierChip(d.tier) + '<span>' + esc(d.why) + '</span></div><div class="cards">' + cards + '</div>' +
    '<button class="link" id="nurseLink">לא מתאים לי – שיחה עם אחות</button><div class="pad-b"></div></div>');
  $('#resBack').onclick = () => { renderChat(); };
  $('#nurseLink').onclick = () => showNurse('result');
  document.querySelectorAll('.card.ok').forEach((b) => { b.onclick = () => selectChannel(b.dataset.ch); });
}

function selectChannel(ch) {
  S.channel = ch; S.slot = null; S.photo = false;
  if (ch === 'digital') return submitBooking(true);
  if (S.complaintId === 'rash' && ch === 'video') return showPhoto();
  showSlots();
}

function showNurse(from) {
  setView('nurse', '<div class="chat-head">' + backBtn('nBack') + '<div class="bot-id"><b>שיחה עם אחות</b><small>מוקד מכבי</small></div></div>' +
    '<div class="pane center"><div class="okmark" style="background:#eaf1ff;color:var(--blue)">' + ICON.nurse.replace('<svg', '<svg style="stroke-dasharray:none;stroke-dashoffset:0;animation:none"') + '</div>' +
    '<div class="h2">אחות זמינה לשיחה</div><p class="note">אפשר לספר במילים שלכם מה מפריע, והאחות תכוון אתכם לצעד הבא.</p><div class="bignum">*3555</div>' +
    '<a class="btn" href="tel:*3555" style="text-decoration:none">חיוג למוקד</a><div class="pad-b"></div>' +
    '<button class="btn ghost" id="nBack2">חזרה</button></div>');
  const back = () => { if (from === 'result' && S.decision) showResult(); else if (from === 'chat') { renderChat(); } else showHome(); };
  $('#nBack').onclick = back; $('#nBack2').onclick = back;
}

/* ---------- photo (simulated) ---------- */
function showPhoto() {
  setView('photo', '<div class="chat-head">' + backBtn('phBack') + '<div class="bot-id"><b>צירוף תמונה</b><small>עוזר לרופא/ה להעריך בוידאו</small></div></div>' +
    '<div class="pane"><div class="h2">צרפו תמונה של האזור</div><p class="note">תמונה ברורה, באור טוב, תעזור לרופא/ה להתכונן לפגישה. בהדגמה אין העלאה אמיתית.</p>' +
    '<div id="dropArea"><button class="drop" id="addPhoto" style="width:100%;font-family:inherit"><div class="big">' + ICON.cam + '</div><b style="color:var(--ink)">צירוף תמונה</b><br><small>הדגמה בלבד</small></button></div>' +
    '<button class="btn" id="phNext">המשך לבחירת מועד</button><button class="link" id="phSkip">דלגו על השלב</button></div>');
  $('#phBack').onclick = () => showResult();
  $('#addPhoto').onclick = () => {
    S.photo = true;
    $('#dropArea').innerHTML = '<div class="thumb"><i></i><span><b>תמונה_1.jpg</b><small>נוספה (הדגמה)</small></span></div>';
  };
  $('#phNext').onclick = () => showSlots();
  $('#phSkip').onclick = () => { S.photo = false; showSlots(); };
}

/* ---------- slots ---------- */
const pad = (n) => String(n).padStart(2, '0');
function genSlots(tier) {
  const now = new Date();
  const round = (d) => { d.setMinutes(Math.ceil(d.getMinutes() / 10) * 10, 0, 0); return d; };
  const add = (m) => round(new Date(now.getTime() + m * 60000));
  const day = (off, h, m) => { const d = new Date(now); d.setDate(d.getDate() + off); d.setHours(h, m, 0, 0); return d; };
  const work = (d) => { if (d.getHours() >= 20 || d.getHours() < 7) { const n = new Date(d); if (d.getHours() >= 20) n.setDate(n.getDate() + 1); n.setHours(8, 20, 0, 0); return n; } return d; };
  let list;
  if (tier <= 1) list = [work(add(35)), work(add(65)), work(add(110)), work(add(160))];
  else if (tier === 2) list = [work(add(150)), work(add(240)), day(1, 9, 10), day(1, 11, 40)];
  else if (tier === 3) list = [day(1, 10, 30), day(1, 16, 10), day(2, 9, 40), day(3, 12, 20)];
  else list = [day(3, 10, 0), day(5, 14, 30), day(8, 9, 20), day(10, 17, 10)];
  list.sort((a, b) => a - b);
  for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] < 30 * 60000) list[i] = new Date(list[i - 1].getTime() + 40 * 60000);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const names = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'שבת'];
  return list.map((d) => {
    const diff = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
    const dayLabel = diff === 0 ? 'היום' : diff === 1 ? 'מחר' : names[d.getDay()] + ' ' + d.getDate() + '.' + (d.getMonth() + 1);
    return { iso: d.toISOString(), day: dayLabel, time: pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  });
}
const PLACE = {
  clinic: 'מרפאת מכבי (הדגמה), רחוב הדוגמה 12',
  video: 'הפגישה תתקיים בשיחת וידאו באפליקציה',
  phone: 'הרופא/ה יתקשרו אליכם בשעה שנקבעה',
};
function showSlots() {
  const d = S.decision, ch = S.channel;
  const slots = genSlots(d.tier);
  setView('slots', '<div class="chat-head">' + backBtn('slBack') + '<div class="bot-id"><b>' + CH_INFO[ch].name + '</b><small>בחירת מועד</small></div></div>' +
    '<div class="pane"><div class="doc"><span class="av">' + DOCTOR.init + '</span><span><b>' + DOCTOR.name + '</b><small>' + DOCTOR.role + '</small><small>' + esc(PLACE[ch]) + '</small></span></div>' +
    '<div class="r-why" style="margin-bottom:6px">' + tierChip(d.tier) + '<span>מועדים פנויים בהתאם לדחיפות</span></div>' +
    '<div class="slots">' + slots.map((s, i) => '<button class="slot" data-i="' + i + '" style="animation-delay:' + (i * 70) + 'ms"><small>' + s.day + '</small><b>' + s.time + '</b></button>').join('') + '</div>' +
    '<button class="btn" id="slOk" disabled>אישור התור</button></div>');
  $('#slBack').onclick = () => (S.complaintId === 'rash' && ch === 'video' ? showPhoto() : showResult());
  document.querySelectorAll('.slot').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.slot').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel'); S.slot = slots[+b.dataset.i]; $('#slOk').disabled = false;
    };
  });
  $('#slOk').onclick = () => submitBooking(false);
}

/* ---------- booking + confirmation ---------- */
async function submitBooking(digital) {
  const body = { profileId: S.profileId, complaintId: S.complaintId, userText: S.userText, answers: S.answers, channel: S.channel, photo: S.photo, when: S.slot ? S.slot.iso : null };
  try {
    const r = await fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('book');
  } catch (_) { return toast('לא ניתן היה לשמור, נסו שוב'); }
  digital ? showSent() : showConfirm();
}
function showConfirm() {
  const d = S.decision, ch = S.channel;
  setView('confirm', '<div class="pane center"><div class="okmark">' + ICON.check + '</div><div class="h2">התור נקבע</div>' +
    '<div class="sumcard"><div class="sumrow"><span>סוג תור</span><b>' + CH_INFO[ch].name + '</b></div><div class="sumrow"><span>מועד</span><b>' + S.slot.day + ', ' + S.slot.time + '</b></div>' +
    '<div class="sumrow"><span>רופא/ה</span><b>' + DOCTOR.name + '</b></div><div class="sumrow"><span>דחיפות</span><b>' + tierChip(d.tier) + '</b></div>' +
    (S.photo ? '<div class="sumrow"><span>תמונה</span><b>צורפה (הדגמה)</b></div>' : '') + '</div>' +
    '<p class="note">התשובות שלכם הועברו לרופא/ה כסיכום קצר, כדי שלא תצטרכו לחזור על הכול.</p>' +
    '<button class="btn" id="cfHome">חזרה לדף הבית</button></div>');
  $('#cfHome').onclick = () => showHome();
}
function showSent() {
  const d = S.decision;
  setView('sent', '<div class="pane center"><div class="okmark">' + ICON.check + '</div><div class="h2">הבקשה נשלחה</div>' +
    '<div class="sumcard"><div class="sumrow"><span>סוג</span><b>בקשה דיגיטלית, ללא תור</b></div><div class="sumrow"><span>טיפול</span><b>מרחוק, אין צורך להגיע</b></div><div class="sumrow"><span>דחיפות</span><b>' + tierChip(d.tier) + '</b></div></div>' +
    '<p class="note">הבקשה הועברה לרופא/ה. נעדכן אתכם באפליקציה כשתטופל.</p><button class="btn" id="sdHome">חזרה לדף הבית</button></div>');
  $('#sdHome').onclick = () => showHome();
}

/* ---------- status dot ---------- */
function setStatus(live) {
  $('#dot').classList.toggle('live', !!live);
  const t = live ? 'מודל חי' : 'תסריט מקומי';
  $('#dotLabel').textContent = t; $('#statusDot').title = 'מצב: ' + t;
}
async function loadStatus() {
  try { const j = await (await fetch('/api/status')).json(); setStatus(j.mode === 'live'); } catch (_) { setStatus(false); }
}

/* ---------- reset + demo menu ---------- */
function hardReset(profileId) {
  S = freshState(profileId || (S ? S.profileId : 'p1'));
  renderHeader(); showHome();
}
async function runScenario(n) {
  closeMenu(); closeSheet();
  S = freshState('p1'); renderHeader();
  await startChat(SCENARIOS[n]);
}
function closeMenu() { $('#demoMenu').hidden = true; }

$('#profileBtn').onclick = openSheet;
$('#demoBtn').onclick = (e) => { e.stopPropagation(); const m = $('#demoMenu'); m.hidden = !m.hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('.corner-demo')) closeMenu(); });
document.querySelectorAll('[data-sc]').forEach((b) => { b.onclick = () => runScenario(+b.dataset.sc); });
$('#resetBtn').onclick = async () => {
  closeMenu();
  try { await fetch('/api/reset', { method: 'POST' }); } catch (_) {}
  hardReset('p1'); toast('המערכת אופסה');
};

S = freshState('p1');
renderHeader(); showHome(); loadStatus();
