// Desktop step 12: the cleanup. Markup and CSS that no layout showed any
// more are gone, and everything the other layouts still use is kept.
//   A. Gone everywhere (desktop 1440x900, 1024x768, 800x600, a portrait
//      phone, a short landscape phone and the app): the room's scenery
//      (walls, lights, clock, speakers, plant...; only .room-bg's vignette
//      is left), the room's right side (the VINYLS crate, #crateRecords,
//      the cat), the player view's aurora orbs and groove background, the
//      deck's strobe dots, rubber mat and feet, and the song rows' groove
//      and hole. No stylesheet rule mentions any of them, and the two
//      unused volume helpers are gone. updateCrateRecords stays, as the
//      hook other views wrap.
//   B. Kept for the app (?app=1, 1440x900 and 1024x768): the crate's left
//      rail (mini turntable, display, loop/shuffle/crackle/gif/sleep), the
//      old toolbar's Search, which opens the library search window
//      (#searchModal), the sidebar's collapse handle, the marquee clones
//      and the deck on the player view.
//   C. Kept for the short landscape phone shell (844x390 touch): Search
//      opens #searchModal there too, and its Home and playlist views show.
//   D. The desktop (html.dv2) still sends Search to its Search page and
//      hides the rail, and no layout logs a page error.
// Writes to /save-music are faked and recorded (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

const GONE = ['room-wall', 'room-floor', 'floor-rug', 'wall-art', 'wall-poster', 'wall-shelf', 'wall-clock',
    'string-lights', 'hanging-lights', 'dust-particles', 'ambient-overlay', 'floor-speaker', 'floor-records',
    'floor-plant', 'room-right', 'vinyl-crate-decor', 'crate-box', 'crate-records', 'crate-record', 'crate-label',
    'cat-silhouette', 'aurora-orbs', 'aurora-orb', 'vinyl-groove-bg', 'strobe-dots', 'rubber-mat', 'deck-foot',
    'song-list-vinyl-groove', 'song-list-vinyl-hole', 'coffee-mug', 'mug-steam', 'section-hidden', 'stat-chip'];

(async () => {
    const b = await L.launch();

    async function open(opts = {}) {
        const vp = opts.vp || { width: 1440, height: 900 };
        const phone = !!opts.phone;
        const ctx = await b.newContext({ viewport: vp, isMobile: phone, hasTouch: phone, storageState: L.state(opts.acct || 'mid') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|lrclib\.net/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.raw) return { ctx, p };
        await p.evaluate(() => {
            const stub = { _s: 5, _t: 0, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); };
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
        });
        return { ctx, p };
    }

    // What's left of the removed markup and CSS, and whether the views render
    const survey = (p) => p.evaluate((gone) => {
        const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const present = gone.filter((c) => document.querySelector('.' + c));
        const rules = [];
        const re = new RegExp('[.#](' + gone.concat(['crateRecords']).join('|') + ')(?![\\w-])');
        const walk = (list) => { for (const r of list) { if (r.cssRules && !r.selectorText) walk(r.cssRules); else if (r.selectorText && re.test(r.selectorText)) rules.push(r.selectorText); } };
        for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (e) { /* cross-origin */ } }
        const bg = document.querySelector('#vinylCrateView .room-bg');
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            app: document.documentElement.classList.contains('app-shell'),
            present, rules: rules.slice(0, 10),
            crateRecords: !!document.getElementById('crateRecords'),
            roomBg: !!bg && bg.children.length === 0,
            hook: typeof window.updateCrateRecords === 'function',
            helpers: [typeof window.adjustVolume, typeof window.angleToVol],
            rail: shown(document.querySelector('#vinylCrateView .room-left')),
            miniDeck: shown(document.querySelector('#vinylCrateView .mini-turntable')),
            railBtns: ['loopCoaster', 'shuffleBtn', 'crackleBtn', 'makeGifBtn', 'sleepBtn'].filter((id) => shown(document.getElementById(id))).length,
            searchBtn: shown(document.querySelector('#vinylCrateView .crate-search-btn')),
            crate: shown(document.getElementById('vinylCrateView')),
            dupes: document.querySelectorAll('#recordsConveyor .conveyor-dupes').length,
        };
    }, GONE);
    const songRows = (p) => p.evaluate(() => ({
        rows: document.querySelectorAll('#songList .song-list-item').length,
        shownRows: [...document.querySelectorAll('#songList .song-list-item')].filter((r) => r.getClientRects().length > 0).length,
        vinyls: document.querySelectorAll('#songList .song-list-vinyl').length,
        leftovers: document.querySelectorAll('.song-list-vinyl-groove, .song-list-vinyl-hole').length,
        deck: (() => { const d = document.querySelector('#musicPlayerView .record-player'); return !!d && d.getClientRects().length > 0; })(),
        sidebar: (() => { const s = document.getElementById('musicSidebar'); return !!s && s.getClientRects().length > 0; })(),
        collapse: (() => { const c = document.getElementById('sidebarCollapseBtn'); return !!c && c.getClientRects().length > 0 && getComputedStyle(c).visibility !== 'hidden'; })(),
    }));

    // ---- A + D: every layout ----
    const LAYOUTS = [
        { tag: 'desktop 1440x900', vp: { width: 1440, height: 900 }, desk: true },
        { tag: 'desktop 1024x768', vp: { width: 1024, height: 768 }, desk: true },
        { tag: 'desktop 800x600', vp: { width: 800, height: 600 }, desk: true },
        { tag: 'phone 390x844', vp: { width: 390, height: 844 }, phone: true },
        { tag: 'landscape 844x390', vp: { width: 844, height: 390 }, phone: true },
        { tag: 'app 1440x900', vp: { width: 1440, height: 900 }, query: '?app=1', app: true },
        { tag: 'app 1024x768', vp: { width: 1024, height: 768 }, query: '?app=1', app: true },
        { tag: 'app 390x844', vp: { width: 390, height: 844 }, phone: true, query: '?app=1' },
    ];
    for (const l of LAYOUTS) {
        const { ctx, p } = await open(l);
        const s = await survey(p);
        check(`A ${l.tag}: the removed markup is gone (only .room-bg's empty vignette box is left)`, s.present.length === 0 && !s.crateRecords && s.roomBg, s);
        check(`A ${l.tag}: no stylesheet rule targets the removed classes`, s.rules.length === 0, s.rules);
        check(`A ${l.tag}: updateCrateRecords is still a hook; the unused volume helpers are gone`, s.hook && s.helpers.every((t) => t === 'undefined'), s);
        // Re-render the song rows (and run the hook) the way a playlist change does
        await p.evaluate(() => { openPlayerView(); rebuildSongList(); updateCrateRecords(); });
        await p.waitForTimeout(700);
        const r = await songRows(p);
        check(`A ${l.tag}: rebuilt song rows keep their cover box and lose the groove and hole`, r.rows > 0 && r.vinyls === r.rows && r.leftovers === 0, r);
        if (l.desk) {
            check(`D ${l.tag}: the desktop hides the rail and the old toolbar's Search`, s.dv2 && !s.rail && !s.searchBtn, s);
        }
        if (l.app) {
            check(`B ${l.tag}: the app keeps the crate's left rail (mini turntable and its five buttons) and the toolbar's Search`, s.app && !s.dv2 && s.rail && s.miniDeck && s.railBtns === 5 && s.searchBtn, s);
            check(`B ${l.tag}: the app keeps the marquee clones`, s.dupes > 0, s);
            check(`B ${l.tag}: the app's player view shows the deck, the song list and the collapse handle`, r.deck && r.sidebar && r.shownRows > 0 && r.collapse, r);
        }
        check(`D ${l.tag}: no page errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- B: the app's Search opens the library search window ----
    {
        const { ctx, p } = await open({ vp: { width: 1440, height: 900 }, query: '?app=1' });
        await p.click('#vinylCrateView .crate-search-btn');
        await p.waitForTimeout(400);
        const st = await p.evaluate(() => ({
            modal: document.getElementById('searchModal').classList.contains('active'),
            page: document.documentElement.classList.contains('dv-search'),
            input: document.activeElement && document.activeElement.id,
        }));
        check('B app 1440x900: the toolbar\'s Search opens #searchModal (not the desktop Search page)', st.modal && !st.page, st);
        await p.evaluate(() => hideSearchModal());
        check('B app 1440x900: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- C: the short landscape phone shell ----
    {
        const { ctx, p } = await open({ vp: { width: 844, height: 390 }, phone: true });
        const s = await survey(p);
        check('C landscape 844x390: the shell (no dv2, not the app) shows Home', !s.dv2 && !s.app && s.crate, s);
        await p.evaluate(() => showSearchModal());
        await p.waitForTimeout(400);
        const st = await p.evaluate(() => ({ modal: document.getElementById('searchModal').classList.contains('active'), page: document.documentElement.classList.contains('dv-search') }));
        check('C landscape 844x390: Search opens #searchModal', st.modal && !st.page, st);
        await p.evaluate(() => hideSearchModal());
        await p.evaluate(() => openPlayerView());
        await p.waitForTimeout(700);
        const r = await songRows(p);
        check('C landscape 844x390: the playlist view shows its song rows', r.sidebar && r.shownRows > 0, r);
        check('C landscape 844x390: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- D: the desktop still sends Search to its Search page ----
    {
        const { ctx, p } = await open({ vp: { width: 1440, height: 900 } });
        await p.evaluate(() => showSearchModal());
        await p.waitForTimeout(400);
        const st = await p.evaluate(() => ({ modal: document.getElementById('searchModal').classList.contains('active'), page: document.documentElement.classList.contains('dv-search') }));
        check('D desktop 1440x900: Search opens the Search page, never #searchModal', !st.modal && st.page, st);
        check('D desktop 1440x900: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 1500)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
