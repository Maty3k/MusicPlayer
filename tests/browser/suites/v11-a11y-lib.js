// Helpers for v11-a11y-axe. (Copied from the session scratchpad. Only the
// plumbing changed: base URL, saved logins, the screenshot folder and the
// axe-core path come from ../lib.js and node_modules.)
const fs = require('fs');
const path = require('path');
const Lib = require('../lib');
const APP = Lib.APP;
const SP = Lib.ROOT;
const SHOTS = path.dirname(Lib.shot('v11-a11y', 'x'));
fs.mkdirSync(SHOTS, { recursive: true });
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - First Find', channel: 'Band One', thumbnail: '' },
    { videoId: 'bbbbbbbbbb2', title: 'Second Find', channel: 'Someone', thumbnail: '' },
];
async function launch() { return Lib.launch(); }
async function open(b, opts = {}) {
    const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, storageState: Lib.state(opts.acct || 'demo') });
    const p = await ctx.newPage();
    p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
    p.__posts = []; p.__opts = opts;
    await p.route(/youtube\.com|sdk\.scdn|spotify\.com|ytimg\.com/, r => r.abort());
    await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) }));
    await p.route('**/youtube-playlist', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, title: 'A List', videos: [] }) }));
    await p.route('**/upload-song', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, mp3_url: '/media/x.mp3', cover: '' }) }));
    await p.route('**/save-music', async (route) => {
        const body = JSON.parse(route.request().postData() || '{}');
        p.__posts.push(body);
        if (body.action === 'switchPlaylist') return route.continue();
        if (body.action === 'stats') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, range: body.range, stats: { totalPlays: 3, distinctSongs: 2, distinctArtists: 1, topSongs: [{ title: 'Top Tune', artist: 'Top Artist', cover: '', plays: 2 }], topArtists: [{ artist: 'Top Artist', plays: 2 }] } }) });
        if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: 1, skipped: 0 }) });
        if (body.action === 'add') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, index: 0 }) });
        if (body.action === 'share') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, url: 'http://127.0.0.1:8123/s/t' }) });
        if (body.action === 'createPlaylist' || body.action === 'create') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, id: 'fake', playlist: { id: 'fake', name: 'X' } }) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, favorited: true, key: 'k' }) });
    });
    if (opts.init) await p.addInitScript(opts.init);
    await p.goto(APP); await p.waitForTimeout(1500);
    return { ctx, p };
}
async function axe(p, label) {
    await p.addScriptTag({ path: require.resolve('axe-core/axe.min.js') }).catch(() => {});
    const r = await p.evaluate(async () => {
        const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
        const visible = (sel) => { try { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); let hiddenAnc = false; for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden') { hiddenAnc = true; break; } } return !hiddenAnc && r.width > 0 && r.height > 0; } catch (e) { return 'err'; } };
        return res.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ t: n.target.join(' '), vis: visible(n.target[n.target.length - 1]), html: n.html.slice(0, 160), msg: (n.failureSummary || '').replace(/\s+/g, ' ').slice(0, 260) })) }));
    });
    return r;
}
const look = (p) => p.evaluate(() => ({
    tab: document.documentElement.dataset.mTab,
    layer: history.state && history.state.mLayer || null,
    depth: history.state && history.state.mDepth || 0,
    modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
    np: document.body.classList.contains('m-np-open'),
    player: document.getElementById('musicPlayerView').classList.contains('active'),
    active: (() => { const a = document.activeElement; if (!a) return null; return a.id ? '#' + a.id : (a.tagName + (a.className && typeof a.className === 'string' ? '.' + a.className.split(' ').join('.') : '') + (a.getAttribute('aria-label') ? '[' + a.getAttribute('aria-label') + ']' : '')); })(),
}));
const back = async (p, ms = 700) => { await p.evaluate(() => history.back()); await p.waitForTimeout(ms); return look(p); };
module.exports = { launch, open, axe, look, back, APP, SP, SHOTS, YT };
