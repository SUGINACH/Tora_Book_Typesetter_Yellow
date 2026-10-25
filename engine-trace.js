/* engine-trace.js — יומן החלטות של מנוע העימוד (שלב 3 בתכנית: Reports_Summaries_Studies/תכנית_ארגון_מנוע_העימוד.md).

   מטרה: לדעת איזה מעבר (איזון, יישור, מתיחה, כיווץ...) שינה איזה אלמנט, ובכמה — בלי חקירה.
   כשבדיקת הגיאומטריה מוצאת ממצא על בלוק/טור/עמוד, explain(אלמנט) מחזיר את רשימת המעברים שנגעו בו לפי הסדר,
   עם הגובה לפני ואחרי כל אחד. ככה ממצא "בלוק בולט ב-512px" נשלח ישר למעבר שיצר אותו.

   איך זה עובד: המעברים הם פונקציות גלובליות של typesetter.js. enable() מחליף כל אחת בעוטף שרושם אירוע
   (שם, ארגומנטים, גיאומטריה לפני/אחרי, ערך מוחזר) ואז קורא למקור; disable() מחזיר את המקורות.
   כבוי כברירת מחדל, ולא נוגע בקוד המנוע — לכן אין לו השפעה על הפריסה (נבדק: 0 הפרשים מול ריצה בלי יומן).

   שימוש:  EngineTrace.reset(); EngineTrace.enable(); typesetDocument(); EngineTrace.disable();
           EngineTrace.summary();  EngineTrace.explain(element);                                        */
(function (root) {
    'use strict';

    /* geo: האם למדוד גובה/גלילה של ארגומנטי האלמנט לפני ואחרי. החלטות בלבד (בלי שינוי DOM) — geo:false */
    const PASSES = {
        rollbackTrailingHeadings: { geo: true },
        compressColumnBy: { geo: true },
        tryReclaimOrphanTail: { geo: false },
        justifyColumnVertically: { geo: true },
        shrinkColumnVertically: { geo: true },
        stretchLastBlockToBottom: { geo: true },
        repositionBlockNotes: { geo: true },
        balanceColumns: { geo: true },
        finalizeNotePositions: { geo: false },
        fitSectionDividerToPage: { geo: true },
        fitH2OrnamentsToText: { geo: true },
        fitColumnDividers: { geo: true },
        flushFootnotesInto: { geo: true },
        flushEndnotesForPart: { geo: true },
        applyCrossParagraphParens: { geo: true },
        resolveParagraphSplit: { geo: false },
        computeBestFitLine: { geo: false }
    };
    const MAX_EVENTS = 40000;

    let enabled = false, seq = 0, depth = 0, dropped = 0;
    const stack = [];   // שמות המעברים הפעילים כרגע — מגדיר מי קרא למי
    let events = [], refs = [];
    const originals = {};

    const q = v => Math.round(v * 100) / 100;
    const isEl = v => !!v && v.nodeType === 1;

    function pageNoOf(el) {
        const pg = el.closest ? el.closest('.a4-page') : null;
        if (!pg || !pg.parentElement) return null;
        return Array.prototype.indexOf.call(pg.parentElement.querySelectorAll(':scope > .a4-page'), pg) + 1;
    }
    function describe(el) {
        return {
            tag: String(el.tagName || '').toLowerCase(),
            cls: Array.from(el.classList || []).slice(0, 3).join('.'),
            pg: pageNoOf(el),
            tx: String(el.textContent || '').trim().slice(0, 24)
        };
    }
    function geo(el) {
        const r = el.getBoundingClientRect();
        const g = { h: q(r.height), sh: el.scrollHeight };
        /* עבור body-flow נמדד גם הבלוק האחרון: מעבר כמו stretchLastBlockToBottom משנה אותו ולא את ה-flow עצמו */
        if (el.classList && el.classList.contains && el.classList.contains('page-body-flow') && el.lastElementChild) g.last = q(el.lastElementChild.getBoundingClientRect().height);
        const cols = el.querySelectorAll ? el.querySelectorAll(':scope > .main-column') : [];
        if (cols.length) g.cols = Array.from(cols).map(c => q(c.getBoundingClientRect().height));
        return g;
    }
    function summarize(v) {
        if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v === undefined ? null : v;
        if (typeof v === 'string') return v.slice(0, 40);
        if (isEl(v)) return describe(v);
        if (Array.isArray(v)) return { len: v.length };
        if (typeof v === 'object') {
            const o = {};
            Object.keys(v).slice(0, 8).forEach(k => { const x = v[k]; if (x === null || ['number', 'boolean', 'string'].includes(typeof x)) o[k] = typeof x === 'string' ? x.slice(0, 24) : x; });
            return o;
        }
        return String(typeof v);
    }

    function wrap(name, cfg) {
        const orig = root[name];
        if (typeof orig !== 'function' || orig.__engineTraceWrapped) return false;
        const w = function (...args) {
            if (!enabled) return orig.apply(this, args);
            const ev = { seq: ++seq, pass: name, depth, parent: stack.length ? stack[stack.length - 1] : null, args: [] };
            const els = [];
            args.forEach((a, i) => {
                if (isEl(a)) { ev.args.push(Object.assign({ i }, describe(a))); els.push(a); }
                else if (Array.isArray(a) && a.length && isEl(a[0])) { ev.args.push({ i, list: a.length, first: describe(a[0]) }); els.push(...a.slice(0, 50)); }
                else if (typeof a === 'number' || typeof a === 'boolean') ev.args.push({ i, v: a });
            });
            const measured = els.slice(0, 4);
            if (cfg.geo) ev.before = measured.map(geo);
            const t0 = performance.now();
            depth++; stack.push(name);
            let ret, err = null;
            try { ret = orig.apply(this, args); } catch (e) { err = e; }
            stack.pop(); depth--;
            ev.ms = q(performance.now() - t0);
            if (cfg.geo) {
                ev.after = measured.map(geo);
                ev.dh = ev.after.map((a, i) => q(a.h - ev.before[i].h));
                ev.dl = ev.after.map((a, i) => (a.last !== undefined && ev.before[i].last !== undefined) ? q(a.last - ev.before[i].last) : 0);
                ev.changed = ev.dh.some(d => Math.abs(d) > 0.5) || ev.dl.some(d => Math.abs(d) > 0.5);
            }
            ev.ret = summarize(ret);
            if (err) ev.error = String(err && err.message || err);
            if (events.length < MAX_EVENTS) { events.push(ev); refs.push(els); } else dropped++;
            if (err) throw err;
            return ret;
        };
        w.__engineTraceWrapped = true;
        originals[name] = orig;
        root[name] = w;
        return true;
    }

    function enable() {
        if (enabled) return;
        Object.keys(PASSES).forEach(n => wrap(n, PASSES[n]));
        enabled = true;
    }
    function disable() {
        enabled = false;
        Object.keys(originals).forEach(n => { root[n] = originals[n]; delete originals[n]; });
    }
    function reset() { events = []; refs = []; seq = 0; depth = 0; dropped = 0; }

    function summary() {
        const byPass = {};
        events.forEach(e => {
            const s = byPass[e.pass] || (byPass[e.pass] = { calls: 0, changed: 0, sumAbsDh: 0 });
            s.calls++;
            if (e.changed) s.changed++;
            if (e.dh) s.sumAbsDh = q(s.sumAbsDh + e.dh.reduce((t, d) => t + Math.abs(d), 0) + (e.dl || []).reduce((t, d) => t + Math.abs(d), 0));
        });
        return { enabled, events: events.length, dropped, byPass };
    }

    /* כל האירועים שנגעו באלמנט (או בהורה/בצאצא שלו), לפי הסדר */
    function explain(el, opts) {
        const limit = (opts && opts.limit) || 60;
        const out = [];
        for (let i = 0; i < events.length; i++) {
            const related = refs[i].some(a => a === el || (a.contains && a.contains(el)) || (el.contains && el.contains(a)));
            if (related) out.push(events[i]);
        }
        return out.length > limit ? out.slice(out.length - limit) : out;
    }

    root.EngineTrace = { PASSES, enable, disable, reset, summary, explain, events: () => events.slice(), isEnabled: () => enabled };
})(typeof window !== 'undefined' ? window : globalThis);
