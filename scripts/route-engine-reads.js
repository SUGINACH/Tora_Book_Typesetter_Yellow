#!/usr/bin/env node
'use strict';
/* מנתב את כל קריאות ההגדרות של המנוע דרך EngineInputs (שלב 2 בתכנית: Reports_Summaries_Studies/תכנית_ארגון_מנוע_העימוד.md).

   הניתוב מכני ואידמפוטנטי, ולכן אפשר להריץ אותו מחדש אחרי כל מיזוג של קוד מנוע:
     document.getElementById('x')           ->  EngineInputs.el('x')        (הגדרה: קורא מהצילום של העימוד)
     document.getElementById('inp-book-x')  ->  EngineInputs.derived(...)   (פקדים שה-parse עצמו כותב אליהם)
     book-container / measuring-box / raw-input / mw-*  נשארים DOM חי (אלמנטים של המנוע, לא הגדרות)
   וגם מוודא שתחילת וסוף עימוד (typesetDocumentNow) קוראים ל-EngineInputs.beginRun / endRun.

   שימוש:  node scripts/route-engine-reads.js            (מנתב ומדפיס סיכום)
           node scripts/route-engine-reads.js --check    (בלי לשנות; יוצא ב-1 אם נשארה קריאת הגדרה גולמית)  */
const fs = require('fs');
const path = require('path');

const FILES = ['typesetter.js', 'decorations.js'];

function argEnd(src, start) {
    let depth = 1, i = start, quote = null;
    while (i < src.length) {
        const c = src[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            else if (quote === '`' && c === '$' && src[i + 1] === '{') {
                let d = 1; i += 2;
                while (i < src.length && d) { if (src[i] === '{') d++; else if (src[i] === '}') d--; i++; }
                continue;
            }
        } else if (c === "'" || c === '"' || c === '`') quote = c;
        else if (c === '(') depth++;
        else if (c === ')') { depth--; if (depth === 0) return i; }
        i++;
    }
    return -1;
}

function classify(arg) {
    const a = arg.trim();
    if (/^['"`](book-container|measuring-box|raw-input)['"`]$/.test(a)) return 'live';
    if (/^[`'"]mw-/.test(a)) return 'live';
    if (/^[`'"]inp-book-/.test(a)) return 'derived';
    return 'el';
}

function route(src) {
    const n = { el: 0, derived: 0, live: 0 };
    let out = '', pos = 0, m;
    const re = /document\.getElementById\(/g;
    while ((m = re.exec(src))) {
        const s = m.index + m[0].length, e = argEnd(src, s);
        if (e < 0) throw new Error('getElementById לא מאוזן במיקום ' + m.index);
        const kind = classify(src.slice(s, e));
        n[kind]++;
        if (kind === 'live') continue;
        out += src.slice(pos, m.index) + (kind === 'derived' ? 'EngineInputs.derived(' : 'EngineInputs.el(') + src.slice(s, e) + ')';
        pos = e + 1;
        re.lastIndex = e + 1;
    }
    return { out: out + src.slice(pos), n };
}

const BOUNDARY_OLD = "    try {\n        return typesetDocumentCore();\n    } finally {";
const BOUNDARY_NEW = "    if (window.EngineInputs) EngineInputs.beginRun();   // [V22/שלב 2] צילום הגדרות אחד לכל העימוד\n    try {\n        return typesetDocumentCore();\n    } finally {\n        if (window.EngineInputs) EngineInputs.endRun();";

function ensureBoundaries(src) {
    if (src.includes('EngineInputs.beginRun()')) return { out: src, added: false };
    if (src.split(BOUNDARY_OLD).length !== 2) throw new Error('לא נמצא המבנה של typesetDocumentNow — עדכן את route-engine-reads.js');
    return { out: src.replace(BOUNDARY_OLD, BOUNDARY_NEW), added: true };
}

function run(rootDir, opts) {
    const report = {};
    for (const f of FILES) {
        const p = path.join(rootDir, f);
        const src = fs.readFileSync(p, 'utf8');
        const r = route(src);
        let out = r.out, added = false;
        if (f === 'typesetter.js') { const b = ensureBoundaries(out); out = b.out; added = b.added; }
        report[f] = { routedEl: r.n.el, routedDerived: r.n.derived, liveKept: r.n.live, boundariesAdded: added, changed: out !== src };
        if (!opts.check && out !== src) fs.writeFileSync(p, out);
    }
    return report;
}

module.exports = { route, ensureBoundaries, run, FILES };

if (require.main === module) {
    const check = process.argv.includes('--check');
    const report = run(path.resolve(__dirname, '..'), { check });
    for (const [f, r] of Object.entries(report)) console.log(`${f}: נותבו ${r.routedEl} הגדרות ו-${r.routedDerived} פקדים נגזרים, נשארו חיים ${r.liveKept}${r.boundariesAdded ? ', נוספו גבולות ריצה' : ''}${r.changed ? (check ? '  ← נדרש ניתוב' : '  ← עודכן') : ''}`);
    if (check && Object.values(report).some(r => r.changed)) process.exit(1);
}
