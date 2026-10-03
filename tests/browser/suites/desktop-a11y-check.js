// Desktop step 10: the keyboard and accessibility pass, at 1440x900 (and
// 1024x768 for axe and the Tab order). Checks the shortcuts (Space,
// Ctrl+arrows, Shift+arrows, M, L, S, R, Q, Y, N, "?"; "/" still opens
// Search), each doing what its bar button does, and each ignored while
// typing in the Search field, under a window and with a menu open; the
// Keyboard shortcuts window (its list, "?" and the avatar menu open it,
// Esc and "?" close it, focus back); the windows as dialogs on the desktop
// (focus in, the page inert behind them so Tab stays in, Esc closes them,
// focus back to what opened them); "Skip to content" (the first Tab stop,
// shown while focused, to each page's heading); the Tab order (skip link,
// sidebar, avatar, page, side panel, bar: only what shows) with a visible
// 2px amber ring on every stop and in the menus and windows; axe (no
// violations) and one h1 per view with no duplicate ids on Home, a
// playlist page (loaded, loading, failed, empty), Now Playing (lyrics on
// and off, ⋯), Search (empty, results, Add to playlist), the side panel,
// every menu and every window; less motion when the system asks for it;
// and that phones (390x844, 844x390) and the app (?app=1) have none of it.
// Writes to /save-music are faked and recorded (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const AXE = require.resolve('axe-core/axe.min.js', { paths: [L.ROOT] });
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - First Find', channel: 'Band One', thumbnail: '' },
    { videoId: 'bbbbbbbbbb2', title: 'Second Find', channel: 'Someone', thumbnail: '' },
];
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
            // A stub player at 0:30 of 3:20; record what plays and every seek
            window.__seeks = [];
            const stub = { _s: 5, _t: 30, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo(t) { window.__seeks.push(Math.round(t)); this._t = t; }, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return this._t; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); if (!cue) window.__played.push(s && s.title); };
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            playQueue = []; afterQueueChange();
            // Whether the page took the last key (read after every handler)
            window.__took = null;
            window.addEventListener('keydown', (e) => { window.__took = e.defaultPrevented; });
            // (the Ctrl/⌘ arrows are taken in the capture phase, before the bubble)
            window.__tookCap = null;
            window.addEventListener('keydown', (e) => { window.__tookCap = e.defaultPrevented; }, true);
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
    // The h1s a screen reader finds (not hidden, not inert), and duplicate ids
    const tree = (p) => p.evaluate(() => {
        const inTree = (el) => {
            for (let e = el; e; e = e.parentElement) {
                const c = getComputedStyle(e);
                if (c.display === 'none' || c.visibility === 'hidden' || e.hidden || e.inert || e.getAttribute('aria-hidden') === 'true') return false;
            }
            return true;
        };
        const ids = {};
        document.querySelectorAll('[id]').forEach((e) => { ids[e.id] = (ids[e.id] || 0) + 1; });
        return {
            h1: [...document.querySelectorAll('h1')].filter(inTree).map((h) => h.id || h.textContent.trim().slice(0, 30)),
            dup: Object.keys(ids).filter((k) => ids[k] > 1),
            dialog: [...document.querySelectorAll('.add-song-modal.active, .vgm-modal.active')].map((m) => m.id),
        };
    });
    // What the shortcuts change
    const st = (p) => p.evaluate(() => {
        const $ = (id) => document.getElementById(id);
        const a = document.activeElement;
        return {
            play: $('dvBarPlay').getAttribute('aria-label'),
            idx: currentSongIndex,
            title: (document.querySelector('#dvBar .dv-bar-meta .song-title') || {}).textContent || '',
            shuffle: $('dvBarShuffle').dataset.mode,
            loop: $('dvBarLoop').dataset.mode,
            like: $('dvBarLike').getAttribute('aria-pressed'),
            mute: $('dvBarMute').getAttribute('aria-pressed'),
            vol: Math.round(currentVolume),
            range: $('dvBarVolume').value,
            panel: window.dvSidePanel.isOpen() ? (window.dvSidePanel.showing('queue') ? 'queue' : 'lyrics') : null,
            np: window.dvNowPlaying.isOpen(),
            search: window.dvSearch.isOpen(),
            keys: $('dvKeysModal').classList.contains('active'),
            seeks: window.__seeks.slice(),
            took: window.__took,
            tookCap: window.__tookCap,
            modals: [...document.querySelectorAll('.add-song-modal.active, .vgm-modal.active')].map((m) => m.id),
            focus: a ? (a.id || (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 40) || a.tagName) : null,
            focusInKeys: !!a && $('dvKeysModal').contains(a),
            inert: ['dvSide', 'music-section', 'dvBar', 'dvPanel', 'dvSkip'].filter((id) => $(id) && $(id).inert),
            scroll: [document.scrollingElement.scrollTop, (document.querySelector('#vinylCrateView .room-content') || {}).scrollTop || 0, ($('musicSidebar') || {}).scrollTop || 0],
        };
    });
    const press = async (p, key, ms = 250) => { await p.keyboard.press(key); await p.waitForTimeout(ms); return st(p); };
    const blur = (p) => p.evaluate(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); });
    const home = async (p) => { await p.evaluate(() => { if (window.dvNowPlaying) window.dvNowPlaying.close(); if (window.dvSearch) window.dvSearch.close(); if (document.getElementById('musicPlayerView').classList.contains('active')) showPlaylistPicker(); }); await p.waitForTimeout(700); };
    const otherWithSongs = (p) => p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= 1) || String(activePlaylistId));
    const emptyList = (p) => p.evaluate(() => Object.keys(playlistsMeta).find(k => !playlistsMeta[k].songCount) || null);
    const openList = async (p, id) => { await p.evaluate((i) => selectPlaylistFromCrate(i), id); await p.waitForTimeout(1500); };
    const openNp = async (p) => { await p.click('#dvBarDeck'); await p.waitForTimeout(900); };
    // A query that finds a song in the library (2+ letters of a title)
    const libQuery = (p) => p.evaluate(() => {
        const s = songsData.find((x) => x && /[A-Za-z]{3,}/.test(x.title || ''));
        return s ? s.title.match(/[A-Za-z]{3,}/)[0] : 'song';
    });
    // The amber the theme uses, as a computed colour
    const amberOf = (p) => p.evaluate(() => {
        const d = document.createElement('i');
        d.style.color = 'var(--amber)';
        document.body.appendChild(d);
        const c = getComputedStyle(d).color;
        d.remove();
        return c;
    });
    // Where focus is, whether it shows, and its ring (a 2px amber outline;
    // the Search field's goes round the field, the lyrics' on their panel)
    const where = (p) => p.evaluate(() => {
        const a = document.activeElement;
        if (!a || a === document.body || a === document.documentElement) return { zone: 'body' };
        const zone = a.id === 'dvSkip' ? 'skip' : a.closest('#dvSide') ? 'side' : a.closest('#dvAcct') ? 'acct' : a.closest('#dvPanel') ? 'panel'
            : a.closest('#dvBar') ? 'bar' : a.closest('#music-section') ? 'main' : a.closest('.add-song-modal, .vgm-modal') ? 'window' : 'other';
        let visible = a.getClientRects().length > 0;
        for (let e = a; e && visible; e = e.parentElement) {
            const c = getComputedStyle(e);
            if (c.visibility === 'hidden' || c.display === 'none' || Number(c.opacity) === 0) visible = false;
        }
        const ringEl = a.id === 'mSearchInput' ? a.closest('.m-search-field')
            : a.id === 'sleeveLyrics' ? (a.closest('.vinyl-sleeve') && a.closest('.dv-deck') ? a.closest('.vinyl-sleeve') : a) : a;
        const c = getComputedStyle(ringEl);
        return {
            zone, visible,
            id: a.id || (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || a.className,
            ring: { style: c.outlineStyle, width: parseFloat(c.outlineWidth), color: c.outlineColor },
        };
    });
    const ringOk = (w, amber) => w.ring.style === 'solid' && w.ring.width >= 1.5 && w.ring.color === amber;
    // Tab from the skip link round to it again: the zones in order, and
    // every stop shown with its ring
    async function tabWalk(p) {
        await p.focus('#dvSkip');
        const stops = [await where(p)];
        for (let i = 0; i < 90; i++) {
            await p.keyboard.press('Tab');
            await p.waitForTimeout(200); // (a row's buttons fade in as it takes focus)
            const w = await where(p);
            if (w.zone === 'skip' || w.zone === 'body' || w.zone === 'other') break;
            stops.push(w);
        }
        return stops;
    }
    const zonesOf = (stops) => stops.map((s) => s.zone).filter((z, i, a) => i === 0 || a[i - 1] !== z);

    // ---- A. The shortcuts (1440x900)
    {
        const { ctx, p } = await open({});
        // A playlist other than Favorites plays (Favorites locks its ♥): a
        // song tap on another one, as the user would
        const other = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== 'favorites' && k !== String(activePlaylistId) && playlistsMeta[k].songCount >= 3)
            || Object.keys(playlistsMeta).find(k => k !== 'favorites' && playlistsMeta[k].songCount >= 3));
        await openList(p, other);
        await p.click('#songList .song-list-item[data-index="0"]'); await p.waitForTimeout(1200);
        await home(p);
        // What the bar's buttons call, recorded (they still run); the heart's
        // save as the bar check stubs it
        await p.evaluate(() => {
            window.__calls = [];
            for (const name of ['toggleMusic', 'nextSong', 'prevSong']) {
                const orig = window[name];
                window[name] = function () { window.__calls.push(name); return orig.apply(this, arguments); };
            }
            window.__favCalls = [];
            window.toggleFavoriteSong = async function (x) { window.__favCalls.push(x && x.title); const k = songPlayKey(x); if (favoriteKeys.has(k)) favoriteKeys.delete(k); else favoriteKeys.add(k); updateFavoriteHearts(); };
        });
        const calls = () => p.evaluate(() => window.__calls.splice(0));
        const s0 = await st(p);
        const playingList = await p.evaluate(() => String(activePlaylistId));

        await blur(p);
        const sp1 = await press(p, 'Space');
        const sp2 = await press(p, 'Space');
        const spCalls = await calls();
        check('A Space plays and pauses (focus on the page: toggleMusic twice) and takes the key (no page scroll)',
            spCalls.join() === 'toggleMusic,toggleMusic' && sp1.took === true && sp2.took === true && sp2.scroll.join() === s0.scroll.join(), { spCalls, took: [sp1.took, sp2.took], scroll: [s0.scroll, sp2.scroll] });

        const n1 = await press(p, 'Control+ArrowRight', 400);
        const n2 = await press(p, 'Control+ArrowLeft', 400);
        const nCalls = await calls();
        check('A Ctrl+→ plays the next song, Ctrl+← the previous one (nextSong, prevSong)', nCalls.join() === 'nextSong,prevSong' && n1.tookCap && n2.tookCap, { nCalls, took: [n1.tookCap, n2.tookCap] });
        await press(p, 'Meta+ArrowRight', 400);
        await press(p, 'Meta+ArrowLeft', 400);
        const mCalls = await calls();
        check('A ⌘+→ / ⌘+← do the same (Mac)', mCalls.join() === 'nextSong,prevSong', mCalls);

        await p.evaluate(() => { window.__seeks = []; ytPlayer._t = 30; });
        const f1 = await press(p, 'Shift+ArrowRight');
        await p.evaluate(() => { ytPlayer._t = 30; });
        const f2 = await press(p, 'Shift+ArrowLeft');
        check('A Shift+→ / Shift+← seek 5 seconds forward / back', f2.seeks.join(',') === '35,25' && f1.took, f2.seeks);

        const v1 = await press(p, 'Control+ArrowDown');
        const v2 = await press(p, 'Control+ArrowUp');
        check('A Ctrl+↓ / Ctrl+↑ turn the volume down / up by 10 (the bar\'s slider follows)', v1.tookCap && v1.vol === Math.max(0, s0.vol - 10) && v2.vol === Math.min(100, v1.vol + 10) && v1.range === String(v1.vol), { s0: s0.vol, v1: [v1.vol, v1.range], v2: v2.vol });

        const mu1 = await press(p, 'm');
        const mu2 = await press(p, 'm');
        check('A M mutes and unmutes', mu1.mute === 'true' && mu1.vol === 0 && mu2.mute === 'false' && mu2.vol === v2.vol, { mu1: [mu1.mute, mu1.vol], mu2: [mu2.mute, mu2.vol] });

        const lk0 = await st(p);
        const l1 = await press(p, 'l', 300);
        const l2 = await press(p, 'l', 300);
        const favCalls = await p.evaluate(() => window.__favCalls.slice());
        const nowTitle = await p.evaluate(() => { const x = currentRadioSong || songsData[currentSongIndex]; return x && x.title; });
        check('A L likes the playing song (♥ on) and unlikes it again (toggleFavoriteSong, the playing song)', playingList !== 'favorites' && l1.like !== lk0.like && l2.like === lk0.like && favCalls.length === 2 && favCalls.every((t) => t === nowTitle),
            { playingList, like: [lk0.like, l1.like, l2.like], favCalls, nowTitle });

        const sh1 = await press(p, 's');
        const r1 = await press(p, 'r');
        check('A S switches shuffle, R repeat (as their bar buttons)', sh1.shuffle !== s0.shuffle && r1.loop !== s0.loop, { shuffle: [s0.shuffle, sh1.shuffle], loop: [s0.loop, r1.loop] });
        // Back as they were (one click of each, in turn)
        for (let k = 0; k < 3 && (await st(p)).shuffle !== s0.shuffle; k++) await p.click('#dvBarShuffle');
        for (let k = 0; k < 3 && (await st(p)).loop !== s0.loop; k++) await p.click('#dvBarLoop');

        await blur(p);
        const q1 = await press(p, 'q', 500);
        const q2 = await press(p, 'q', 500);
        await blur(p);
        const y1 = await press(p, 'y', 500);
        const y2 = await press(p, 'y', 500);
        check('A Q opens and closes the side panel on Up next, Y on Lyrics', s0.panel === null && q1.panel === 'queue' && q2.panel === null && y1.panel === 'lyrics' && y2.panel === null,
            { q: [q1.panel, q2.panel], y: [y1.panel, y2.panel] });

        await blur(p);
        const np1 = await press(p, 'n', 900);
        const np2 = await press(p, 'n', 900);
        check('A N opens Now Playing (focus on its heading) and closes it again', np1.np && np1.focus === 'dvNpHeading' && !np2.np, { np1: [np1.np, np1.focus], np2: np2.np });

        await blur(p);
        const sl = await press(p, '/', 500);
        check('A "/" still opens Search (focus in its field)', sl.search && sl.focus === 'mSearchInput', { search: sl.search, focus: sl.focus });

        // ---- Typing in the Search field: the keys are letters
        const before = await st(p);
        await p.keyboard.type(' mlsrqyn?', { delay: 30 });
        await p.keyboard.press('Control+ArrowRight');
        await p.keyboard.press('Shift+ArrowLeft');
        await p.waitForTimeout(400);
        const typed = await st(p);
        const typedCalls = await calls();
        const value = await p.evaluate(() => document.getElementById('mSearchInput').value);
        check('A typing in the Search field: the letters land in it, no shortcut fires (play, song, modes, like, mute, panel, Now Playing, the list)',
            value.includes('mlsrqyn?') && typedCalls.length === 0 && typed.play === before.play && typed.idx === before.idx && typed.shuffle === before.shuffle && typed.loop === before.loop
            && typed.like === before.like && typed.mute === before.mute && typed.panel === null && !typed.np && !typed.keys && typed.search && typed.seeks.length === before.seeks.length,
            { value, typedCalls, before, typed });
        await p.evaluate(() => { const i = document.getElementById('mSearchInput'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
        await home(p);

        // ---- A focused control keeps its own Space and arrows
        await p.focus('#dvBarShuffle');
        const fs0 = await st(p);
        await calls();
        const fs1 = await press(p, 'Space');
        const fsCalls = await calls();
        check('A Space on a focused button presses that button only (shuffle switched, no play/pause)', fs1.shuffle !== fs0.shuffle && fsCalls.length === 0, { shuffle: [fs0.shuffle, fs1.shuffle], fsCalls });
        await p.click('#dvBarShuffle'); await p.waitForTimeout(100);
        for (let k = 0; k < 3 && (await st(p)).shuffle !== s0.shuffle; k++) await p.click('#dvBarShuffle');
        await p.focus('#dvBarVolume');
        const vv0 = await st(p);
        const vv1 = await press(p, 'Shift+ArrowLeft');
        check('A Shift+← on the volume slider stays the slider\'s (no seek)', vv1.seeks.length === vv0.seeks.length, { seeks: [vv0.seeks, vv1.seeks] });

        // ---- With a menu open: the menu has the keys
        await p.click('#dvAcctBtn'); await p.waitForTimeout(250);
        const mn0 = await st(p);
        for (const k of ['s', 'r', 'q', 'n', 'm', '?']) await p.keyboard.press(k);
        await p.waitForTimeout(400);
        const mn1 = await st(p);
        check('A with the avatar menu open: S, R, Q, N, M and ? do nothing',
            mn1.shuffle === mn0.shuffle && mn1.loop === mn0.loop && mn1.panel === mn0.panel && !mn1.np && mn1.mute === mn0.mute && !mn1.keys, { mn0, mn1 });
        await p.keyboard.press('Escape'); await p.waitForTimeout(200);
        check('A errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- B. The windows: focus in, the page inert (Tab stays in), Esc
    // closes them, focus back; no shortcuts under them
    {
        const { ctx, p } = await open({});
        await home(p);
        await p.click('#dvAcctBtn'); await p.waitForTimeout(200);
        await p.click('#dvAcctMenu [data-dv-acct="playback"]'); await p.waitForTimeout(600);
        await p.evaluate(() => {
            window.__calls = [];
            for (const name of ['toggleMusic', 'nextSong', 'prevSong']) {
                const orig = window[name];
                window[name] = function () { window.__calls.push(name); return orig.apply(this, arguments); };
            }
        });
        const w0 = await st(p);
        check('B Settings (from the avatar menu): focus inside it, the page behind it inert', w0.modals.includes('settingsModal') && w0.inert.length === 5
            && await p.evaluate(() => document.getElementById('settingsModal').contains(document.activeElement)), { modals: w0.modals, inert: w0.inert, focus: w0.focus });
        const outside = [];
        for (let i = 0; i < 40; i++) {
            await p.keyboard.press('Tab');
            const inside = await p.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest('#settingsModal'); });
            if (!inside) outside.push(await p.evaluate(() => document.activeElement.id || document.activeElement.className));
        }
        check('B Tab never leaves Settings for the page behind it', outside.length === 0, outside);
        for (const k of ['Space', 'n', 'q', 's', 'Control+ArrowRight', '?']) await p.keyboard.press(k);
        await p.waitForTimeout(400);
        const w1 = await st(p);
        const wCalls = await p.evaluate(() => window.__calls.slice());
        check('B under a window: Space, N, Q, S, Ctrl+→ and ? do nothing', wCalls.length === 0 && w1.play === w0.play && !w1.np && w1.panel === w0.panel && w1.shuffle === w0.shuffle && w1.idx === w0.idx && !w1.keys,
            { wCalls, w0: [w0.play, w0.shuffle, w0.idx], w1: [w1.play, w1.np, w1.panel, w1.shuffle, w1.idx, w1.keys] });
        await p.keyboard.press('Escape'); await p.waitForTimeout(500);
        const w2 = await st(p);
        check('B Esc closes Settings: the page is back (not inert), focus back on the avatar', w2.modals.length === 0 && w2.inert.length === 0 && w2.focus === 'dvAcctBtn', { modals: w2.modals, inert: w2.inert, focus: w2.focus });

        // Every window: Esc closes it, focus back where it was
        const wins = [
            ['statsModal', () => showStatsModal()],
            ['spotifyImportModal', () => showSpotifyImportModal()],
            ['addSongModal', () => showAddSongModal()],
            ['playlistEditModal', () => showPlaylistEditModal(String(activePlaylistId))],
            ['bringMusicModal', () => showBringMusicModal()],
            ['vinylGifModal', () => openVinylGifModal()],
            ['dvKeysModal', () => window.dvKeys.open()],
        ];
        const got = {};
        for (const [id, show] of wins) {
            await p.focus('#dvSideHome');
            await p.evaluate(show); await p.waitForTimeout(600);
            const o = await p.evaluate((i) => { const m = document.getElementById(i); return { open: m.classList.contains('active'), inside: m.contains(document.activeElement) }; }, id);
            await p.keyboard.press('Escape'); await p.waitForTimeout(500);
            const c = await st(p);
            got[id] = { open: o.open, inside: o.inside, closed: !c.modals.includes(id), back: c.focus, inert: c.inert };
        }
        check('B every window takes focus as it opens and closes on Esc, focus back on what opened it (Your listening, Import, Add songs, Edit playlist, Bring your music over, the GIF maker, Keyboard shortcuts)',
            Object.values(got).every((g) => g.open && g.inside && g.closed && g.back === 'dvSideHome' && g.inert.length === 0), got);
        check('B errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- C. The Keyboard shortcuts window
    {
        const { ctx, p } = await open({});
        await home(p);
        await blur(p);
        const k1 = await press(p, '?', 600);
        const list = await p.evaluate(() => {
            const m = document.getElementById('dvKeysModal');
            const r = m.getBoundingClientRect();
            return {
                role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), label: (document.getElementById(m.getAttribute('aria-labelledby')) || {}).textContent,
                rows: [...m.querySelectorAll('.dv-keys-list > div')].map((d) => d.querySelector('dt').textContent.trim() + '=' + d.querySelector('dd').textContent.trim().replace(/\s+/g, ' ')),
                fits: r.width > 0 && [...m.querySelectorAll('.dv-keys-panel')].every((x) => { const b = x.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; }),
            };
        });
        const want = ['Play or pause=Space', 'Next song=Ctrl →', 'Previous song=Ctrl ←', 'Forward 5 seconds=Shift →', 'Back 5 seconds=Shift ←', 'Volume up / down=Ctrl ↑ ↓', 'Mute=M', 'Like the song=L', 'Shuffle=S', 'Repeat=R',
            'Search=/ or Ctrl K', 'Now Playing=N', 'Up next=Q', 'Lyrics=Y', 'Keyboard shortcuts=?', 'Close or go back=Esc'];
        const isMac = await p.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || ''));
        const wantHere = isMac ? want.map((x) => x.replace(/Ctrl/g, '⌘')) : want;
        check('C "?" opens Keyboard shortcuts: a labelled modal dialog listing every shortcut, on screen, focus in it',
            k1.keys && k1.focusInKeys && list.role === 'dialog' && list.modal === 'true' && list.label === 'Keyboard shortcuts' && wantHere.every((x) => list.rows.includes(x)) && list.fits, { k1: [k1.keys, k1.focus], list });
        const k2 = await press(p, '?', 500);
        check('C "?" again closes it', !k2.keys && k2.modals.length === 0 && k2.inert.length === 0, { keys: k2.keys, inert: k2.inert });
        // From the avatar menu (by keyboard); focus back on the avatar
        await p.focus('#dvAcctBtn');
        await p.keyboard.press('Enter'); await p.waitForTimeout(200);
        const items = await p.evaluate(() => [...document.querySelectorAll('#dvAcctMenu [role="menuitem"]')].filter((x) => !x.hidden).map((x) => x.textContent.trim()));
        const at = items.indexOf('Keyboard shortcuts');
        for (let k = 0; k < at; k++) await p.keyboard.press('ArrowDown');
        await p.keyboard.press('Enter'); await p.waitForTimeout(600);
        const k3 = await st(p);
        await p.click('#dvKeysModal .add-song-modal-close'); await p.waitForTimeout(500);
        const k4 = await st(p);
        check('C the avatar menu has "Keyboard shortcuts" (after Settings); it opens the window; its × closes it, focus back on the avatar',
            at === items.indexOf('Account') + 1 && k3.keys && k3.focusInKeys && !k4.keys && k4.focus === 'dvAcctBtn', { items, k3: [k3.keys, k3.focus], k4: [k4.keys, k4.focus] });
        check('C errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- D. Skip to content, the Tab order and the focus rings (1440x900 and 1024x768)
    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const { ctx, p } = await open({ vp });
        const amber = await amberOf(p);
        // The first Tab from a fresh page: the skip link, shown
        await p.keyboard.press('Tab'); await p.waitForTimeout(200);
        const sk = await where(p);
        const skBox = await p.evaluate(() => { const r = document.getElementById('dvSkip').getBoundingClientRect(); return { t: r.top, l: r.left, b: r.bottom, r: r.right }; });
        check(`${tag} D the first Tab stop is "Skip to content", shown on screen with the ring`, sk.zone === 'skip' && sk.visible && skBox.t >= 0 && skBox.b <= vp.height && skBox.l >= 0 && ringOk(sk, amber), { sk, skBox, amber });
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        const toHome = (await st(p)).focus;
        const skipTo = async () => { await p.focus('#dvSkip'); await p.keyboard.press('Enter'); await p.waitForTimeout(300); return (await st(p)).focus; };
        await openList(p, await otherWithSongs(p));
        const toPl = await skipTo();
        await openNp(p);
        const toNp = await skipTo();
        await p.evaluate(() => window.dvNowPlaying.close()); await p.waitForTimeout(500);
        await p.click('#dvSideSearch'); await p.waitForTimeout(500);
        const toSearch = await skipTo();
        check(`${tag} D Skip to content goes to the page's heading: Home's greeting, the playlist's name, Now Playing's heading, the Search field`,
            toHome === 'mGreeting' && toPl === 'dvPlName' && toNp === 'dvNpHeading' && toSearch === 'mSearchInput', { toHome, toPl, toNp, toSearch });

        // The Tab order on each page, the side panel open
        await home(p);
        await p.evaluate(() => window.dvSidePanel.open('queue')); await p.waitForTimeout(500);
        const walks = {};
        walks.home = await tabWalk(p);
        await openList(p, await otherWithSongs(p));
        walks.playlist = await tabWalk(p);
        await openNp(p);
        walks.np = await tabWalk(p);
        await p.evaluate(() => window.dvNowPlaying.close()); await p.waitForTimeout(500);
        await p.click('#dvSideSearch'); await p.waitForTimeout(500);
        walks.search = await tabWalk(p);
        const ORDER = 'skip,side,acct,main,panel,bar';
        for (const [page, stops] of Object.entries(walks)) {
            const z = zonesOf(stops).join(',');
            const hidden = stops.filter((s) => !s.visible).map((s) => s.zone + ':' + s.id);
            const noRing = stops.slice(1).filter((s) => !ringOk(s, amber)).map((s) => s.zone + ':' + s.id + ' ' + JSON.stringify(s.ring));
            check(`${tag} D ${page}: Tab goes skip link, sidebar, avatar, page, side panel, bar`, z === ORDER, z);
            check(`${tag} D ${page}: every Tab stop shows (nothing from a page that isn't showing)`, hidden.length === 0, hidden);
            check(`${tag} D ${page}: every Tab stop has the 2px amber ring`, noRing.length === 0, noRing);
        }
        // Rings in the menus and a window
        await home(p);
        const menuRings = {};
        for (const [btn, menu] of [['#dvAcctBtn', 'acct'], ['#dvSideAdd', 'add'], ['#dvBarSleep', 'sleep']]) {
            await p.focus(btn); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
            await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
            menuRings[menu] = await where(p);
            await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        }
        await openList(p, await otherWithSongs(p));
        await p.focus('#dvPlMore'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
        menuRings.playlist = await where(p);
        await p.keyboard.press('Escape'); await p.waitForTimeout(150);
        await p.focus('#dvSkip');
        await p.keyboard.press('?'); await p.waitForTimeout(600);
        menuRings.keysWindow = await where(p);
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        check(`${tag} D menu items and a window's controls have the amber ring too`, Object.values(menuRings).every((w) => w.visible && ringOk(w, amber) && (w.zone !== 'window' || w.id === 'Close')),
            menuRings);
        check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- E. axe and the headings, every state (1440x900 and 1024x768)
    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const scans = {};
        const scan = async (p, name, h1) => {
            const v = await axeScan(p);
            const t = await tree(p);
            scans[name] = { v, h1: t.h1, dup: t.dup, ok: v.length === 0 && t.dup.length === 0 && (h1 === undefined ? t.h1.length === 1 : t.h1.length === h1) };
        };
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await scan(p, 'home');
            await p.click('#dvSideAdd'); await p.waitForTimeout(250); await scan(p, 'home + menu'); await p.keyboard.press('Escape');
            await p.click('#dvAcctBtn'); await p.waitForTimeout(250); await scan(p, 'avatar menu'); await p.keyboard.press('Escape');
            await p.click('#dvBarSleep'); await p.waitForTimeout(250); await scan(p, 'sleep menu'); await p.keyboard.press('Escape');
            await p.evaluate(() => window.dvSidePanel.open('queue')); await p.waitForTimeout(500); await scan(p, 'side panel: Up next');
            await p.evaluate(() => window.dvSidePanel.open('lyrics')); await p.waitForTimeout(500); await scan(p, 'side panel: Lyrics');
            await p.evaluate(() => window.dvSidePanel.close()); await p.waitForTimeout(300);
            await openList(p, await otherWithSongs(p));
            await scan(p, 'playlist');
            await p.click('#dvPlMore'); await p.waitForTimeout(250); await scan(p, 'playlist ⋯ menu'); await p.keyboard.press('Escape');
            const row = p.locator('#songList .song-list-item:not(.discover-item):not(.radio-song-item)').first();
            await row.hover();
            await row.locator('.song-send-btn').click(); await p.waitForTimeout(300); await scan(p, 'song ⋯ menu'); await p.keyboard.press('Escape');
            const empty = await emptyList(p);
            if (empty) { await openList(p, empty); await scan(p, 'playlist: empty'); } else scans['playlist: empty'] = { ok: true, note: 'this account has no empty playlist' };
            await home(p);
            await openNp(p);
            await p.evaluate(() => { if (lyricsEnabled) { toggleLyrics(); window.dvSyncLyricsBtn(); } }); await p.waitForTimeout(400);
            await scan(p, 'Now Playing');
            await p.evaluate(() => { if (!lyricsEnabled) { toggleLyrics(); window.dvSyncLyricsBtn(); } }); await p.waitForTimeout(400);
            await scan(p, 'Now Playing: lyrics');
            await p.click('#dvNpMore'); await p.waitForTimeout(250); await scan(p, 'Now Playing ⋯ menu'); await p.keyboard.press('Escape');
            await p.evaluate(() => window.dvSidePanel.open('queue')); await p.waitForTimeout(500); await scan(p, 'Now Playing + side panel');
            await p.evaluate(() => { window.dvSidePanel.close(); window.dvNowPlaying.close(); }); await p.waitForTimeout(500);
            await p.click('#dvSideSearch'); await p.waitForTimeout(600);
            await scan(p, 'Search');
            await p.keyboard.type(await libQuery(p)); await p.waitForTimeout(1800);
            await scan(p, 'Search: results');
            const add = p.locator('#mSearchResults .m-sr-add').first();
            if (await add.count()) { await add.click(); await p.waitForTimeout(600); await scan(p, 'Add to playlist', 0); await p.keyboard.press('Escape'); await p.waitForTimeout(300); } else scans['Add to playlist'] = { ok: false, note: 'no YouTube result with +' };
            scans.errors = { ok: p.__errs.length === 0, v: p.__errs };
            await ctx.close();
        }
        {
            // A playlist loading, then one that failed to load
            const { ctx, p } = await open({ vp });
            await home(p);
            await p.route('**/save-music', async (route) => {
                const body = JSON.parse(route.request().postData() || '{}');
                if (body.action !== 'getPlaylist') return route.fallback();
                if (p.__fail) return route.fulfill({ status: 500, body: 'no' });
                await new Promise((r) => setTimeout(r, 3500));
                return route.fallback();
            });
            const ids = await p.evaluate(() => Object.keys(playlistsMeta).filter(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= 1));
            if (ids.length >= 2) {
                await p.evaluate((i) => { selectPlaylistFromCrate(i); }, ids[0]); await p.waitForTimeout(500);
                const busy = await p.evaluate(() => document.getElementById('songList').getAttribute('aria-busy'));
                await scan(p, 'playlist: loading');
                scans['playlist: loading'].ok = scans['playlist: loading'].ok && busy === 'true';
                await p.waitForTimeout(3500);
                await home(p);
                p.__fail = true;
                await p.evaluate((i) => { selectPlaylistFromCrate(i); }, ids[1]); await p.waitForTimeout(1500);
                const failed = await p.evaluate(() => !!document.querySelector('#songList .song-list-loading.is-failed [role="alert"]'));
                await scan(p, 'playlist: failed');
                scans['playlist: failed'].ok = scans['playlist: failed'].ok && failed;
            } else {
                scans['playlist: loading'] = scans['playlist: failed'] = { ok: true, note: 'fewer than two other playlists with songs' };
            }
            scans['errors (loading)'] = { ok: p.__errs.length === 0, v: p.__errs };
            await ctx.close();
        }
        {
            // Every window (the page behind is inert: the dialog's h2 is its title, no h1)
            const { ctx, p } = await open({ vp });
            await home(p);
            const wins = [
                ['Settings: Playback', () => { showSettingsModal(); setSettingsTab('playback'); }, () => hideSettingsModal()],
                ['Settings: Appearance', () => { showSettingsModal(); setSettingsTab('appearance'); }, () => hideSettingsModal()],
                ['Settings: Account', () => { showSettingsModal(); setSettingsTab('account'); }, () => hideSettingsModal()],
                ['Your listening', () => showStatsModal(), () => hideStatsModal()],
                ['Import: paste', () => { showSpotifyImportModal(); setImportTab('paste'); }, () => hideSpotifyImportModal()],
                ['Import: YouTube', () => { showSpotifyImportModal(); setImportTab('youtube'); }, () => hideSpotifyImportModal()],
                ['Import: Spotify', () => { showSpotifyImportModal(); if (document.querySelector('#importTabs [data-tab="spotify"]')) setImportTab('spotify'); }, () => hideSpotifyImportModal()],
                ['Add songs', () => showAddSongModal(), () => hideAddSongModal()],
                ['Bring your music over', () => showBringMusicModal(), () => hideBringMusicModal()],
                ['Edit playlist', () => showPlaylistEditModal(String(activePlaylistId)), () => hidePlaylistEditModal()],
                ['New playlist', () => showPlaylistCreateModal(), () => hidePlaylistEditModal()],
                ['GIF maker', () => openVinylGifModal(), () => closeVinylGifModal()],
                ['Keyboard shortcuts', () => window.dvKeys.open(), () => window.dvKeys.close()],
            ];
            for (const [name, show, hide] of wins) {
                await p.evaluate(show); await p.waitForTimeout(900);
                await scan(p, 'window: ' + name, 0);
                await p.evaluate(hide); await p.waitForTimeout(500);
            }
            scans['errors (windows)'] = { ok: p.__errs.length === 0, v: p.__errs };
            await ctx.close();
        }
        for (const [name, s] of Object.entries(scans)) {
            check(`${tag} E ${name}: ${name.startsWith('errors') ? 'no page errors' : 'axe clean, one h1 (none under a window), no duplicate ids'}`, s.ok, s);
        }
    }

    // ---- F. Less motion: nothing moves (the turntable, the playing bars,
    // the page fades); with no preference the fades still run
    for (const reduced of [true, false]) {
        const { ctx, p } = await open({ reduced });
        await home(p);
        await p.evaluate(() => { if (!document.getElementById('vinyl').classList.contains('playing')) toggleMusic(); });
        await p.waitForTimeout(600);
        const moving = () => p.evaluate(() => document.getAnimations()
            .filter((a) => a.playState === 'running' && Number(a.effect && a.effect.getComputedTiming().duration) > 1)
            .map((a) => (a.animationName || a.transitionProperty || 'anim') + '@' + ((a.effect.target && (a.effect.target.id || a.effect.target.className)) || '').toString().slice(0, 40)));
        const found = {};
        await p.evaluate((i) => selectPlaylistFromCrate(i), await otherWithSongs(p));
        await p.waitForTimeout(80);
        found.playlistOpening = await moving();
        await p.waitForTimeout(1200);
        found.playlist = await moving();
        await p.evaluate(() => window.dvNowPlaying.open()); await p.waitForTimeout(80);
        found.npOpening = await moving();
        await p.waitForTimeout(1000);
        found.np = await moving();
        await p.evaluate(() => window.dvNowPlaying.close()); await p.waitForTimeout(80);
        found.closing = await moving();
        await p.waitForTimeout(800);
        found.home = await moving();
        if (reduced) {
            check('F reduced motion: no animation or transition runs (Home, a playlist opening, Now Playing with the record playing, closing it)', Object.values(found).every((x) => x.length === 0), found);
        } else {
            check('F no preference: the pages still fade (the check sees motion when there is some)', found.playlistOpening.length > 0 || found.npOpening.length > 0 || found.closing.length > 0, found);
        }
        check(`F ${reduced ? 'reduced' : 'no preference'}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- G. Narrowing to a phone with the shortcuts window open
    {
        const { ctx, p } = await open({});
        await home(p);
        await p.keyboard.press('?'); await p.waitForTimeout(500);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
        const s = await p.evaluate(() => ({ keys: document.getElementById('dvKeysModal').classList.contains('active'), inert: ['dvSide', 'music-section', 'dvBar', 'dvPanel', 'dvSkip'].filter((id) => document.getElementById(id) && document.getElementById(id).inert) }));
        check('G narrowed to 390px with Keyboard shortcuts open: it closes, nothing left inert', !s.keys && s.inert.length === 0, s);
        check('G errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- H. Phones and the app: no shortcuts, no skip link, no shortcuts window
    for (const c of [{ vp: { width: 390, height: 844 }, phone: true }, { vp: { width: 844, height: 390 }, phone: true }, { vp: { width: 1440, height: 900 }, query: '?app=1' }]) {
        const tag = c.query ? 'app (?app=1) 1440x900' : `phone ${c.vp.width}x${c.vp.height}`;
        const { ctx, p } = await open(c);
        const look = () => p.evaluate(() => ({
            dv2: document.documentElement.classList.contains('dv2'),
            skip: getComputedStyle(document.getElementById('dvSkip')).display,
            keys: document.getElementById('dvKeysModal').classList.contains('active'),
            shuffle: shuffleMode, loop: loopMode, playing: document.getElementById('vinyl').classList.contains('playing'),
            vol: Math.round(currentVolume), idx: currentSongIndex,
            inert: ['dvSide', 'music-section', 'dvBar', 'dvPanel', 'dvSkip'].filter((id) => document.getElementById(id) && document.getElementById(id).inert),
        }));
        await blur(p);
        const a = await look();
        for (const k of ['?', 's', 'r', 'm', 'n', 'q', 'Control+ArrowRight', 'Control+ArrowDown']) { await p.keyboard.press(k); await p.waitForTimeout(80); }
        await p.waitForTimeout(400);
        const z = await look();
        check(`H ${tag}: no desktop layout, the skip link not shown`, !a.dv2 && a.skip === 'none', a);
        check(`H ${tag}: the desktop shortcuts do nothing (no window, modes, volume, song unchanged)`, !z.keys && z.shuffle === a.shuffle && z.loop === a.loop && z.vol === a.vol && z.idx === a.idx && z.inert.length === 0, { a, z });
        check(`H ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 1200)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
