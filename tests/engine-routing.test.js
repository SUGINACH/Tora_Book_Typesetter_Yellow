'use strict';
/* בדיקות לסקריפט ניתוב קריאות ההגדרה (scripts/route-engine-reads.js) ולכך שבמנוע לא נשארו קריאות גולמיות.
   אחרי כל מיזוג של קוד מנוע: node scripts/route-engine-reads.js. הרצה: node --test tests/engine-routing.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { route, ensureBoundaries, run } = require('../scripts/route-engine-reads.js');

test('הגדרה רגילה מנותבת ל-EngineInputs.el', () => {
    const r = route("const v = document.getElementById('size-body')?.value;");
    assert.equal(r.out, "const v = EngineInputs.el('size-body')?.value;");
    assert.equal(r.n.el, 1);
});
test('פקד נגזר (inp-book-*) מנותב ל-EngineInputs.derived', () => {
    assert.equal(route("document.getElementById('inp-book-title').value = x;").out, "EngineInputs.derived('inp-book-title').value = x;");
});
test('אלמנטים של המנוע נשארים DOM חי', () => {
    const src = "document.getElementById('book-container'); document.getElementById('measuring-box'); document.getElementById('raw-input'); document.getElementById(`mw-${i}`);";
    const r = route(src);
    assert.equal(r.out, src);
    assert.equal(r.n.live, 4);
});
test('מזהה דינמי, כולל ביטויים עם סוגריים וגרשיים, מנותב בשלמותו', () => {
    assert.equal(route("document.getElementById('s-h' + level)").out, "EngineInputs.el('s-h' + level)");
    assert.equal(route("document.getElementById(`f-${tocPrefix}-${level}`)").out, "EngineInputs.el(`f-${tocPrefix}-${level}`)");
    assert.equal(route("document.getElementById(pick(a, 'x)'))").out, "EngineInputs.el(pick(a, 'x)'))");
});
test('אידמפוטנטי: ניתוב שני לא משנה דבר', () => {
    const once = route("a(document.getElementById('x')); b(document.getElementById('inp-book-y'));").out;
    assert.equal(route(once).out, once);
});
test('גבולות ריצה: נוספים פעם אחת, ולא מוספים שוב', () => {
    const src = "function typesetDocumentNow() {\n    try {\n        return typesetDocumentCore();\n    } finally {\n        cleanup();\n    }\n}";
    const first = ensureBoundaries(src);
    assert.equal(first.added, true);
    assert.match(first.out, /EngineInputs\.beginRun\(\)/);
    assert.match(first.out, /EngineInputs\.endRun\(\)/);
    assert.equal(ensureBoundaries(first.out).added, false);
});
test('במנוע ובקישוטים אין קריאות הגדרה גולמיות, ויש גבולות ריצה', () => {
    const report = run(path.resolve(__dirname, '..'), { check: true });
    for (const [f, r] of Object.entries(report)) assert.equal(r.changed, false, `${f}: נדרש ניתוב. הרץ: node scripts/route-engine-reads.js`);
});
