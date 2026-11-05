'use strict';
/* בדיקות יחידה לתוסף geometry-audit-extra.js (הכללים הנוספים של V22), בלי דפדפן: התוסף נטען מול בסיס מדומה,
   כך שהבדיקות אינן תלויות ב-DOM שה-geometry-audit.js של main משתמש בו. הרצה: node --test tests/geometry-audit-extra.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const emptySummary = () => ({ total: 0, high: 0, medium: 0, low: 0, byKind: {} });
function loadExtras(baseAudit, extraGlobals) {
    const sandbox = Object.assign({ window: { __geomAudit: { audit: baseAudit || (() => ({ issues: [], summary: emptySummary() })) } }, console }, extraGlobals || {});
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'geometry-audit-extra.js'), 'utf8'), sandbox, { filename: 'geometry-audit-extra.js' });
    return sandbox.window.__geomAudit;
}

/* ---------- בונים למודל ---------- */
const R = (x, y, w, h) => ({ x, y, w, h, right: x + w, bottom: y + h });
const Ln = (x, y, w, h = 20) => ({ x, y, w, h, right: x + w, bottom: y + h, idx: 0 });
const node = (type, rect, extra = {}) => Object.assign({ type, tag: 'div', cls: '', text: '', rect, children: [], lines: [] }, extra);
function para(type, x, y, w, nLines, extra = {}) {
    const lines = [];
    for (let i = 0; i < nLines; i++) lines.push(Ln(x, y + i * 20, w));
    return node(type, R(x, y, w, nLines * 20), Object.assign({ text: 'טקסט בדיקה', lines }, extra));
}
const head = (type, x, y, w) => node(type, R(x, y, w, 20), { text: 'כותרת בדיקה', lines: [Ln(x, y, w)] });
function column(side, x, items, w = 380, y = 100) {
    const bottom = items.reduce((m, it) => Math.max(m, it.rect.bottom), y + 20);
    return node('column', R(x, y, w, bottom - y), { side, children: items });
}
function block(cols) {
    const x = Math.min(...cols.map(c => c.rect.x)), right = Math.max(...cols.map(c => c.rect.right));
    const y = Math.min(...cols.map(c => c.rect.y)), bottom = Math.max(...cols.map(c => c.rect.bottom));
    return node('block-2col', R(x, y, right - x, bottom - y), { children: cols });
}
function page(idx, flowChildren, opts = {}) {
    const kids = [node('body-flow', R(10, 90, 780, 800), { children: flowChildren })];
    if (opts.fn) kids.push(node('footnote-area', R(10, opts.fn, 780, 100)));
    if (opts.pn) kids.push(node('page-number', R(350, opts.pn, 100, 20)));
    return node('page', R(0, 0, 800, 1100), { idx, label: String(idx + 1), children: [node('wrapper', R(0, 0, 800, 1100), { children: kids })] });
}
const kinds = (res, k) => res.issues.filter(i => i.kind === k);
const RX = 410, LX = 10;

/* ---------- טקסט שחודר לאזור ההערות / מספר העמוד ---------- */
test('טקסט שחודר לאזור ההערות גם כשתיבת ה-body-flow תקינה', () => {
    const m = { pages: [page(0, [block([column('right', RX, [para('p-end', RX, 940, 380, 2)]), column('left', LX, [])])], { fn: 950, pn: 1060 })] };
    const hit = kinds(loadExtras().audit(m), 'fn-overflow');
    assert.equal(hit.length, 1);
    assert.equal(hit[0].basis, 'text');
    assert.equal(hit[0].overlapPx, 30);
    assert.equal(hit[0].severity, 'high');
});
test('טקסט שנגמר מעל אזור ההערות ומספר העמוד — אין ממצא', () => {
    const m = { pages: [page(0, [block([column('right', RX, [para('p-end', RX, 800, 380, 2)]), column('left', LX, [])])], { fn: 950, pn: 1060 })] };
    const r = loadExtras().audit(m);
    assert.equal(kinds(r, 'fn-overflow').length + kinds(r, 'pn-overflow').length, 0);
});
test('חדירה למספר העמוד מדווחת pn-overflow', () => {
    const m = { pages: [page(0, [block([column('right', RX, [para('p-end', RX, 1050, 380, 2)]), column('left', LX, [])])], { pn: 1060 })] };
    assert.equal(kinds(loadExtras().audit(m), 'pn-overflow').length, 1);
});
test('לא מכפיל ממצא שהבסיס כבר דיווח על אותו עמוד', () => {
    const base = () => ({ issues: [{ kind: 'fn-overflow', severity: 'high', pageIdx: 0 }], summary: emptySummary() });
    const m = { pages: [page(0, [block([column('right', RX, [para('p-end', RX, 940, 380, 2)]), column('left', LX, [])])], { fn: 950 })] };
    assert.equal(kinds(loadExtras(base).audit(m), 'fn-overflow').length, 1);
});

/* ---------- כותרת בתחתית טור ---------- */
test('כותרת h4 כפריט אחרון בטור: high', () => {
    const m = { pages: [page(0, [block([column('right', RX, [para('p-end', RX, 100, 380, 3), head('h4', RX, 160, 380)]), column('left', LX, [])])])] };
    assert.equal(kinds(loadExtras().audit(m), 'heading-at-bottom').filter(i => i.severity === 'high').length, 1);
});
test('כותרת ואחריה שורת גוף אחת: p-cut high, p-end שלם medium', () => {
    const mk = type => ({ pages: [page(0, [block([column('right', RX, [head('h5', RX, 100, 380), para(type, RX, 120, 380, 1)]), column('left', LX, [])])])] });
    assert.equal(kinds(loadExtras().audit(mk('p-cut')), 'heading-at-bottom')[0].severity, 'high');
    assert.equal(kinds(loadExtras().audit(mk('p-end')), 'heading-at-bottom')[0].severity, 'medium');
});
test('כותרת ואחריה שתי שורות גוף — תקין', () => {
    const m = { pages: [page(0, [block([column('right', RX, [head('h4', RX, 100, 380), para('p-end', RX, 120, 380, 2)]), column('left', LX, [])])])] };
    assert.equal(kinds(loadExtras().audit(m), 'heading-at-bottom').length, 0);
});

/* ---------- טור ריק ---------- */
test('טור ריק: high באמצע עמוד, low בסוף פרק', () => {
    const mk = nextHasH2 => {
        const p0 = page(0, [block([column('right', RX, [para('p-end', RX, 100, 380, 3)]), column('left', LX, [])])]);
        const p1 = page(1, nextHasH2 ? [node('h2-title', R(10, 90, 780, 40), { lines: [Ln(10, 90, 780)] })] : []);
        return { pages: [p0, p1] };
    };
    assert.equal(kinds(loadExtras().audit(mk(false)), 'empty-column')[0].severity, 'high');
    assert.equal(kinds(loadExtras().audit(mk(true)), 'empty-column')[0].severity, 'low');
});

/* ---------- שרשרת המשך (על ה-DOM) ---------- */
function fakeP(cls, cont, text = 'טקסט') {
    return { className: cls, classList: { contains: c => cls.split(' ').includes(c) }, getAttribute: n => (n === 'data-is-cont' ? String(!!cont) : null), textContent: text, getBoundingClientRect: () => ({ left: 15, top: 25, width: 100, height: 20 }) };
}
function chainDoc(paragraphs) {
    const flow = { querySelectorAll: () => paragraphs };
    const pg = { querySelector: sel => (sel === '.page-body-flow' ? flow : null), querySelectorAll: () => [] };
    const host = { getBoundingClientRect: () => ({ left: 5, top: 5 }), querySelectorAll: sel => (sel === '.a4-page' ? [pg] : []) };
    return { getElementById: id => (id === 'book-container' ? host : null) };
}
const chainIssues = ps => kinds(loadExtras(null, { document: chainDoc(ps) }).audit({ pages: [] }), 'chain-broken');

test('שרשרת תקינה: p-cut ואחריו פסקת המשך', () => {
    assert.equal(chainIssues([fakeP('p-cut'), fakeP('p-end', true), fakeP('p-end')]).length, 0);
});
test('שרשרת שבורה: p-cut בלי המשך', () => {
    const r = chainIssues([fakeP('p-cut', false, 'חתוכה'), fakeP('p-end')]);
    assert.equal(r.length, 1);
    assert.match(r[0].message, /p-cut/);
});
test('שרשרת שבורה: פסקת המשך בלי p-cut לפניה', () => {
    assert.equal(chainIssues([fakeP('p-end'), fakeP('p-end', true)]).length, 1);
});
test('שרשרת: p-cut אחרון במסמך נחשב שבור', () => {
    assert.equal(chainIssues([fakeP('p-end'), fakeP('p-cut')]).length, 1);
});

/* ---------- U+E000 (דורש DOM) ---------- */
test('תו U+E000: מזוהה דרך ה-DOM, ולא רץ בלי DOM', () => {
    const el = { textContent: 'שלום \uE000 עולם', getBoundingClientRect: () => ({ left: 15, top: 25, width: 100, height: 20 }) };
    const pg = { querySelectorAll: () => [el] };
    const host = { getBoundingClientRect: () => ({ left: 5, top: 5 }), querySelectorAll: () => [pg] };
    const doc = { getElementById: id => (id === 'book-container' ? host : null) };
    const withDom = loadExtras(null, { document: doc }).audit({ pages: [] });
    assert.equal(kinds(withDom, 'pua-char').length, 1);
    assert.equal(JSON.stringify(kinds(withDom, 'pua-char')[0].childRect), JSON.stringify({ x: 10, y: 20, w: 100, h: 20 }));   // ערכים מ-vm: משווים לפי JSON
    assert.equal(kinds(loadExtras().audit({ pages: [] }), 'pua-char').length, 0);
});

/* ---------- סיכום ועמידות ---------- */
test('הסיכום מחושב מחדש ומתאים לרשימת הממצאים', () => {
    const base = () => ({ issues: [{ kind: 'imbalance', severity: 'medium', pageIdx: 0 }], summary: Object.assign(emptySummary(), { total: 1, medium: 1, byKind: { imbalance: 1 }, byBalanceOutcome: { x: 1 } }) });
    const m = { pages: [page(0, [block([column('right', RX, [para('p-end', RX, 100, 380, 3), head('h4', RX, 160, 380)]), column('left', LX, [])])])] };
    const r = loadExtras(base).audit(m);
    assert.equal(r.summary.total, r.issues.length);
    assert.equal(r.summary.high, r.issues.filter(i => i.severity === 'high').length);
    assert.equal(r.summary.byKind.imbalance, 1);
    assert.equal(r.summary.byKind['heading-at-bottom'], 1);
    assert.deepEqual(r.summary.byBalanceOutcome, { x: 1 });   // שדות של הבסיס נשמרים
});
test('שגיאה בתוסף לא מפילה את הבדיקה של הבסיס', () => {
    const base = () => ({ issues: [{ kind: 'containment', severity: 'high', pageIdx: 0 }], summary: emptySummary() });
    const r = loadExtras(base).audit({ pages: [null] });
    assert.equal(kinds(r, 'containment').length, 1);
    assert.equal(kinds(r, 'audit-extra-error').length, 1);
});
test('הטעינה כפולה לא עוטפת פעמיים', () => {
    let calls = 0;
    const sandbox = { window: { __geomAudit: { audit: () => { calls++; return { issues: [], summary: emptySummary() }; } } }, console };
    vm.createContext(sandbox);
    const src = fs.readFileSync(path.join(__dirname, '..', 'geometry-audit-extra.js'), 'utf8');
    vm.runInContext(src, sandbox); vm.runInContext(src, sandbox);
    sandbox.window.__geomAudit.audit({ pages: [] });
    assert.equal(calls, 1);
});
