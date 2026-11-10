'use strict';
// Zero-dependency demo server. Node 24: built-in http, fs, global fetch.
const http = require('http');
const fs = require('fs');
const path = require('path');
const Rules = require('./rules.js');

// ---------- .env (parsed by hand; never logged) ----------
(function loadEnv() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  } catch (_) { /* no .env: scripted mode */ }
})();

const PORT = Number(process.env.PORT) || 3000;
const LLM = {
  base: (process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
  model: process.env.LLM_MODEL || '',
  key: process.env.LLM_API_KEY || '',
  timeoutMs: 6000,
  lastOk: null,
};
const llmConfigured = () => !!(LLM.key && LLM.model && !/your-free-qwen/i.test(LLM.model) && !/^(your|paste)/i.test(LLM.key));

// ---------- LLM helpers (classification, answer mapping, summary wording ONLY) ----------
function parseJsonLoose(text) {
  if (!text) return null;
  let t = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(t); } catch (_) { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* ignore */ } }
  return null;
}
async function llmJson(system, user) {
  if (!llmConfigured()) return null;
  try {
    const res = await fetch(LLM.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LLM.key },
      body: JSON.stringify({
        model: LLM.model, temperature: 0, max_tokens: 400,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(LLM.timeoutMs),
    });
    if (!res.ok) throw new Error('http ' + res.status);
    const data = await res.json();
    const obj = parseJsonLoose(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    if (!obj || typeof obj !== 'object') throw new Error('unparseable');
    LLM.lastOk = true;
    return obj;
  } catch (_) {
    LLM.lastOk = false; // silent fallback; details (and the key) are never logged
    return null;
  }
}

async function classify(text) {
  const list = Rules.COMPLAINT_ORDER.map((id) => id + ' = ' + Rules.COMPLAINTS[id].he).join('\n');
  const obj = await llmJson(
    'You classify a patient\'s Hebrew free text into exactly one complaint ID for a health-fund appointment assistant. You never diagnose. ' +
    'Allowed IDs:\n' + list + '\nunknown = none of the above or unclear.\n' +
    'Reply with strict JSON only: {"complaint":"<id>","confidence":<0..1>}',
    String(text).slice(0, 500));
  if (obj && typeof obj.complaint === 'string') {
    const id = obj.complaint.trim();
    const conf = Number(obj.confidence);
    if (Rules.COMPLAINTS[id] && !(conf < 0.5)) return { complaintId: id, confidence: isFinite(conf) ? conf : 0.7, source: 'llm' };
    if (id === 'unknown') return { complaintId: 'unknown', confidence: 0, source: 'llm' };
  }
  return Rules.localClassify(text);
}

async function mapAnswer(complaintId, questionId, text) {
  const question = Rules.getQuestion(complaintId, questionId);
  if (!question) return { value: null, source: 'local' };
  const opts = question.options.map((o) => o.value + ' = ' + o.label).join('\n');
  const obj = await llmJson(
    'Map the patient\'s Hebrew answer onto exactly one option of the question, or "none" if it is unclear or does not answer it. Do not guess.\n' +
    'Question: ' + question.text + '\nOptions:\n' + opts + '\nReply with strict JSON only: {"value":"<option value or none>"}',
    String(text).slice(0, 300));
  if (obj && typeof obj.value === 'string') {
    if (question.options.some((o) => o.value === obj.value)) return { value: obj.value, source: 'llm' };
    if (obj.value === 'none') return { value: null, source: 'llm' };
  }
  return { value: Rules.localMapAnswer(question, text), source: 'local' };
}

// ---------- summaries ----------
function answerLabel(qn, v) { const o = qn.options.find((x) => x.value === v); return o ? o.label : v; }

function buildSummary(profile, complaintId, userText, answers, decision, channel, photo) {
  const c = Rules.COMPLAINTS[complaintId];
  const qa = [], denied = [], positive = [];
  if (c) {
    for (const qn of c.questions) {
      const v = answers[qn.id];
      if (v == null) continue;
      const isFlag = !!qn.short && v !== (qn.deny || 'no');
      qa.push({ q: qn.text, a: answerLabel(qn, v), flag: isFlag });
      if (qn.short) (isFlag ? positive : denied).push(qn.short);
    }
  }
  const profileFlags = ['גיל ' + profile.age, profile.sex === 'male' ? 'גבר' : 'אישה']
    .concat(profile.pregnant ? ['הריון'] : [], profile.immuno ? ['דיכוי חיסוני'] : [], profile.chronic || []);
  const tierHe = decision.tier != null ? Rules.TIERS[decision.tier].he : '';
  const label = c ? c.he : 'פנייה לא מזוהה';
  const s1 = 'המבוטח/ת ' + profile.name + ' (גיל ' + profile.age + ') פונה בשל ' + label + '; ' +
    (positive.length ? 'דווח על: ' + positive.join(', ') : 'לא דווחו סימני אזהרה בשאלון') + '.';
  const s2 = 'נותב/ה ל' + (Rules.CHANNELS[channel] || channel) + ' בדחיפות "' + tierHe + '"' +
    (decision.modifiers && decision.modifiers.length ? ' (הועלתה בדרגה בגלל ' + decision.modifiers.join(', ') + ')' : '') +
    (photo ? ', צורפה תמונה' : '') + '.';
  return { words: userText, qa, denied, profileFlags, why: decision.why, text: s1 + ' ' + s2, photo: !!photo };
}

async function rewriteSummary(summary) {
  const obj = await llmJson(
    'Rewrite the following pre-visit facts as exactly two short, fluent Hebrew sentences for a family doctor. ' +
    'Use only the facts given. No diagnosis, no advice. Reply with strict JSON only: {"text":"<two sentences>"}',
    summary.text + '\nהסימנים שנשללו: ' + (summary.denied.join(', ') || 'אין'));
  if (obj && typeof obj.text === 'string' && obj.text.trim().length > 10 && obj.text.length < 600) return obj.text.trim();
  return null;
}

// ---------- in-memory state ----------
const DOCTOR = { name: 'ד"ר רונית שפירא', specialty: 'רפואת משפחה' };
let queue = [], emergencies = [], seq = 1;

const todayAt = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };

function makeEntry({ profile, complaintId, userText, answers, channel, when, bookedAt, photo, source }) {
  const d = Rules.decide(complaintId, answers, profile);
  const c = Rules.COMPLAINTS[complaintId];
  return {
    id: 'a' + (seq++), source: source || 'patient',
    name: profile.name, age: profile.age,
    complaintId, complaint: c ? c.he : 'פנייה לא מזוהה',
    tier: d.tier, tierLabel: d.tier != null ? Rules.TIERS[d.tier].he : '',
    channel, channelLabel: Rules.CHANNELS[channel] || channel,
    when: when || null, bookedAt: bookedAt || new Date().toISOString(),
    summary: buildSummary(profile, complaintId, userText, answers, d, channel, photo),
  };
}

const no = (...ids) => Object.fromEntries(ids.map((i) => [i, 'no']));
function seedState() {
  seq = 1;
  const P = (name, age, sex, extra) => Object.assign({ name, age, sex, pregnant: false, immuno: false, diabetic: false, chronic: [] }, extra || {});
  const seeds = [
    { profile: P('ליאור חיים', 38, 'male'), complaintId: 'abdominal', userText: 'כואבת לי הבטן כבר מהבוקר ויש הקאות',
      answers: { ...no('ab_sudden', 'ab_blood', 'ab_block'), ab_worse: 'yes' }, channel: 'clinic', when: '09:00', booked: '08:50' },
    { profile: P('רחל מנסור', 73, 'female', { chronic: ['יתר לחץ דם', 'סוכרת'], diabetic: true }), complaintId: 'headache', userText: 'כאב ראש חזק מאתמול, והיום הקאתי',
      answers: { ...no('he_sudden', 'he_neuro', 'he_neck', 'he_injury'), he_vomit: 'yes' }, channel: 'clinic', when: '09:40', booked: '07:30' },
    { profile: P('יוסי אלבז', 52, 'male'), complaintId: 'urinary', userText: 'צריבה במתן שתן כבר יומיים',
      answers: no('ur_confuse', 'ur_sys'), channel: 'clinic', when: '10:20', booked: '08:15' },
    { profile: P('עומר שחר', 31, 'male'), complaintId: 'fever', userText: 'יש לי חום מאתמול בערב',
      answers: { ...no('fe_rash', 'fe_wake', 'fe_dehyd'), fe_days: 'short' }, channel: 'video', when: '12:40', booked: '08:40' },
    { profile: P('גיל אורבך', 36, 'male'), complaintId: 'rash', userText: 'פריחה מגרדת בבטן כבר כמה ימים',
      answers: no('ra_fade', 'ra_swell', 'ra_fever', 'ra_fast'), channel: 'video', when: '15:20', booked: '07:45', photo: true },
    { profile: P('תמר גולן', 29, 'female'), complaintId: 'back', userText: 'כאב גב אחרי שהרמתי ארגזים',
      answers: no('ba_neuro', 'ba_trauma', 'ba_fever', 'ba_chronic'), channel: 'phone', when: '14:00', booked: '06:50' },
    { profile: P('ענת שגיא', 45, 'female'), complaintId: 'admin', userText: 'לחדש מרשם לתרופה קבועה',
      answers: no('ad_new'), channel: 'digital', when: null, booked: '08:00' },
  ];
  queue = seeds.map((s) => makeEntry({ ...s, when: s.when ? todayAt(s.when) : null, bookedAt: todayAt(s.booked), source: 'seed' }));
  const pr = P('אורי מלכה', 61, 'male');
  const e = makeEntry({ profile: pr, complaintId: 'chest', userText: 'לחץ בחזה שמקרין לזרוע', answers: { ch_now: 'yes' }, channel: 'emergency', when: null, bookedAt: todayAt('08:12'), source: 'seed' });
  emergencies = [e];
}
seedState();

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const profileById = (id) => Rules.PROFILES.find((p) => p.id === id);

function serveStatic(res, urlPath) {
  let file;
  if (urlPath === '/' || urlPath === '/index.html') file = path.join(__dirname, 'public', 'index.html');
  else if (urlPath === '/doctor') file = path.join(__dirname, 'public', 'doctor.html');
  else if (urlPath === '/rules.js') file = path.join(__dirname, 'rules.js');
  else {
    file = path.join(__dirname, 'public', path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
  }
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && p === '/api/status') {
      return send(res, 200, { mode: llmConfigured() && LLM.lastOk !== false ? 'live' : 'scripted', configured: llmConfigured() });
    }
    if (req.method === 'GET' && p === '/api/queue') return send(res, 200, { doctor: DOCTOR, appointments: queue, emergencies });
    if (req.method === 'POST' && p === '/api/reset') { seedState(); return send(res, 200, { ok: true }); }
    if (req.method === 'POST' && p === '/api/classify') {
      const b = await readBody(req);
      if (!b.text || typeof b.text !== 'string') return send(res, 400, { error: 'text required' });
      return send(res, 200, await classify(b.text));
    }
    if (req.method === 'POST' && p === '/api/answer') {
      const b = await readBody(req);
      return send(res, 200, await mapAnswer(b.complaintId, b.questionId, String(b.text || '')));
    }
    if (req.method === 'POST' && (p === '/api/book' || p === '/api/summary')) {
      const b = await readBody(req);
      const profile = profileById(b.profileId);
      if (!profile) return send(res, 400, { error: 'unknown profile' });
      const answers = b.answers && typeof b.answers === 'object' ? b.answers : {};
      const d = Rules.decide(b.complaintId, answers, profile);
      if (!d.done) return send(res, 400, { error: 'questionnaire incomplete' });
      const userText = String(b.userText || '').slice(0, 400);
      if (p === '/api/summary') {
        const s = buildSummary(profile, b.complaintId, userText, answers, d, b.channel || d.recommended, !!b.photo);
        const t = await rewriteSummary(s);
        return send(res, 200, { text: t || s.text, source: t ? 'llm' : 'local', summary: s });
      }
      const channel = b.channel;
      if (channel === 'emergency') {
        if (!d.emergency) return send(res, 400, { error: 'not an emergency' });
        const e = makeEntry({ profile, complaintId: b.complaintId, userText, answers, channel, when: null });
        emergencies.push(e);
        return send(res, 200, { ok: true, id: e.id });
      }
      if (d.emergency || !d.channelsAllowed.includes(channel)) return send(res, 400, { error: 'channel not allowed' });
      let when = null;
      if (channel !== 'digital') { const t = new Date(b.when); when = isNaN(t) ? new Date(Date.now() + 3600e3).toISOString() : t.toISOString(); }
      const entry = makeEntry({ profile, complaintId: b.complaintId, userText, answers, channel, when, photo: !!b.photo });
      queue.push(entry);
      // optional fluent rewrite, never blocks the booking and never affects routing
      if (llmConfigured()) rewriteSummary(entry.summary).then((t) => { if (t) entry.summary.text = t; }).catch(() => {});
      return send(res, 200, { ok: true, id: entry.id, tier: entry.tier });
    }
    if (req.method === 'GET') return serveStatic(res, decodeURIComponent(p));
    send(res, 404, { error: 'not found' });
  } catch (_) {
    send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log('Demo running: http://localhost:' + PORT + '  (doctor: /doctor)  mode: ' + (llmConfigured() ? 'live model configured' : 'scripted (no API key)'));
});
