'use strict';
/* בדיקות יחידה ליומן ההחלטות (engine-trace.js) — DOM מדומה, בלי דפדפן. הרצה: node --test tests/engine-trace.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');

function makeEl(h, opts = {}) {
    return { nodeType: 1, tagName: 'DIV', classList: opts.cls || ['block-2col'], textContent: opts.text || 'טקסט', scrollHeight: h, _h: h, parent: opts.parent || null,
        getBoundingClientRect() { return { height: this._h }; }, querySelectorAll() { return []; }, closest() { return null; },
        contains(o) { for (let p = o; p; p = p.parent) if (p === this) return true; return false; } };
}
function load() {
    delete globalThis.EngineTrace;   // פונקציות המעבר מוגדרות בכל בדיקה לפני הקריאה ל-load()
    delete require.cache[require.resolve('../engine-trace.js')];
    require('../engine-trace.js');
    return globalThis.EngineTrace;
}

test('enable עוטף ו-disable מחזיר את הפונקציה המקורית (זהות)', () => {
    globalThis.balanceColumns = function balanceColumns(el) { return 1; };
    const orig = globalThis.balanceColumns;
    const T = load();
    T.enable();
    assert.notEqual(globalThis.balanceColumns, orig);
    T.disable();
    assert.equal(globalThis.balanceColumns, orig);
});

test('אירוע: שם המעבר, ארגומנטים, גובה לפני/אחרי, הפרש וערך מוחזר', () => {
    globalThis.balanceColumns = function balanceColumns(el, width) { el._h += 30; return { moved: 2, note: 'x' }; };
    const T = load(); T.enable(); T.reset();
    const el = makeEl(100);
    const ret = globalThis.balanceColumns(el, 300);
    T.disable();
    assert.deepEqual(ret, { moved: 2, note: 'x' });           // הערך המוחזר עובר כמו שהוא
    const [ev] = T.events();
    assert.equal(ev.pass, 'balanceColumns');
    assert.equal(ev.before[0].h, 100);
    assert.equal(ev.after[0].h, 130);
    assert.deepEqual(ev.dh, [30]);
    assert.equal(ev.changed, true);
    assert.deepEqual(ev.ret, { moved: 2, note: 'x' });
    assert.ok(ev.args.some(a => a.v === 300));
});

test('כבוי: אין עוטף ואין אירועים', () => {
    globalThis.balanceColumns = function balanceColumns(el) { return 7; };
    const orig = globalThis.balanceColumns;
    const T = load(); T.reset();
    assert.equal(globalThis.balanceColumns(makeEl(1)), 7);
    assert.equal(globalThis.balanceColumns, orig);
    assert.equal(T.events().length, 0);
});

test('explain: מוצא אירועים לפי הורה/צאצא/זהות, ולא לפי אלמנט לא קשור', () => {
    globalThis.balanceColumns = function balanceColumns(el) { el._h += 10; };
    globalThis.justifyColumnVertically = function justifyColumnVertically(col) { col._h += 5; };
    const T = load(); T.enable(); T.reset();
    const block = makeEl(500), col = makeEl(300, { parent: block, cls: ['main-column'] }), other = makeEl(200);
    globalThis.balanceColumns(block);
    globalThis.justifyColumnVertically(col);
    globalThis.justifyColumnVertically(other);
    T.disable();
    assert.deepEqual(T.explain(col).map(e => e.pass), ['balanceColumns', 'justifyColumnVertically']);   // הבלוק מכיל את הטור
    assert.deepEqual(T.explain(block).map(e => e.pass), ['balanceColumns', 'justifyColumnVertically']);  // הטור בתוך הבלוק
    assert.deepEqual(T.explain(other).map(e => e.pass), ['justifyColumnVertically']);
});

test('שגיאה במעבר: נרשמת ומוטלת מחדש', () => {
    globalThis.balanceColumns = function balanceColumns() { throw new Error('boom'); };
    const T = load(); T.enable(); T.reset();
    assert.throws(() => globalThis.balanceColumns(makeEl(1)), /boom/);
    T.disable();
    assert.equal(T.events()[0].error, 'boom');
});

test('summary: ספירת קריאות ושינויים לכל מעבר; החלטות בלי geo לא נספרות כשינוי', () => {
    globalThis.balanceColumns = function balanceColumns(el, grow) { el._h += grow; };
    globalThis.computeBestFitLine = function computeBestFitLine() { return 5; };
    const T = load(); T.enable(); T.reset();
    const el = makeEl(100);
    globalThis.balanceColumns(el, 0); globalThis.balanceColumns(el, 12); globalThis.computeBestFitLine(el);
    T.disable();
    const s = T.summary();
    assert.equal(s.byPass.balanceColumns.calls, 2);
    assert.equal(s.byPass.balanceColumns.changed, 1);
    assert.equal(s.byPass.computeBestFitLine.calls, 1);
    assert.equal(s.byPass.computeBestFitLine.changed, 0);
    assert.equal(s.dropped, 0);
});

test('parent: מעבר שנקרא מתוך מעבר אחר מציין מי קרא לו', () => {
    globalThis.justifyColumnVertically = function justifyColumnVertically(col) { col._h += 8; };
    globalThis.balanceColumns = function balanceColumns(block) { globalThis.justifyColumnVertically(block.col); block._h += 8; };
    const T = load(); T.enable(); T.reset();
    const block = makeEl(300), col = makeEl(100, { parent: block, cls: ['main-column'] }); block.col = col;
    globalThis.balanceColumns(block);
    globalThis.justifyColumnVertically(col);   // קריאה ישירה, בלי מעבר אב
    T.disable();
    const ev = T.events();
    const inner = ev.find(e => e.pass === 'justifyColumnVertically' && e.parent === 'balanceColumns');
    const direct = ev.filter(e => e.pass === 'justifyColumnVertically' && e.parent === null);
    assert.ok(inner, 'הקריאה הפנימית מציינת את balanceColumns');
    assert.equal(direct.length, 1);
    assert.equal(ev.find(e => e.pass === 'balanceColumns').parent, null);
});

test('body-flow: שינוי בגובה הבלוק האחרון נחשב שינוי של המעבר', () => {
    globalThis.stretchLastBlockToBottom = function stretchLastBlockToBottom(flow) { flow.lastElementChild._h += 40; };
    const T = load(); T.enable(); T.reset();
    const last = makeEl(200), flow = makeEl(900, { cls: { contains: c => c === 'page-body-flow', 0: 'page-body-flow', length: 1, [Symbol.iterator]: function* () { yield 'page-body-flow'; } } });
    flow.lastElementChild = last;
    globalThis.stretchLastBlockToBottom(flow);
    T.disable();
    const [ev] = T.events();
    assert.deepEqual(ev.dh, [0]);
    assert.deepEqual(ev.dl, [40]);
    assert.equal(ev.changed, true);
});
