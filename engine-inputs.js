/* engine-inputs.js — קלטי מנוע העימוד כנתונים מפורשים ושקופים (שלבים 1-2 בתכנית:
   Reports_Summaries_Studies/תכנית_ארגון_מנוע_העימוד.md).

   העיקרון: פריסה = פונקציה של (טקסט, הגדרות, גופנים טעונים, משתני CSS). כל קלט כזה מוצהר ומחושב לו hash,
   כך שכשתי הרצות נותנות פריסות שונות אפשר לדעת מיד אם הקלט השתנה (הסבר בקלט) או שלא (באג בקוד/מצב נסתר).

   שלב 1 (כאן): גופנים. גופן שנטען באמצע עימוד משנה את המדידות (נמדד: 127 מתוך 141 עמודים שונים בין הרצה
   ראשונה ליציבה). runUntilFontsStable מריץ את העימוד עד שקבוצת הגופנים הטעונים לא משתנה, ומחזיר דוח. */
(function (root) {
    'use strict';

    /* FNV-1a 32 ביט — hash דטרמיניסטי וקל לקלטים (לא קריפטוגרפי) */
    function fnv(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    const fontKey = f => `${f.family}|${f.weight}|${f.style}`;
    const loadedFonts = () => new Set([...document.fonts].filter(f => f.status === 'loaded').map(fontKey));
    const erroredFonts = () => [...document.fonts].filter(f => f.status === 'error').map(fontKey);
    /* document.fonts.ready עלול לא להגיע כשיש מאות הגדרות גופן (ראו הערה ב-app.js:ensureBuiltinFontsLoaded) — לכן timeout */
    const settled = ms => Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, ms))]);

    /* מריץ runFn (עימוד סינכרוני) עד שקבוצת הגופנים הטעונים יציבה.
       מחזיר: passes (כמה הרצות), lateFonts (גופנים שנטענו בזמן עימוד), fontErrors, unstable (לא התייצב ב-maxPasses),
       fontsHash+fontCount (טביעת אצבע של קבוצת הגופנים הטעונים בסוף). */
    async function runUntilFontsStable(runFn, opts) {
        const max = (opts && opts.maxPasses) || 3;
        const waitMs = (opts && opts.waitMs) || 3000;
        const late = [];
        let passes = 0, unstable = false;
        for (;;) {
            const before = loadedFonts();
            runFn();
            passes++;
            await settled(waitMs);
            const newly = [...loadedFonts()].filter(k => !before.has(k));
            if (!newly.length) break;
            late.push(...newly);
            if (passes >= max) { unstable = true; break; }
        }
        const now = [...loadedFonts()].sort();
        return { passes, lateFonts: late, fontErrors: erroredFonts(), unstable, fontsHash: fnv(now.join('\n')), fontCount: now.length };
    }

    /* ===== שלב 2: צילום הגדרות =====
       המנוע קרא הגדרות ישירות מה-DOM ב-~200 מקומות (typesetter.js, decorations.js) ובזמנים שונים בתוך העימוד.
       עכשיו: צילום אחד בתחילת עימוד (beginRun), וכל הקריאות עוברות דרך el(id). אין צילום מחוץ לעימוד —
       שם el(id) קורא את ה-DOM החי, כמו קודם. הדוח (lastRun) מראה בדיוק אילו הגדרות נקראו ואילו חסרות.

       פקדי inp-book-* (שם ספר, מחבר, ...) אינם בצילום: שלב ה-parse של המנוע *כותב* אליהם מתוך שורות הטקסט
       (typesetter.js, בלוק "שם הספר - ..."), ושלבים מאוחרים קוראים אותם. זה מצב נסתר (הפלט תלוי בערך שנשאר
       מהרצה קודמת), ולכן הם נגישים דרך derived(id) והדוח מציין אילו מהם שונו בהרצה (derivedChanged). */
    const NON_SETTING = new Set(['raw-input']);
    const DERIVED_PREFIX = 'inp-book-';
    let cur = null;

    function snapshotControl(c) {
        const attrs = {};
        for (const a of c.attributes) attrs[a.name] = a.value;
        return Object.freeze({
            id: c.id, tagName: c.tagName, type: c.type, name: c.name, value: c.value, checked: !!c.checked,
            disabled: !!c.disabled, min: c.min, max: c.max, step: c.step, selectedIndex: c.selectedIndex,
            dataset: Object.freeze(Object.assign({}, c.dataset)),
            getAttribute: n => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
            hasAttribute: n => Object.prototype.hasOwnProperty.call(attrs, n)
        });
    }
    function readDerived() {
        const o = {};
        document.querySelectorAll('[id^="' + DERIVED_PREFIX + '"]').forEach(c => { o[c.id] = c.value; });
        return o;
    }
    function beginRun() {
        if (cur) { cur.depth++; return; }
        const map = new Map();
        document.querySelectorAll('input[id], select[id], textarea[id]').forEach(c => {
            if (NON_SETTING.has(c.id) || c.id.startsWith(DERIVED_PREFIX)) return;
            map.set(c.id, snapshotControl(c));
        });
        cur = { depth: 1, map, used: new Set(), missing: new Set(), live: new Set(), derivedUsed: new Set(), derivedAtStart: readDerived() };
    }
    /* תחליף לקריאה (בלבד) של document.getElementById(id) עבור הגדרה */
    function el(id) {
        if (!cur) return document.getElementById(id);
        const m = cur.map.get(id);
        if (m) { cur.used.add(id); return m; }
        const live = document.getElementById(id);
        if (live) { cur.live.add(id); return live; }
        cur.missing.add(id);
        return null;
    }
    /* גישה חיה לפקד שהמנוע עצמו כותב/קורא (inp-book-*), עם רישום */
    function derived(id) {
        if (cur) cur.derivedUsed.add(id);
        return document.getElementById(id);
    }
    function endRun() {
        if (!cur) return;
        if (--cur.depth > 0) return;
        const startD = cur.derivedAtStart, endD = readDerived();
        const usedIds = [...cur.used].sort();
        const allIds = [...cur.map.keys()].sort();
        const pair = id => { const m = cur.map.get(id); return [id, m.value, m.checked]; };
        root.EngineInputs.lastRun = {
            settingsHash: fnv(JSON.stringify(allIds.map(pair))),
            settingsUsedCount: usedIds.length,
            settingsUsedHash: fnv(JSON.stringify(usedIds.map(pair))),
            settingsMissing: [...cur.missing].sort(),
            liveReads: [...cur.live].sort(),
            derivedUsed: [...cur.derivedUsed].sort(),
            derivedChanged: Object.keys(endD).filter(k => endD[k] !== startD[k]).sort(),
            derivedAtStartHash: fnv(JSON.stringify(startD))
        };
        cur = null;
    }

    root.EngineInputs = Object.assign(root.EngineInputs || {}, { fnv, runUntilFontsStable, beginRun, endRun, el, derived, lastRun: null });
})(typeof window !== 'undefined' ? window : globalThis);
