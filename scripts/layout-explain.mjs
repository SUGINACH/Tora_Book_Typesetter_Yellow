#!/usr/bin/env node
/* מצמיד כל ממצא של בדיקת הגיאומטריה למעברי המנוע שנגעו באלמנט — בלי חקירה.

   מריץ את העימוד פעמיים: בלי יומן ועם יומן (engine-trace.js), בודק שהיומן לא שינה את הפריסה, מריץ את
   בדיקת הגיאומטריה, ולכל אחד מהממצאים החמורים מדפיס את רשימת המעברים שנגעו באלמנט הבעייתי עם הגובה
   לפני ואחרי. אם אף מעבר לא נגע בו — הבעיה נוצרה בבנייה/חלוקה לעמודים, לא במעבר מאוחר.

   שימוש:
     node scripts/layout-explain.mjs --root . --text very_long_test_text.txt --lines 1500 --audit geometry-audit.js
         [--top 6]                     כמה ממצאים להסביר
         [--kind containment,imbalance] סינון סוגים
         [--json out.json]
   דרישות: npm i puppeteer-core, ו-Chrome (--chrome <path> או CHROME_PATH). */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const o = { root: path.resolve('.'), text: null, lines: 1500, audit: null, top: 6, kinds: [], chrome: null, json: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--root') o.root = path.resolve(argv[++i]);
    else if (v === '--text') o.text = argv[++i];
    else if (v === '--lines') o.lines = parseInt(argv[++i], 10);
    else if (v === '--audit') o.audit = path.resolve(argv[++i]);
    else if (v === '--top') o.top = parseInt(argv[++i], 10);
    else if (v === '--kind') o.kinds = String(argv[++i]).split(',').filter(Boolean);
    else if (v === '--chrome') o.chrome = argv[++i];
    else if (v === '--json') o.json = argv[++i];
}
if (!o.text) { console.error('שימוש: node scripts/layout-explain.mjs --root <תיקייה> --text <קובץ> [--lines N] [--audit geometry-audit.js] [--top N] [--kind a,b] [--json out]'); process.exit(2); }

let puppeteer;
try { puppeteer = (await import('puppeteer-core')).default; } catch { console.error('חסרה התלות puppeteer-core — הרץ: npm i puppeteer-core'); process.exit(2); }
let exe = [o.chrome, process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(p => fs.existsSync(p));
let launchArgs = ['--no-sandbox'];
let headlessMode = true;   // Chrome מותקן: headless רגיל. ב-Chrome 132+ מצב 'shell' קיים רק בבינארי headless-shell נפרד
if (!exe) { try { const c = (await import('@sparticuz/chromium')).default; exe = await c.executablePath(); launchArgs = [...c.args, '--no-sandbox']; headlessMode = 'shell'; } catch { /* אין */ } }
if (!exe) { console.error('לא נמצא Chrome (--chrome <path> / CHROME_PATH)'); process.exit(2); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(o.root, p);
    if (!f.startsWith(o.root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
    res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream');
    fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const settings = JSON.parse(fs.readFileSync(path.join(o.root, 'default_settings.json'), 'utf8'));
const all = fs.readFileSync(o.text, 'utf8').split('\n');
const text = o.lines > 0 ? all.slice(0, o.lines).join('\n') : all.join('\n');

/* טביעת אצבע של פריסה (כמו ב-layout-ab.mjs) */
const fpFn = () => {
    const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
    const q = v => Math.round(v * 64) / 64;
    return Array.from(document.querySelectorAll('#book-container .a4-page')).map((pg, i) => {
        const pr = pg.getBoundingClientRect(); const rel = el => { const r = el.getBoundingClientRect(); return { y: q(r.top - pr.top), h: q(r.height) }; };
        const flow = pg.querySelector('.page-body-flow');
        const blocks = flow ? Array.from(flow.children).map(b => ({ k: b.className.toString().slice(0, 20), ...rel(b), cols: Array.from(b.querySelectorAll(':scope > .main-column, :scope > .single-wide-col')).map(c => ({ n: c.children.length, ...rel(c), th: fnv(c.textContent) })) })) : [];
        const fn = pg.querySelector('.footnote-area');
        return { n: i + 1, th: fnv(flow ? flow.textContent : ''), blocks, fn: fn ? rel(fn) : null };
    });
};

/* רץ בדף: מסביר את הממצאים החמורים לפי יומן ההחלטות */
const explainFn = (topK, kinds) => {
    const bc = document.getElementById('book-container').getBoundingClientRect();
    const audit = window.__geomAudit.audit(window.__geomAudit.extract());
    const rank = { high: 3, medium: 2, low: 1 };
    const pri = { 'fn-overflow': 0, 'pn-overflow': 0, 'page-overflow': 0, 'fn-page-overflow': 0, 'fn-pn-overflow': 0, containment: 1, overlap: 2, imbalance: 3 };
    const issues = audit.issues.filter(i => !kinds.length || kinds.includes(i.kind))
        .sort((a, b) => (rank[b.severity] - rank[a.severity]) || ((pri[a.kind] ?? 9) - (pri[b.kind] ?? 9)) || a.pageIdx - b.pageIdx).slice(0, topK);
    const pages = Array.from(document.querySelectorAll('#book-container .a4-page'));
    const rnd = r => ({ x: Math.round(r.left - bc.left), y: Math.round(r.top - bc.top), w: Math.round(r.width), h: Math.round(r.height) });
    const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    const findEl = (pageIdx, rect) => {
        const pg = pages[pageIdx]; if (!pg) return null;
        const hits = [pg, ...pg.querySelectorAll('*')].filter(e => same(rnd(e.getBoundingClientRect()), rect));
        return hits.find(e => /block-|main-column|footnote-area|page-body-flow/.test(String(e.className))) || hits[0] || null;
    };
    return {
        summary: audit.summary,
        explained: issues.map(i => ({
            kind: i.kind, severity: i.severity, page: i.pageIdx + 1, message: String(i.message).slice(0, 130),
            matches: ['childRect', 'aRect', 'bRect', 'rightRect', 'leftRect'].filter(k => i[k]).map(k => {
                const el = findEl(i.pageIdx, i[k]);
                if (!el) return { rect: k, el: null, events: [] };
                const ev = EngineTrace.explain(el, { limit: 400 });
                return { rect: k, el: `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}`, events: ev.map(e => ({ seq: e.seq, pass: e.pass, parent: e.parent, dh: e.dh || null, dl: e.dl || null, before: e.before || null, after: e.after || null, changed: !!e.changed, ret: e.ret })) };
            })
        }))
    };
};

const browser = await puppeteer.launch({ args: launchArgs, executablePath: exe, headless: headlessMode, protocolTimeout: 1800000, defaultViewport: { width: 1280, height: 900 } });
let out;
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.error('[pageerror]', String(e).slice(0, 160)));
    await page.goto(`http://127.0.0.1:${port}/renderer.html`, { waitUntil: 'load' });
    if (o.audit) await page.addScriptTag({ path: o.audit });
    await page.waitForFunction(() => typeof window.typesetDocument === 'function' && !!window.__geomAudit && !!window.EngineTrace, { timeout: 60000 });
    const typeset = trace => page.evaluate(async (tx, st, withTrace, fpSrc) => {
        const fpFn = eval('(' + fpSrc + ')');
        const done = await new Promise(resolve => { const h = e => { if (e.data && (e.data.type === 'render-done' || e.data.type === 'render-error')) { window.removeEventListener('message', h); resolve(e.data); } };
            window.addEventListener('message', h); window.postMessage({ type: 'typeset', text: tx, settings: st, trace: withTrace }, '*'); });
        window.scrollTo({ top: 0, behavior: 'instant' });
        return { type: done.type, report: done.report || null, fp: fpFn() };
    }, text, settings, trace, fpFn.toString());
    const plain = await typeset(false);
    const traced = await typeset(true);
    const diffPages = (A, B) => { let c = 0; for (let i = 0; i < Math.max(A.length, B.length); i++) { const x = A[i], y = B[i]; if (!x || !y || x.th !== y.th || JSON.stringify([x.blocks, x.fn]) !== JSON.stringify([y.blocks, y.fn])) c++; } return c; };
    const noEffect = diffPages(plain.fp, traced.fp);
    const ex = await page.evaluate(explainFn, o.top, o.kinds);
    out = { pages: traced.fp.length, traceChangedPages: noEffect, trace: traced.report && traced.report.trace, audit: ex.summary, explained: ex.explained };
} finally { await browser.close(); server.close(); }

console.log(`עמודים: ${out.pages} | היומן שינה ${out.traceChangedPages} עמודים${out.traceChangedPages === 0 ? ' (אין השפעה על הפריסה)' : ' ⚠'} | ממצאי בדיקת גיאומטריה: ${out.audit.total} (high ${out.audit.high})`);
if (out.trace) {
    console.log(`\nמעברים ביומן (${out.trace.events} אירועים${out.trace.dropped ? ', ' + out.trace.dropped + ' נזרקו' : ''}):`);
    Object.entries(out.trace.byPass).sort((a, b) => b[1].changed - a[1].changed).forEach(([n, s]) => console.log(`  ${n.padEnd(28)} קריאות ${String(s.calls).padStart(5)} | שינו גובה ${String(s.changed).padStart(5)} | סכום |Δh| ${s.sumAbsDh}`));
}
console.log('');
for (const e of out.explained) {
    console.log(`עמוד ${e.page} [${e.severity}] ${e.kind}: ${e.message}`);
    for (const m of e.matches) {
        if (!m.el) { console.log(`   ${m.rect}: לא נמצא אלמנט תואם`); continue; }
        const changed = m.events.filter(x => x.changed);
        console.log(`   ${m.rect} → ${m.el}: ${m.events.length} מעברים נגעו בו, ${changed.length} שינו גובה`);
        if (!m.events.length) { console.log('      אף מעבר מאוחר לא נגע בו: הגובה נקבע בבנייה/חלוקה לעמודים'); continue; }
        const mag = x => Math.max(0, ...x.dh.map(Math.abs), ...(x.dl || []).map(Math.abs));
        const big = changed.reduce((b, x) => (!b || mag(x) > mag(b) ? x : b), null);
        (changed.length ? changed : m.events).slice(-6).forEach(x => {
            const last = x.dl && x.dl.some(d => d) ? ` | בלוק אחרון ${x.dl.filter(d => d).join(',')}` : '';
            const h = x.before ? `גובה ${x.before.map(b => b.h).join(',')} → ${x.after.map(a => a.h).join(',')}${last}` : `ret=${JSON.stringify(x.ret)}`;
            console.log(`      #${x.seq} ${x.pass}${x.parent ? ' (בתוך ' + x.parent + ')' : ''}  ${h}${x === big ? '   ← השינוי הגדול ביותר' : ''}`);
        });
    }
    console.log('');
}
if (o.json) fs.writeFileSync(o.json, JSON.stringify(out, null, 2));
if (out.traceChangedPages > 0) process.exitCode = 1;   // היומן לא אמור לשנות את הפריסה
