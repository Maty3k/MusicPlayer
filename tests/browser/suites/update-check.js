// New versions (script.js, "New versions"; GET /version): an open page
// notices a deploy. It reloads by itself only at rest, once per build in a
// tab; otherwise the offer at the top asks (Refresh / Later). /version is
// stubbed with page.route, page time runs on Playwright's clock, and
// visibility is faked (document.hidden). Phone 390x844, desktop 1440x900.
//   A. The same build: no offer, no reload, one request 30 s after opening.
//   B. A newer build at rest: exactly one reload. Still newer after it (an
//      old server, the offline copy): no second reload, the offer shows. A
//      reload that reaches the newer build says "Updated to the newest
//      version" and offers nothing.
//   C. Playing: no reload; the offer shows, opaque, off Now Playing's
//      chevron and ⋯ on a phone (it waits under Now Playing) and off the
//      desktop avatar, and above the desktop side panel (820px), where it
//      waits while a song menu pushed up to the top is open; Later hides it
//      for an hour; Refresh reloads.
//   D. Paused 2 minutes ago: the offer. 11 minutes later, back in view: a
//      reload.
//   E. Now Playing open (the desktop deck too), the queue sheet or a song
//      menu (the offer waits under them), typing in Search, a save going,
//      or the sleep timer set: no reload. With none: one. Typing when a
//      newer build is announced: the offer waits until the field is left;
//      already up, it steps aside while the field is in use (not after
//      Later). A Spotify library import going: no reload until it stops.
//   F. An older build, a 503, a page instead of JSON, a failed request, or
//      none within 8 s: nothing happens, no page errors.
//   G. Offline: no request. Back online: one, then a reload at rest.
//   H. Back (pageshow, persisted): it asks at once, at most every 30 s.
//   I. With the service worker on: two answers in a row with different
//      builds both arrive, and no cache holds /version.
//   J. /version is the server's, never stored; the You page and Settings →
//      Account show "Version <its label>".
// Writes to /save-music are faked (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const MIN = 60 * 1000;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();

    // opts: vp, acct, sw (keep the service worker), answer (what /version says, see answer())
    async function open(opts = {}) {
        const vp = opts.vp || { width: 390, height: 844 };
        const phone = vp.width <= 600;
        const ctx = await b.newContext({
            viewport: vp, isMobile: phone, hasTouch: phone, storageState: L.state(opts.acct || 'mid'),
            // Routes see the page's own requests; with a worker the reloads would go through it
            serviceWorkers: opts.sw ? 'allow' : 'block',
        });
        const p = await ctx.newPage();
        p.__phone = phone;
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__navs = 0; p.on('request', r => { if (r.isNavigationRequest() && r.frame() === p.mainFrame()) p.__navs++; });
        p.__loads = 0; p.on('load', () => p.__loads++);
        p.__asks = 0;
        p.__answer = opts.answer || { build: 'same' };
        // Covers and web fonts too: a reload's load event mustn't wait on other servers
        await p.route(/youtube\.com|ytimg\.com|sdk\.scdn|spotify\.com|lrclib\.net|fonts\.(googleapis|gstatic)\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (READS.includes(body.action)) return route.continue();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.route('**/version', (route) => answer(p, route));
        await p.addInitScript(() => {
            // The test says when the page is away; Chrome's own events don't count
            let hidden = false;
            Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
            Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
            window.addEventListener('visibilitychange', (e) => { if (e.isTrusted) e.stopImmediatePropagation(); }, true);
            window.__setHidden = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); };
            // Every toast this page shows, gone or not
            window.__toasts = [];
            document.addEventListener('DOMContentLoaded', () => {
                new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
                    if (n.nodeType === 1 && n.classList.contains('m-toast')) window.__toasts.push(n.textContent);
                }))).observe(document.body, { childList: true });
            });
        });
        await p.clock.install({ time: new Date('2026-10-19T08:00:00Z') });
        await p.goto(APP); await p.waitForTimeout(1200);
        p.__build = await p.evaluate(() => Number(document.querySelector('meta[name="app-build"]').content));
        await stub(p);
        await p.evaluate(() => { window.__marker = 1; });
        return { ctx, p };
    }

    // A stub YouTube player, as the other suites use
    const stub = (p) => p.evaluate(() => {
        const s = { _s: 5, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
            playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
            mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
            getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
        ytPlayer = ytPlayerReal = s; ytPlayerReady = true;
        window.playSongSource = function (song, cue) { noteSongRequest(song, !cue); };
        window.fetchRadioRecommendations = function () {};
        window.loadLyricsForSong = async function () {};
    });

    // What /version says: { build: 'same' | 'newer' | 'older' | <number> }, { fail: '503' | 'html' | 'abort' | 'slow' }, or { real: true }
    async function answer(p, route) {
        p.__asks++;
        const a = p.__answer;
        if (a.real) return route.continue();
        if (a.fail === 'abort') return route.abort();
        if (a.fail === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Service Unavailable"}' });
        if (a.fail === 'html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><title>Log in</title><form></form>' });
        const build = { same: p.__build, newer: p.__build + 3600, older: p.__build - 3600 }[a.build] || a.build || p.__build + 3600;
        const reply = { status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify({ build, label: 'stub' }) };
        if (a.fail === 'slow') {
            // A newer build, too late: the page gave up after 8 s of its own time
            await new Promise((done) => setTimeout(done, 3000));
            try { await route.fulfill(reply); } catch (e) { /* the page stopped waiting */ }
            return;
        }
        return route.fulfill(reply);
    }

    // Back into view, the way a phone returns to the page (a reload a timer
    // just started may take the page away under it)
    const comeBack = (p) => p.evaluate(() => { window.__setHidden(true); window.__setHidden(false); }).catch(() => {});
    // Real time for an answer to land, and for a reload to finish if one started
    async function settle(p) {
        await p.waitForTimeout(1200);
        for (let i = 0; i < 50 && p.__navs > p.__loads; i++) await p.waitForTimeout(200);
        await p.waitForLoadState('domcontentloaded').catch(() => {});
        await p.waitForTimeout(300);
    }
    // Polls the page (real time) until fn says yes, for up to ms
    async function until(p, fn, ms = 3000) {
        for (let t = 0; t < ms; t += 150) {
            if (await p.evaluate(fn).catch(() => false)) return true;
            await p.waitForTimeout(150);
        }
        return false;
    }
    // Page time moves on (Playwright's clock); back: the page then comes back into view
    async function after(p, ms, back) {
        await p.clock.fastForward(ms);
        if (back) await comeBack(p);
        await settle(p);
    }
    const press = (p, sel) => (p.__phone ? p.tap(sel) : p.click(sel));
    const look = (p) => p.evaluate(() => {
        const offer = document.getElementById('appUpdateOffer');
        const cs = getComputedStyle(offer);
        const r = offer.getBoundingClientRect();
        // What a tap at an element's middle reaches: the element, or the offer over it
        const reach = (id) => {
            const el = document.getElementById(id);
            if (!el || !el.getClientRects().length) return null;
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !!hit && el.contains(hit);
        };
        const alpha = (/rgba?\(([^)]+)\)/.exec(cs.backgroundColor) || [, ''])[1].split(',')[3];
        return {
            same: window.__marker === 1,
            offer: !offer.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0,
            offerAttr: offer.hidden ? 'hidden' : 'shown',
            offerTop: Math.round(r.top),
            // The offer, not something over it, at its middle; out of the Tab
            // and swipe order with the page (a sheet or window over it)
            offerOnTop: r.height > 0 && reach('appUpdateOffer'),
            offerInert: !!offer.closest('[inert]'),
            bg: cs.backgroundColor,
            bgAlpha: alpha === undefined ? 1 : Number(alpha),
            toasts: window.__toasts.slice(),
            np: document.body.classList.contains('m-np-open'),
            reachCollapse: reach('mNpCollapse'),
            reachKebab: reach('mNpKebab'),
            reachAvatar: reach('dvAcctBtn'),
            reachNow: reach('appUpdateNow'),
            reachLater: reach('appUpdateLater'),
            reachSearch: reach('mSearchInput'),
        };
    });
    const play = (p) => p.evaluate(() => onPlayerStateChange({ data: 1 }));
    const pause = (p) => p.evaluate(() => onPlayerStateChange({ data: 2 }));

    // ---- A: the same build ----
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const tag = vp.width <= 600 ? 'phone' : 'desktop';
        const { ctx, p } = await open({ vp });
        const early = p.__asks;
        await after(p, 31 * 1000);
        const s = await look(p);
        check(`A ${tag}: the same build: one request 30 s after opening (none before), no offer, no reload`, early === 0 && p.__asks === 1 && !s.offer && s.same && p.__loads === 1, { early, asks: p.__asks, s, loads: p.__loads });
        check(`A ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- B: a newer build at rest ----
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const tag = vp.width <= 600 ? 'phone' : 'desktop';
        const { ctx, p } = await open({ vp, answer: { build: 'newer' } });
        await after(p, 31 * 1000);
        let s = await look(p);
        check(`B ${tag}: a newer build at rest: the page reloads by itself`, p.__asks === 1 && p.__loads === 2 && !s.same, { asks: p.__asks, loads: p.__loads, s });
        // The answer is still newer than the page (an old server, the offline copy)
        await after(p, 31 * 1000);
        s = await look(p);
        check(`B ${tag}: still older after it: no second reload, the offer asks instead, no "updated" toast`, p.__asks === 2 && p.__loads === 2 && s.offer && !s.toasts.some(t => /Updated/.test(t)), { asks: p.__asks, loads: p.__loads, s });
        check(`B ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ answer: { build: 'newer' } });
        const newer = p.__build + 3600;
        // From now on the server's page is the newer build
        await p.route((url) => url.pathname === '/', async (route) => {
            if (!route.request().isNavigationRequest()) return route.continue();
            const res = await route.fetch();
            const body = (await res.text()).replace(/(<meta name="app-build" content=")\d+(">)/, `$1${newer}$2`);
            return route.fulfill({ response: res, body });
        });
        await after(p, 31 * 1000);
        await until(p, () => window.__toasts.includes('Updated to the newest version'));
        let s = await look(p);
        const build = await p.evaluate(() => Number(document.querySelector('meta[name="app-build"]').content));
        check('B phone: a reload that reaches the newer build says "Updated to the newest version" and offers nothing', p.__loads === 2 && build === newer && s.toasts.includes('Updated to the newest version') && !s.offer, { loads: p.__loads, build, newer, s });
        await after(p, 31 * 1000);
        s = await look(p);
        check('B phone: on the newer build, the next answer changes nothing', p.__loads === 2 && !s.offer && p.__asks === 2, { loads: p.__loads, asks: p.__asks, s });
        check('B phone (reaches it): errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- C: playing ----
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const tag = vp.width <= 600 ? 'phone' : 'desktop';
        const { ctx, p } = await open({ vp, answer: { build: 'newer' } });
        await play(p);
        await after(p, 31 * 1000);
        let s = await look(p);
        check(`C ${tag}: playing: no reload, the offer asks`, s.same && p.__loads === 1 && s.offer, { s, loads: p.__loads });
        if (p.__phone) {
            check('C phone: the offer sits at the top, clear of the clock', s.offerTop >= 18 && s.offerTop < 120, s.offerTop);
            // (it sits over Home's heading: nothing of it may show through)
            check('C phone: the offer is opaque', s.bgAlpha === 1, s.bg);
            await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(900);
            s = await look(p);
            check('C phone: on Now Playing it waits underneath: the chevron and ⋯ take the taps', s.np && s.offerAttr === 'shown' && !s.offer && s.reachCollapse === true && s.reachKebab === true, s);
            await p.evaluate(() => history.back()); await p.waitForTimeout(900);
            s = await look(p);
            check('C phone: Now Playing closed: the offer is back', !s.np && s.offer, s);
        } else {
            check('C desktop: the offer leaves the avatar menu free', s.reachAvatar === true, s);
        }
        await press(p, '#appUpdateLater'); await p.waitForTimeout(300);
        s = await look(p);
        check(`C ${tag}: Later hides it`, !s.offer && s.offerAttr === 'hidden', s);
        await after(p, 6 * MIN, true);
        s = await look(p);
        check(`C ${tag}: …for an hour: an answer 6 minutes later doesn't bring it back`, !s.offer && s.same, s);
        await after(p, 61 * MIN, true);
        s = await look(p);
        check(`C ${tag}: an hour later, still playing: it asks again, still no reload`, s.offer && s.same && p.__loads === 1, { s, loads: p.__loads });
        await press(p, '#appUpdateNow');
        await settle(p);
        s = await look(p);
        check(`C ${tag}: Refresh reloads, even with music on`, p.__loads === 2 && !s.same, { loads: p.__loads, s });
        check(`C ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // A narrow desktop window with the side panel open: the panel takes the
    // right 280px, where the offer's buttons are
    {
        const { ctx, p } = await open({ vp: { width: 820, height: 700 }, answer: { build: 'newer' } });
        await p.click('#dvBarQueue'); await p.waitForTimeout(600);
        await play(p);
        await after(p, 31 * 1000);
        const s = await look(p);
        const panel = await p.evaluate(() => document.documentElement.classList.contains('dv-panel'));
        check('C desktop 820px, Up next open in the side panel: the offer shows over the panel, Refresh and Later both take clicks',
            panel && s.offer && s.reachNow === true && s.reachLater === true, { panel, s });
        // A window (Settings) over it all: the offer waits under it, inert with the page
        await p.evaluate(() => showSettingsModal()); await p.waitForTimeout(500);
        const w = await look(p);
        await p.evaluate(() => hideSettingsModal()); await p.waitForTimeout(500);
        const back = await look(p);
        check('C desktop 820px: a window open: the offer waits under it, out of the Tab order; closed, it takes clicks again',
            w.offer && w.offerOnTop === false && w.offerInert && back.offer && !back.offerInert && back.reachLater === true, { w, back });
        // A song menu with no room under its row (a row mid-list, the
        // playlists to copy to in it) goes up to the top of the window, where
        // the offer is: the offer waits while it's open, so Play next takes
        // the click
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(800);
        const row = '#songList .song-list-item[data-index="5"]';
        await p.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), row); await p.waitForTimeout(200);
        await p.hover(row);
        await p.click(row + ' .song-send-btn'); await p.waitForTimeout(400);
        const menu = await p.evaluate(() => {
            const m = document.querySelector('.send-menu');
            const first = m && m.querySelector('.send-menu-item');
            if (!first) return null;
            const r = first.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { item: first.textContent.trim(), top: Math.round(r.top), offerBottom: Math.round(document.getElementById('appUpdateOffer').getBoundingClientRect().bottom), reached: !!hit && first.contains(hit) };
        });
        const menuOpen = await look(p);
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        const menuShut = await look(p);
        check('C desktop 820px: a song menu pushed up to the top: the offer waits while it is open, so Play next takes the click; closed, the offer is back and takes clicks',
            !!menu && menu.item === 'Play next' && menu.top < menu.offerBottom && menu.reached && !menuOpen.offer && menuOpen.offerAttr === 'shown'
            && menuShut.offer && menuShut.reachLater === true, { menu, menuOpen, menuShut });
        check('C desktop 820px: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- D: paused a moment ago ----
    {
        const { ctx, p } = await open({ answer: { build: 'newer' } });
        await play(p); await p.waitForTimeout(200);
        await pause(p); await p.waitForTimeout(200);
        await after(p, 2 * MIN);
        let s = await look(p);
        check('D phone: paused 2 minutes ago: the offer, no reload (the song keeps its place)', s.offer && s.same && p.__loads === 1, { s, loads: p.__loads });
        await after(p, 11 * MIN, true);
        s = await look(p);
        check('D phone: nothing played for 13 minutes, back in view: it reloads', p.__loads === 2 && !s.same, { loads: p.__loads, s });
        check('D phone: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- E: something going on ----
    {
        const { ctx, p } = await open({ answer: { build: 'newer' } });
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(900);
        await after(p, 31 * 1000);
        let s = await look(p);
        check('E phone: Now Playing open: no reload', s.same && p.__loads === 1 && p.__asks === 1, { s, loads: p.__loads, asks: p.__asks });
        await p.evaluate(() => history.back()); await p.waitForTimeout(900);
        // [what, start, then (once start has settled), end, what has to be
        // true meanwhile, whether the offer (shown) waits under it]; steps
        // take the page
        const inPage = (fn) => (pg) => pg.evaluate(fn);
        const cases = [
            ['the queue sheet open', inPage(() => openQueueModal()), null, inPage(() => hideQueueModal()),
                () => document.getElementById('queueModal').classList.contains('active'), true],
            ['a song menu open', inPage(() => showSendMenu(document.getElementById('mNpKebab'), currentSongIndex)), null, inPage(() => closeSendMenu()),
                () => !!document.querySelector('.send-menu'), true],
            // (the Search page takes focus only once it's no longer inert; a
            // key in the field, as typing is; Tab out of it, a key too)
            ['typing in Search', inPage(() => document.querySelector('#mTabs .m-tab[data-tab="search"]').click()),
                async (pg) => { await pg.evaluate(() => document.getElementById('mSearchInput').focus()); await pg.keyboard.press('ArrowRight'); },
                async (pg) => { await pg.keyboard.press('Tab'); await pg.evaluate(() => document.querySelector('#mTabs .m-tab[data-tab="home"]').click()); },
                () => document.activeElement === document.getElementById('mSearchInput')],
            ['a song edit being saved', inPage(() => { songOpInFlight = true; }), null, inPage(() => { songOpInFlight = false; }), () => songOpInFlight === true],
            // The sleep timer lives only in the page: a reload would drop it
            ['the sleep timer set to the end of the song', inPage(() => setSleepTimer('end')), null, inPage(() => clearSleepTimer()), () => sleepEndOfTrack === true],
            ['the sleep timer set to 60 minutes', inPage(() => setSleepTimer(60)), null, inPage(() => clearSleepTimer()), () => sleepDeadline > Date.now()],
        ];
        for (const [what, start, then, end, holds, under] of cases) {
            await start(p); await p.waitForTimeout(600);
            if (then) { await then(p); await p.waitForTimeout(300); }
            const asks = p.__asks;
            await after(p, 6 * MIN, true);
            s = await look(p);
            const held = await p.evaluate(holds).catch(() => false);
            check(`E phone: ${what}: no reload`, held && s.same && p.__loads === 1 && p.__asks === asks + 1, { held, s, loads: p.__loads, asks: p.__asks });
            if (under) check(`E phone: ${what}: the offer waits under it, out of reach of Tab and swipes`, s.offer && s.offerOnTop === false && s.offerInert, s);
            await end(p); await p.waitForTimeout(600);
        }
        await after(p, 6 * MIN, true);
        s = await look(p);
        check('E phone: with none of them: it reloads', p.__loads === 2 && !s.same, { loads: p.__loads, s });
        check('E phone: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ vp: { width: 1440, height: 900 }, answer: { build: 'newer' } });
        await p.click('#dvBarDeck'); await p.waitForTimeout(800);
        await after(p, 2 * MIN);
        let s = await look(p);
        check('E desktop: the turntable (Now Playing) open: no reload, the offer asks', s.same && p.__loads === 1 && s.offer, { s, loads: p.__loads });
        await p.click('#dvNpBack'); await p.waitForTimeout(800);
        await after(p, 6 * MIN, true);
        s = await look(p);
        check('E desktop: closed, untouched since: it reloads', p.__loads === 2 && !s.same, { loads: p.__loads, s });
        check('E desktop: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // Typing in Search when a newer build is announced: the offer would sit
    // over the field, so it waits until the field is left
    {
        const { ctx, p } = await open({ answer: { build: 'newer' } });
        await press(p, '#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(600);
        await press(p, '#mSearchInput'); await p.keyboard.press('ArrowRight');
        await after(p, 31 * 1000);
        let s = await look(p);
        const inField = await p.evaluate(() => document.activeElement === document.getElementById('mSearchInput'));
        check('E phone: typing in Search when a newer build is announced: no offer over the field yet, no reload', inField && !s.offer && s.same && p.__loads === 1 && p.__asks === 1, { inField, s, loads: p.__loads, asks: p.__asks });
        await p.keyboard.press('Tab'); await p.waitForTimeout(400);
        s = await look(p);
        check('E phone: the field left: the offer shows (just touched, so no reload)', s.offer && s.same && p.__loads === 1, { s, loads: p.__loads });
        // The offer up, the field in use again: it steps aside (the field
        // under it takes taps), and comes back once the field is left
        await p.evaluate(() => document.getElementById('mSearchInput').focus()); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(300);
        const typing = await look(p);
        await p.keyboard.press('Tab'); await p.waitForTimeout(400);
        const left = await look(p);
        check('E phone: the offer up, then the field in use: the offer steps aside, nothing covers the field; left, the offer is back',
            !typing.offer && typing.reachSearch === true && left.offer && left.same && p.__loads === 1, { typing, left, loads: p.__loads });
        // After Later: the field in use and left again brings nothing back
        await press(p, '#appUpdateLater'); await p.waitForTimeout(300);
        await p.evaluate(() => document.getElementById('mSearchInput').focus()); await p.waitForTimeout(300);
        await p.keyboard.press('Tab'); await p.waitForTimeout(400);
        const later = await look(p);
        check('E phone: after Later, the field in use and left again doesn\'t bring the offer back', !later.offer && later.offerAttr === 'hidden', later);
        check('E phone (typing): errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // A Spotify library import keeps going after its window closes (minutes
    // on a big library): a reload would cut it off
    {
        const { ctx, p } = await open({ answer: { build: 'newer' } });
        let chunk = null; // its first chunk, held until the check is done
        await p.route('**/spotify-library', (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'plan') {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, sources: [{ kind: 'liked', id: 'liked', name: 'Liked Songs', total: 900 }], skipped: 0 }) });
            }
            chunk = route;
        });
        // Its button and status line (the window shows them with Spotify set up)
        await p.evaluate(() => {
            const btn = document.createElement('button');
            const status = document.createElement('div');
            document.body.append(btn, status);
            runSpotifyLibraryImport({ action: 'plan' }, btn, status);
        });
        for (let i = 0; i < 30 && !chunk; i++) await p.waitForTimeout(100);
        await after(p, 31 * 1000);
        let s = await look(p);
        check('E phone: a Spotify library import going, its window closed: no reload, the offer asks', !!chunk && s.same && p.__loads === 1 && p.__asks === 1 && s.offer, { chunk: !!chunk, s, loads: p.__loads, asks: p.__asks });
        // The chunk fails: the import stops there (and doesn't reload by itself)
        if (chunk) await chunk.abort().catch(() => {}); // (gone with a reload)
        await p.waitForTimeout(500);
        await after(p, 6 * MIN, true);
        s = await look(p);
        check('E phone: the import stopped: it reloads', p.__loads === 2 && !s.same, { loads: p.__loads, s });
        check('E phone (import): errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- F: answers that don't count ----
    {
        const { ctx, p } = await open({ answer: { build: 'older' } });
        await after(p, 31 * 1000);
        let s = await look(p);
        check('F phone: an older build (a server the deploy hasn\'t reached): nothing happens', p.__asks === 1 && !s.offer && s.same, { asks: p.__asks, s });
        for (const fail of ['503', 'html', 'abort']) {
            p.__answer = { fail };
            const asks = p.__asks;
            await after(p, 6 * MIN, true);
            s = await look(p);
            check(`F phone: ${fail === 'html' ? 'a page instead of JSON' : fail === 'abort' ? 'a failed request' : 'a 503'}: nothing happens`, p.__asks === asks + 1 && !s.offer && s.same, { asks: p.__asks, s });
        }
        p.__answer = { fail: 'slow' };
        const asks = p.__asks;
        await p.clock.fastForward(6 * MIN);
        await comeBack(p);
        for (let i = 0; i < 20 && p.__asks === asks; i++) await p.waitForTimeout(100);
        await p.clock.fastForward(9000); // the page's 8 s
        await p.waitForTimeout(4000); // past the stub's late answer
        s = await look(p);
        check('F phone: no answer within 8 s: it stops waiting, nothing happens (not even when it comes late)', p.__asks === asks + 1 && !s.offer && s.same && p.__loads === 1, { asks: p.__asks, s, loads: p.__loads });
        p.__answer = { build: 'same' };
        await after(p, 6 * MIN, true);
        check('F phone: the next return into view asks again', p.__asks === asks + 2, { asks: p.__asks });
        check('F phone: no page errors from any of them', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- G: offline, then online ----
    {
        const { ctx, p } = await open({ answer: { build: 'newer' } });
        await ctx.setOffline(true);
        await after(p, 31 * 1000);
        await comeBack(p); await p.waitForTimeout(500);
        let s = await look(p);
        check('G phone: offline: no request, no reload', p.__asks === 0 && s.same && !s.offer, { asks: p.__asks, s });
        await ctx.setOffline(false);
        await settle(p);
        s = await look(p);
        check('G phone: back online: one request, then a reload at rest', p.__asks === 1 && p.__loads === 2 && !s.same, { asks: p.__asks, loads: p.__loads, s });
        check('G phone: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- H: brought back by Back ----
    {
        const { ctx, p } = await open();
        const before = p.__asks;
        await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await p.waitForTimeout(800);
        const first = p.__asks;
        await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
        await p.waitForTimeout(800);
        check('H phone: back from the back/forward cache it asks at once, and not again within 30 s', before === 0 && first === 1 && p.__asks === 1, { before, first, after: p.__asks });
        check('H phone: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- I: nothing in between keeps an answer ----
    {
        const { ctx, p } = await open({ sw: true });
        const controlled = await p.evaluate(() => new Promise((done) => {
            if (!('serviceWorker' in navigator)) return done(false);
            if (navigator.serviceWorker.controller) return done(true);
            navigator.serviceWorker.addEventListener('controllerchange', () => done(true));
            setTimeout(() => done(!!navigator.serviceWorker.controller), 8000);
        }));
        const ask = () => p.evaluate(() => fetch('/version', { cache: 'no-store' }).then(r => r.json()).then(j => j.build));
        p.__answer = { build: p.__build + 100 };
        const one = await ask();
        p.__answer = { build: p.__build + 200 };
        const two = await ask();
        const kept = await p.evaluate(async () => {
            const found = [];
            for (const name of await caches.keys()) {
                if (await (await caches.open(name)).match('/version', { ignoreSearch: true })) found.push(name);
            }
            return found;
        });
        check('I phone: with the service worker: two answers in a row, two builds, and no cache holds /version', controlled && one === p.__build + 100 && two === p.__build + 200 && kept.length === 0, { controlled, one, two, kept });
        check('I phone: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- J: the version line ----
    for (const vp of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
        const tag = vp.width <= 600 ? 'phone' : 'desktop';
        const { ctx, p } = await open({ vp, answer: { real: true } });
        const server = await p.evaluate(() => fetch('/version').then(async (r) => ({ ok: r.ok, cache: r.headers.get('Cache-Control'), body: await r.json() })));
        check(`J ${tag}: /version is the server's build (the page's own here), never stored`, server.ok && server.body.build === p.__build && /no-store/.test(server.cache || '') && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/.test(server.body.label), server);
        // center: scrolled to the middle of its scroller first
        const line = (id, center) => p.evaluate(({ id, center }) => {
            const el = document.getElementById(id);
            if (!el) return null;
            if (center) el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { text: el.textContent.trim(), shown: el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden', onTop: !!hit && el.contains(hit), bottom: r.bottom };
        }, { id, center });
        const want = 'Version ' + server.body.label;
        if (p.__phone) {
            await p.tap('#mAvatarBtn'); await p.waitForTimeout(800);
            // Scrolled all the way down, as in step9-check's Y18
            await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(300);
            const you = await line('mYouVersion', false);
            const bars = await p.evaluate(() => {
                const dock = document.getElementById('mDock');
                const tabs = document.getElementById('mTabs').getBoundingClientRect();
                const shown = getComputedStyle(dock).visibility !== 'hidden' && dock.getBoundingClientRect().height > 0;
                return { dockTop: shown ? dock.getBoundingClientRect().top : Infinity, tabsTop: tabs.top };
            });
            check('J phone: the You page ends with the version, under Log out and clear of the mini player', !!you && you.text === want && you.shown && you.onTop && you.bottom <= Math.min(bars.dockTop, bars.tabsTop), { you, want, bars });
            await p.tap('#mYouPage [data-m-you="account"]'); await p.waitForTimeout(800);
        } else {
            await p.click('#dvAcctBtn'); await p.waitForTimeout(300);
            await p.click('[data-dv-acct="account"]'); await p.waitForTimeout(800);
        }
        const settings = await line('settingsVersion', true);
        check(`J ${tag}: Settings → Account ends with the same version`, !!settings && settings.text === want && settings.shown && settings.onTop, { settings, want });
        check(`J ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 1500)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
