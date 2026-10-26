/* engine-diagnostics.js — דוח אבחון מלא בלחיצה אחת (שלב 3 בתכנית: Reports_Summaries_Studies/תכנית_ארגון_מנוע_העימוד.md).

   הדוח מרכז במקום אחד את כל מה שצריך כדי לדעת מאיפה בא ממצא, בלי חקירה:
     1. קלטים: hash של הטקסט, ההגדרות שנקראו, הגופנים והמשתנים — אם שתי הרצות נראות שונות והקלטים זהים, הבעיה בקוד;
        וגם הגדרות שהקוד קורא ואין להן פקד, ופקדים שהמנוע עצמו שינה (מצב נסתר).
     2. סטטיסטיקת מעברים מיומן ההחלטות.
     3. ממצאי בדיקת הגיאומטריה.
     4. לכל אחד מהחמורים: שרשרת המעברים שנגעו באלמנט הבעייתי, עם הגובה לפני ואחרי ומי קרא לכל מעבר.
   build() נקרא אחרי עימוד עם יומן (renderer-bridge.js מריץ עימוד כזה בבקשת 'diagnose'). */
(function (root) {
    'use strict';

    const RANK = { high: 3, medium: 2, low: 1 };
    const PRI = { 'fn-overflow': 0, 'pn-overflow': 0, 'page-overflow': 0, 'fn-page-overflow': 0, 'fn-pn-overflow': 0, 'chain-broken': 1, 'pua-char': 1,
        containment: 2, overlap: 3, 'heading-at-bottom': 3, widow: 4, orphan: 4, 'empty-column': 4, imbalance: 5, 'sparse-line': 6 };
    const RECT_KEYS = ['childRect', 'aRect', 'bRect', 'rightRect', 'leftRect'];

    function build(opts) {
        opts = opts || {};
        const top = opts.top || 10, kinds = opts.kinds || [], report = opts.report || {};
        const host = document.getElementById('book-container');
        const bc = host.getBoundingClientRect();
        const pages = Array.from(host.querySelectorAll('.a4-page'));
        const audit = root.__geomAudit.audit(root.__geomAudit.extract());

        const rnd = r => ({ x: Math.round(r.left - bc.left), y: Math.round(r.top - bc.top), w: Math.round(r.width), h: Math.round(r.height) });
        const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
        const findEl = (pageIdx, rect) => {
            const pg = pages[pageIdx];
            if (!pg) return null;
            const hits = [pg, ...pg.querySelectorAll('*')].filter(e => same(rnd(e.getBoundingClientRect()), rect));
            return hits.find(e => /block-|main-column|footnote-area|page-body-flow/.test(String(e.className))) || hits[0] || null;
        };

        const chosen = audit.issues.filter(i => !kinds.length || kinds.includes(i.kind))
            .sort((a, b) => (RANK[b.severity] - RANK[a.severity]) || ((PRI[a.kind] ?? 9) - (PRI[b.kind] ?? 9)) || a.pageIdx - b.pageIdx)
            .slice(0, top);

        const explained = chosen.map(i => ({
            kind: i.kind, severity: i.severity, page: i.pageIdx + 1, message: String(i.message).slice(0, 160),
            matches: RECT_KEYS.filter(k => i[k]).map(k => {
                const el = findEl(i.pageIdx, i[k]);
                if (!el) return { rect: k, el: null, events: [] };
                const ev = root.EngineTrace ? root.EngineTrace.explain(el, { limit: 400 }) : [];
                return {
                    rect: k, el: `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}`,
                    events: ev.map(e => ({ seq: e.seq, pass: e.pass, parent: e.parent, dh: e.dh || null, dl: e.dl || null, before: e.before || null, after: e.after || null, changed: !!e.changed, ret: e.ret }))
                };
            })
        }));

        const trace = report.trace || (root.EngineTrace ? root.EngineTrace.summary() : null);
        const json = {
            createdAt: new Date().toISOString(), pages: pages.length,
            inputs: {
                textHash: report.textHash, settingsUsedCount: report.settingsUsedCount, settingsUsedHash: report.settingsUsedHash, settingsHash: report.settingsHash,
                fontsHash: report.fontsHash, fontCount: report.fontCount, typesetPasses: report.passes, lateFonts: report.lateFonts, fontErrors: report.fontErrors,
                cssVarsHash: report.cssVarsHash, settingsMissing: report.settingsMissing, derivedChanged: report.derivedChanged
            },
            trace, audit: audit.summary, explained
        };
        return { text: toText(json), json };
    }

    function toText(j) {
        const L = [];
        const inp = j.inputs;
        L.push('# דוח אבחון עימוד', '', `נוצר: ${j.createdAt} | עמודים: ${j.pages}`, '');
        L.push('## קלטים',
            `- טקסט: \`${inp.textHash}\` | הגדרות שנקראו: ${inp.settingsUsedCount} (\`${inp.settingsUsedHash}\`) | גופנים טעונים: ${inp.fontCount} (\`${inp.fontsHash}\`) | הרצות עימוד: ${inp.typesetPasses} | CSS: \`${inp.cssVarsHash}\``);
        if (inp.lateFonts && inp.lateFonts.length) L.push(`- גופנים שנטענו באמצע העימוד (גרמו להרצה נוספת): ${inp.lateFonts.join(', ')}`);
        if (inp.fontErrors && inp.fontErrors.length) L.push(`- גופנים שנכשלו בטעינה: ${inp.fontErrors.join(', ')}`);
        if (inp.settingsMissing && inp.settingsMissing.length) L.push(`- הגדרות שהקוד קורא ואין להן פקד: ${inp.settingsMissing.join(', ')}`);
        if (inp.derivedChanged && inp.derivedChanged.length) L.push(`- פקדים שהמנוע עצמו שינה בעימוד (מצב נסתר, תלוי בהיסטוריה): ${inp.derivedChanged.join(', ')}`);
        L.push('', 'כלל אצבע: אם הפריסה שונה בין שתי הרצות והקלטים (ה-hashים למעלה) זהים — הבאג בקוד או במצב נסתר; אם הקלטים שונים — ההסבר בקלט.', '');

        if (j.trace && j.trace.byPass) {
            L.push('## מעברי המנוע (יומן החלטות)', '', '| מעבר | קריאות | שינו גובה | סכום |Δh| |', '|---|---|---|---|');
            Object.entries(j.trace.byPass).sort((a, b) => b[1].changed - a[1].changed || b[1].calls - a[1].calls)
                .forEach(([n, s]) => L.push(`| ${n} | ${s.calls} | ${s.changed} | ${s.sumAbsDh} |`));
            L.push('');
        }
        const a = j.audit;
        L.push('## ממצאי בדיקת הגיאומטריה', '', `סה"כ ${a.total} (high ${a.high}, medium ${a.medium}, low ${a.low}): ` + Object.entries(a.byKind).map(([k, n]) => `${k} ${n}`).join(', '), '');
        L.push(`## הסברים לממצאים החמורים (${j.explained.length})`, '');
        j.explained.forEach((e, n) => {
            L.push(`### ${n + 1}. עמוד ${e.page} [${e.severity}] ${e.kind}`, '', e.message, '');
            e.matches.forEach(m => {
                if (!m.el) { L.push(`- ${m.rect}: לא נמצא אלמנט תואם בעמוד`); return; }
                const changed = m.events.filter(x => x.changed);
                L.push(`- ${m.rect} → \`${m.el}\`: ${m.events.length} מעברים נגעו בו, ${changed.length} שינו גובה`);
                if (!m.events.length) { L.push('  - אף מעבר מאוחר לא נגע בו: הגובה נקבע בבנייה או בחלוקה לעמודים'); return; }
                const mag = x => Math.max(0, ...(x.dh || []).map(Math.abs), ...(x.dl || []).map(Math.abs));
                const big = changed.reduce((b, x) => (!b || mag(x) > mag(b) ? x : b), null);
                (changed.length ? changed : m.events).slice(-8).forEach(x => {
                    const last = x.dl && x.dl.some(d => d) ? ` | בלוק אחרון ${x.dl.filter(d => d).join(',')}` : '';
                    const h = x.before ? `גובה ${x.before.map(b => b.h).join(',')} → ${x.after.map(b => b.h).join(',')}${last}` : `ret=${JSON.stringify(x.ret)}`;
                    L.push(`  - #${x.seq} ${x.pass}${x.parent ? ' (בתוך ' + x.parent + ')' : ''}: ${h}${x === big ? ' ← השינוי הגדול ביותר' : ''}`);
                });
            });
            L.push('');
        });
        return L.join('\n');
    }

    root.EngineDiagnostics = { build };
})(typeof window !== 'undefined' ? window : globalThis);
