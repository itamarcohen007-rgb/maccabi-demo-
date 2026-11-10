/* Rule table + pure decision function. Runs in Node and in the browser (window.Rules).
   Routing is decided ONLY here. The language model never touches this file's output. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TIERS = {
    0: { he: 'חירום', color: '#D32F2F' },
    1: { he: 'היום', color: '#F57C00' },
    2: { he: 'תוך 48 שעות', color: '#F9A825' },
    3: { he: 'תוך 3 ימים', color: '#1863D3' },
    4: { he: 'שגרתי', color: '#78849E' },
  };
  const CHANNELS = {
    emergency: 'פנייה מיידית לחירום',
    clinic: 'תור במרפאה',
    video: 'תור וידאו',
    phone: 'תור טלפוני',
    digital: 'בקשה דיגיטלית ללא תור',
  };
  const BOOKABLE = ['clinic', 'video', 'phone'];

  const PROFILES = [
    { id: 'p1', name: 'נועה לוי', age: 34, sex: 'female', pregnant: false, immuno: false, diabetic: false, chronic: [] },
    { id: 'p2', name: 'אברהם מזרחי', age: 71, sex: 'male', pregnant: false, immuno: false, diabetic: true, chronic: ['סוכרת'] },
    { id: 'p3', name: 'מיכל אזולאי', age: 28, sex: 'female', pregnant: true, immuno: false, diabetic: false, chronic: [] },
  ];

  const YN = [{ value: 'yes', label: 'כן' }, { value: 'no', label: 'לא' }];
  // q(id, text, short): short = label used in the doctor's "checked and denied" list
  const q = (id, text, short, extra) => Object.assign({ id, text, short, options: YN, deny: 'no' }, extra || {});
  const Y = (qid) => ({ q: qid, in: ['yes'] });
  const IN = (qid, ...vals) => ({ q: qid, in: vals });
  const P = (fn) => ({ profile: fn });
  const EMERGENCY = (why, extra) => Object.assign({ emergency: true, allowed: [], tier: 0, why }, extra || {});

  const WHY_PHYS = 'נדרשת בדיקה גופנית של רופא/ה במרפאה';

  const COMPLAINTS = {
    abdominal: {
      id: 'abdominal', he: 'כאב בטן',
      questions: [
        q('ab_sudden', 'האם הכאב התחיל פתאום והוא חזק מאוד?', 'כאב פתאומי וחזק מאוד'),
        q('ab_blood', 'האם יש דם בהקאה או בצואה, או צואה שחורה?', 'דם בהקאה או בצואה'),
        q('ab_block', 'האם אי אפשר להשתין, להתפנות או להוציא גזים?', 'חסימה (אין שתן, יציאות או גזים)'),
        q('ab_worse', 'האם הכאב החמיר מאוד בשעות האחרונות, או שיש הקאות או שלשול כבר כמה ימים?', 'החמרה מהירה או הקאות/שלשול ממושכים'),
        q('ab_dur', 'כמה זמן זה נמשך?', null, { options: [
          { value: 'days', label: 'ימים ספורים או פחות', kw: ['יום', 'ימים', 'אתמול', 'שעות', 'היום', 'הלילה'] },
          { value: 'weeks', label: 'שבועות, בלי שינוי', kw: ['שבוע', 'שבועות', 'חודש', 'חודשים'] },
        ] }),
      ],
      rules: [
        { id: 'ab0', any: [Y('ab_sudden'), Y('ab_blood'), Y('ab_block')], outcome: EMERGENCY('כאב בטן עם סימן שמחייב התייחסות מיידית.') },
        { id: 'ab1', any: [Y('ab_worse'), P((p) => p.pregnant)], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1,
          why: (p, a) => a.ab_worse === 'yes' ? 'הכאב מחמיר או מלווה בהקאות/שלשול ממושכים, ולכן נדרשת בדיקה היום.' : 'בהריון כאב בטן נבדק היום במרפאה.',
          locks: { phone: 'כאב בטן מחייב בדיקה גופנית של רופא/ה', video: 'כאב בטן מחייב בדיקה גופנית של רופא/ה' } } },
        { id: 'ab2', any: [IN('ab_dur', 'weeks')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 3,
          why: 'כאב שחוזר שבועות בלי שינוי נבדק במרפאה, ללא דחיפות מיוחדת.',
          locks: { phone: 'כאב בטן מחייב בדיקה גופנית של רופא/ה', video: 'כאב בטן מחייב בדיקה גופנית של רופא/ה' } } },
        { id: 'ab3', otherwise: true, needs: ['ab_dur'], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 2,
          why: 'לא נמצאו סימני אזהרה, אבל כאב בטן מחייב בדיקה גופנית, ולכן מומלץ תור במרפאה היום או מחר.',
          locks: { phone: 'כאב בטן מחייב בדיקה גופנית של רופא/ה', video: 'כאב בטן מחייב בדיקה גופנית של רופא/ה' } } },
      ],
    },

    chest: {
      id: 'chest', he: 'כאב בחזה',
      questions: [
        q('ch_now', 'האם הכאב קיים עכשיו ואינו נרגע?', 'כאב קיים ולא נרגע'),
        q('ch_spread', 'האם הכאב מתפשט ליד, לצוואר, ללסת או לגב?', 'הקרנה ליד, צוואר, לסת או גב'),
        q('ch_assoc', 'האם יש איתו הזעה, בחילה או קוצר נשימה?', 'הזעה, בחילה או קוצר נשימה'),
      ],
      rules: [
        { id: 'ch0', any: [Y('ch_now'), Y('ch_spread'), Y('ch_assoc')], outcome: EMERGENCY('כאב בחזה עם סימן שמחייב התייחסות מיידית.') },
        { id: 'ch1', otherwise: true, outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1,
          why: 'כאב בחזה שבא והולך נבדק היום במרפאה.',
          locks: { phone: 'נדרשת האזנה ובדיקת אק"ג במרפאה', video: 'נדרשת האזנה ובדיקת אק"ג במרפאה' } } },
      ],
    },

    headache: {
      id: 'headache', he: 'כאב ראש',
      questions: [
        q('he_sudden', 'האם הכאב התחיל פתאום, ונראה כמו הכאב החזק ביותר שהיה לך?', 'כאב פתאומי וחזק ביותר'),
        q('he_neuro', 'האם יש חולשה, שינוי בדיבור או בראייה, או בלבול?', 'חולשה, שינוי בדיבור או בראייה, בלבול'),
        q('he_neck', 'האם יש חום יחד עם נוקשות בצוואר?', 'חום עם נוקשות צוואר'),
        q('he_injury', 'האם הייתה מכה בראש לאחרונה?', 'מכה בראש לאחרונה'),
        q('he_vomit', 'האם יש הקאות, או שהכאב מחמיר בשיעול או בהתכופפות?', 'הקאות או החמרה בשיעול/התכופפות'),
      ],
      rules: [
        { id: 'he0', any: [Y('he_sudden'), Y('he_neuro'), Y('he_neck'), Y('he_injury')], outcome: EMERGENCY('כאב ראש עם סימן שמחייב התייחסות מיידית.') },
        { id: 'he1', any: [Y('he_vomit')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1,
          why: 'כאב ראש עם הקאות או החמרה בשיעול נבדק היום במרפאה.',
          locks: { phone: 'רופא/ה צריך/ה לראות אותך כדי להעריך', video: 'במצב כזה נדרשת בדיקה גופנית במרפאה' } } },
        { id: 'he2', otherwise: true, outcome: { allowed: ['video', 'clinic'], recommended: 'video', tier: 3,
          why: 'לא נמצאו סימני אזהרה, ולכן אפשר לבחור תור וידאו או מרפאה בתוך 3 ימים.',
          locks: { phone: 'רופא/ה צריך/ה לראות אותך כדי להעריך' } } },
      ],
    },

    fever: {
      id: 'fever', he: 'חום',
      questions: [
        q('fe_rash', 'האם יש פריחה שלא נעלמת כשלוחצים עליה?', 'פריחה שלא דוהה בלחיצה'),
        q('fe_wake', 'האם קשה להעיר אותך, או שיש קושי בנשימה?', 'קושי להעיר או קושי בנשימה'),
        q('fe_days', 'כמה זמן יש חום?', null, { options: [
          { value: 'short', label: 'עד 3 ימים', kw: ['יומיים', 'יום', 'אתמול', 'שעות', 'הלילה', 'שלושה'] },
          { value: 'mid', label: '3 עד 4 ימים', kw: ['ארבעה', 'ארבע', '4'] },
          { value: 'long', label: '5 ימים או יותר', kw: ['שבוע', 'חמישה', 'חמש', 'שישה', 'ימים רבים', '5', '6', '7'] },
        ] }),
        q('fe_dehyd', 'האם יש סימני התייבשות (יובש בפה, מעט מאוד שתן, סחרחורת)?', 'סימני התייבשות'),
      ],
      rules: [
        { id: 'fe0', any: [Y('fe_rash'), Y('fe_wake')], outcome: EMERGENCY('חום עם סימן שמחייב התייחסות מיידית.') },
        { id: 'fe1', any: [IN('fe_days', 'long'), P((p) => p.immuno), Y('fe_dehyd')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1,
          why: (p, a) => p.immuno ? 'חום אצל מי שמערכת החיסון שלו מדוכאת נבדק היום.' : (a.fe_days === 'long' ? 'חום שנמשך 5 ימים או יותר נבדק היום במרפאה.' : 'חום עם סימני התייבשות נבדק היום במרפאה.'),
          locks: { phone: 'עם סימנים כאלה חשוב שרופא/ה יבדוק פנים אל פנים', video: 'עם סימנים כאלה חשוב שרופא/ה יבדוק פנים אל פנים' } } },
        { id: 'fe2', otherwise: true, outcome: { allowed: ['phone', 'video', 'clinic'], recommended: 'phone', tier: 3,
          why: 'חום קצר ללא סימני אזהרה: אפשר לבחור כל סוג תור בתוך 3 ימים.', locks: {} } },
      ],
    },

    cough: {
      id: 'cough', he: 'שיעול / כאב גרון',
      questions: [
        q('co_breath', 'האם קשה לנשום או לבלוע, או שיש ריור?', 'קושי בנשימה או בבליעה, ריור'),
        q('co_worse', 'האם יש שיעול עם דם, כאב בחזה, או שהמצב מחמיר מהר?', 'דם בשיעול, כאב בחזה או החמרה מהירה'),
        q('co_long', 'האם השיעול נמשך יותר משלושה שבועות, או שיש ירידה לא מוסברת במשקל?', 'שיעול מעל 3 שבועות או ירידה במשקל'),
      ],
      rules: [
        { id: 'co0', any: [Y('co_breath')], outcome: EMERGENCY('קושי בנשימה או בבליעה מחייב התייחסות מיידית.') },
        { id: 'co1', any: [Y('co_worse')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1, why: 'שיעול עם דם, כאב בחזה או החמרה מהירה נבדק היום במרפאה.',
          locks: { phone: 'נדרשת בדיקה גופנית והאזנה במרפאה', video: 'נדרשת בדיקה גופנית והאזנה במרפאה' } } },
        { id: 'co2', any: [Y('co_long')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 3, why: 'שיעול ממושך נבדק במרפאה בתוך 3 ימים.',
          locks: { phone: 'נדרשת בדיקה גופנית והאזנה במרפאה', video: 'נדרשת בדיקה גופנית והאזנה במרפאה' } } },
        { id: 'co3', otherwise: true, outcome: { allowed: ['phone', 'video', 'clinic'], recommended: 'phone', tier: 4,
          why: 'לא נמצאו סימני אזהרה, ולכן אפשר לבחור כל סוג תור, ללא דחיפות.', locks: {} } },
      ],
    },

    back: {
      id: 'back', he: 'כאב גב',
      questions: [
        q('ba_neuro', 'האם יש חולשה או נימול ברגליים, נימול באזור המפשעה, או בעיה חדשה בשליטה על שתן או יציאות?', 'חולשה או נימול ברגליים/מפשעה, בעיית שליטה'),
        q('ba_trauma', 'האם הכאב התחיל אחרי נפילה קשה או תאונה?', 'נפילה קשה או תאונה'),
        q('ba_fever', 'האם יש חום או הרגשה כללית רעה מאוד?', 'חום או הרגשה כללית רעה'),
        q('ba_chronic', 'האם הכאב נמשך שבועות, מופיע בלילה, או שיש ירידה לא מוסברת במשקל?', 'כאב ממושך, לילי או ירידה במשקל'),
      ],
      rules: [
        { id: 'ba0', any: [Y('ba_neuro'), Y('ba_trauma')], outcome: EMERGENCY('כאב גב עם סימן שמחייב התייחסות מיידית.') },
        { id: 'ba1', any: [Y('ba_fever')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1, why: 'כאב גב עם חום או הרגשה רעה נבדק היום במרפאה.',
          locks: { phone: WHY_PHYS, video: WHY_PHYS } } },
        { id: 'ba2', any: [Y('ba_chronic')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 3, why: 'כאב גב ממושך נבדק במרפאה בתוך 3 ימים.',
          locks: { phone: WHY_PHYS, video: WHY_PHYS } } },
        { id: 'ba3', otherwise: true, outcome: { allowed: ['phone', 'video', 'clinic'], recommended: 'phone', tier: 4,
          why: 'נראה כמו מאמץ פשוט ללא סימני אזהרה, ולכן אפשר לבחור כל סוג תור.', locks: {} } },
      ],
    },

    urinary: {
      id: 'urinary', he: 'צריבה או דחיפות במתן שתן',
      questions: [
        q('ur_confuse', 'האם יש בלבול או ישנוניות חריגה?', 'בלבול או ישנוניות חריגה'),
        q('ur_sys', 'האם יש חום, צמרמורות, כאב בצד הגב, או דם בשתן?', 'חום, צמרמורות, כאב בצד או דם בשתן'),
      ],
      rules: [
        { id: 'ur0', any: [Y('ur_confuse')], outcome: EMERGENCY('בלבול או ישנוניות חריגה מחייבים התייחסות מיידית.') },
        { id: 'ur1', any: [Y('ur_sys'), P((p) => p.pregnant), P((p) => p.sex === 'male'), P((p) => p.diabetic), P((p) => p.age >= 65)],
          outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1,
            why: (p, a) => a.ur_sys === 'yes' ? 'התסמינים מלווים בסימנים נוספים, ולכן נדרשת בדיקה היום.' : 'בפרופיל הזה (' + [p.pregnant && 'הריון', p.sex === 'male' && 'גבר', p.diabetic && 'סוכרת', p.age >= 65 && 'גיל 65 ומעלה'].filter(Boolean).join(', ') + ') בודקים היום במרפאה.',
            locks: { phone: 'במצב כזה נדרשת בדיקה במרפאה', video: 'במצב כזה נדרשת בדיקה במרפאה' } } },
        { id: 'ur2', any: [P((p) => p.sex === 'female' && p.age >= 16 && p.age <= 64)], outcome: { allowed: ['phone', 'video', 'clinic'], recommended: 'phone', tier: 3,
          why: 'ללא סימנים נוספים אפשר לבחור כל סוג תור בתוך 3 ימים.', locks: {} } },
        { id: 'ur3', otherwise: true, outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 3, why: 'בגיל הזה מומלצת בדיקה במרפאה.',
          locks: { phone: 'בגיל הזה נדרשת בדיקה במרפאה', video: 'בגיל הזה נדרשת בדיקה במרפאה' } } },
      ],
    },

    rash: {
      id: 'rash', he: 'פריחה',
      questions: [
        q('ra_fade', 'האם הפריחה לא נעלמת כשלוחצים עליה?', 'פריחה שלא דוהה בלחיצה'),
        q('ra_swell', 'האם יש התנפחות בשפתיים או בלשון, או קושי בנשימה?', 'התנפחות שפתיים/לשון או קושי בנשימה'),
        q('ra_fever', 'האם יש חום או הרגשה כללית לא טובה?', 'חום או הרגשה כללית לא טובה'),
        q('ra_fast', 'האם הפריחה מתפשטת מהר, כואבת, או עם שלפוחיות?', 'התפשטות מהירה, כאב או שלפוחיות'),
      ],
      rules: [
        { id: 'ra0', any: [Y('ra_fade'), Y('ra_swell')], outcome: EMERGENCY('פריחה עם סימן שמחייב התייחסות מיידית.') },
        { id: 'ra1', any: [Y('ra_fever'), Y('ra_fast')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1, why: 'פריחה עם חום, כאב או התפשטות מהירה נבדקת היום במרפאה.',
          locks: { phone: 'אי אפשר להעריך פריחה בלי לראות אותה', video: 'פריחה עם סימנים כאלה נבדקת פנים אל פנים' } } },
        { id: 'ra2', otherwise: true, outcome: { allowed: ['video', 'clinic'], recommended: 'video', tier: 3,
          why: 'פריחה ללא חום וללא סימני אזהרה: תור וידאו עם צירוף תמונה מתאים, או מרפאה, בתוך 3 ימים.',
          locks: { phone: 'אי אפשר להעריך פריחה בלי לראות אותה' } } },
      ],
    },

    ear: {
      id: 'ear', he: 'כאב אוזניים',
      questions: [
        q('ea_long', 'האם הכאב נמשך יותר משניים-שלושה ימים?', 'כאב מעל 2-3 ימים'),
        q('ea_signs', 'האם יש חום, הפרשה מהאוזן, נפיחות מאחורי האוזן או שינוי בשמיעה?', 'חום, הפרשה, נפיחות או שינוי בשמיעה'),
      ],
      rules: [
        { id: 'ea1', any: [Y('ea_long'), Y('ea_signs')], outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 1, why: 'כאב אוזניים עם סימנים נוספים נבדק היום במרפאה.',
          locks: { phone: 'נדרשת בדיקת אוזן במכשיר במרפאה', video: 'נדרשת בדיקת אוזן במכשיר במרפאה' } } },
        { id: 'ea2', otherwise: true, outcome: { allowed: ['clinic'], recommended: 'clinic', tier: 3, why: 'כאב אוזניים נבדק במרפאה בתוך 3 ימים.',
          locks: { phone: 'נדרשת בדיקת אוזן במכשיר במרפאה', video: 'נדרשת בדיקת אוזן במכשיר במרפאה' } } },
      ],
    },

    mood: {
      id: 'mood', he: 'מצב רוח ירוד / חרדה',
      questions: [
        q('mo_safe', 'לפני הכול, חשוב לנו לשאול: האם עברו עליך לאחרונה מחשבות לפגוע בעצמך?', 'מחשבות לפגוע בעצמך', { deny: 'none', options: [
          { value: 'none', label: 'לא', kw: ['לא', 'אין'] },
          { value: 'safe_now', label: 'כן, אבל אני בטוח/ה כרגע', kw: ['כן אבל', 'בטוח', 'בטוחה'] },
          { value: 'unsafe', label: 'כן, ואני לא בטוח/ה שאצליח להישאר בטוח/ה', kw: ['לא בטוח', 'לא בטוחה', 'תוכנית', 'לא מצליח', 'לא מצליחה'] },
        ] }),
        q('mo_dur', 'כמה זמן זה מורגש?', null, { options: [
          { value: 'days', label: 'ימים ספורים', kw: ['יום', 'ימים'] },
          { value: 'weeks', label: 'שבועות', kw: ['שבוע', 'שבועות'] },
          { value: 'months', label: 'חודשים או יותר', kw: ['חודש', 'חודשים', 'שנה', 'שנים'] },
        ] }),
      ],
      rules: [
        { id: 'mo0', any: [IN('mo_safe', 'unsafe')], outcome: EMERGENCY('חשוב שתקבלו עזרה מיידית.', { eran: true }) },
        { id: 'mo1', any: [IN('mo_safe', 'safe_now')], outcome: { allowed: ['clinic', 'video'], recommended: 'video', tier: 1,
          why: 'תודה ששיתפת. חשוב לדבר עם רופא/ה היום.', locks: { phone: 'חשוב שהרופא/ה יראה אותך' } } },
        { id: 'mo2', otherwise: true, needs: ['mo_dur'], outcome: { allowed: ['video', 'clinic'], recommended: 'video', tier: 3,
          why: 'מומלץ לדבר עם רופא/ה פנים אל פנים, בוידאו או במרפאה, בתוך 3 ימים.', locks: { phone: 'חשוב שהרופא/ה יראה אותך' } } },
      ],
    },

    admin: {
      id: 'admin', he: 'חידוש מרשם / אישור מחלה / תוצאות בדיקה',
      questions: [
        q('ad_new', 'האם יש תסמין חדש או תופעת לוואי שקשורים לזה?', 'תסמין חדש או תופעת לוואי'),
      ],
      rules: [
        { id: 'ad0', any: [Y('ad_new')], outcome: { restart: true, allowed: [], tier: null, why: 'יש תסמין חדש, ולכן מתחילים מהתסמין.' } },
        { id: 'ad1', otherwise: true, outcome: { allowed: ['digital', 'phone'], recommended: 'digital', tier: 4,
          why: 'אין צורך להגיע: אפשר לטפל בבקשה מרחוק, בלי תור.',
          locks: { clinic: 'אין צורך להגיע – אפשר לטפל בזה מרחוק', video: 'אין צורך להגיע – אפשר לטפל בזה מרחוק' } } },
      ],
    },
  };

  const COMPLAINT_ORDER = ['abdominal', 'chest', 'headache', 'fever', 'cough', 'back', 'urinary', 'rash', 'ear', 'mood', 'admin'];

  function getModifiers(p) {
    const m = [];
    if (p.age < 5) m.push('גיל מתחת ל-5');
    if (p.age >= 65) m.push('גיל ' + p.age);
    if (p.pregnant) m.push('הריון');
    if (p.immuno) m.push('דיכוי חיסוני');
    if (p.chronic && p.chronic.length) m.push('מחלה כרונית (' + p.chronic.join(', ') + ')');
    return m;
  }

  function evalCond(cond, answers, profile) {
    if (cond.profile) return !!cond.profile(profile);
    const v = answers[cond.q];
    if (v === undefined || v === null) return null;
    return cond.in.includes(v);
  }

  function ruleStatus(rule, answers, profile) {
    let unknownQ = null;
    for (const cond of rule.any || []) {
      const v = evalCond(cond, answers, profile);
      if (v === true) return { state: 'fire' };
      if (v === null && !unknownQ) unknownQ = cond.q;
    }
    if (unknownQ) return { state: 'unknown', next: unknownQ };
    if (rule.otherwise) {
      for (const qid of rule.needs || []) if (answers[qid] == null) return { state: 'unknown', next: qid };
      return { state: 'fire' };
    }
    return { state: 'skip' };
  }

  function finalize(cid, he, rule, answers, profile) {
    const o = rule.outcome;
    if (o.restart) return { complaintId: cid, done: true, restart: true, channelsAllowed: [], recommended: null, locked: [], tier: null, why: o.why, emergency: false };
    let tier = o.tier;
    const mods = getModifiers(profile);
    let raised = false;
    if (tier > 1 && mods.length) { tier = Math.max(1, tier - 1); raised = true; }
    let why = typeof o.why === 'function' ? o.why(profile, answers) : o.why;
    if (raised) why += ' הדחיפות הועלתה בדרגה בגלל: ' + mods.join(', ') + '.';
    const allowed = o.allowed.slice();
    const locked = o.emergency ? [] : BOOKABLE.filter((ch) => !allowed.includes(ch))
      .map((ch) => ({ channel: ch, reason: (o.locks && o.locks[ch]) || WHY_PHYS }));
    return {
      complaintId: cid, complaint: he, done: true,
      channelsAllowed: o.emergency ? [] : allowed,
      recommended: o.emergency ? 'emergency' : o.recommended,
      locked, tier, why, emergency: !!o.emergency, eran: !!o.eran, nurse: !!o.nurse,
      modifiers: raised ? mods : [], rule: rule.id,
    };
  }

  function unknownDecision(profile) {
    const mods = getModifiers(profile);
    let tier = 3, raised = false;
    if (mods.length) { tier = 2; raised = true; }
    const reason = 'לא ברור עדיין מה הבעיה, ולכן מומלצת בדיקה במרפאה או שיחה עם אחות';
    return {
      complaintId: 'unknown', complaint: 'לא זוהתה בעיה', done: true,
      channelsAllowed: ['clinic'], recommended: 'clinic',
      locked: [{ channel: 'phone', reason }, { channel: 'video', reason }],
      tier, nurse: true, emergency: false, eran: false, modifiers: raised ? mods : [], rule: 'unknown',
      why: 'לא הצלחנו להבין בוודאות מה הבעיה, ולכן לא ננחש. אפשר לדבר עם אחות במוקד ‎*3555 או לקבוע תור במרפאה.' + (raised ? ' הדחיפות הועלתה בדרגה בגלל: ' + mods.join(', ') + '.' : ''),
    };
  }

  // Pure function. If more answers are needed: { done:false, next:<questionId> }.
  function decide(complaintId, answers, profile) {
    answers = answers || {}; profile = profile || PROFILES[0];
    const c = COMPLAINTS[complaintId];
    if (!c) return unknownDecision(profile);
    for (const rule of c.rules) {
      const st = ruleStatus(rule, answers, profile);
      if (st.state === 'unknown') return { complaintId, complaint: c.he, done: false, next: st.next, channelsAllowed: [], locked: [], recommended: null, tier: null, why: '' };
      if (st.state === 'fire') return finalize(complaintId, c.he, rule, answers, profile);
    }
    return unknownDecision(profile);
  }

  function getQuestion(complaintId, qid) {
    const c = COMPLAINTS[complaintId];
    return c ? c.questions.find((x) => x.id === qid) || null : null;
  }

  // ---------- local (offline) language helpers ----------
  function normalize(s) {
    return String(s || '').replace(/[֑-ׇ]/g, '').replace(/["'״׳`]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function kwMatch(norm, k) {
    if (k[0] === '=') {
      return new RegExp('(^|[^\\u05d0-\\u05ea])[ובהלכמש]{0,3}' + k.slice(1) + '(?![\\u05d0-\\u05ea])').test(norm);
    }
    return norm.includes(k);
  }
  const KEYWORDS = {
    abdominal: [['בטן', 3], ['קיבה', 3], ['שלשול', 2], ['הקאה', 2], ['הקאות', 2], ['מקיא', 2], ['מקיאה', 2], ['עצירות', 2], ['מעיים', 2], ['בחילה', 1], ['גזים', 1]],
    chest: [['חזה', 3], ['דפיקות לב', 2], ['קוצר נשימה', 2], ['קשה לנשום', 2], ['לחץ בלב', 3], ['כאב בלב', 3]],
    headache: [['כאב ראש', 3], ['כאבי ראש', 3], ['מיגרנ', 3], ['=ראש', 2], ['סחרחורת', 1]],
    fever: [['=חום', 3], ['צמרמורת', 2], ['קדחת', 2], ['מדחום', 2], ['חם לי', 1], ['קר לי', 1]],
    cough: [['שיעול', 3], ['משתעל', 3], ['משתעלת', 3], ['כאב גרון', 3], ['גרון', 2], ['צרידות', 2], ['שפעת', 2], ['הצטננות', 2], ['נזלת', 1]],
    back: [['=גב', 3], ['מותן', 3], ['מתניים', 3], ['דיסק', 2], ['עמוד שדרה', 2], ['תפוס לי', 2]],
    urinary: [['שתן', 3], ['משתין', 3], ['משתינה', 3], ['צריבה', 3], ['השתנה', 2], ['דלקת בדרכי', 3], ['דחיפות', 1]],
    rash: [['פריחה', 3], ['פריחות', 3], ['חרלת', 3], ['מגרד', 2], ['גרד', 2], ['בעור', 2], ['אקזמה', 2], ['שלפוחיות', 2], ['אדמומיות', 1], ['כתמים', 1]],
    ear: [['אוזנ', 3], ['אוזן', 3], ['שמיעה', 2], ['טנטון', 1]],
    mood: [['מצב רוח', 3], ['חרדה', 3], ['חרדות', 3], ['דיכאון', 3], ['מדוכא', 3], ['מדוכאת', 3], ['פאניקה', 3], ['לפגוע בעצמי', 4], ['לא רוצה לחיות', 4], ['מתאבד', 3], ['עצוב', 2], ['עצובה', 2], ['לחץ נפשי', 2], ['נפשי', 2], ['מתח', 1], ['בכי', 1]],
    admin: [['מרשם', 3], ['מרשמים', 3], ['לחדש', 3], ['חידוש', 3], ['אישור מחלה', 4], ['תוצאות', 3], ['בדיקות דם', 2], ['תרופה', 2], ['תרופות', 2], ['אישור', 1]],
  };

  function localClassify(text) {
    let n = normalize(text);
    n = n.replace(/(בלי|ללא|אין|לא)\s+(לי\s+)?חום/g, ' ').replace(/(בלי|ללא|אין)\s+(לי\s+)?(כאב|כאבים)/g, ' ');
    const scores = [];
    for (const id of COMPLAINT_ORDER) {
      let s = 0;
      for (const [k, w] of KEYWORDS[id]) if (kwMatch(n, k)) s += w;
      scores.push([id, s]);
    }
    scores.sort((a, b) => b[1] - a[1]);
    const [best, second] = [scores[0], scores[1]];
    if (best[1] >= 2 && best[1] - second[1] >= 1) return { complaintId: best[0], confidence: Math.min(1, best[1] / 5), source: 'local' };
    return { complaintId: 'unknown', confidence: 0, source: 'local' };
  }

  const tokens = (n) => n.split(/[^א-ת0-9]+/).filter(Boolean);
  function localMapAnswer(question, text) {
    const n = normalize(text);
    if (!question) return null;
    const unsure = ['לא יודע', 'לא בטוח', 'אולי', 'לא יודעת', 'לא בטוחה', 'לא זוכר', 'לא זוכרת'];
    const isYN = question.options.length === 2 && question.options[0].value === 'yes';
    if (isYN) {
      if (unsure.some((u) => n.includes(u))) return null;
      const t = tokens(n);
      const yes = t.some((w) => ['כן', 'בטח', 'נכון', 'ברור', 'אכן', 'כמובן', 'יש', 'קיים', 'קיימת', 'חזק', 'מאוד'].includes(w));
      const no = t.some((w) => ['לא', 'אין', 'בלי', 'ללא', 'שלילי', 'נעלם', 'נעלמה'].includes(w));
      if (yes && !no) return 'yes';
      if (no && !yes) return 'no';
      return null;
    }
    // multiple choice: match option labels or keywords; exactly one option must match
    const hits = question.options.filter((o) => {
      if (n === normalize(o.label)) return true;
      return (o.kw || []).some((k) => n.includes(normalize(k)) && !(k === 'לא' && n.length > 4));
    });
    if (hits.length === 1) return hits[0].value;
    if (hits.length > 1) {
      // prefer the longest keyword match (e.g. "לא בטוח" over "לא")
      let bestO = null, bestLen = -1, tie = false;
      for (const o of hits) {
        const len = Math.max(...(o.kw || []).filter((k) => n.includes(normalize(k))).map((k) => k.length), 0);
        if (len > bestLen) { bestO = o; bestLen = len; tie = false; } else if (len === bestLen) tie = true;
      }
      return tie ? null : bestO.value;
    }
    return null;
  }

  return { TIERS, CHANNELS, BOOKABLE, PROFILES, COMPLAINTS, COMPLAINT_ORDER, decide, getQuestion, getModifiers, normalize, localClassify, localMapAnswer };
});
