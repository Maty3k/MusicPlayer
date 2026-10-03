// Desktop step 11: the review fixes, the visual polish and the motion, at
// 1440x900 (800x600 and a 1024x768 touch tablet where noted).
//   A. The review fixes: (1) a touch tablet shows a song row's ♥, ⋯, × and
//      handle (no hover there); (2) Up next's "Next from" starts where Next
//      goes while a queued or radio song plays; (3) the bar stays when a
//      preview is paused with the playing list empty; (4) a pasted Apple
//      Music list keeps numeric titles ("1979"), read by column position;
//      (5) one desktop menu open at a time; (6) leaving the short landscape
//      phone shell for the desktop without crossing 600px closes the phone
//      queue window; (7) clicking the playlist already on screen doesn't
//      fetch it again (no flicker, the scroll stays); (8) moving through the
//      song rows touches only the two rows whose Tab stop changes.
//   B. Polish: the type scale, the Play button's contrasting (cream) focus
//      ring, the column labels' band under the avatar on a scrolled
//      playlist, Home's greeting wrapping instead of cutting off, the
//      windows as cards with pill tabs, thin scrollbars.
//   C. Motion: the page fade-and-rise, the staggered fade-in of a page's
//      first rows and cards (first render only), menus, the side panel,
//      windows, the play icon, the seek bar's glide, the ♥ pop, the pressed
//      bounce, the platter's spin-up and spin-down, the tonearm and Now
//      Playing's backdrop cross-fade: present by default, between 100 and
//      350ms, on transform/opacity, and none at all with reduced motion.
//      Nothing shifts once they end (rects stable, and the same as with
//      reduced motion) and a row can be clicked while its page fades in.
//   D. axe on every page, menu and window in every room theme; and a
//      window whose content scrolls (Your listening with CI's stats, every
//      window in a short 1024x540 window) keeps that content reachable by
//      the keyboard (axe scrollable-region-focusable).
//   E. Phones (390x844, 844x390) and the app (?app=1) get none of it.
// Writes to /save-music are faked and recorded (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const AXE = require.resolve('axe-core/axe.min.js', { paths: [L.ROOT] });
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - First Find', channel: 'Band One', thumbnail: '' },
    { videoId: 'bbbbbbbbbb2', title: 'Second Find', channel: 'Someone', thumbnail: '' },
];
const THEMES = ['blue-hour', 'golden-hour', 'after-hours', 'velvet', 'greenroom'];
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();

    async function open(opts = {}) {
        const vp = opts.vp || { width: 1440, height: 900 };
        const phone = !!opts.phone;
        const ctx = await b.newContext({
            viewport: vp, isMobile: phone, hasTouch: phone,
            reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
            storageState: L.state(opts.acct || 'mid'),
        });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|lrclib\.net/, r => r.abort());
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) }));
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.raw) return { ctx, p };
        await p.evaluate(() => {
            // A stub player at 0:30 of 3:20; record what plays
            const stub = { _s: 5, _t: 30, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo(t) { this._t = t; }, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return this._t; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); if (!cue) window.__played.push(s && s.title); };
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            playQueue = []; afterQueueChange();
        });
        return { ctx, p };
    }
    // ---- end open

    async function axeScan(p) {
        await p.addScriptTag({ path: AXE }).catch(() => {});
        return p.evaluate(async () => {
            const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
            return res.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        });
    }
    // Waits for a condition in the page (CI is slower than a laptop)
    const until = async (p, fn, arg, ms = 4000) => {
        try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); return true; } catch (e) { return false; }
    };
    const home = async (p) => {
        await p.evaluate(() => { if (window.dvNowPlaying) window.dvNowPlaying.close(); if (window.dvSearch) window.dvSearch.close(); if (document.getElementById('musicPlayerView').classList.contains('active')) showPlaylistPicker(); });
        await p.waitForTimeout(600);
    };
    // Playlists picked by what they hold (the seeded data differs from a laptop's)
    const listWith = (p, min, notPlaying = true) => p.evaluate(([min, notPlaying]) => Object.keys(playlistsMeta)
        .filter((k) => k !== 'favorites' && (!notPlaying || k !== String(activePlaylistId)) && (playlistsMeta[k].songCount || 0) >= min)
        .sort((a, z) => playlistsMeta[z].songCount - playlistsMeta[a].songCount)[0] || null, [min, notPlaying]);
    const openList = async (p, id) => {
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await until(p, (i) => String(listId()) === String(i) && !listLoading() && document.querySelectorAll('#songList .song-list-item:not(.discover-item):not(.radio-song-item)').length > 0, id, 6000);
        await p.waitForTimeout(500);
    };
    const openNp = async (p) => { await p.click('#dvBarDeck'); await p.waitForTimeout(700); };
    // A colour as the page computes it
    const colorOf = (p, v) => p.evaluate((v) => { const d = document.createElement('i'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, v);
    const rectOf = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }, sel);
    const overlap = (a, z) => !!a && !!z && a.l < z.r - 0.5 && z.l < a.r - 0.5 && a.t < z.b - 0.5 && z.t < a.b - 0.5;
    // ms from a computed duration list ("0.22s, 150ms")
    const msOf = (s) => String(s || '').split(',').map((x) => x.trim()).map((x) => (x.endsWith('ms') ? parseFloat(x) : parseFloat(x) * 1000));

    // ======== A. The review fixes ========

    // ---- A1. A touch tablet (no hover): a row's ♥, ⋯, × and handle show
    {
        const { ctx, p } = await open({ vp: { width: 1024, height: 768 } });
        const id = await listWith(p, 2);
        const look = () => p.evaluate(() => {
            const row = document.querySelector('#songList .song-list-item:not(.discover-item):not(.radio-song-item):not(.active)');
            const op = (sel) => { const el = row && row.querySelector(sel); return el ? Number(getComputedStyle(el).opacity) : null; };
            return { hoverNone: matchMedia('(hover: none)').matches, dv2: document.documentElement.classList.contains('dv2'), fav: op('.song-fav-btn:not(.is-fav)'), more: op('.song-send-btn'), del: op('.song-delete-btn'), grab: op('.song-drag-handle') };
        });
        await openList(p, id);
        await p.mouse.move(2, 2);
        const mouse = await look();
        const cdp = await ctx.newCDPSession(p);
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await p.waitForTimeout(400);
        const touch = await look();
        // (a liked ♥ shows anyway: only the ones that would hide count)
        const shownAll = (s) => [s.more, s.del, s.grab].every((x) => x === 1) && (s.fav === null || s.fav === 1);
        check('A1 a mouse: a row\'s ⋯, × and handle wait for hover', !mouse.hoverNone && mouse.more === 0 && mouse.grab === 0, mouse);
        check('A1 a touch tablet (hover: none, still the desktop layout): a row\'s ♥, ⋯, × and handle show', touch.hoverNone && touch.dv2 && shownAll(touch), touch);
        check('A1 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A2. "Next from": where Next goes, also while a radio/queued song plays
    {
        const { ctx, p } = await open({});
        const id = await listWith(p, 4);
        await openList(p, id);
        await p.click('#songList .song-list-item[data-index="1"]');
        await until(p, (i) => String(activePlaylistId) === String(i) && currentSongIndex === 1 && !isChangingSong, id, 6000);
        await home(p);
        const probe = (radio) => p.evaluate(async (radio) => {
            shuffleMode = 'off'; loopMode = 'playlist';
            currentRowUnloaded = false;
            currentRadioSong = radio ? { title: 'A radio song', artist: 'Someone', youtube_id: 'radioRadio1', cover: '' } : null;
            window.dvSidePanel.open('queue');
            renderQueue();
            const first = document.querySelector('#dvPanel .dv-nf-row');
            const shown = first ? parseInt(first.dataset.nfIndex, 10) : null;
            // What Next would play (recorded, not played)
            const orig = window.switchSong;
            let next = null;
            window.switchSong = (i) => { next = i; };
            try { nextSong(); } finally { window.switchSong = orig; }
            songHistory.pop();
            const at = currentSongIndex;
            currentRadioSong = null;
            return { shown, next, at };
        }, radio);
        const plain = await probe(false);
        const radio = await probe(true);
        check('A2 a list song playing: "Next from" starts at the song Next plays (the row after it)', plain.shown === plain.next && plain.next === plain.at + 1, plain);
        check('A2 a radio or queued song playing: "Next from" starts at the song Next plays (not one early)', radio.shown === radio.next && radio.next === radio.at + 1, radio);
        check('A2 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A3. A paused preview keeps the bar when the playing list is empty
    {
        const { ctx, p } = await open({ acct: 'demo' });
        const bar = () => p.evaluate(() => ({ bar: document.documentElement.classList.contains('dv2-bar'), songs: songsData.filter((s) => s && s.title).length, playing: document.getElementById('vinyl').classList.contains('playing') }));
        const s0 = await bar();
        await p.evaluate(() => playRadioSong({ title: 'A preview', artist: 'Someone', youtube_id: 'previewVid1', cover: '' }));
        await until(p, () => !!currentRadioSong);
        await p.evaluate(() => document.getElementById('vinyl').classList.add('playing'));
        await p.waitForTimeout(200);
        const s1 = await bar();
        await p.evaluate(() => document.getElementById('vinyl').classList.remove('playing'));
        await p.waitForTimeout(300);
        const s2 = await bar();
        check('A3 an empty playing list: no bar until something plays', s0.songs === 0 && !s0.bar, s0);
        check('A3 a preview playing: the bar shows; paused, it stays (its only transport)', s1.bar && !s2.playing && s2.bar, { s1, s2 });
        check('A3 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A4. A pasted Apple Music list keeps numeric titles (shared code: the phone too)
    for (const c of [{ tag: 'desktop' }, { tag: 'phone 390x844', vp: { width: 390, height: 844 }, phone: true }]) {
        const { ctx, p } = await open(c);
        const parsed = await p.evaluate(() => typeof parsePasteLine !== 'function' ? 'no parsePasteLine' : [
            '1979\t4:26\tThe Smashing Pumpkins\tMellon Collie',
            '22\t3:52\tTaylor Swift\tRed',
            '3\tSong Name\t3:24\tSome Artist\tAn Album',
            'Another Song\tAnother Artist\tAnother Album\t2:58',
            'Laufey – From the Start',
            'Just a title',
        ].map((l) => { const x = parsePasteLine(l); return x.title + ' | ' + x.artist; }));
        const want = ['1979 | The Smashing Pumpkins', '22 | Taylor Swift', 'Song Name | Some Artist', 'Another Song | Another Artist', 'From the Start | Laufey', 'Just a title | '];
        check(`A4 ${c.tag}: tab-separated columns read by position (numeric titles kept; a leading track number and the time go); "Artist – Title" lines as before`, JSON.stringify(parsed) === JSON.stringify(want), { parsed, want });
        if (!c.phone) {
            await p.evaluate(() => { showSpotifyImportModal(); setImportTab('paste'); });
            await p.waitForTimeout(400);
            await p.fill('#pasteImportInput', '1979\t4:26\tThe Smashing Pumpkins\tMellon Collie\n22\t3:52\tTaylor Swift\tRed');
            await p.evaluate(() => resolvePasteList());
            await until(p, () => Array.isArray(importSelection) && importSelection.length === 2 && document.querySelectorAll('#spotifyImportTracks .import-track-title').length === 2, null, 8000);
            const titles = await p.evaluate(() => [...document.querySelectorAll('#spotifyImportTracks .import-track-title')].map((t) => t.textContent.trim()));
            check('A4 the paste list\'s review shows the numeric titles', titles.join(',') === '1979,22', titles);
        }
        check(`A4 ${c.tag} errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A5. One menu at a time (opening one closes the others)
    {
        const { ctx, p } = await open({});
        const openMenus = () => p.evaluate(() => {
            const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
            return [['acct', 'dvAcctPop'], ['add', 'dvSideAddMenu'], ['sleep', 'dvBarSleepMenu'], ['pl', 'dvPlMenu'], ['np', 'dvNpMenu']]
                .filter(([, id]) => shown(document.getElementById(id))).map(([n]) => n)
                .concat(document.querySelector('.send-menu') ? ['row'] : []);
        });
        const steps = {};
        await p.click('#dvAcctBtn'); await p.waitForTimeout(200); steps.acct = await openMenus();
        await p.click('#dvSideAdd'); await p.waitForTimeout(200); steps.add = await openMenus();
        await p.click('#dvBarSleep'); await p.waitForTimeout(200); steps.sleep = await openMenus();
        await p.click('#dvAcctBtn'); await p.waitForTimeout(200); steps.acct2 = await openMenus();
        await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        await openList(p, await listWith(p, 1));
        await p.click('#dvPlMore'); await p.waitForTimeout(200); steps.pl = await openMenus();
        await p.hover('#songList .song-list-item[data-index="0"]');
        await p.click('#songList .song-list-item[data-index="0"] .song-send-btn'); await p.waitForTimeout(250); steps.row = await openMenus();
        await p.click('#dvAcctBtn'); await p.waitForTimeout(200); steps.acct3 = await openMenus();
        await p.click('#dvPlMore'); await p.waitForTimeout(200); steps.pl2 = await openMenus();
        await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        await openNp(p);
        await p.click('#dvNpMore'); await p.waitForTimeout(200); steps.np = await openMenus();
        await p.click('#dvBarSleep'); await p.waitForTimeout(200); steps.sleep2 = await openMenus();
        const want = { acct: ['acct'], add: ['add'], sleep: ['sleep'], acct2: ['acct'], pl: ['pl'], row: ['row'], acct3: ['acct'], pl2: ['pl'], np: ['np'], sleep2: ['sleep'] };
        check('A5 opening a menu closes the one that was open (avatar, +, sleep, playlist ⋯, a row\'s ⋯, Now Playing ⋯)', JSON.stringify(steps) === JSON.stringify(want), steps);
        check('A5 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A6. The short landscape shell to the desktop without crossing 600px
    {
        const { ctx, p } = await open({ vp: { width: 900, height: 450 }, phone: true });
        const s0 = await p.evaluate(() => ({ dv2: document.documentElement.classList.contains('dv2') }));
        await p.evaluate(() => window.openQueueModal()); await p.waitForTimeout(500);
        const s1 = await p.evaluate(() => ({ queue: document.getElementById('queueModal').classList.contains('active') }));
        await p.setViewportSize({ width: 900, height: 700 });
        await until(p, () => document.documentElement.classList.contains('dv2'));
        await p.waitForTimeout(600);
        const s2 = await p.evaluate(() => ({ dv2: document.documentElement.classList.contains('dv2'), queue: document.getElementById('queueModal').classList.contains('active'), inert: document.getElementById('music-section').inert }));
        check('A6 900x450 touch is the phone shell; its queue window opens', !s0.dv2 && s1.queue, { s0, s1 });
        check('A6 grown to 900x700 (the desktop, 600px never crossed): the queue window is closed, the page not left inert', s2.dv2 && !s2.queue && !s2.inert, s2);
        check('A6 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A7. The playlist already on screen: no refetch, no flicker, the scroll stays
    {
        const { ctx, p } = await open({});
        const id = await listWith(p, 1);
        await openList(p, id);
        await p.evaluate(() => {
            const sb = document.getElementById('musicSidebar');
            sb.scrollTop = Math.min(200, sb.scrollHeight - sb.clientHeight);
            document.querySelectorAll('#songList .song-list-item').forEach((r) => { r.dataset.mark = '1'; });
        });
        await p.waitForTimeout(200);
        const before = await p.evaluate(() => ({ scroll: document.getElementById('musicSidebar').scrollTop }));
        const gets = p.__posts.filter((x) => x.action === 'getPlaylist').length;
        await p.click(`#dvSideList .dv-side-pl[data-playlist="${id}"]`);
        await p.waitForTimeout(800);
        const after = await p.evaluate(() => ({
            scroll: document.getElementById('musicSidebar').scrollTop,
            kept: [...document.querySelectorAll('#songList .song-list-item')].every((r) => r.dataset.mark === '1'),
            loading: listLoading(),
        }));
        const gets2 = p.__posts.filter((x) => x.action === 'getPlaylist').length;
        check('A7 clicking the playlist already on screen: no new fetch, the rows stay (no flicker), the scroll stays', gets2 === gets && after.kept && !after.loading && Math.abs(after.scroll - before.scroll) < 1, { gets, gets2, before, after });
        check('A7 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- A8. Moving through the rows rewrites only the two rows' Tab stops
    {
        const { ctx, p } = await open({});
        const id = await listWith(p, 4);
        await openList(p, id);
        await p.focus('#songList .song-list-item[data-index="0"]');
        await p.waitForTimeout(200);
        await p.evaluate(() => {
            window.__touched = [];
            window.__mo = new MutationObserver((recs) => {
                const rows = new Set();
                recs.forEach((r) => { const row = r.target.closest && r.target.closest('.song-list-item'); if (row) rows.add(row.dataset.index); });
                window.__touched.push([...rows]);
            });
            window.__mo.observe(document.getElementById('songList'), { attributes: true, attributeFilter: ['tabindex'], subtree: true });
        });
        for (let i = 0; i < 3; i++) { await p.keyboard.press('ArrowDown'); await p.waitForTimeout(120); }
        const s = await p.evaluate(() => {
            window.__mo.disconnect();
            const rows = [...document.querySelectorAll('#songList .song-list-item:not(.discover-item):not(.radio-song-item)')];
            return {
                touched: [...new Set(window.__touched.flat())],
                focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.index : null,
                stops: rows.filter((r) => r.tabIndex === 0).map((r) => r.dataset.index),
                rows: rows.length,
            };
        });
        check('A8 three ↓ presses: only the rows gaining and losing the Tab stop change (0-3), one row in the Tab order, the focused one', s.focus === '3' && s.stops.join() === '3' && s.touched.every((x) => ['0', '1', '2', '3'].includes(x)) && s.touched.length <= 4, s);
        check('A8 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ======== B. Polish ========
    {
        const { ctx, p } = await open({});
        const cream = await colorOf(p, 'var(--cream)');
        const amber = await colorOf(p, 'var(--amber)');
        const tokens = await p.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            return ['--dv-text-sm', '--dv-text-md', '--dv-text-lg', '--dv-text-h2', '--dv-r-md', '--dv-r-lg', '--dv-shadow-pop', '--dv-mid'].map((k) => cs.getPropertyValue(k).trim());
        });
        check('B the desktop\'s type scale, radii, shadows and timings are defined', tokens.every(Boolean), tokens);
        const scale = await p.evaluate(() => {
            const fs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e).fontSize : null; };
            return { section: fs('#vinylCrateView .recent-songs-label'), card: fs('#vinylCrateView .card-caption-title'), meta: fs('#vinylCrateView .card-caption-meta'), side: fs('#dvSide .dv-side-name') };
        });
        check('B the type scale in use (sections 22px, card titles 15px, meta 13px, sidebar names 14px)', scale.section === '22px' && scale.card === '15px' && scale.meta === '13px' && scale.side === '14px', scale);

        // The Play button: a cream ring, clear of it (an amber one vanished into it)
        const id = await listWith(p, 25) || await listWith(p, 1);
        await openList(p, id);
        await p.focus('#dvPlShuffle'); await p.keyboard.press('Shift+Tab'); // (by the keyboard: :focus-visible)
        await p.waitForTimeout(150);
        const ring = await p.evaluate(() => { const a = document.activeElement; const c = getComputedStyle(a); return { id: a.id, style: c.outlineStyle, width: parseFloat(c.outlineWidth), color: c.outlineColor, offset: parseFloat(c.outlineOffset), bg: c.backgroundColor }; });
        check('B the Play button\'s focus ring is cream (not amber on amber), 2px, 3px out', ring.id === 'dvPlPlay' && ring.style === 'solid' && ring.width >= 2 && ring.color === cream && ring.offset >= 3 && ring.bg === amber, { ring, cream, amber });

        // A long list scrolled: the column labels stick under a band; the avatar sits in it
        await p.evaluate(() => { const sb = document.getElementById('musicSidebar'); sb.scrollTop = sb.scrollHeight; });
        await p.waitForTimeout(400);
        const stick = await p.evaluate(() => {
            const sb = document.getElementById('musicSidebar'), c = document.getElementById('dvPlCols');
            const top = parseFloat(getComputedStyle(c).top);
            const cr = c.getBoundingClientRect(), sr = sb.getBoundingClientRect();
            const a = document.getElementById('dvAcctBtn').getBoundingClientRect();
            const labels = [...c.children].filter((x) => x.getClientRects().length).map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; });
            return {
                canScroll: sb.scrollHeight - sb.clientHeight > c.offsetTop,
                stuck: c.classList.contains('is-stuck'), at: cr.top - sr.top - sb.clientTop, top,
                band: Number(getComputedStyle(c, '::before').opacity),
                avatar: { l: a.left, t: a.top, r: a.right, b: a.bottom }, labels, colsTop: cr.top,
            };
        });
        const clear = stick.labels.every((x) => !overlap(x, stick.avatar)) && stick.avatar.b <= stick.colsTop + 0.5;
        check('B a scrolled playlist: the column labels stick below a band, the avatar in the band clear of them', !stick.canScroll || (stick.stuck && stick.band === 1 && Math.abs(stick.at - stick.top) < 2 && clear), stick);
        await p.evaluate(() => { document.getElementById('musicSidebar').scrollTop = 0; });
        await p.waitForTimeout(300);
        const unstuck = await p.evaluate(() => ({ stuck: document.getElementById('dvPlCols').classList.contains('is-stuck'), band: Number(getComputedStyle(document.getElementById('dvPlCols'), '::before').opacity) }));
        check('B back at the top: no band (the header shows as before)', !unstuck.stuck && unstuck.band === 0, unstuck);

        // The windows: cards, × 32px, pill tabs (the chosen one cream)
        const win = async (show, sel) => {
            await p.evaluate(show); await p.waitForTimeout(450);
            const s = await p.evaluate((sel) => {
                const m = document.querySelector('.add-song-modal.active');
                const panel = m.querySelector('.add-song-modal-panel');
                const close = m.querySelector('.add-song-modal-close');
                const tabs = sel ? [...m.querySelectorAll(sel)] : [];
                const act = tabs.find((t) => t.classList.contains('active'));
                const c = getComputedStyle(panel);
                return {
                    id: m.id, radius: c.borderTopLeftRadius, closeW: close ? close.getBoundingClientRect().width : null,
                    pills: tabs.every((t) => parseFloat(getComputedStyle(t).borderTopLeftRadius) >= 16),
                    active: act ? getComputedStyle(act).backgroundColor : null, n: tabs.length,
                    title: getComputedStyle(m.querySelector('.add-song-modal-title')).fontSize,
                };
            }, sel);
            await p.keyboard.press('Escape'); await p.waitForTimeout(350);
            return s;
        };
        const wins = {
            settings: await win(() => showSettingsModal(), '#settingsTabs .settings-tab'),
            stats: await win(() => showStatsModal(), '#statsRange .settings-source-btn'),
            importer: await win(() => showSpotifyImportModal(), '#importTabs .import-tab'),
            addSongs: await win(() => showAddSongModal(), null),
            edit: await win(() => showPlaylistEditModal(Object.keys(playlistsMeta).find((k) => k !== 'favorites') || Object.keys(playlistsMeta)[0]), null),
        };
        const winsOk = Object.values(wins).every((w) => w.radius === '16px' && w.closeW === 32 && w.title === '22px' && w.pills && (w.n === 0 || w.active === cream));
        check('B the windows (Settings, Your listening, Import, Add songs, Edit playlist): 16px cards, a 32px ×, 22px titles, pill tabs with the chosen one cream', winsOk, wins);
        const thin = await p.evaluate(() => ['#musicSidebar', '#dvSideList'].map((s) => getComputedStyle(document.querySelector(s)).scrollbarWidth));
        check('B the scrollers\' scrollbars are thin', thin.every((x) => x === 'thin'), thin);
        check('B errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // Home's greeting at 800x600 with the side panel open: it wraps, never cut off
    {
        const { ctx, p } = await open({ vp: { width: 800, height: 600 } });
        await p.evaluate(() => window.dvSidePanel.open('queue')); await p.waitForTimeout(400);
        const g = await p.evaluate(() => {
            const el = document.getElementById('mGreeting');
            const out = [];
            for (const text of ['Good morning', 'Good afternoon', 'Good evening']) {
                el.textContent = text;
                const c = getComputedStyle(el);
                out.push({ text, cut: el.scrollWidth > el.clientWidth + 1, ws: c.whiteSpace, to: c.textOverflow, w: el.clientWidth });
            }
            return out;
        });
        check('B 800x600, side panel open: Home\'s greeting is never cut off ("Good after…")', g.every((x) => !x.cut && x.ws === 'normal' && x.to !== 'ellipsis'), g);
        check('B 800x600 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ======== C. Motion ========
    const motion = {};
    for (const reduced of [false, true]) {
        const tag = reduced ? 'reduced' : 'default';
        const { ctx, p } = await open({ reduced });
        const s = {};
        const cs = (sel, pseudo) => p.evaluate(([sel, pseudo]) => {
            const e = document.querySelector(sel);
            if (!e) return null;
            const c = getComputedStyle(e, pseudo || null);
            return { name: c.animationName, dur: c.animationDuration, tProp: c.transitionProperty, tDur: c.transitionDuration };
        }, [sel, pseudo]);
        // Pages: a playlist fading in (and its first rows, one after another)
        const id = await listWith(p, 4);
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await until(p, (i) => String(listId()) === String(i) && !listLoading(), id, 6000);
        s.pageIn = await cs('#musicSidebar');
        s.stagger = await p.evaluate(() => {
            const rows = [...document.querySelectorAll('#songList .song-list-item.dv-in')];
            return { n: rows.length, names: [...new Set(rows.map((r) => getComputedStyle(r).animationName))], delays: rows.slice(0, 3).map((r) => getComputedStyle(r).animationDelay) };
        });
        // A row can be clicked while its page fades in
        const hit = await p.evaluate(() => {
            const r = document.querySelector('#songList .song-list-item:not(.discover-item):not(.radio-song-item)');
            const b = r.getBoundingClientRect();
            const at = document.elementFromPoint(b.left + 60, b.top + b.height / 2);
            return !!at && r.contains(at);
        });
        s.hitDuringFade = hit;
        await p.waitForTimeout(900);
        s.staggerLater = await p.evaluate(() => document.querySelectorAll('#songList .dv-in').length);
        // A redraw (not a new page): no fade-in again
        await p.evaluate(() => rebuildSongList());
        s.staggerRebuild = await p.evaluate(() => document.querySelectorAll('#songList .dv-in').length);
        // Nothing shifts once it's settled
        const sels = ['#dvPlHead .dv-pl-name', '#dvPlPlay', '#dvPlCols', '#songList .song-list-item[data-index="2"]', '#dvBar', '#dvSide', '#dvAcctBtn'];
        const rects = () => p.evaluate((sels) => sels.map((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left * 2) / 2, Math.round(r.top * 2) / 2, Math.round(r.width * 2) / 2, Math.round(r.height * 2) / 2].join(','); }), sels);
        const r1 = await rects();
        await p.waitForTimeout(400);
        const r2 = await rects();
        s.rects = r1;
        s.stable = JSON.stringify(r1) === JSON.stringify(r2);
        // Menus, the side panel, windows
        await p.click('#dvPlMore'); await p.waitForTimeout(30);
        s.menu = await cs('#dvPlMenu');
        await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        await p.evaluate(() => window.dvSidePanel.open('queue')); await p.waitForTimeout(30);
        s.panel = await cs('#dvPanel');
        await p.evaluate(() => window.dvSidePanel.close()); await p.waitForTimeout(300);
        await p.evaluate(() => showSettingsModal()); await p.waitForTimeout(30);
        s.window = await cs('#settingsModal .add-song-modal-panel');
        await p.keyboard.press('Escape'); await p.waitForTimeout(400);
        // The bar: the play icon, the seek bar's glide, the pressed bounce, the ♥ pop
        await p.evaluate(() => document.getElementById('vinyl').classList.add('playing')); await p.waitForTimeout(30);
        s.icon = await cs('#dvBarPlay .dv-ic-pause');
        await p.evaluate(() => document.getElementById('vinyl').classList.remove('playing'));
        s.fill = await cs('#dvBarFill');
        s.fillTransform = await p.evaluate(() => { dvBarProgress(50, 200); return getComputedStyle(document.getElementById('dvBarFill')).transform; });
        s.btn = await cs('#dvBarNext');
        // ♥: a song of this (non-Favorites) list playing, the save faked
        await p.click('#songList .song-list-item[data-index="0"]');
        await until(p, (i) => String(activePlaylistId) === String(i) && !isChangingSong, id, 6000);
        await p.evaluate(() => {
            window.toggleFavoriteSong = async function (x) { const k = songPlayKey(x); if (favoriteKeys.has(k)) favoriteKeys.delete(k); else favoriteKeys.add(k); updateFavoriteHearts(); };
        });
        const like = () => p.evaluate(() => { const b = document.getElementById('dvBarLike'); return { on: b.classList.contains('is-on'), pop: b.classList.contains('dv-pop'), locked: b.getAttribute('aria-disabled') === 'true', name: getComputedStyle(b.querySelector('svg')).animationName }; });
        let l0 = await like();
        if (l0.on && !l0.locked) { await p.click('#dvBarLike'); await p.waitForTimeout(450); l0 = await like(); }
        if (!l0.on && !l0.locked) {
            await p.click('#dvBarLike'); await p.waitForTimeout(40);
            s.pop = await like();
            await p.waitForTimeout(450);
            await p.click('#dvBarLike'); await p.waitForTimeout(40);
            s.unpop = await like();
        } else s.pop = { skipped: l0 };
        // Now Playing: the page, the tonearm, the platter's spin-up and -down, the backdrop
        await openNp(p);
        s.np = await cs('#musicPlayerView .music-main');
        s.arm = await cs('#tonearm');
        s.spin = await p.evaluate(async () => {
            const v = document.getElementById('vinyl');
            const anim = () => v.getAnimations().find((a) => a.animationName === 'spin');
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            v.classList.add('playing');
            await wait(60);
            const up = anim() ? anim().playbackRate : null;
            await wait(500);
            const full = anim() ? anim().playbackRate : null;
            v.classList.remove('playing');
            await wait(60);
            const down = { cls: v.classList.contains('dv-spin-down'), state: getComputedStyle(v).animationPlayState, name: getComputedStyle(v).animationName, rate: anim() ? anim().playbackRate : null };
            await wait(600);
            const end = { cls: v.classList.contains('dv-spin-down'), state: getComputedStyle(v).animationPlayState };
            return { up, full, down, end };
        });
        s.backdrop = await p.evaluate(async () => {
            const img = document.getElementById('backdropImg');
            img.style.display = '';
            img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#a33"/></svg>');
            await new Promise((r) => setTimeout(r, 120));
            img.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#3a3"/></svg>');
            await new Promise((r) => setTimeout(r, 120));
            const ghost = document.querySelector('.music-main-backdrop .dv-backdrop-old');
            const g = ghost ? { going: ghost.classList.contains('is-going'), name: getComputedStyle(ghost).animationName, pos: getComputedStyle(ghost).position } : null;
            await new Promise((r) => setTimeout(r, 1700));
            return { ghost: g, left: document.querySelectorAll('.music-main-backdrop .dv-backdrop-old').length };
        });
        await p.evaluate(() => window.dvNowPlaying.close()); await p.waitForTimeout(500);
        // Home: its cards lift on hover
        await home(p);
        const card = await p.$('#vinylCrateView .record-card .record-card-cover');
        if (card) {
            const before = await rectOf(p, '#vinylCrateView .record-card .record-card-cover');
            await card.hover(); await p.waitForTimeout(400);
            s.lift = await p.evaluate(() => { const c = document.querySelector('#vinylCrateView .record-card .record-card-cover'); return { transform: getComputedStyle(c).transform, shadow: getComputedStyle(c).boxShadow }; });
            s.lift.moved = before ? (await rectOf(p, '#vinylCrateView .record-card .record-card-cover')).t - before.t : null;
            await p.mouse.move(2, 2); await p.waitForTimeout(400);
        }
        s.errs = p.__errs.slice();
        motion[tag] = s;
        await ctx.close();
    }
    {
        const d = motion.default;
        const r = motion.reduced;
        const inRange = (x, lo = 100, hi = 350) => msOf(x).every((m) => m >= lo && m <= hi);
        check('C default: a playlist page fades in rising (dvPageIn, 100-350ms)', d.pageIn.name === 'dvPageIn' && inRange(d.pageIn.dur), d.pageIn);
        check('C default: its first rows fade in one after another (12 at most, opacity only, staggered delays)', d.stagger.n > 0 && d.stagger.n <= 12 && d.stagger.names.join() === 'dvFadeIn' && new Set(d.stagger.delays).size === Math.min(3, d.stagger.n), d.stagger);
        check('C default: only on the page\'s first render (gone after, not on a redraw)', d.staggerLater === 0 && d.staggerRebuild === 0, { later: d.staggerLater, rebuild: d.staggerRebuild });
        check('C a row can be clicked while its page fades in (nothing covers it)', d.hitDuringFade && r.hitDuringFade, { d: d.hitDuringFade, r: r.hitDuringFade });
        check('C nothing shifts once the motion ends (rects stable, and the same as with reduced motion)', d.stable && r.stable && JSON.stringify(d.rects) === JSON.stringify(r.rects), { d: d.rects, r: r.rects });
        check('C default: menus drop in, the side panel slides in, windows rise (100-350ms)', d.menu.name === 'dvMenuIn' && inRange(d.menu.dur) && d.panel.name === 'dvPanelIn' && inRange(d.panel.dur) && d.window.name === 'dvWindowIn' && inRange(d.window.dur), { menu: d.menu, panel: d.panel, window: d.window });
        check('C default: the play/pause icon pops in; the seek bar glides (a transform, 100ms); buttons give when pressed (a transform transition)', d.icon.name === 'dvIconIn' && inRange(d.icon.dur) && /transform/.test(d.fill.tProp) && d.fillTransform !== 'none' && /transform/.test(d.btn.tProp), { icon: d.icon, fill: d.fill, ft: d.fillTransform, btn: d.btn });
        check('C default: a new like pops (dvPop); an unlike doesn\'t', !d.pop.skipped && d.pop.on && d.pop.pop && d.pop.name === 'dvPop' && !d.unpop.on && !d.unpop.pop, { pop: d.pop, unpop: d.unpop });
        check('C default: Now Playing fades in rising; the tonearm swings (a 320ms transform)', d.np.name === 'dvPageIn' && /transform/.test(d.arm.tProp) && msOf(d.arm.tDur).some((m) => m >= 150 && m <= 350), { np: d.np, arm: d.arm });
        check('C default: the platter spins up (slower at first, full speed after) and down (still turning, then paused)', d.spin.up !== null && d.spin.up < 1 && d.spin.full === 1 && d.spin.down.cls && d.spin.down.state === 'running' && !d.spin.end.cls && d.spin.end.state === 'paused', d.spin);
        check('C default: the backdrop cross-fades (the old cover fades out over the new one, then goes)', !!d.backdrop.ghost && d.backdrop.ghost.going && d.backdrop.ghost.name === 'dvFadeOut' && d.backdrop.ghost.pos === 'absolute' && d.backdrop.left === 0, d.backdrop);
        check('C default: a card lifts on hover (its cover up 4px, a deeper shadow)', !!d.lift && d.lift.transform !== 'none' && Math.abs(d.lift.moved + 4) < 1, d.lift);
        // Reduced motion: none of it
        const still = (x) => !x || x.name === 'none' || msOf(x.dur).every((m) => m < 1);
        const noTrans = (x) => !x || msOf(x.tDur).every((m) => m < 1);
        check('C reduced motion: no page, menu, panel, window or icon animation', [r.pageIn, r.menu, r.panel, r.window, r.icon, r.np].every(still), { pageIn: r.pageIn, menu: r.menu, panel: r.panel, window: r.window, icon: r.icon, np: r.np });
        check('C reduced motion: no staggered fade-in, no transitions (seek bar, buttons, tonearm)', r.stagger.n === 0 && noTrans(r.fill) && noTrans(r.btn) && noTrans(r.arm), { stagger: r.stagger, fill: r.fill, btn: r.btn, arm: r.arm });
        check('C reduced motion: the platter stops at once (no spin-down), no backdrop cross-fade, no ♥ pop, no card lift', !r.spin.down.cls && (r.spin.down.name === 'none' || r.spin.down.state !== 'running') && !r.backdrop.ghost && (!!r.pop.skipped || !r.pop.pop) && (!r.lift || r.lift.transform === 'none'), { spin: r.spin, backdrop: r.backdrop, pop: r.pop, lift: r.lift });
        check('C errors', d.errs.length === 0 && r.errs.length === 0, { d: d.errs, r: r.errs });
    }

    // ======== D. axe on every page, menu and window, in every room theme ========
    {
        const { ctx, p } = await open({});
        const id = await listWith(p, 1);
        const bad = {};
        let scans = 0;
        const scan = async (name) => {
            await p.waitForTimeout(450); // (the motion has ended)
            const v = await axeScan(p);
            scans++;
            if (v.length) bad[name] = v;
        };
        for (const theme of THEMES) {
            await p.evaluate((t) => setRoomTheme(t), theme);
            await home(p);
            await scan(theme + ' home');
            await p.click('#dvAcctBtn'); await scan(theme + ' avatar menu'); await p.keyboard.press('Escape');
            await p.evaluate(() => window.dvSidePanel.open('queue')); await scan(theme + ' side panel');
            await p.evaluate(() => window.dvSidePanel.close());
            await openList(p, id);
            await scan(theme + ' playlist');
            await p.click('#dvPlMore'); await scan(theme + ' playlist menu'); await p.keyboard.press('Escape');
            await p.evaluate(() => window.dvSearch.open()); await p.waitForTimeout(200);
            await p.fill('#mSearchInput', 'a'); await p.keyboard.type('n');
            await p.waitForTimeout(900);
            await scan(theme + ' search');
            await home(p);
            await openNp(p); await scan(theme + ' now playing');
            await p.evaluate(() => window.dvNowPlaying.close()); await p.waitForTimeout(400);
            for (const [n, show] of [['settings', () => showSettingsModal()], ['appearance', () => { showSettingsModal(); setSettingsTab('appearance'); }], ['stats', () => showStatsModal()], ['import', () => showSpotifyImportModal()], ['add songs', () => showAddSongModal()], ['edit playlist', () => showPlaylistEditModal(Object.keys(playlistsMeta)[0])]]) {
                await p.evaluate(show); await scan(theme + ' ' + n);
                await p.keyboard.press('Escape'); await p.waitForTimeout(350);
                await p.evaluate(() => document.querySelectorAll('.add-song-modal.active').forEach((m) => m.classList.remove('active')));
            }
        }
        await p.evaluate(() => setRoomTheme('blue-hour'));
        check(`D axe: no violations on every page, menu and window in all ${THEMES.length} room themes (${scans} scans)`, Object.keys(bad).length === 0 && scans === THEMES.length * 13, bad);
        check('D errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ======== D2. Windows whose content scrolls: a keyboard can reach it ========
    // (axe scrollable-region-focusable: CI's seeded stats overflow Your
    // listening; a short window makes the others scroll too)
    const BIG_STATS = {
        totalPlays: 812, distinctSongs: 64, distinctArtists: 21,
        topSongs: Array.from({ length: 20 }, (_, i) => ({ title: 'Stat song ' + (i + 1), artist: 'Stat artist ' + (i % 7), cover: '', plays: 40 - i })),
        topArtists: Array.from({ length: 10 }, (_, i) => ({ artist: 'Stat artist ' + i, plays: 90 - i * 5 })),
    };
    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 540 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const { ctx, p } = await open({ vp });
        const bad = {};
        const shows = [
            ['Your listening', async () => { await p.evaluate((st) => { window.fetchStats = async () => {}; showStatsModal(); renderStats(st); }, BIG_STATS); }],
            ['Settings', async () => { await p.evaluate(() => showSettingsModal()); }],
            ['Settings, Appearance', async () => { await p.evaluate(() => { showSettingsModal(); setSettingsTab('appearance'); }); }],
            ['Settings, Account', async () => { await p.evaluate(() => { showSettingsModal(); setSettingsTab('account'); }); }],
            ['Import, a long checklist', async () => { await p.evaluate(() => { showSpotifyImportModal(); importSelection = Array.from({ length: 40 }, (_, i) => ({ title: 'Pasted ' + i, artist: 'Someone', album: '', cover: '', spotify_id: '', youtube_id: 'v' + i, needsMatch: true, matchLabel: '▸ match ' + i, checked: true })); renderImportChecklist('Pasted list', true); }); }],
            ['Add songs, results', async () => { await p.evaluate(() => showAddSongModal()); await p.waitForTimeout(300); const f = await p.$('#addSongModal input[type="search"], #addSongModal input[type="text"]'); if (f) { await f.fill('song'); await p.keyboard.press('Enter'); } }],
            ['Edit playlist', async () => { await p.evaluate(() => showPlaylistEditModal(Object.keys(playlistsMeta)[0])); }],
            ['GIF maker', async () => { await p.evaluate(() => window.openVinylGifModal && window.openVinylGifModal()); }],
        ];
        let stats = null;
        for (const [name, show] of shows) {
            await show();
            await p.waitForTimeout(900);
            if (name === 'Your listening') {
                stats = await p.evaluate(() => { const b = document.getElementById('statsBody'); return { scrolls: b.scrollHeight > b.clientHeight + 1, tab: b.getAttribute('tabindex'), role: b.getAttribute('role'), named: b.getAttribute('aria-labelledby') || b.getAttribute('aria-label') }; });
            }
            const v = (await axeScan(p)).filter((x) => /scrollable-region-focusable|aria-|region/.test(x));
            if (v.length) bad[name] = v;
            await p.keyboard.press('Escape'); await p.waitForTimeout(350);
            await p.evaluate(() => { document.querySelectorAll('.add-song-modal.active').forEach((m) => m.classList.remove('active')); if (window.closeVinylGifModal) window.closeVinylGifModal(); });
            await p.waitForTimeout(200);
        }
        check(`D2 ${tag} Your listening, its list scrolling: a labelled region in the Tab order`, !!stats && (!stats.scrolls || (stats.tab === '0' && stats.role === 'region' && !!stats.named)), stats);
        check(`D2 ${tag} every window with scrolling content: no scrollable-region-focusable (or ARIA) violations`, Object.keys(bad).length === 0, bad);
        const after = await p.evaluate(() => document.querySelectorAll('[data-dv-scrollstop]').length);
        check(`D2 ${tag} closed, the windows' scroll stops are gone again`, after === 0, after);
        check(`D2 ${tag} errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ======== E. Phones and the app: none of it ========
    for (const c of [{ vp: { width: 390, height: 844 }, phone: true }, { vp: { width: 844, height: 390 }, phone: true }, { vp: { width: 1440, height: 900 }, query: '?app=1' }]) {
        const tag = c.query ? 'app (?app=1) 1440x900' : `phone ${c.vp.width}x${c.vp.height}`;
        const { ctx, p } = await open(c);
        const id = await listWith(p, 2);
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(1500);
        const s = await p.evaluate(() => {
            const cs = getComputedStyle(document.documentElement);
            const side = document.getElementById('musicSidebar');
            const greet = document.getElementById('mGreeting');
            return {
                dv2: document.documentElement.classList.contains('dv2'),
                tokens: ['--dv-text-md', '--dv-mid'].map((k) => cs.getPropertyValue(k).trim()).filter(Boolean),
                staggered: document.querySelectorAll('.dv-in').length,
                pageAnim: side ? getComputedStyle(side).animationName : null,
                stuck: document.querySelectorAll('.is-stuck').length,
                greetWs: greet ? getComputedStyle(greet).whiteSpace : null,
                fill: getComputedStyle(document.getElementById('dvBarFill')).transform,
            };
        });
        check(`E ${tag}: no desktop polish or motion (no tokens, no staggered rows, no page animation, no band)`, !s.dv2 && s.tokens.length === 0 && s.staggered === 0 && s.pageAnim !== 'dvPageIn' && s.stuck === 0, s);
        const stops = await p.evaluate(async (st) => {
            window.fetchStats = async () => {};
            showStatsModal(); renderStats(st);
            await new Promise((r) => setTimeout(r, 600));
            const b = document.getElementById('statsBody');
            const out = { stops: document.querySelectorAll('[data-dv-scrollstop]').length, tab: b.getAttribute('tabindex') };
            hideStatsModal();
            return out;
        }, BIG_STATS);
        check(`E ${tag}: a scrolling window body gets no desktop Tab stop`, stops.stops === 0 && stops.tab === null, stops);
        check(`E ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 1500)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
