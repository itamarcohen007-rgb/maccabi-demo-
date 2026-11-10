'use strict';
// Run: node test.js   (no dependencies)
const assert = require('assert');
const net = require('net');
const { spawn } = require('child_process');
const R = require('./rules.js');

let pass = 0, fail = 0;
function t(name, fn) {
  return Promise.resolve().then(fn).then(() => { pass++; console.log('PASS  ' + name); })
    .catch((e) => { fail++; console.log('FAIL  ' + name + '\n      ' + (e && e.message)); });
}
const [P1, P2, P3] = R.PROFILES;
const no = (...ids) => Object.fromEntries(ids.map((i) => [i, 'no']));
const emerg = (cid, answers, p) => {
  const d = R.decide(cid, answers, p || P1);
  assert.strictEqual(d.done, true, cid + ' not done');
  assert.strictEqual(d.emergency, true, cid + ' should be emergency');
  assert.strictEqual(d.tier, 0);
  assert.deepStrictEqual(d.channelsAllowed, []);
  assert.strictEqual(d.recommended, 'emergency');
};

(async () => {
  // ---- four rehearsed scenarios ----
  await t('scenario 1: abdominal, no red flags -> clinic only, T2, phone+video locked', () => {
    const d = R.decide('abdominal', { ...no('ab_sudden', 'ab_blood', 'ab_block', 'ab_worse'), ab_dur: 'days' }, P1);
    assert.strictEqual(d.tier, 2);
    assert.deepStrictEqual(d.channelsAllowed, ['clinic']);
    assert.strictEqual(d.recommended, 'clinic');
    assert.deepStrictEqual(d.locked.map((l) => l.channel).sort(), ['phone', 'video']);
    assert.ok(d.locked.every((l) => l.reason === 'כאב בטן מחייב בדיקה גופנית של רופא/ה'));
  });
  await t('scenario 2: prescription renewal -> digital recommended (+phone), T4, clinic+video locked', () => {
    const d = R.decide('admin', { ad_new: 'no' }, P1);
    assert.strictEqual(d.tier, 4);
    assert.strictEqual(d.recommended, 'digital');
    assert.deepStrictEqual(d.channelsAllowed, ['digital', 'phone']);
    assert.deepStrictEqual(d.locked.map((l) => l.channel).sort(), ['clinic', 'video']);
    assert.ok(d.locked.every((l) => l.reason === 'אין צורך להגיע – אפשר לטפל בזה מרחוק'));
  });
  await t('scenario 3: chest pain spreading -> emergency T0, nothing bookable', () => {
    emerg('chest', { ch_now: 'no', ch_spread: 'yes' });
    const d = R.decide('chest', { ch_now: 'yes' }, P1);
    assert.strictEqual(d.done, true); assert.strictEqual(d.emergency, true); // stops after first yes
  });
  await t('scenario 4: rash no fever -> video recommended, phone locked, T3', () => {
    const d = R.decide('rash', no('ra_fade', 'ra_swell', 'ra_fever', 'ra_fast'), P1);
    assert.strictEqual(d.tier, 3);
    assert.strictEqual(d.recommended, 'video');
    assert.deepStrictEqual(d.channelsAllowed, ['video', 'clinic']);
    assert.deepStrictEqual(d.locked, [{ channel: 'phone', reason: 'אי אפשר להעריך פריחה בלי לראות אותה' }]);
  });

  // ---- flow behaviour ----
  await t('stops asking as soon as a red flag fires', () => {
    const d = R.decide('abdominal', { ab_sudden: 'yes' }, P1);
    assert.strictEqual(d.done, true); assert.strictEqual(d.emergency, true);
  });
  await t('asks next question while undecided', () => {
    const d = R.decide('abdominal', { ab_sudden: 'no' }, P1);
    assert.strictEqual(d.done, false); assert.strictEqual(d.next, 'ab_blood');
  });
  await t('chest "comes and goes" -> clinic only T1 with ECG lock', () => {
    const d = R.decide('chest', no('ch_now', 'ch_spread', 'ch_assoc'), P1);
    assert.strictEqual(d.tier, 1); assert.deepStrictEqual(d.channelsAllowed, ['clinic']);
    assert.ok(d.locked.every((l) => l.reason === 'נדרשת האזנה ובדיקת אק"ג במרפאה'));
  });
  await t('admin with new symptom -> restart', () => {
    const d = R.decide('admin', { ad_new: 'yes' }, P1);
    assert.strictEqual(d.restart, true);
  });
  await t('unknown complaint -> clinic T3 + nurse line', () => {
    const d = R.decide('unknown', {}, P1);
    assert.strictEqual(d.tier, 3); assert.strictEqual(d.nurse, true); assert.deepStrictEqual(d.channelsAllowed, ['clinic']);
  });

  // ---- a red-flag path for every complaint that has one ----
  await t('red flag: abdominal (blood)', () => emerg('abdominal', { ab_sudden: 'no', ab_blood: 'yes' }));
  await t('red flag: chest (assoc sweating)', () => emerg('chest', { ch_now: 'no', ch_spread: 'no', ch_assoc: 'yes' }));
  await t('red flag: headache (neuro)', () => emerg('headache', { he_sudden: 'no', he_neuro: 'yes' }));
  await t('red flag: fever (rash not fading)', () => emerg('fever', { fe_rash: 'yes' }));
  await t('red flag: cough (breathing)', () => emerg('cough', { co_breath: 'yes' }));
  await t('red flag: back (leg weakness)', () => emerg('back', { ba_neuro: 'yes' }));
  await t('red flag: urinary (confusion)', () => emerg('urinary', { ur_confuse: 'yes' }));
  await t('red flag: rash (swelling)', () => emerg('rash', { ra_fade: 'no', ra_swell: 'yes' }));
  await t('red flag: mood (unsafe) -> emergency + ERAN', () => {
    emerg('mood', { mo_safe: 'unsafe' });
    assert.strictEqual(R.decide('mood', { mo_safe: 'unsafe' }, P1).eran, true);
  });
  await t('ear (no red flag): >3 days -> clinic only T1', () => {
    const d = R.decide('ear', { ea_long: 'yes' }, P1);
    assert.strictEqual(d.tier, 1); assert.deepStrictEqual(d.channelsAllowed, ['clinic']);
  });
  await t('mood safe_now -> T1 video/clinic, phone locked', () => {
    const d = R.decide('mood', { mo_safe: 'safe_now' }, P1);
    assert.strictEqual(d.tier, 1); assert.deepStrictEqual(d.channelsAllowed, ['clinic', 'video']);
    assert.strictEqual(d.locked[0].channel, 'phone');
  });

  // ---- modifiers ----
  await t('modifier: 71-year-old diabetic cough T4 -> T3', () => {
    const d = R.decide('cough', no('co_breath', 'co_worse', 'co_long'), P2);
    assert.strictEqual(d.tier, 3); assert.ok(d.modifiers.length > 0); assert.ok(d.why.includes('הועלתה'));
  });
  await t('modifier: pregnant abdominal no flags T2 -> T1 (rule + modifier, never T0)', () => {
    const d = R.decide('abdominal', no('ab_sudden', 'ab_blood', 'ab_block', 'ab_worse'), P3);
    assert.strictEqual(d.tier, 1);
  });
  await t('modifier: same rash answers, 34yo T3 vs pregnant 28yo T2', () => {
    const a = no('ra_fade', 'ra_swell', 'ra_fever', 'ra_fast');
    assert.strictEqual(R.decide('rash', a, P1).tier, 3);
    assert.strictEqual(R.decide('rash', a, P3).tier, 2);
  });
  await t('modifier never creates T0', () => {
    for (const p of R.PROFILES) {
      const d = R.decide('cough', no('co_breath', 'co_worse', 'co_long'), p);
      assert.ok(d.tier >= 1);
    }
  });
  await t('modifier: child under 5 raises one tier', () => {
    const kid = { ...P1, age: 4 };
    assert.strictEqual(R.decide('fever', { ...no('fe_rash', 'fe_wake', 'fe_dehyd'), fe_days: 'short' }, kid).tier, 2);
  });
  await t('urinary: male goes straight to clinic T1 by profile', () => {
    const d = R.decide('urinary', no('ur_confuse'), P2);
    assert.strictEqual(d.done, true); assert.strictEqual(d.tier, 1);
  });

  // ---- offline classifier + server ----
  const SENT = [
    ['יש לי כאב בטן מאתמול', 'abdominal'],
    ['אני צריכה לחדש מרשם לתרופה ללחץ דם', 'admin'],
    ['יש לי כאב בחזה שמקרין ליד שמאל ואני מזיעה', 'chest'],
    ['יש לי פריחה מגרדת בזרוע כבר שבוע, בלי חום', 'rash'],
  ];
  await t('local classifier: four scenario sentences', () => {
    for (const [s, id] of SENT) assert.strictEqual(R.localClassify(s).complaintId, id, s);
  });
  await t('local classifier: wording variants for all complaints', () => {
    const cases = { 'כואב לי הראש': 'headache', 'יש לי חום גבוה': 'fever', 'שיעול כבר שבועיים': 'cough', 'כאבי גב תחתון': 'back',
      'צריבה במתן שתן': 'urinary', 'כואבת לי האוזן': 'ear', 'אני בחרדה': 'mood', 'צריך אישור מחלה': 'admin', 'יש לי שלשול והקאות': 'abdominal' };
    for (const [s, id] of Object.entries(cases)) assert.strictEqual(R.localClassify(s).complaintId, id, s);
    assert.strictEqual(R.localClassify('מה שלומך').complaintId, 'unknown');
  });

  const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  const child = spawn(process.execPath, ['server.js'], { cwd: __dirname, env: { ...process.env, PORT: String(port), LLM_API_KEY: '', LLM_MODEL: '' }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:' + port;
  const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base + '/api/status'); break; } catch (_) { await new Promise((r) => setTimeout(r, 100)); } }
    await t('server: status reports scripted mode with no key', async () => {
      assert.strictEqual((await (await fetch(base + '/api/status')).json()).mode, 'scripted');
    });
    for (const [s, id] of SENT) {
      await t('server: classify "' + s + '" -> ' + id, async () => {
        const j = await post('/api/classify', { text: s });
        assert.strictEqual(j.complaintId, id); assert.strictEqual(j.source, 'local');
      });
    }
    await t('server: scenario 1 booking appears in queue; reset restores seed', async () => {
      const before = (await (await fetch(base + '/api/queue')).json()).appointments.length;
      const r = await post('/api/book', { profileId: 'p1', complaintId: 'abdominal', userText: 'כאב בטן', answers: { ...no('ab_sudden', 'ab_blood', 'ab_block', 'ab_worse'), ab_dur: 'days' }, channel: 'clinic', when: new Date(Date.now() + 36e5).toISOString() });
      assert.ok(r.ok);
      const q = await (await fetch(base + '/api/queue')).json();
      assert.strictEqual(q.appointments.length, before + 1);
      assert.ok(q.appointments.some((a) => a.id === r.id && a.tier === 2));
      await post('/api/reset', {});
      assert.strictEqual((await (await fetch(base + '/api/queue')).json()).appointments.length, before);
    });
    await t('server: locked channel and emergency booking are refused', async () => {
      const res = await fetch(base + '/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: 'p1', complaintId: 'abdominal', answers: { ...no('ab_sudden', 'ab_blood', 'ab_block', 'ab_worse'), ab_dur: 'days' }, channel: 'phone' }) });
      assert.strictEqual(res.status, 400);
      const res2 = await fetch(base + '/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId: 'p1', complaintId: 'chest', answers: { ch_now: 'yes' }, channel: 'clinic' }) });
      assert.strictEqual(res2.status, 400);
    });
  } finally { child.kill(); }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
