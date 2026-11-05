/* geometry-audit-extra.js — כללים נוספים לבדיקת הגיאומטריה (V22), כתוסף שלא נוגע ב-geometry-audit.js.

   הקובץ geometry-audit.js (הגרסה של main/V23) נשאר כמות שהוא, כך שעריכות עתידיות בו לא יתנגשו בכללים כאן.
   התוסף עוטף את api.audit: מריץ את הבדיקה המקורית ואז מוסיף ממצאים. נטען אחרי geometry-audit.js (renderer.html).

   כללים:
     fn-overflow / pn-overflow (basis:'text')  תחתית הטקסט בפועל חודרת לאזור ההערות / למספר העמוד. בדיקת תיבות
         לא תופסת תוכן שגולש מתיבת ה-body-flow (overflow:visible): בעמוד 47 נמדדו 374-512px בלי דיווח של בדיקת תיבות.
     heading-at-bottom   כותרת (רמות 3-6) בתחתית טור, או כותרת ואחריה פחות משתי שורות גוף (בעיה 5 במסמך ההגדרות).
     empty-column        טור ריק כשהטור השני מלא; בסוף פרק זה תקין (low). (בעיה 7)
     chain-broken        p-cut שאחריו אין פסקת המשך, או פסקת המשך שלפניה אין p-cut: אובדן או כפילות טקסט.
                         (דורש DOM — מודל הבדיקה של main לא נושא את סימון ההמשך)
     pua-char            תו U+E000 (ריבוע) בטקסט. (בעיה 9; דורש DOM) */
(function (root) {
    'use strict';
    const api = root.__geomAudit;
    if (!api || api.__extraRules) return;

    const TOL_PX = 1;
    const TEXT = new Set(['p', 'p-cut', 'p-end', 'h2-title', 'h3-title', 'h3', 'h4', 'h5', 'h6', 'h7']);
    const isPara = t => t === 'p' || t === 'p-cut' || t === 'p-end';
    const isHead = t => t === 'h3' || t === 'h4' || t === 'h5' || t === 'h6';
    const hasText = n => TEXT.has(n.type) && n.lines && n.lines.length > 0;
    const ri = r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
    const child = (node, type) => (node.children || []).find(c => c.type === type) || null;
    const hasType = (node, type) => !!node && (node.type === type || (node.children || []).some(c => hasType(c, type)));
    const txt = n => String(n.text || '');

    function regions(page) {
        const w = page.children && page.children[0];
        return w ? { flow: child(w, 'body-flow'), fn: child(w, 'footnote-area'), pn: child(w, 'page-number') } : { flow: null, fn: null, pn: null };
    }

    /* תחתית הטקסט הנמוכה ביותר בגוף העמוד (שורות טקסט בלבד) */
    function lowestText(node, best) {
        for (const l of node.lines || []) if (l.bottom > best.b) { best.b = l.bottom; best.node = node; best.line = l; }
        for (const c of node.children || []) lowestText(c, best);
        return best;
    }
    function auditTextOver(page, issues) {
        const { flow, fn, pn } = regions(page);
        if (!flow || (!fn && !pn)) return;
        const best = lowestText(flow, { b: -Infinity, node: null, line: null });
        if (!best.node) return;
        [['fn-overflow', fn, 'לאזור ההערות'], ['pn-overflow', pn, 'למספר העמוד']].forEach(([kind, target, label]) => {
            if (!target) return;
            const over = best.b - target.rect.y;
            if (over <= TOL_PX || issues.some(i => i.kind === kind && i.pageIdx === page.idx)) return;
            issues.push({
                kind, severity: over > 2 ? 'high' : 'medium', basis: 'text', pageIdx: page.idx, location: `page ${page.label}`,
                overlapPx: Math.round(over * 10) / 10, pText: txt(best.node), aRect: ri(best.line), bRect: ri(target.rect),
                message: `טקסט הגוף חודר ${label} בעמוד ${page.label}: ${Math.round(over)}px`
            });
        });
    }

    function auditHeadingBottom(node, page, issues) {
        if (node.type === 'column') {
            const it = (node.children || []).filter(hasText);
            const n = it.length;
            if (n >= 1 && isHead(it[n - 1].type)) {
                const h = it[n - 1];
                issues.push({ kind: 'heading-at-bottom', severity: 'high', pageIdx: page.idx, location: `page ${page.label} / ${node.side}`, pText: txt(h), childRect: ri(h.rect),
                    message: `כותרת ${h.type} בתחתית טור ${node.side} בלי גוף אחריה ("${txt(h).slice(0, 30)}")` });
            } else if (n >= 2 && isHead(it[n - 2].type) && isPara(it[n - 1].type) && it[n - 1].lines.length < 2) {
                const h = it[n - 2], p = it[n - 1];
                const shortComplete = p.type === 'p-end';   // המודל אינו נושא סימון המשך: p-end = סוף פסקה (medium), p-cut חתוך (high)
                issues.push({ kind: 'heading-at-bottom', severity: shortComplete ? 'medium' : 'high', pageIdx: page.idx, location: `page ${page.label} / ${node.side}`, pText: txt(h), aRect: ri(h.rect), bRect: ri(p.rect),
                    message: `כותרת ${h.type} עם שורת גוף אחת בלבד בתחתית טור ${node.side}${shortComplete ? ' (פסקה קצרה שלמה)' : ''}` });
            }
        }
        for (const c of node.children || []) auditHeadingBottom(c, page, issues);
    }

    function auditEmptyColumn(page, nextPage, issues) {
        const flow = regions(page).flow;
        if (!flow) return;
        flow.children.forEach((b, bi) => {
            if (b.type !== 'block-2col') return;
            const cols = b.children.filter(c => c.type === 'column');
            if (cols.length !== 2) return;
            const cnt = c => c.children.filter(hasText).length;
            const a = cnt(cols[0]), d = cnt(cols[1]);
            if ((a === 0) === (d === 0)) return;
            const empty = a === 0 ? cols[0] : cols[1];
            const benign = bi === flow.children.length - 1 && (!nextPage || hasType(nextPage, 'h2-title'));
            issues.push({ kind: 'empty-column', severity: benign ? 'low' : 'high', pageIdx: page.idx, location: `page ${page.label} / ${empty.side}`, childRect: ri(empty.rect),
                message: `טור ${empty.side} ריק כשהטור השני מלא${benign ? ' (ייתכן סוף פרק — תקין)' : ''}` });
        });
    }

    /* שרשרת המשך: כל p-cut חייב להמשיך בפסקה עם data-is-cont מיד אחריו (סדר DOM = סדר קריאה: ימין לפני שמאל, בלוק
       אחרי בלוק, עמוד אחרי עמוד), וכל פסקת המשך חייבת לבוא אחרי p-cut. שבירה = אובדן או כפילות טקסט.
       רץ על ה-DOM: מודל הבדיקה של main לא נושא את סימון ההמשך (הכללים שלו קוראים אותו מה-DOM). נבדק על המנוע
       הנוכחי: 234 p-cut מול 234 פסקאות המשך, 0 שבירות. בלוק ברוחב מלא (שארית טרמינלית) נכלל כי הסריקה היא לכל p בגוף העמוד. */
    function auditChainDom(issues) {
        if (typeof document === 'undefined') return;
        const host = document.getElementById('book-container');
        if (!host) return;
        const bc = host.getBoundingClientRect();
        const seq = [];
        Array.from(host.querySelectorAll('.a4-page')).forEach((pg, pi) => {
            const flow = pg.querySelector('.page-body-flow');
            if (flow) flow.querySelectorAll('p').forEach(el => seq.push({ el, pi }));
        });
        const isCut = e => e.classList.contains('p-cut');
        const isContEl = e => e.getAttribute('data-is-cont') === 'true';
        for (let k = 0; k < seq.length; k++) {
            const cur = seq[k].el, nx = seq[k + 1] && seq[k + 1].el, pv = seq[k - 1] && seq[k - 1].el;
            let why = null;
            if (isCut(cur) && !(nx && isContEl(nx))) why = 'פסקה חתוכה (p-cut) שאחריה אין פסקת המשך';
            else if (isContEl(cur) && !(pv && isCut(pv))) why = 'פסקת המשך שלפניה אין p-cut';
            if (!why) continue;
            const r = cur.getBoundingClientRect(), t = String(cur.textContent || '').trim().slice(0, 30);
            issues.push({ kind: 'chain-broken', severity: 'high', pageIdx: seq[k].pi, location: `page ${seq[k].pi + 1}`, pText: t,
                childRect: { x: Math.round(r.left - bc.left), y: Math.round(r.top - bc.top), w: Math.round(r.width), h: Math.round(r.height) }, message: `${why} ("${t}")` });
        }
    }

    function auditPuaDom(issues) {
        if (typeof document === 'undefined') return;
        const host = document.getElementById('book-container');
        if (!host) return;
        const bc = host.getBoundingClientRect();
        Array.from(host.querySelectorAll('.a4-page')).forEach((pg, pi) => {
            pg.querySelectorAll('p, [class*="title-level"], .h3-title-text, .note-line').forEach(el => {
                const t = el.textContent || '';
                if (t.indexOf('\uE000') === -1) return;
                const r = el.getBoundingClientRect();
                issues.push({ kind: 'pua-char', severity: 'high', pageIdx: pi, location: `page ${pi + 1}`, pText: t.trim().slice(0, 30),
                    childRect: { x: Math.round(r.left - bc.left), y: Math.round(r.top - bc.top), w: Math.round(r.width), h: Math.round(r.height) },
                    message: `תו U+E000 (ריבוע) בטקסט: "${t.trim().slice(0, 30)}"` });
            });
        });
    }

    /* כל כלל רץ בבידוד: כשל באחד לא מדלג על האחרים, והוא מדווח כ-audit-extra-error */
    function extra(model, issues) {
        const guard = (name, fn) => {
            try { fn(); }
            catch (e) { issues.push({ kind: 'audit-extra-error', severity: 'low', pageIdx: -1, location: name, message: `${name}: ${String(e && e.message || e)}` }); }
        };
        const pages = model.pages;
        for (let pi = 0; pi < pages.length; pi++) {
            const page = pages[pi];
            guard('page ' + (pi + 1), () => {
                auditTextOver(page, issues);
                for (const c of page.children || []) auditHeadingBottom(c, page, issues);
                auditEmptyColumn(page, pages[pi + 1], issues);
            });
        }
        guard('chain-broken (DOM)', () => auditChainDom(issues));
        guard('pua-char (DOM)', () => auditPuaDom(issues));
    }

    const baseAudit = api.audit;
    api.audit = function (model) {
        const res = baseAudit.apply(this, arguments);
        extra(model, res.issues);
        const s = res.summary || (res.summary = {});
        s.total = res.issues.length;
        s.high = res.issues.filter(i => i.severity === 'high').length;
        s.medium = res.issues.filter(i => i.severity === 'medium').length;
        s.low = res.issues.filter(i => i.severity === 'low').length;
        s.byKind = {};
        res.issues.forEach(i => { s.byKind[i.kind] = (s.byKind[i.kind] || 0) + 1; });
        return res;
    };
    api.__extraRules = true;
})(typeof window !== 'undefined' ? window : globalThis);
