// Step 12: Spotify-style browsing on phones. Opening a playlist shows it and
// leaves playback alone; Play or a song tap makes it the playing one.
// Writes to /save-music are faked and recorded (reads go through).
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    const b = await L.launch();

    async function open(opts = {}) {
        const desktop = !!opts.desktop;
        const ctx = await b.newContext({
            viewport: opts.vp || (desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }),
            isMobile: !desktop, hasTouch: !desktop,
            storageState: L.state(opts.acct || 'mid'),
        });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = []; p.__opts = opts;
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            const o = p.__opts;
            if (body.action === 'getPlaylist') {
                if (o.getDelay) await sleep(o.getDelay);
                if (o.getFail) return route.abort();
                if (o.resume && o.resume[body.playlist] !== undefined) {
                    const res = await route.fetch();
                    const json = await res.json();
                    json.playlist.currentIndex = o.resume[body.playlist];
                    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
                }
                return route.continue();
            }
            if (READS.includes(body.action)) return route.continue();
            if (body.action === 'switchPlaylist') {
                // Desktop opens: answer like the server would, without switching it
                const res = await route.fetch({ postData: JSON.stringify({ action: 'getPlaylist', playlist: body.playlist }) });
                const json = await res.json();
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, playlist: json.playlist, recentlyPlayed: [body.playlist] }) });
            }
            if (o.delay && o.delay[body.action]) await sleep(o.delay[body.action]);
            const a = o.answers && o.answers[body.action];
            const ans = typeof a === 'function' ? a(body) : (a || { success: true });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ans) });
        });
        await p.goto(APP); await p.waitForTimeout(1200);
        await p.evaluate(() => {
            // A stub player; record what the engine asks of it
            window.__yt = [];
            const stub = { _s: 5, loadVideoById(id) { window.__yt.push('load'); this._s = 1; }, cueVideoById() { window.__yt.push('cue'); this._s = 5; },
                playVideo() { window.__yt.push('play'); this._s = 1; }, pauseVideo() { window.__yt.push('pause'); this._s = 2; }, stopVideo() {},
                seekTo() {}, setVolume() {}, getVolume() { return 100; }, mute() {}, unMute() {}, isMuted() { return false; },
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__cued = []; window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); (cue ? window.__cued : window.__played).push(s && s.title); };
            window.__toasts = [];
            const t = window.mToast; if (t) window.mToast = function (m) { window.__toasts.push(m); return t.apply(this, arguments); };
        });
        return { ctx, p };
    }
    const playing = (p) => p.evaluate(() => {
        // Pretend the current song plays (body.m-playing follows #vinyl)
        document.getElementById('vinyl').classList.add('playing');
    });
    const snap = (p) => p.evaluate(() => ({
        active: String(activePlaylistId), len: songsData.length, cur: currentSongIndex,
        last: lastRequestedSong ? lastRequestedSong.title : null,
        dock: (document.getElementById('mDockInfo') || {}).textContent.replace(/\s+/g, ' ').trim(),
        dockHidden: document.getElementById('mDock').classList.contains('m-dock-hidden'),
        cued: window.__cued.length, played: window.__played.length, yt: window.__yt.length,
    }));
    const screen = (p) => p.evaluate(() => ({
        shown: document.getElementById('musicPlayerView').classList.contains('active'),
        viewedId, loading: listLoading(), failed: viewFailed,
        title: document.getElementById('playlistTitle').textContent.trim(),
        loadingRow: !!document.querySelector('#songList .song-list-loading:not(.is-failed)'),
        failedRow: !!document.querySelector('#songList .song-list-loading.is-failed'),
        busy: document.getElementById('songList').getAttribute('aria-busy'),
        rows: document.querySelectorAll('#songList .song-list-item:not(.discover-item)').length,
        activeRows: document.querySelectorAll('#songList .song-list-item.active').length,
        cls: document.getElementById('musicSidebar').className,
        pill: getComputedStyle(document.querySelector('#mPlayAll .m-when-paused')).display !== 'none' ? 'Play' : 'Pause',
        stackP: ((history.state && history.state.mStack) || []).filter(l => l.n === 'playlist').map(l => l.p),
    }));
    const writes = (p, action) => p.__posts.filter(x => !action || x.action === action);
    const playbackWrites = (p) => p.__posts.filter(x => ['switch', 'switchPlaylist'].includes(x.action));
    const meta = (p) => p.evaluate(() => Object.fromEntries(Object.keys(playlistsMeta).map(k => [k, { name: playlistsMeta[k].name, n: playlistsMeta[k].songCount }])));
    const tabTo = async (p, t) => { await p.tap(`#mTabs .m-tab[data-tab="${t}"]`); await p.waitForTimeout(400); };

    // ---- 1. Home tile, slow load: the screen + loading row at once; playback untouched
    {
        const { ctx, p } = await open({ getDelay: 1500 });
        await playing(p);
        const m = await meta(p);
        const before = await snap(p);
        const id = await p.evaluate(() => [...document.querySelectorAll('#mRecentPlaylists .m-rp-tile')].map(t => t.dataset.playlist)
            .find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 2));
        await p.tap(`#mRecentPlaylists .m-rp-tile[data-playlist="${id}"]`);
        await p.waitForTimeout(150);
        const early = await screen(p);
        check('1 Home tile: the screen and a loading row show at once (slow getPlaylist)',
            early.shown && early.loading && early.loadingRow && early.busy === 'true' && early.title === m[id].name && early.rows === 0, early);
        await p.waitForTimeout(1800);
        const late = await screen(p);
        const after = await snap(p);
        check('1 Home tile: the songs load, no row is marked playing, Play reads Play while music plays',
            late.viewedId === id && !late.loading && late.rows === m[id].n && late.activeRows === 0 && late.pill === 'Play' && /m-pl-viewing/.test(late.cls) && late.busy === null, late);
        check('1 Home tile: cue, dock, lastRequestedSong and the playing list are untouched; nothing switches on the server',
            JSON.stringify(before) === JSON.stringify(after) && playbackWrites(p).length === 0, { before, after, posts: playbackWrites(p) });
        check('1 the history entry records the viewed playlist', late.stackP.length === 1 && late.stackP[0] === id, late.stackP);
        check('1 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 2. Search tile and 3. Library card: the same, playback untouched
    {
        const { ctx, p } = await open();
        await playing(p);
        const before = await snap(p);
        await tabTo(p, 'search');
        const id = await p.evaluate(() => [...document.querySelectorAll('#mSearchResults .m-rp-tile')].map(t => t.dataset.playlist)
            .find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.tap(`#mSearchResults .m-rp-tile[data-playlist="${id}"]`);
        await p.waitForTimeout(900);
        const s = await screen(p);
        const after = await snap(p);
        check('2 Search tile: shows the playlist; playback and the server are untouched',
            s.shown && s.viewedId === id && s.rows > 0 && JSON.stringify(before) === JSON.stringify(after) && playbackWrites(p).length === 0, { s, before, after });
        await p.goBack(); await p.waitForTimeout(500);
        const closed = await screen(p);
        check('2 back closes the screen and puts the playing list back behind it',
            !closed.shown && closed.viewedId === null && closed.title === (await meta(p))[before.active].name, closed);
        await tabTo(p, 'library');
        const id2 = await p.evaluate((skip) => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && k !== skip && playlistsMeta[k].songCount > 0), id);
        await p.tap(`.record-card[data-playlist="${id2}"] .record-card-cover`);
        await p.waitForTimeout(900);
        const s2 = await screen(p);
        const after2 = await snap(p);
        check('3 Library card: shows the playlist; playback and the server are untouched',
            s2.shown && s2.viewedId === id2 && s2.rows > 0 && JSON.stringify(before) === JSON.stringify(after2) && playbackWrites(p).length === 0, { s2, after2 });
        check('2/3 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 4. Back during the load cancels it; tapping again opens and loads
    {
        const { ctx, p } = await open({ getDelay: 1500 });
        const id = await p.evaluate(() => [...document.querySelectorAll('#mRecentPlaylists .m-rp-tile')].map(t => t.dataset.playlist).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.tap(`#mRecentPlaylists .m-rp-tile[data-playlist="${id}"]`);
        await p.waitForTimeout(300);
        await p.goBack();
        await p.waitForTimeout(2200);
        const s = await screen(p);
        const toasts = await p.evaluate(() => window.__toasts.slice());
        check('4 back during the load: no late screen, no toast, the playing list is back',
            !s.shown && s.viewedId === null && !s.loading && toasts.length === 0 && s.rows > 0, { s, toasts });
        await p.tap(`#mRecentPlaylists .m-rp-tile[data-playlist="${id}"]`);
        await p.waitForTimeout(2000);
        const s2 = await screen(p);
        check('4 the same tile again: the screen opens and loads', s2.shown && s2.viewedId === id && !s2.loading && s2.rows > 0, s2);
        check('4 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 5. An empty playlist keeps the dock, also after a reload
    {
        const { ctx, p } = await open();
        const empty = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount === 0));
        const before = await snap(p);
        await p.evaluate((id) => selectPlaylistFromCrate(id), empty);
        await p.waitForTimeout(900);
        const s = await screen(p);
        const after = await snap(p);
        check('5 viewing an empty playlist (nothing playing): its empty card, and the dock stays with the playing song',
            s.viewedId === empty && /m-pl-empty/.test(s.cls) && !after.dockHidden && after.dock === before.dock && playbackWrites(p).length === 0, { s, before, after });
        await p.reload(); await p.waitForTimeout(2000);
        const r = await p.evaluate(() => ({ active: String(activePlaylistId), viewedId, dockHidden: document.getElementById('mDock').classList.contains('m-dock-hidden'), n: songsData.length }));
        check('5 after a reload: the dock is still there, the playing list unchanged, the empty playlist still on screen',
            r.active === before.active && !r.dockHidden && r.n === before.len && r.viewedId === empty, r);
        check('5 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 6. A row tap adopts with one activating 'switch' and plays the row
    {
        const { ctx, p } = await open();
        await playing(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 3));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const want = await p.evaluate(() => viewedSongs[2].title);
        await p.tap('#songList .song-list-item[data-index="2"]');
        await p.waitForTimeout(900);
        const st = await p.evaluate(() => ({ active: String(activePlaylistId), cur: currentSongIndex, viewedId, last: lastRequestedSong && lastRequestedSong.title,
            actRows: [...document.querySelectorAll('#songList .song-list-item.active')].map(r => r.dataset.index), cls: document.getElementById('musicSidebar').className,
            tileActive: (document.querySelector('#mRecentPlaylists .m-rp-tile.is-active') || {}).dataset }));
        const sw = writes(p, 'switch');
        const act = sw.filter(x => x.activate);
        check('6 row tap: the playlist becomes the playing one at that row, and it plays',
            st.active === id && st.cur === 2 && st.viewedId === null && st.last === want && st.actRows.join() === '2' && !/m-pl-viewing/.test(st.cls), st);
        check('6 row tap: exactly one switch with activate, naming the playlist and the row', act.length === 1 && act[0].playlist === id && act[0].index === 2
            && sw.every(x => x.playlist === id && x.index === 2), sw);
        check('6 the Home tile marker follows the playing playlist', st.tileActive && st.tileActive.playlist === id, st.tileActive);
        await p.evaluate(() => window.mOpenNowPlaying && window.mOpenNowPlaying()); await p.waitForTimeout(500);
        const from = await p.evaluate(() => document.getElementById('mNpFromName').textContent.trim());
        check('6 Now Playing says it plays from that playlist', from === (await meta(p))[id].name, from);
        check('6 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 7. Play resumes a shown playlist at its saved song and opens Now Playing
    {
        const id0 = 'pl-4';
        const { ctx, p } = await open({ resume: { [id0]: 3 } });
        await playing(p);
        const id = await p.evaluate((x) => playlistsMeta[x] && playlistsMeta[x].songCount > 4 && x !== String(activePlaylistId) ? x : null, id0);
        if (!id) { check('7 setup: pl-4 with 5+ songs, not playing', false, null); } else {
            await p.evaluate((i) => selectPlaylistFromCrate(i), id);
            await p.waitForTimeout(900);
            const pre = await screen(p);
            // (with shuffle on, Play starts a random song instead)
            const shuf = await p.evaluate(() => { const m = shuffleMode; shuffleMode = 'off'; return m; });
            const want = await p.evaluate(() => viewedSongs[3].title);
            await p.tap('#mPlayAll');
            await p.waitForTimeout(900);
            const st = await p.evaluate(() => ({ active: String(activePlaylistId), cur: currentSongIndex, last: lastRequestedSong && lastRequestedSong.title, np: document.body.classList.contains('m-np-open'), yt: window.__yt.slice() }));
            const act = writes(p, 'switch').filter(x => x.activate);
            check('7 Play on a shown playlist: Play label while another song plays; starts its saved song (no toggle/pause)',
                pre.pill === 'Play' && st.active === id && st.cur === 3 && st.last === want && !st.yt.includes('pause'), { pre: pre.pill, st });
            check('7 Play: one activating switch at the saved index; Now Playing opens', act.length === 1 && act[0].playlist === id && act[0].index === 3 && st.np, { act, np: st.np });
        }
        check('7 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 8. Now Playing's ⋯ acts on the playing list while another is shown
    {
        const { ctx, p } = await open({ answers: { delete: { success: true, newIndex: 5 } } });
        await playing(p);
        const before = await snap(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 3));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const viewed = await p.evaluate(() => ({ n: viewedSongs.length, count: document.querySelector('.sidebar-track-count').textContent }));
        const npSong = await p.evaluate(() => songsData[currentSongIndex].title);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(500);
        await p.tap('#mNpKebab'); await p.waitForTimeout(400);
        const sheetTitle = await p.evaluate(() => (document.querySelector('.send-menu-song-title') || {}).textContent);
        await p.tap('.send-menu-delete'); await p.waitForTimeout(150);
        await p.tap('.send-menu-delete'); await p.waitForTimeout(700);
        const del = writes(p, 'delete');
        const st = await p.evaluate(() => ({ len: songsData.length, vn: viewedSongs && viewedSongs.length, viewedId, count: document.querySelector('.sidebar-track-count').textContent }));
        check('8 NP ⋯ shows the playing song while another playlist is on screen', sheetTitle === npSong, { sheetTitle, npSong });
        check('8 NP ⋯ Remove deletes from the playing playlist at the playing index', del.length === 1 && del[0].playlist === before.active && del[0].index === before.cur, del);
        check('8 the shown playlist and its count are untouched', st.vn === viewed.n && st.count === viewed.count && st.len === before.len - 1 && st.viewedId === id, { st, viewed });
        check('8 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 9. Remove / move / reorder in a shown playlist name it and leave playback alone
    {
        const { ctx, p } = await open({ answers: {
            delete: { success: true, newIndex: 0 },
            moveSong: (body) => ({ success: true, newIndex: 0, fromCount: 3, toCount: 99 }),
        } });
        await playing(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= 5));
        const target = await p.evaluate((x) => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && k !== x && k !== 'favorites'), id);
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const before = await snap(p);
        const n0 = await p.evaluate(() => viewedSongs.length);
        // Remove row 1 through its song sheet
        await p.evaluate(() => showSendMenu(document.querySelector('#songList .song-list-item[data-index="1"] .song-send-btn'), 1));
        await p.waitForTimeout(400);
        await p.tap('.send-menu-delete'); await p.waitForTimeout(150);
        await p.tap('.send-menu-delete'); await p.waitForTimeout(700);
        const del = writes(p, 'delete');
        // Move row 0 to another playlist through the sheet's picker
        await p.evaluate(() => showSendMenu(document.querySelector('#songList .song-list-item[data-index="0"] .song-send-btn'), 0));
        await p.waitForTimeout(400);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(500);
        await p.evaluate(() => { document.querySelector('.send-menu-move-input').checked = true; });
        await p.tap(`.send-menu-pick[data-playlist="${target}"]`); await p.waitForTimeout(700);
        const mv = writes(p, 'moveSong');
        // Reorder: swap the first two rows and drop
        const order = await p.evaluate(() => {
            const list = document.getElementById('songList');
            const rows = list.querySelectorAll('.song-list-item:not(.discover-item)');
            list.insertBefore(rows[1], rows[0]);
            finishSongDrag();
            return viewedSongs.map(s => s.title);
        });
        await p.waitForTimeout(700);
        const ro = writes(p, 'reorder');
        const after = await snap(p);
        const st = await p.evaluate(() => ({ vn: viewedSongs.length, viewedId, rows: document.querySelectorAll('#songList .song-list-item:not(.discover-item)').length }));
        check('9 remove in a shown playlist names it (index into it)', del.length === 1 && del[0].playlist === id && del[0].index === 1, del);
        check('9 move from a shown playlist names it as fromPlaylist', mv.length === 1 && mv[0].fromPlaylist === id && mv[0].toPlaylist === target && mv[0].songIndex === 0, mv);
        check('9 reorder in a shown playlist names it', ro.length === 1 && ro[0].playlist === id && ro[0].order.length === n0 - 2, ro);
        check('9 the shown list follows (two fewer rows); playback, the playing list and the cue are untouched',
            st.vn === n0 - 2 && st.rows === n0 - 2 && st.viewedId === id && JSON.stringify(before) === JSON.stringify(after) && playbackWrites(p).length === 0, { st, before, after });
        check('9 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 10. Next stays in the playing list while another is shown
    {
        const { ctx, p } = await open();
        await playing(p);
        const before = await snap(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 3));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const want = await p.evaluate(() => (shuffleMode === 'off' ? songsData[(currentSongIndex + 1) % songsData.length].title : null));
        await p.tap('#mDockNext'); await p.waitForTimeout(900);
        const st = await p.evaluate(() => ({ active: String(activePlaylistId), last: lastRequestedSong && lastRequestedSong.title, viewedId, actRows: document.querySelectorAll('#songList .song-list-item.active').length }));
        const sw = writes(p, 'switch');
        check('10 Next plays the playing list\'s next song; the shown list keeps no playing row',
            st.active === before.active && (want === null || st.last === want) && st.viewedId === id && st.actRows === 0, { st, want });
        check('10 its save names the playing playlist, without activate', sw.length === 1 && sw[0].playlist === before.active && !sw[0].activate, sw);
        check('10 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 11. Show in playlist from a shown playlist: the playing list comes back, history follows
    {
        const { ctx, p } = await open();
        const before = await snap(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 3));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(500);
        await p.tap('#mNpKebab'); await p.waitForTimeout(400);
        await p.evaluate(() => { const b = [...document.querySelectorAll('.send-menu-item')].find(x => /Show in playlist/.test(x.textContent)); b.click(); });
        await p.waitForTimeout(1500);
        const s = await screen(p);
        const flashed = await p.evaluate(() => [...document.querySelectorAll('#songList .m-row-flash')].map(r => r.dataset.index));
        check('11 Show in playlist: the playing list is on screen, its row lit, history records it',
            s.shown && s.viewedId === null && s.title === (await meta(p))[before.active].name && flashed.join() === String(before.cur) && s.stackP.join() === before.active, { s, flashed });
        check('11 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 12. A failed load shows Retry (no layer popped); Retry loads it
    {
        const { ctx, p } = await open({ getFail: true });
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const s = await screen(p);
        check('12 failed load: an error row with Retry, the screen stays', s.shown && s.failedRow && s.viewedId === id && s.busy === null && s.stackP.join() === id, s);
        p.__opts.getFail = false;
        await p.tap('.song-list-retry'); await p.waitForTimeout(900);
        const s2 = await screen(p);
        check('12 Retry loads the songs', !s2.loading && s2.rows > 0 && !s2.failedRow, s2);
        check('12 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 13. Leaving the shell (landscape phone unfolding) collapses the view
    {
        const { ctx, p } = await open({ vp: { width: 844, height: 390 } });
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const s = await screen(p);
        await p.setViewportSize({ width: 1104, height: 884 }); await p.waitForTimeout(600);
        const s2 = await screen(p);
        const name = (await meta(p))[await p.evaluate(() => String(activePlaylistId))].name;
        check('13 landscape shell shows the playlist; leaving the shell puts the playing list back', s.viewedId === id && s2.viewedId === null && s2.title === name, { s, s2 });
        check('13 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 14. Desktop still switches and cues on open
    {
        const { ctx, p } = await open({ desktop: true });
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(1200);
        const st = await p.evaluate(() => ({ active: String(activePlaylistId), viewedId, cued: window.__cued.slice(), cur: songsData[currentSongIndex] && songsData[currentSongIndex].title, title: document.getElementById('playlistTitle').textContent.trim() }));
        check('14 desktop: opening a playlist switches to it and cues its song', st.active === id && st.viewedId === null && st.cued.includes(st.cur)
            && writes(p, 'switchPlaylist').length === 1 && writes(p, 'getPlaylist').length === 0, { st, posts: p.__posts.map(x => x.action) });
        const row = await p.evaluate(() => { playListRow(1); return true; });
        await p.waitForTimeout(1500);
        const sw = writes(p, 'switch');
        check('14 desktop: a row tap saves into the open playlist (named), never activating', sw.length === 1 && sw[0].playlist === id && sw[0].index === 1 && !sw[0].activate, sw);
        check('14 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 15. Play after a remove starts the saved song where the server moved it
    {
        const id0 = 'pl-4';
        const { ctx, p } = await open({ resume: { [id0]: 3 }, answers: { delete: { success: true, newIndex: 2 } } });
        await playing(p);
        await p.evaluate(() => { shuffleMode = 'off'; });
        await p.evaluate((i) => selectPlaylistFromCrate(i), id0);
        await p.waitForTimeout(900);
        const want = await p.evaluate(() => viewedSongs[3].title);
        await p.evaluate(() => deleteSong(0, { skipConfirm: true })); await p.waitForTimeout(500);
        const resume = await p.evaluate(() => viewedResume);
        await p.tap('#mPlayAll'); await p.waitForTimeout(900);
        const st = await p.evaluate(() => ({ cur: currentSongIndex, last: lastRequestedSong && lastRequestedSong.title, active: String(activePlaylistId) }));
        const act = writes(p, 'switch').filter(x => x.activate);
        check('15 remove row 0 of a shown playlist (saved song 3), then Play: its saved song plays at its new place',
            resume === 2 && st.active === id0 && st.cur === 2 && st.last === want && act.length === 1 && act[0].index === 2, { resume, st, act, want });
        check('15 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 16. A tap while a track change or an edit is in flight
    {
        const { ctx, p } = await open();
        await playing(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 3));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        // An edit still saving: the tap is refused with a note
        await p.evaluate(() => { songOpInFlight = true; });
        await p.tap('#songList .song-list-item[data-index="1"]'); await p.waitForTimeout(400);
        const s1 = await p.evaluate(() => ({ active: String(activePlaylistId), viewedId, toasts: window.__toasts.slice() }));
        await p.evaluate(() => { songOpInFlight = false; });
        check('16 a row tap while an edit saves: "Still saving", nothing adopted', s1.viewedId === id && s1.active !== id
            && s1.toasts.some(t => /Still saving/.test(t)) && writes(p, 'switch').length === 0, s1);
        // A track change in flight: the tap waits for it, then plays
        await p.evaluate(() => { isChangingSong = true; setTimeout(() => { isChangingSong = false; }, 600); });
        await p.tap('#songList .song-list-item[data-index="3"]'); await p.waitForTimeout(200);
        const mid = await p.evaluate(() => ({ active: String(activePlaylistId), viewedId }));
        await p.waitForTimeout(1200);
        const s2 = await p.evaluate(() => ({ active: String(activePlaylistId), cur: currentSongIndex, viewedId, last: lastRequestedSong && lastRequestedSong.title, want: songsData[3] && songsData[3].title }));
        const act = writes(p, 'switch').filter(x => x.activate);
        check('16 a row tap during a track change waits for it, then adopts and plays the row',
            mid.viewedId === id && mid.active !== id && s2.active === id && s2.cur === 3 && s2.last === s2.want && act.length === 1 && act[0].index === 3, { mid, s2, act });
        // Now Playing's ⋯ refuses when what plays isn't the current row
        await p.evaluate(() => { currentRowUnloaded = true; window.mOpenNowPlaying(); }); await p.waitForTimeout(500);
        await p.tap('#mNpKebab'); await p.waitForTimeout(400);
        const k = await p.evaluate(() => ({ sheet: !!document.querySelector('.send-menu-sheet'), toasts: window.__toasts.slice(-1) }));
        check('16 NP ⋯ refuses while the current row hasn\'t started (no sheet on a song that isn\'t playing)', !k.sheet && /isn't in the playlist/.test(k.toasts[0] || ''), k);
        check('16 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 17. Reload on a shown playlist brings it back (loading, then its songs)
    {
        const { ctx, p } = await open({ getDelay: 800 });
        const before = await snap(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(1300);
        await p.reload(); await p.waitForTimeout(300);
        const early = await p.evaluate(() => ({ viewedId, loading: listLoading(), title: document.getElementById('playlistTitle').textContent.trim(), loadingRow: !!document.querySelector('#songList .song-list-loading') }));
        await p.waitForTimeout(1500);
        const s = await screen(p);
        const after = await p.evaluate(() => ({ active: String(activePlaylistId), len: songsData.length }));
        const name = (await meta(p))[id].name;
        check('17 reload: the shown playlist comes back under its name, loading, then its songs; the playing list stays',
            early.viewedId === id && early.loadingRow && early.title === name && s.shown && s.viewedId === id && s.rows > 0 && s.stackP.join() === id
            && after.active === before.active && after.len === before.len, { early, s, after });
        check('17 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 18. Add songs from a shown playlist goes into it, without touching playback
    {
        const { ctx, p } = await open({ answers: { addBatch: { success: true, added: 1, skipped: 0 } } });
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: [{ videoId: 'abcdefghijk', title: 'New Tune', channel: 'Chan', thumbnail: '' }] }) }));
        await playing(p);
        const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(900);
        const before = await snap(p);
        const n0 = await p.evaluate(() => viewedSongs.length);
        await p.tap('#mPlAdd'); await p.waitForTimeout(500);
        const to = await p.evaluate(() => document.getElementById('mAddToName').textContent.trim());
        await p.fill('#addSongSearch', 'new tune'); await p.dispatchEvent('#addSongSearch', 'input'); await p.waitForTimeout(1500);
        await p.evaluate(() => { const r = document.querySelector('#addSongSearchResults [data-add-i="0"]'); if (r) r.click(); });
        await p.waitForTimeout(900);
        const add = writes(p, 'addBatch');
        const after = await snap(p);
        const st = await p.evaluate(() => ({ vn: viewedSongs && viewedSongs.length, last: viewedSongs && viewedSongs[viewedSongs.length - 1].title }));
        check('18 Add songs on a shown playlist: "To" is that playlist; the song lands in it; playback untouched',
            to === (await meta(p))[id].name && add.length === 1 && add[0].playlist === id && st.vn === n0 + 1 && st.last === 'New Tune'
            // (the dock hides for the keyboard while the sheet's search has focus)
            && JSON.stringify({ ...before, dockHidden: 0 }) === JSON.stringify({ ...after, dockHidden: 0 }), { to, add, st, before, after });
        check('18 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
