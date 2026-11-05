#!/usr/bin/env node
/* משווה שתי ריצות ששמרו ב-layout-ab.mjs --save (כל אחת רצה בנפרד, למשל כדי להישאר בתוך מגבלת זמן).
   שימוש:  node scripts/layout-ab-compare.mjs <A.json> <B.json> [--expect-zero]
   --expect-zero: יוצא ב-1 אם יש עמוד ששונה בין A ל-B (הוכחת 0 הפרשים לשינוי שאמור לא לשנות התנהגות). */
import fs from 'node:fs';
import path from 'node:path';

const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
const expectZero = process.argv.includes('--expect-zero');
if (files.length !== 2) { console.error('שימוש: node scripts/layout-ab-compare.mjs <A.json> <B.json> [--expect-zero]'); process.exit(2); }
const A = JSON.parse(fs.readFileSync(files[0], 'utf8')), B = JSON.parse(fs.readFileSync(files[1], 'utf8'));

function diffFp(X, Y) {
    const n = Math.max(X.length, Y.length); let changed = 0, textMoved = 0, geomOnly = 0, first = -1;
    for (let i = 0; i < n; i++) {
        const x = X[i], y = Y[i]; let c = false;
        if (!x || !y || x.th !== y.th) { c = true; textMoved++; }
        else if (JSON.stringify([x.blocks, x.fn]) !== JSON.stringify([y.blocks, y.fn])) { c = true; geomOnly++; }
        if (c) { changed++; if (first < 0) first = i + 1; }
    }
    return { changed, textMoved, geomOnly, first };
}
console.log(`A=${path.basename(files[0])} | B=${path.basename(files[1])}\n`);
console.log('וריאנט'.padEnd(22) + 'עמודים A→B'.padEnd(13) + 'ממצאים A→B (high)'.padEnd(22) + 'עמודים ששונו (טקסט/גיאומטריה בלבד)  ראשון');
let totalChanged = 0;
A.forEach((a, i) => {
    const b = B[i]; if (!b) return;
    const d = diffFp(a.fp, b.fp); totalChanged += d.changed;
    console.log(a.name.padEnd(22) + `${a.pages}→${b.pages}`.padEnd(13) + `${a.issues}→${b.issues} (${a.high}→${b.high})`.padEnd(22) + `${d.changed}/${Math.max(a.pages, b.pages)} (${d.textMoved}/${d.geomOnly})  ${d.first}`);
    const kinds = new Set([...Object.keys(a.byKind), ...Object.keys(b.byKind)]);
    const kd = [...kinds].filter(k => (a.byKind[k] || 0) !== (b.byKind[k] || 0)).map(k => `${k} ${a.byKind[k] || 0}→${b.byKind[k] || 0}`);
    if (kd.length) console.log('   סוגי ממצאים שהשתנו: ' + kd.join(', '));
});
console.log(totalChanged === 0 ? '\n0 עמודים שונים בכל הוריאנטים' : `\nסה"כ עמודים ששונו: ${totalChanged}`);
if (expectZero && totalChanged) process.exitCode = 1;
