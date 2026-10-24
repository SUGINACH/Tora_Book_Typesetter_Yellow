'use strict';
/* בדיקות יחידה לחוזה של engine-inputs.js — בלי דפדפן, עם DOM מדומה מינימלי.
   הרצה:  node --test tests/engine-inputs.test.js                                       */
const test = require('node:test');
const assert = require('node:assert/strict');

/* ---------- DOM מדומה ---------- */
function makeControl(id, value, extra = {}) {
    return Object.assign({ id, tagName: 'INPUT', type: 'text', name: id, value, checked: false, disabled: false,
        min: '', max: '', step: '', selectedIndex: -1, dataset: {}, attributes: [] }, extra);
}
let controls, fonts;
function setupDom(list, fontList) {
    controls = list;
    fonts = fontList || [];
    globalThis.document = {
        getElementById: id => controls.find(c => c.id === id) || null,
        querySelectorAll: sel => {
            if (sel.startsWith('input[id]')) return controls;
            const m = /\[id\^="(.+)"\]/.exec(sel);
            return m ? controls.filter(c => c.id.startsWith(m[1])) : [];
        },
        fonts: Object.assign(fonts, { ready: Promise.resolve() })
    };
}
function loadModule() {
    delete globalThis.EngineInputs;
    delete require.cache[require.resolve('../engine-inputs.js')];
    require('../engine-inputs.js');
    return globalThis.EngineInputs;
}

test('מחוץ לעימוד: el קורא את ה-DOM החי', () => {
    setupDom([makeControl('size-body', '12')]);
    const EI = loadModule();
    assert.equal(EI.el('size-body').value, '12');
    assert.equal(EI.el('nope'), null);
});

test('בתוך עימוד: הערך קפוא גם אם הפקד החי משתנה אחרי ההתחלה', () => {
    setupDom([makeControl('size-body', '12')]);
    const EI = loadModule();
    EI.beginRun();
    controls[0].value = '99';
    assert.equal(EI.el('size-body').value, '12');
    assert.throws(() => { 'use strict'; EI.el('size-body').value = '5'; }, TypeError);   // הצילום חסין לכתיבה
    EI.endRun();
    assert.equal(EI.el('size-body').value, '99');   // אחרי העימוד שוב חי
});

test('הדוח: הגדרות שנקראו, חסרות, ו-hash יציב לאותו קלט', () => {
    const build = () => { setupDom([makeControl('a', '1'), makeControl('b', '2'), makeControl('unused', 'x')]); return loadModule(); };
    const run = EI => { EI.beginRun(); EI.el('a'); EI.el('b'); EI.el('hdr-split-title'); EI.endRun(); return EI.lastRun; };
    const r1 = run(build()), r2 = run(build());
    assert.deepEqual(r1.settingsMissing, ['hdr-split-title']);
    assert.equal(r1.settingsUsedCount, 2);
    assert.equal(r1.settingsUsedHash, r2.settingsUsedHash);
    assert.notEqual(r1.settingsHash, '');
});

test('hash ההגדרות מתחלף כשערך שנקרא משתנה, ולא כשערך שלא נקרא משתנה', () => {
    setupDom([makeControl('a', '1'), makeControl('unused', 'x')]);
    const EI = loadModule();
    const run = () => { EI.beginRun(); EI.el('a'); EI.endRun(); return EI.lastRun; };
    const base = run();
    controls[1].value = 'y';
    assert.equal(run().settingsUsedHash, base.settingsUsedHash);
    assert.notEqual(run().settingsHash, base.settingsHash);
    controls[0].value = '2';
    assert.notEqual(run().settingsUsedHash, base.settingsUsedHash);
});

test('פקדים נגזרים (inp-book-*): מחוץ לצילום, והדוח מציין מה המנוע שינה', () => {
    setupDom([makeControl('inp-book-title', 'ישן'), makeControl('inp-book-author', 'מחבר'), makeControl('a', '1')]);
    const EI = loadModule();
    EI.beginRun();
    EI.derived('inp-book-title').value = 'חדש';          // כמו שלב ה-parse של המנוע
    EI.derived('inp-book-author');                       // קריאה בלבד
    assert.equal(EI.el('inp-book-title').value, 'חדש');  // לא בצילום → חי (ולכן נרשם כ-live)
    EI.endRun();
    assert.deepEqual(EI.lastRun.derivedChanged, ['inp-book-title']);
    assert.deepEqual(EI.lastRun.derivedUsed, ['inp-book-author', 'inp-book-title']);
});

test('begin/end מקוננים משחררים רק ביציאה החיצונית', () => {
    setupDom([makeControl('a', '1')]);
    const EI = loadModule();
    EI.beginRun(); EI.beginRun();
    EI.endRun();
    controls[0].value = '7';
    assert.equal(EI.el('a').value, '1');   // עדיין בתוך העימוד
    EI.endRun();
    assert.equal(EI.el('a').value, '7');
});

test('runUntilFontsStable: גופן שנטען בהרצה הראשונה גורם להרצה שנייה, ואז מתייצב', async () => {
    const font = { family: 'Alpha', weight: 'bold', style: 'normal', status: 'unloaded' };
    setupDom([], [font, { family: 'Base', weight: '400', style: 'normal', status: 'loaded' }]);
    const EI = loadModule();
    let calls = 0;
    const report = await EI.runUntilFontsStable(() => { calls++; if (calls === 1) font.status = 'loaded'; }, { waitMs: 5 });
    assert.equal(calls, 2);
    assert.equal(report.passes, 2);
    assert.deepEqual(report.lateFonts, ['Alpha|bold|normal']);
    assert.equal(report.unstable, false);
    assert.equal(report.fontCount, 2);
});

test('runUntilFontsStable: בלי גופן חדש — הרצה אחת; וקבוצת גופנים זהה נותנת fontsHash זהה', async () => {
    const mk = () => { setupDom([], [{ family: 'Base', weight: '400', style: 'normal', status: 'loaded' }]); return loadModule(); };
    const r1 = await mk().runUntilFontsStable(() => {}, { waitMs: 5 });
    const r2 = await mk().runUntilFontsStable(() => {}, { waitMs: 5 });
    assert.equal(r1.passes, 1);
    assert.equal(r1.fontsHash, r2.fontsHash);
});

test('runUntilFontsStable: גופן שממשיך להיטען ללא הפסקה מסומן unstable אחרי maxPasses', async () => {
    const fs = []; setupDom([], fs);
    const EI = loadModule();
    let n = 0;
    const report = await EI.runUntilFontsStable(() => { fs.push({ family: 'F' + (n++), weight: '400', style: 'normal', status: 'loaded' }); }, { maxPasses: 3, waitMs: 5 });
    assert.equal(report.passes, 3);
    assert.equal(report.unstable, true);
});
