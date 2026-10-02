// Desktop step 3: the left sidebar (#dvSide) at 1440x900 and 1024x768, and
// its icon rail at 800x600. Checks that it lists every playlist with the
// playing one marked; that opening a playlist from it only SHOWS it (the
// playing song, its cue and the bar stay as they were; no switch is saved)
// and that a song row or Play then makes it the playing one; Home and
// Search; the + menu; renames, counts and deletes reaching it; the source
// chips; the keyboard; crackle and make gif; and that phones (390x844,
// 844x390) and the app shell (?app=1) get no sidebar (the app still
// switches and cues on open). Writes to /save-music are faked and
// recorded (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();

    async function open(opts = {}) {
        const vp = opts.vp || { width: 1440, height: 900 };
        const phone = !!opts.phone;
        const ctx = await b.newContext({
            viewport: vp, isMobile: phone, hasTouch: phone,
            storageState: L.state(opts.acct || 'mid'),
        });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|lrclib\.net/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            if (body.action === 'switchPlaylist') {
                // Answer like the server would, without switching it
                const res = await route.fetch({ postData: JSON.stringify({ action: 'getPlaylist', playlist: body.playlist }) });
                const json = await res.json();
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, playlist: json.playlist, recentlyPlayed: [body.playlist] }) });
            }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.raw) return { ctx, p };
        await p.evaluate(() => {
            // A stub player; record what the engine asks of it
            window.__yt = [];
            const stub = { _s: 5, _t: 0, loadVideoById() { window.__yt.push('load'); this._s = 1; }, cueVideoById() { window.__yt.push('cue'); this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; },
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__cued = []; window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); (cue ? window.__cued : window.__played).push(s && s.title); };
            // No outside services: radio and lyrics lookups are no-ops here
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
        });
        return { ctx, p };
    }
    // ---- end open

    const writes = (p, action) => p.__posts.filter(x => x.action === action);
    // The sidebar as it stands, and what plays
    const side = (p) => p.evaluate(() => {
        const nav = document.getElementById('dvSide');
        const r = nav.getBoundingClientRect();
        const ms = document.getElementById('music-section').getBoundingClientRect();
        const bar = document.getElementById('dvBar');
        const rows = [...document.querySelectorAll('#dvSideList > li')].map((li) => {
            const btn = li.querySelector('.dv-side-pl');
            return {
                id: btn.dataset.playlist, hidden: li.hidden,
                name: btn.querySelector('.dv-side-name').textContent,
                count: btn.querySelector('.dv-side-count').textContent,
                playing: btn.classList.contains('is-playing'),
                eq: getComputedStyle(btn.querySelector('.dv-side-eq')).display !== 'none',
                open: btn.classList.contains('is-open'),
                current: btn.getAttribute('aria-current'),
                tab: btn.tabIndex,
            };
        });
        return {
            display: getComputedStyle(nav).display,
            left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width),
            msLeft: Math.round(ms.left), barTop: getComputedStyle(bar).display === 'none' ? innerHeight : Math.round(bar.getBoundingClientRect().top), vh: innerHeight, vw: innerWidth,
            home: document.getElementById('dvSideHome').getAttribute('aria-current'),
            search: document.getElementById('dvSideSearch').getAttribute('aria-current'),
            rows,
        };
    });
    const playState = (p) => p.evaluate(() => ({
        active: String(activePlaylistId), cur: currentSongIndex, n: songsData.length,
        song: songsData[currentSongIndex] ? songsData[currentSongIndex].title : null,
        viewedId, onScreen: String(listId()),
        bar: document.querySelector('#dvBar .song-title').textContent.trim(),
        cued: window.__cued.length, played: window.__played.slice(), yt: window.__yt.length,
        crate: !document.getElementById('vinylCrateView').classList.contains('hidden'),
        player: document.getElementById('musicPlayerView').classList.contains('active'),
        title: document.getElementById('playlistTitle').textContent.trim(),
    }));
    const meta = (p) => p.evaluate(() => JSON.parse(JSON.stringify(playlistsMeta)));
    const otherWithSongs = (p, not = []) => p.evaluate((skip) => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && !skip.includes(k) && playlistsMeta[k].songCount > 1), not);
    const clickRow = (p, id) => p.click(`#dvSideList .dv-side-pl[data-playlist="${id}"]`);

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. Layout, every playlist listed, the playing one marked
        {
            const { ctx, p } = await open({ vp });
            const s = await side(p);
            const m = await meta(p);
            const ids = Object.keys(m);
            const active = await p.evaluate(() => String(activePlaylistId));
            check(`${tag} A the sidebar shows down the left, the page starts at its right edge, both end above the bar`,
                s.display !== 'none' && s.left === 0 && s.top === 0 && s.w >= 200 && s.w <= 300 && s.msLeft === s.right && s.bottom <= s.barTop, s);
            check(`${tag} A every playlist is listed, in order, with its name and song count`,
                s.rows.length === ids.length && s.rows.every((r, i) => r.id === ids[i] && r.name === m[r.id].name && r.count === `${m[r.id].songCount} ${m[r.id].songCount === 1 ? 'song' : 'songs'}`), { rows: s.rows, ids });
            const playing = s.rows.filter(r => r.playing);
            check(`${tag} A only the playing playlist is marked (amber + bars)`, playing.length === 1 && playing[0].id === active && playing[0].eq && s.rows.filter(r => r.eq).length === 1, { playing, active });
            check(`${tag} A on the collection: Home is current, no playlist is`, s.home === 'page' && !s.search && s.rows.every(r => !r.current), s);
            const sem = await p.evaluate(() => {
                const nav = document.getElementById('dvSide');
                const lib = document.getElementById('dvSideList');
                return {
                    tag: nav.tagName, label: nav.getAttribute('aria-label'), listTag: lib.tagName, listName: lib.getAttribute('aria-labelledby') && document.getElementById(lib.getAttribute('aria-labelledby')).textContent.trim(),
                    lis: [...lib.children].every(li => li.tagName === 'LI' && li.firstElementChild.tagName === 'BUTTON'),
                    tabbable: [...lib.querySelectorAll('.dv-side-pl')].filter(b => b.tabIndex === 0).length,
                    unlabeled: [...nav.querySelectorAll('button')].filter(e => !(e.getAttribute('aria-label') || e.textContent.trim())).map(e => e.id || e.className),
                    dupIds: [...nav.querySelectorAll('[id]')].map(e => e.id).filter(id => document.querySelectorAll(`[id="${id}"]`).length !== 1),
                };
            });
            check(`${tag} A a labelled nav landmark, a labelled list of buttons, one row in the Tab order, every control named, no duplicate ids`,
                sem.tag === 'NAV' && !!sem.label && sem.listTag === 'UL' && sem.listName === 'Your Library' && sem.lis && sem.tabbable === 1 && sem.unlabeled.length === 0 && sem.dupIds.length === 0, sem);
            const gone = await p.evaluate(() => ({
                back: getComputedStyle(document.getElementById('backToCrate')).display,
                rail: getComputedStyle(document.querySelector('#vinylCrateView .room-left')).display,
                crackle: getComputedStyle(document.getElementById('dvSideCrackle')).display, gif: getComputedStyle(document.getElementById('dvSideGif')).display,
                pitch: !!document.getElementById('pitchSlider'),
            }));
            check(`${tag} A the "← Crate" button and the crate's console rail are gone; crackle and make gif sit in the sidebar (pitch stays on the deck)`,
                gone.back === 'none' && gone.rail === 'none' && gone.crackle !== 'none' && gone.gif !== 'none' && gone.pitch, gone);
            // Many playlists: the list scrolls on its own, the page doesn't move
            const scroll = await p.evaluate(() => { const l = document.getElementById('dvSideList'); const o = getComputedStyle(l).overflowY; return { o, sh: l.scrollHeight, ch: l.clientHeight }; });
            check(`${tag} A the playlist list is its own scroller`, scroll.o === 'auto', scroll);
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. Opening a playlist only shows it; C. a song row then plays it
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p);
            const name = (await meta(p))[id].name;
            const s0 = await playState(p);
            await clickRow(p, id);
            await p.waitForTimeout(1200);
            const s1 = await playState(p);
            const rows = await p.evaluate(() => [...document.querySelectorAll('#songList .song-list-item:not(.discover-item)')].map(r => r.querySelector('.song-list-title').textContent));
            const n = (await meta(p))[id].songCount;
            check(`${tag} B a playlist opens on screen: its title and songs, the player view up`,
                s1.player && !s1.crate && s1.viewedId === id && s1.onScreen === id && s1.title === name && rows.length === n, { s1, rows: rows.length, n });
            check(`${tag} B playback untouched: same playing list and song, no cue, the bar unchanged`,
                s1.active === s0.active && s1.cur === s0.cur && s1.song === s0.song && s1.bar === s0.bar && s1.cued === s0.cued && s1.played.length === 0 && s1.yt === s0.yt, { s0, s1 });
            check(`${tag} B nothing saved: no switchPlaylist, no switch; one getPlaylist read`,
                writes(p, 'switchPlaylist').length === 0 && writes(p, 'switch').length === 0 && writes(p, 'getPlaylist').length === 1, p.__posts.map(x => x.action));
            const sb = await side(p);
            const row = sb.rows.find(r => r.id === id);
            const playingRow = sb.rows.find(r => r.playing);
            check(`${tag} B the sidebar: the opened one is current (aria-current, highlighted), the playing one still marked, Home not current`,
                row.current === 'page' && row.open && !row.playing && playingRow && playingRow.id === s0.active && sb.home === null && row.tab === 0, { row, playingRow, home: sb.home });
            const play = await p.evaluate(() => { const b = document.getElementById('dvPlPlay'); return { shown: getComputedStyle(b).display !== 'none', label: b.textContent.trim(), dis: b.disabled }; });
            check(`${tag} B the playlist shows a Play button`, play.shown && play.label === 'Play' && !play.dis, play);

            // C. A song row adopts the list and plays that song
            const want = await p.evaluate(() => viewedSongs[1].title);
            await p.click('#songList .song-list-item[data-index="1"]');
            await p.waitForTimeout(1800);
            const s2 = await playState(p);
            const sw = writes(p, 'switch');
            check(`${tag} C a song tap makes it the playing list and plays that song`,
                s2.active === id && s2.viewedId === null && s2.cur === 1 && s2.played.includes(want), { s2, want });
            check(`${tag} C the switch is saved (activate, into that playlist)`, sw.some(x => x.playlist === id && x.activate === true && x.index === 1), sw);
            const sb2 = await side(p);
            check(`${tag} C the sidebar marks it playing (and still current)`, sb2.rows.filter(r => r.playing).map(r => r.id).join() === id && sb2.rows.find(r => r.id === id).current === 'page', sb2.rows);
            check(`${tag} B/C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. Play on a shown playlist; E. Home and Search
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p);
            await clickRow(p, id);
            await p.waitForTimeout(1200);
            const songs = await p.evaluate(() => viewedSongs.map(s => s.title));
            await p.click('#dvPlPlay');
            await p.waitForTimeout(1800);
            const s1 = await playState(p);
            check(`${tag} D Play makes the shown playlist the playing one and starts one of its songs`,
                s1.active === id && s1.viewedId === null && s1.played.length === 1 && songs.includes(s1.played[0]) && writes(p, 'switch').some(x => x.playlist === id && x.activate === true), { s1, songs });

            // E. Back to a shown (not playing) playlist, then Home
            const other = await otherWithSongs(p);
            await clickRow(p, other);
            await p.waitForTimeout(1200);
            await p.click('#dvSideHome');
            await p.waitForTimeout(700);
            const h = await playState(p);
            const sh = await side(p);
            check(`${tag} E Home: the collection again, Home current, no playlist current, the shown one put away`,
                h.crate && !h.player && h.viewedId === null && h.active === id && sh.home === 'page' && sh.rows.every(r => !r.current), { h, home: sh.home });
            // The bar's turntable opens the playing list (not the one shown before)
            await p.click('#dvBarDeck');
            await p.waitForTimeout(700);
            const t = await playState(p);
            const st = await side(p);
            check(`${tag} E the turntable then opens the playing list (current in the sidebar)`, t.player && t.onScreen === id && st.rows.find(r => r.id === id).current === 'page', { t });
            await p.click('#dvSideHome');
            await p.waitForTimeout(500);
            await p.click('#dvSideSearch');
            await p.waitForTimeout(400);
            const se = await p.evaluate(() => ({ open: document.getElementById('searchModal').classList.contains('active'), focus: document.activeElement && document.activeElement.id }));
            const ss = await side(p);
            check(`${tag} E Search opens the search window and is current`, se.open && ss.search === 'page' && ss.home === null, { se, search: ss.search, home: ss.home });
            await p.evaluate(() => hideSearchModal());
            await p.waitForTimeout(300);
            const sh2 = await side(p);
            check(`${tag} E closing search makes Home current again`, sh2.home === 'page' && !sh2.search, sh2);
            check(`${tag} D/E errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- F. The + menu; G. renames, counts and deletes reach the sidebar
        {
            const { ctx, p } = await open({ vp });
            await p.click('#dvSideAdd');
            const m1 = await p.evaluate(() => ({ hidden: document.getElementById('dvSideAddMenu').hidden, exp: document.getElementById('dvSideAdd').getAttribute('aria-expanded'), focus: document.activeElement && document.activeElement.dataset.dvAdd }));
            await p.keyboard.press('ArrowDown');
            const f2 = await p.evaluate(() => document.activeElement.dataset.dvAdd);
            await p.keyboard.press('Escape');
            const m2 = await p.evaluate(() => ({ hidden: document.getElementById('dvSideAddMenu').hidden, exp: document.getElementById('dvSideAdd').getAttribute('aria-expanded'), focus: document.activeElement.id }));
            check(`${tag} F + opens its menu (focus on New playlist), arrows move, Escape closes back to +`,
                !m1.hidden && m1.exp === 'true' && m1.focus === 'new' && f2 === 'bring' && m2.hidden && m2.exp === 'false' && m2.focus === 'dvSideAdd', { m1, f2, m2 });
            await p.click('#dvSideAdd');
            await p.click('#dvSideAddMenu [data-dv-add="new"]');
            await p.waitForTimeout(300);
            const n1 = await p.evaluate(() => ({ open: document.getElementById('playlistEditModal').classList.contains('active'), title: document.getElementById('playlistEditModalTitle').textContent, menu: document.getElementById('dvSideAddMenu').hidden }));
            check(`${tag} F New playlist opens the create window`, n1.open && n1.title === 'New Playlist' && n1.menu, n1);
            await p.evaluate(() => hidePlaylistEditModal());
            await p.click('#dvSideAdd');
            await p.click('#dvSideAddMenu [data-dv-add="bring"]');
            await p.waitForTimeout(300);
            const n2 = await p.evaluate(() => document.getElementById('bringMusicModal').classList.contains('active'));
            check(`${tag} F Bring your music over opens the chooser`, n2, n2);
            await p.evaluate(() => hideBringMusicModal());
            await p.click('#dvSideAdd');
            await p.click('#dvSideHome'); // an outside click closes it
            const n3 = await p.evaluate(() => document.getElementById('dvSideAddMenu').hidden);
            check(`${tag} F a click elsewhere closes the menu`, n3, n3);

            // G. Rename (through the edit window), counts, a delete
            const id = await otherWithSongs(p);
            await p.evaluate((i) => showPlaylistEditModal(i), id);
            await p.fill('#playlistEditName', 'Renamed <b>x</b>');
            await p.evaluate(() => savePlaylistEdit()); await p.waitForTimeout(600);
            const g1 = await p.evaluate((i) => { const b = document.querySelector(`#dvSideList [data-playlist="${i}"]`); return { name: b.querySelector('.dv-side-name').textContent, html: b.querySelector('.dv-side-name').innerHTML }; }, id);
            check(`${tag} G a rename shows in the sidebar (as text)`, g1.name === 'Renamed <b>x</b>' && g1.html === 'Renamed &lt;b&gt;x&lt;/b&gt;', g1);
            const before = (await meta(p))[id].songCount;
            await p.evaluate((i) => bumpSongCount(i), id); await p.waitForTimeout(100);
            const g2 = await p.evaluate((i) => document.querySelector(`#dvSideList [data-playlist="${i}"] .dv-side-count`).textContent, id);
            check(`${tag} G a song added to another playlist counts there`, g2 === `${before + 1} songs`, { g2, before });
            await p.evaluate(() => { songsData.push(Object.assign({}, songsData[0], { title: 'One more' })); updateTrackCount(); }); await p.waitForTimeout(100);
            const g3 = await p.evaluate(() => ({ text: document.querySelector(`#dvSideList [data-playlist="${String(activePlaylistId)}"] .dv-side-count`).textContent, n: songsData.length }));
            check(`${tag} G the playing list's count follows its songs`, g3.text === `${g3.n} songs`, g3);
            await p.evaluate((i) => forgetPlaylist(i), id); await p.waitForTimeout(100);
            const g4 = await p.evaluate((i) => ({ row: !!document.querySelector(`#dvSideList [data-playlist="${i}"]`), n: document.querySelectorAll('#dvSideList > li').length, meta: Object.keys(playlistsMeta).length }), id);
            check(`${tag} G a deleted playlist leaves the sidebar`, !g4.row && g4.n === g4.meta, g4);
            // A recolour reaches the cover tile
            const id2 = await otherWithSongs(p);
            await p.evaluate((i) => { showPlaylistEditModal(i); selectedEditColor = '#ff8fa3'; }, id2);
            await p.evaluate(() => savePlaylistEdit()); await p.waitForTimeout(600);
            const g5 = await p.evaluate((i) => document.querySelector(`#dvSideList [data-playlist="${i}"]`).style.getPropertyValue('--pl-color'), id2);
            check(`${tag} G a recolour reaches the row`, g5.trim() === '#ff8fa3', g5);
            check(`${tag} F/G errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- H. Source chips, keyboard, crackle and make gif (1440)
    {
        const { ctx, p } = await open({});
        const src = await p.evaluate(() => [...document.querySelectorAll('#dvSideList > li')].map(li => li.dataset.source));
        await p.click('#dvSide [data-dv-source="spotify"]');
        const h1 = await side(p);
        const crate1 = await p.evaluate(() => ({ room: document.getElementById('roomCenter').getAttribute('data-active-source'), pressed: document.querySelector('#dvSide [data-dv-source="spotify"]').getAttribute('aria-pressed') }));
        check('H the Spotify chip filters the sidebar and the crate (one setting)', crate1.room === 'spotify' && crate1.pressed === 'true' && h1.rows.every((r, i) => r.hidden === (src[i] !== 'spotify')), { crate1, src, hidden: h1.rows.map(r => r.hidden) });
        await p.evaluate(() => setSourceFilter('all')); // the crate's own chips reach the sidebar
        const h2 = await side(p);
        const pressed = await p.evaluate(() => document.querySelector('#dvSide [data-dv-source="all"]').getAttribute('aria-pressed'));
        check('H All (from the crate) shows every playlist again', h2.rows.every(r => !r.hidden) && pressed === 'true', { pressed });

        // Keyboard: Tab reaches one row; arrows move; Enter opens
        await p.focus('#dvSideList .dv-side-pl[tabindex="0"]');
        const k0 = await p.evaluate(() => document.activeElement.dataset.playlist);
        await p.keyboard.press('ArrowDown');
        const k1 = await p.evaluate(() => ({ id: document.activeElement.dataset.playlist, tabs: [...document.querySelectorAll('#dvSideList .dv-side-pl')].filter(b => b.tabIndex === 0).map(b => b.dataset.playlist) }));
        await p.keyboard.press('End');
        const kEnd = await p.evaluate(() => document.activeElement.dataset.playlist);
        await p.keyboard.press('Home');
        const kHome = await p.evaluate(() => document.activeElement.dataset.playlist);
        await p.keyboard.press('ArrowDown');
        await p.keyboard.press('Enter');
        await p.waitForTimeout(1200);
        const k2 = await p.evaluate(() => ({ list: String(listId()), focus: document.activeElement && document.activeElement.dataset.playlist }));
        const ids = Object.keys(await meta(p));
        check('H keyboard: one row tabbable, arrows/Home/End move, Enter opens the focused playlist (focus stays)',
            k1.id === ids[ids.indexOf(k0) + 1] && k1.tabs.join() === k1.id && kEnd === ids[ids.length - 1] && kHome === ids[0] && k2.list === ids[1] && k2.focus === ids[1], { k0, k1, kEnd, kHome, k2 });
        // The focus order: the sidebar before the page, the page before the bar
        const order = await p.evaluate(() => {
            const pos = (a, c) => a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING;
            const s = document.getElementById('dvSide'), m = document.getElementById('music-section'), bar = document.getElementById('dvBar');
            return !!pos(s, m) && !!pos(m, bar);
        });
        check('H focus order: sidebar, page, player bar', order, order);

        const c0 = await p.evaluate(() => crackleEnabled);
        await p.click('#dvSideCrackle');
        const c1 = await p.evaluate(() => ({ on: crackleEnabled, pressed: document.getElementById('dvSideCrackle').getAttribute('aria-pressed'), rail: document.getElementById('crackleBtn').dataset.crackle }));
        await p.evaluate(() => setCrackleEnabledFromSettings(!crackleEnabled)); // Settings flips it back
        const c2 = await p.evaluate(() => ({ on: crackleEnabled, pressed: document.getElementById('dvSideCrackle').getAttribute('aria-pressed') }));
        check('H crackle: the sidebar toggles it and follows Settings', c1.on === !c0 && c1.pressed === String(!c0) && c1.rail === (c1.on ? 'on' : 'off') && c2.on === c0 && c2.pressed === String(c0), { c0, c1, c2 });
        await p.click('#dvSideGif');
        await p.waitForTimeout(300);
        const gif = await p.evaluate(() => document.getElementById('vinylGifModal').classList.contains('active'));
        check('H make gif opens the GIF maker', gif, gif);
        check('H errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- I. 800x600: the icon rail
    {
        const vp = { width: 800, height: 600 };
        const { ctx, p } = await open({ vp });
        const s = await side(p);
        const m = await meta(p);
        const look = await p.evaluate(() => {
            const vis = (el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && r.width > 1 && r.height > 1; };
            const first = document.querySelector('#dvSideList .dv-side-pl');
            return {
                labels: [...document.querySelectorAll('#dvSide .dv-side-label, #dvSide .dv-side-text')].some(vis),
                chips: vis(document.querySelector('#dvSide .dv-side-chips')),
                art: vis(first.querySelector('.dv-side-art')),
                name: first.textContent.replace(/\s+/g, ' ').trim(), title: first.title,
                home: vis(document.getElementById('dvSideHome')), add: vis(document.getElementById('dvSideAdd')),
            };
        });
        check('I 800: an icon rail (covers, no text on screen, names kept for screen readers), the page beside it',
            s.display !== 'none' && s.w <= 90 && s.msLeft === s.right && !look.labels && !look.chips && look.art && look.home && look.add && look.name.startsWith(m[s.rows[0].id].name) && look.title === m[s.rows[0].id].name && s.rows.length === Object.keys(m).length, { s, look });
        const id = await otherWithSongs(p);
        const s0 = await playState(p);
        await clickRow(p, id);
        await p.waitForTimeout(1200);
        const s1 = await playState(p);
        check('I 800: a cover opens its playlist without playing it', s1.viewedId === id && s1.player && s1.active === s0.active && s1.song === s0.song && writes(p, 'switch').length === 0, { s0, s1 });
        await p.click('#dvSideAdd');
        const menu = await p.evaluate(() => { const r = document.getElementById('dvSideAddMenu').getBoundingClientRect(); return { hidden: document.getElementById('dvSideAddMenu').hidden, left: Math.round(r.left), right: Math.round(r.right), w: innerWidth }; });
        check('I 800: the + menu opens inside the window', !menu.hidden && menu.left >= 0 && menu.right <= menu.w, menu);
        check('I errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- J. Accounts with little or nothing
    {
        const { ctx, p } = await open({ acct: 'demo' });
        const s = await side(p);
        check('J demo (one empty Favorites): one row, not marked playing', s.rows.length === 1 && !s.rows[0].playing && !s.rows[0].eq && s.rows[0].count === '0 songs', s.rows);
        const play = await p.evaluate(() => { openPlayerView(); return document.getElementById('dvPlPlay').disabled; });
        check('J demo: Play is disabled on an empty playlist', play, play);
        check('J demo errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'empty', raw: true });
        const s = await side(p);
        const note = await p.evaluate(() => !document.getElementById('dvSideEmpty').hidden);
        check('J empty (no playlists): no rows, the empty note shows', s.display !== 'none' && s.rows.length === 0 && note, { s, note });
        check('J empty errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- K. Phones and the app: no sidebar; the app still switches and cues
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const { ctx, p } = await open({ vp, phone: true });
        const s = await p.evaluate(() => ({ side: getComputedStyle(document.getElementById('dvSide')).display, play: getComputedStyle(document.getElementById('dvPlPlay')).display, msLeft: document.getElementById('music-section').getBoundingClientRect().left, dv2: document.documentElement.classList.contains('dv2') }));
        check(`K phone ${vp.width}x${vp.height}: no sidebar, no desktop Play, the page from the left edge`, s.side === 'none' && s.play === 'none' && s.msLeft === 0 && !s.dv2, s);
        check(`K phone ${vp.width}x${vp.height}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ query: '?app=1' });
        const s = await p.evaluate(() => ({ side: getComputedStyle(document.getElementById('dvSide')).display, msLeft: document.getElementById('music-section').getBoundingClientRect().left, back: getComputedStyle(document.getElementById('backToCrate')).display }));
        const id = await otherWithSongs(p);
        await p.evaluate((i) => selectPlaylistFromCrate(i), id);
        await p.waitForTimeout(1500);
        const st = await playState(p);
        const sp = writes(p, 'switchPlaylist');
        check('K app shell (?app=1) at 1440: no sidebar, the page from the left edge', s.side === 'none' && s.msLeft === 0, s);
        check('K app shell: opening a playlist still switches to it and cues its song', st.active === id && st.viewedId === null && st.cued >= 1 && sp.length === 1 && sp[0].playlist === id, { st, sp });
        check('K app shell errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- L. Narrowing a desktop window to a phone and back
    {
        const { ctx, p } = await open({});
        const id = await otherWithSongs(p);
        await clickRow(p, id);
        await p.waitForTimeout(1200);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500);
        const narrow = await p.evaluate(() => ({ side: getComputedStyle(document.getElementById('dvSide')).display, viewedId, msLeft: document.getElementById('music-section').getBoundingClientRect().left }));
        await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(500);
        const wide = await side(p);
        check('L narrowed to 390: the sidebar goes and the shown playlist is put away; widened, the sidebar is back',
            narrow.side === 'none' && narrow.viewedId === null && narrow.msLeft === 0 && wide.display !== 'none' && wide.msLeft === wide.right, { narrow, wide: { display: wide.display, msLeft: wide.msLeft, right: wide.right } });
        check('L errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
