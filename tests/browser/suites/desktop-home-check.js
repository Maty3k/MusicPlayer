// Desktop step 4: the clean Home (the crate, #vinylCrateView, under
// html.dv2) at 1440x900, 1024x768 and 800x600 (beside the icon rail).
// Checks that the room's scenery, the VINYLS crate, the marquee, the old
// toolbar's Search and + New, the crate's own All / Local / Spotify filter
// (except at 601-900px, where the rail has no chips) and any monospace LCD
// text are gone; the greeting; quiet Stats and Settings that still open
// their windows; "Jump back in" as one row of song cards that play in
// place (Home stays); "Your playlists" as a grid of square cover cards that
// open the playlist without touching playback, mark the playing one, and
// keep the edit button and keyboard access; the New playlist / Bring your
// music over tiles; the empty-library states (demo, empty); no sideways
// overflow; an axe scan with no violations; and that phones (390x844,
// 844x390) and the app shell (?app=1) keep their own Home. Writes to
// /save-music are faked and recorded (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const AXE = require.resolve('axe-core/axe.min.js', { paths: [L.ROOT] });
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
    const playState = (p) => p.evaluate(() => ({
        active: String(activePlaylistId), cur: currentSongIndex, n: songsData.length,
        song: songsData[currentSongIndex] ? songsData[currentSongIndex].title : null,
        viewedId, cued: window.__cued.length, played: window.__played.slice(),
        crate: !document.getElementById('vinylCrateView').classList.contains('hidden'),
        player: document.getElementById('musicPlayerView').classList.contains('active'),
    }));
    const home = (p) => p.evaluate(() => {
        const shown = (el) => {
            if (!el) return false;
            for (let e = el; e; e = e.parentElement) {
                const c = getComputedStyle(e);
                if (c.display === 'none' || c.visibility === 'hidden') return false;
            }
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const q = (s) => document.querySelector(s);
        const box = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
        const crate = q('#vinylCrateView');
        const panel = q('#vinylCrateView .room-content');
        // In reading order (the grid places them by CSS order, not DOM order)
        const cards = [...crate.querySelectorAll('.record-card')].filter(c => !c.closest('.conveyor-dupes') && shown(c))
            .sort((a, z) => { const ra = a.getBoundingClientRect(), rz = z.getBoundingClientRect(); return Math.round(ra.top) - Math.round(rz.top) || ra.left - rz.left; });
        const recent = [...crate.querySelectorAll('#recentSongsTrack .recent-song')].filter(shown);
        const tiles = [...crate.querySelectorAll('.crate-new-tile')].filter(shown)
            .sort((a, z) => { const ra = a.getBoundingClientRect(), rz = z.getBoundingClientRect(); return Math.round(ra.top) - Math.round(rz.top) || ra.left - rz.left; });
        const cols = (el) => el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : 0;
        // Monospace (the old LCD) on anything visible in the crate
        const mono = [...crate.querySelectorAll('*')].filter(e => shown(e) && /mono|courier|consolas/i.test(getComputedStyle(e).fontFamily) && e.textContent.trim()).map(e => e.className || e.tagName);
        const amber = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim();
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            vw: innerWidth, docW: document.documentElement.scrollWidth,
            panel: box(panel), panelSW: panel.scrollWidth, panelCW: panel.clientWidth, panelRadius: getComputedStyle(panel).borderTopLeftRadius,
            side: box(q('#dvSide')),
            gone: {
                roomBg: shown(q('#vinylCrateView .room-bg')), roomRight: shown(q('#vinylCrateView .room-right')), crateBox: shown(q('#vinylCrateView .crate-box')),
                rail: shown(q('#vinylCrateView .room-left')), oldTitle: shown(q('#vinylCrateView .greeting-text')), counts: shown(q('#vinylCrateView .collection-stats')),
                search: shown(q('#vinylCrateView .crate-search-btn')),
                newBtn: shown(q('#vinylCrateView .collection-toolbar .new-playlist-btn:not(.crate-search-btn):not(.crate-stats-btn):not(.crate-settings-btn)')),
                dupes: [...crate.querySelectorAll('.conveyor-dupes')].some(shown),
                pencil: [...crate.querySelectorAll('.playlist-edit-btn')].some(shown),
                badge: [...crate.querySelectorAll('.cover-badge')].some(shown),
                vinyl: [...crate.querySelectorAll('.record-card-vinyl')].some(shown),
                pill: cards.some(c => getComputedStyle(c, '::after').content !== 'none'),
                marquee: [...crate.querySelectorAll('.conveyor-track')].map(t => getComputedStyle(t).animationName).filter(n => n !== 'none'),
                mono,
            },
            filter: shown(q('#sourceFilter')),
            greeting: { shown: shown(q('#mGreeting')), text: (q('#mGreeting') || {}).textContent, tag: (q('#mGreeting') || {}).tagName, box: box(q('#mGreeting')) },
            h1s: [...crate.querySelectorAll('h1')].filter(shown).length,
            stats: shown(q('#vinylCrateView .crate-stats-btn')) ? box(q('#vinylCrateView .crate-stats-btn')) : null,
            settings: shown(q('#vinylCrateView .crate-settings-btn')) ? box(q('#vinylCrateView .crate-settings-btn')) : null,
            recentShelf: shown(q('#recentSongsShelf')),
            recentN: Array.isArray(recentSongs) ? recentSongs.length : 0,
            recent: recent.map(r => ({ box: box(r), art: box(r.querySelector('.recent-song-art')), title: (r.querySelector('.recent-song-title') || {}).textContent, artist: shown(r.querySelector('.recent-song-artist')) })),
            recentCols: cols(q('#recentSongsTrack')),
            cards: cards.map(c => ({
                id: c.dataset.playlist, box: box(c), cover: box(c.querySelector('.record-card-cover')),
                name: shown(c.querySelector('.card-caption-title')) ? c.querySelector('.card-caption-title').textContent : null,
                count: shown(c.querySelector('.card-caption-count')) ? c.querySelector('.card-caption-count').textContent : null,
                label: c.querySelector('.record-card-cover').getAttribute('aria-label'),
                playing: c.classList.contains('now-playing') && !c.classList.contains('is-empty'),
                eq: shown(c.querySelector('.card-eq')),
                titleColor: getComputedStyle(c.querySelector('.card-caption-title')).color,
                more: c.querySelector('.card-more') ? getComputedStyle(c.querySelector('.card-more')).opacity : null,
            })),
            gridCols: cols(q('#vinylCrateView .conveyor-rows')),
            tiles: tiles.map(t => ({ text: t.querySelector('.crate-new-tile-label').textContent.trim(), after: (() => { const last = cards[cards.length - 1]; if (!last) return true; const a = last.getBoundingClientRect(), r = t.getBoundingClientRect(); return Math.round(r.top) > Math.round(a.top) || (Math.round(r.top) === Math.round(a.top) && r.left > a.left); })(), box: box(t), icon: box(t.querySelector('.crate-new-tile-icon')) })),
            hint: shown(q('#crateEmptyHint')),
            amber,
            meta: Object.fromEntries(Object.entries(playlistsMeta).map(([k, m]) => [k, { name: m.name, n: k === String(activePlaylistId) ? songsData.length : m.songCount }])),
            active: String(activePlaylistId),
        };
    });
    const rgb = (p, css) => p.evaluate((c) => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; }, css);
    const modalOpen = (p, id) => p.evaluate((i) => document.getElementById(i).classList.contains('active'), id);
    const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
    async function axeScan(p) {
        await p.addScriptTag({ path: AXE });
        return p.evaluate(async () => {
            const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
            return res.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        });
    }

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const rail = vp.width <= 900;

        // ---- A. What's gone, the greeting, the panel, Stats and Settings
        {
            const { ctx, p } = await open({ vp });
            const h = await home(p);
            const g = h.gone;
            check(`${tag} A the room, the VINYLS crate, the console rail, the old title and counts, Search / + New, the marquee and its clones, the sleeve's record, badge, pencil and pill, and LCD text are gone`,
                h.dv2 && !g.roomBg && !g.roomRight && !g.crateBox && !g.rail && !g.oldTitle && !g.counts && !g.search && !g.newBtn && !g.dupes && !g.pencil && !g.badge && !g.vinyl && !g.pill && g.marquee.length === 0 && g.mono.length === 0, g);
            check(`${tag} A the crate's All / Local / Spotify filter ${rail ? 'shows on Home (the rail has no chips)' : 'is gone (the sidebar has it)'}`, h.filter === rail, h.filter);
            const hr = new Date().getHours();
            const want = hr >= 5 && hr < 12 ? 'Good morning' : (hr >= 12 && hr < 18 ? 'Good afternoon' : 'Good evening');
            check(`${tag} A the greeting heads the page ("${want}"), the only heading of its level`, h.greeting.shown && h.greeting.text === want && h.greeting.tag === 'H1' && h.h1s === 1, { g: h.greeting, h1s: h.h1s });
            check(`${tag} A Home is a rounded panel beside the sidebar, with no sideways overflow`,
                h.panel.l >= h.side.r && h.panel.l - h.side.r <= 12 && h.panelRadius === '12px' && h.panelSW <= h.panelCW && h.docW <= h.vw, { panel: h.panel, side: h.side, sw: h.panelSW, cw: h.panelCW, docW: h.docW, vw: h.vw, r: h.panelRadius });
            check(`${tag} A Stats and Settings sit at the top right, on the greeting's line`,
                h.stats && h.settings && h.stats.l > h.greeting.box.r && h.settings.l > h.stats.r - 1 && h.settings.r <= h.panel.r && Math.abs((h.stats.t + h.stats.b) / 2 - (h.greeting.box.t + h.greeting.box.b) / 2) <= 8, { stats: h.stats, settings: h.settings, g: h.greeting.box });
            await p.click('#vinylCrateView .crate-stats-btn'); await p.waitForTimeout(500);
            const stats = await modalOpen(p, 'statsModal');
            await p.evaluate(() => hideStatsModal()); await p.waitForTimeout(300);
            await p.click('#vinylCrateView .crate-settings-btn'); await p.waitForTimeout(400);
            const settings = await modalOpen(p, 'settingsModal');
            await p.evaluate(() => hideSettingsModal()); await p.waitForTimeout(300);
            check(`${tag} A Stats and Settings still open their windows`, stats && settings, { stats, settings });
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. Jump back in: one row of song cards; a card plays in place
        {
            const { ctx, p } = await open({ vp });
            const h = await home(p);
            const n = Math.min(h.recentN, h.recentCols);
            check(`${tag} B Jump back in: one row of cards on the grid's columns (cover, title, artist)`,
                h.recentShelf && h.recentN > 0 && h.recent.length === n && h.recentCols === h.gridCols && h.recent.every(r => r.box.t === h.recent[0].box.t && near(r.art.w, r.art.h) && r.title && r.artist),
                { shelf: h.recentShelf, n: h.recentN, shown: h.recent.length, cols: h.recentCols, grid: h.gridCols, r: h.recent.slice(0, 2) });
            const sel = '#recentSongsTrack .recent-song:nth-child(2)';
            const before = await p.evaluate((s) => getComputedStyle(document.querySelector(s + ' .recent-song-play')).opacity, sel);
            // (from off the card, so the pointer really enters it)
            await p.mouse.move(2, 2); await p.waitForTimeout(100);
            await p.hover(sel); await p.waitForTimeout(600);
            const after = await p.evaluate((s) => getComputedStyle(document.querySelector(s + ' .recent-song-play')).opacity, sel);
            check(`${tag} B a card shows its play button on hover`, before === '0' && after === '1', { before, after });
            const want = await p.evaluate(() => recentSongs[1].title);
            await p.click(sel); await p.waitForTimeout(1200);
            const st = await playState(p);
            check(`${tag} B clicking it plays that song and Home stays on screen (the bar shows it)`,
                st.played[st.played.length - 1] === want && st.crate && !st.player, { st, want });
            // Keyboard: Tab from Settings reaches the first card, Enter plays it
            await p.focus('#vinylCrateView .crate-settings-btn');
            await p.keyboard.press('Tab'); await p.waitForTimeout(400);
            const ring = await p.evaluate(() => { const a = document.activeElement; const pl = a.querySelector('.recent-song-play'); return { cls: a.className, first: a === document.querySelector('#recentSongsTrack .recent-song'), play: pl ? getComputedStyle(pl).opacity : null, outline: getComputedStyle(a).outlineStyle }; });
            await p.keyboard.press('Enter'); await p.waitForTimeout(1600);
            const want0 = await p.evaluate(() => recentSongs[0].title);
            const st2 = await playState(p);
            check(`${tag} B keyboard: Tab from Settings reaches the first card (focus ring, play button shown); Enter plays it`, ring.cls === 'recent-song' && ring.first && ring.play === '1' && ring.outline === 'solid' && st2.played[st2.played.length - 1] === want0 && st2.crate, { ring, st2, want0 });
            check(`${tag} B errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- C. Your playlists: square cover cards; open = browse; the playing marker
        {
            const { ctx, p } = await open({ vp });
            const h = await home(p);
            const ids = Object.keys(h.meta);
            const amber = await rgb(p, h.amber);
            const minCols = vp.width >= 1440 ? 5 : (vp.width >= 1024 ? 4 : 3);
            check(`${tag} C every playlist has one card in creation order: a square cover, its name and song count`,
                h.cards.length === ids.length && h.cards.every((c, i) => c.id === ids[i] && near(c.cover.w, c.cover.h) && c.name === h.meta[c.id].name && c.count === `${h.meta[c.id].n} ${h.meta[c.id].n === 1 ? 'song' : 'songs'}` && c.label && c.label.startsWith(h.meta[c.id].name)),
                h.cards.map(c => ({ id: c.id, cover: c.cover, name: c.name, count: c.count })));
            check(`${tag} C the grid has at least ${minCols} columns, every card inside the panel`, h.gridCols >= minCols && h.cards.every(c => c.box.r <= h.panel.r && c.box.l >= h.panel.l), { cols: h.gridCols, panel: h.panel });
            const playing = h.cards.filter(c => c.playing);
            check(`${tag} C the playing playlist: amber name and bars; no other card marked`,
                playing.length === 1 && playing[0].id === h.active && playing[0].eq && playing[0].titleColor === amber && h.cards.filter(c => !c.playing).every(c => !c.eq && c.titleColor !== amber),
                { playing, amber, active: h.active });
            const tiles = h.tiles;
            check(`${tag} C New playlist and Bring your music over close the grid, with square dashed covers the size of the others`,
                tiles.length === 2 && tiles[0].text === 'New playlist' && tiles[1].text === 'Bring your music over' && tiles.every(t => t.after && near(t.icon.w, t.icon.h) && near(t.icon.w, h.cards[0].cover.w)),
                { tiles, cover: h.cards[0] && h.cards[0].cover });
            // Open one that isn't playing: it shows, playback stays
            const id = ids.find(k => k !== h.active && h.meta[k].n > 1);
            const s0 = await playState(p);
            await p.click(`#vinylCrateView .record-card[data-playlist="${id}"]:not(.conveyor-dupes *) .record-card-cover`);
            await p.waitForTimeout(1300);
            const s1 = await playState(p);
            check(`${tag} C a card opens its playlist on screen; the playing song and list stay`,
                s1.player && s1.viewedId === id && s1.active === s0.active && s1.song === s0.song && s1.played.length === 0 && s1.cued === s0.cued && writes(p, 'switchPlaylist').length === 0,
                { s0, s1, id });
            // A song there makes it the playing one; back Home, its card is marked
            await p.click('#songList .song-list-item:not(.discover-item)'); await p.waitForTimeout(1500);
            await p.click('#dvSideHome'); await p.waitForTimeout(800);
            const h2 = await home(p);
            const pl2 = h2.cards.filter(c => c.playing).map(c => c.id);
            check(`${tag} C after a song from it plays, Home marks that playlist instead`, h2.active === id && pl2.length === 1 && pl2[0] === id && h2.cards.find(c => c.id === id).eq, { active: h2.active, pl2 });
            // All / Local / Spotify: the sidebar's chips (Home's own beside the rail) filter the grid
            const chip = (v) => rail ? `#sourceFilter .source-filter-btn[data-source-filter="${v}"]` : `#dvSide [data-dv-source="${v}"]`;
            const sources = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#vinylCrateView .record-card')].filter(c => !c.closest('.conveyor-dupes')).map(c => [c.dataset.playlist, c.dataset.source])));
            const shownFor = async (v) => { await p.click(chip(v)); await p.waitForTimeout(300); return (await home(p)).cards.map(c => c.id).sort().join(); };
            const want = (v) => Object.keys(sources).filter(k => v === 'all' || sources[k] === v).sort().join();
            const got = { user: await shownFor('user'), spotify: await shownFor('spotify') };
            // A source with no playlists says so (the seeded accounts have no Spotify ones)
            got.note = await p.evaluate(() => getComputedStyle(document.querySelector('#vinylCrateView .conveyor-rows'), '::before').content);
            got.all = await shownFor('all');
            check(`${tag} C ${rail ? "Home's own" : "the sidebar's"} All / Local / Spotify filter the grid`,
                got.user === want('user') && got.spotify === want('spotify') && got.all === want('all') && (want('spotify') !== '' || got.note === '"No Spotify playlists yet."'), { got, sources });
            check(`${tag} C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. The edit button and the keyboard
        {
            const { ctx, p } = await open({ vp });
            const h = await home(p);
            const id = Object.keys(h.meta).find(k => k !== h.active && h.meta[k].n > 0);
            const card = `#vinylCrateView .record-card[data-playlist="${id}"]`;
            const op0 = await p.evaluate((s) => getComputedStyle(document.querySelector(s + ' .card-more')).opacity, card);
            await p.hover(card + ' .record-card-cover'); await p.waitForTimeout(300);
            const op1 = await p.evaluate((s) => getComputedStyle(document.querySelector(s + ' .card-more')).opacity, card);
            check(`${tag} D a card's edit button (⋯) shows on hover`, op0 === '0' && op1 === '1', { op0, op1 });
            await p.mouse.move(2, 2);
            // Tab order: the cover (a button), then its ⋯
            await p.focus(card + ' .record-card-cover');
            await p.keyboard.press('Tab'); await p.waitForTimeout(300);
            const f = await p.evaluate(() => { const a = document.activeElement; return { cls: a.className, label: a.getAttribute('aria-label'), op: getComputedStyle(a).opacity, card: a.closest('.record-card') && a.closest('.record-card').dataset.playlist }; });
            await p.keyboard.press('Enter'); await p.waitForTimeout(500);
            const edit = await modalOpen(p, 'playlistEditModal');
            check(`${tag} D Tab from a cover reaches its ⋯ (shown while focused); Enter opens the playlist's editor`, f.cls === 'card-more' && f.card === id && f.op === '1' && /^Edit /.test(f.label) && edit, { f, edit });
            await p.evaluate(() => hidePlaylistEditModal()); await p.waitForTimeout(300);
            const s0 = await playState(p);
            await p.focus(card + ' .record-card-cover');
            await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
            const s1 = await playState(p);
            check(`${tag} D Enter on a focused cover opens the playlist (no playback change)`, s1.player && s1.viewedId === id && s1.played.length === 0 && s1.active === s0.active, { s1 });
            await p.click('#dvSideHome'); await p.waitForTimeout(700);
            await p.click('#vinylCrateView .crate-new-tile:not(.crate-bring-tile)'); await p.waitForTimeout(500);
            const create = await p.evaluate(() => document.getElementById('playlistEditModal').classList.contains('active') && document.getElementById('playlistEditSaveBtn').textContent.trim());
            await p.evaluate(() => hidePlaylistEditModal()); await p.waitForTimeout(300);
            await p.click('#crateBringTile'); await p.waitForTimeout(500);
            const bring = await modalOpen(p, 'bringMusicModal');
            check(`${tag} D the New playlist tile opens the create window, Bring your music over the chooser`, create === 'Create' && bring, { create, bring });
            check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- E. Fewer columns as the window narrows; one row of recents either way
    {
        const { ctx, p } = await open({ vp: { width: 1920, height: 1080 } });
        const wide = await home(p);
        await p.setViewportSize({ width: 1000, height: 800 }); await p.waitForTimeout(500);
        const narrow = await home(p);
        check('E the grid adapts (1920 → 1000: fewer columns) and Jump back in refits to one row',
            wide.gridCols > narrow.gridCols && narrow.recent.length === Math.min(narrow.recentN, narrow.recentCols) && wide.recent.length === Math.min(wide.recentN, wide.recentCols) && narrow.docW <= narrow.vw,
            { wide: [wide.gridCols, wide.recent.length], narrow: [narrow.gridCols, narrow.recent.length] });
        check('E errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- F. Room themes and reduced motion
    {
        const { ctx, p } = await open({ reduced: true });
        const t = await p.evaluate(() => {
            const panel = document.querySelector('#vinylCrateView .room-content');
            const before = getComputedStyle(panel).backgroundImage;
            setRoomTheme('golden-hour');
            const after = getComputedStyle(panel).backgroundImage;
            const head = getComputedStyle(document.querySelector('#recentSongsShelf .recent-songs-label, #vinylCrateView .crate-shelf .recent-songs-label')).color;
            const card = document.querySelector('#vinylCrateView .record-card');
            return { changed: before !== after, head, cream: getComputedStyle(document.documentElement).getPropertyValue('--cream').trim(), tr: getComputedStyle(card).transitionDuration, eq: [...document.querySelectorAll('#vinylCrateView .card-eq i')].map(i => getComputedStyle(i).animationName).filter(n => n !== 'none').length };
        });
        const cream = await rgb(p, t.cream);
        check('F a room theme recolours Home (panel and headings follow its colours)', t.changed && t.head === cream, t);
        check('F reduced motion: no card transitions, no moving bars', t.tr.split(',').every(x => x.trim() === '0s') && t.eq === 0, t);
        await p.evaluate(() => setRoomTheme('blue-hour'));
        check('F errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- G. Empty libraries
    {
        const { ctx, p } = await open({ acct: 'demo' });
        const h = await home(p);
        const fav = h.cards[0];
        check('G demo (one empty Favorites): the greeting, the first-run card, no Jump back in, the Favorites card unmarked, then the two tiles',
            h.greeting.shown && h.hint && !h.recentShelf && h.cards.length === 1 && !fav.playing && !fav.eq && fav.count === '0 songs' && h.tiles.length === 2, { hint: h.hint, recent: h.recentShelf, fav, tiles: h.tiles.length });
        await p.click('#crateEmptyBring'); await p.waitForTimeout(500);
        const bring = await modalOpen(p, 'bringMusicModal');
        await p.evaluate(() => hideBringMusicModal()); await p.waitForTimeout(300);
        await p.click('#crateEmptyHint .crate-empty-actions button:not(.is-primary)'); await p.waitForTimeout(500);
        const add = await modalOpen(p, 'addSongModal');
        check('G demo: the card\'s Bring your music over opens the chooser, Add a song the add window', bring && add, { bring, add });
        await p.evaluate(() => hideAddSongModal()); await p.waitForTimeout(300);
        const v = await axeScan(p);
        check('G demo: axe finds no violations on the empty Home', v.length === 0, v);
        check('G demo errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'empty', vp: { width: 1024, height: 768 } });
        const chooser = await modalOpen(p, 'bringMusicModal');
        await p.evaluate(() => hideBringMusicModal()); await p.waitForTimeout(400);
        const h = await home(p);
        check('G empty (no playlists): the chooser on load (as before); behind it the greeting, the first-run card and the two tiles, no cards, no overflow',
            chooser && h.greeting.shown && h.hint && h.cards.length === 0 && h.tiles.length === 2 && h.docW <= h.vw && h.panelSW <= h.panelCW, { chooser, hint: h.hint, cards: h.cards.length, tiles: h.tiles.length });
        check('G empty errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- H. axe on the desktop Home with songs (wide, and beside the rail)
    for (const vp of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        const { ctx, p } = await open({ vp });
        const v = await axeScan(p);
        check(`H ${vp.width}x${vp.height} axe finds no violations on Home`, v.length === 0, v);
        check(`H ${vp.width}x${vp.height} errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- I. Phones and the app keep their own Home
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const { ctx, p } = await open({ vp, phone: true });
        const s = await p.evaluate(() => {
            const panel = document.querySelector('#vinylCrateView .room-content');
            const c = getComputedStyle(panel);
            return { dv2: document.documentElement.classList.contains('dv2'), radius: c.borderTopLeftRadius, pos: c.position, top: c.top, border: c.borderTopWidth };
        });
        check(`I phone ${vp.width}x${vp.height}: no desktop Home (no dv2, no rounded panel)`, !s.dv2 && s.radius === '0px' && s.border === '0px', s);
        check(`I phone ${vp.width}x${vp.height}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ query: '?app=1' });
        const s = await p.evaluate(() => {
            const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
            return {
                dv2: document.documentElement.classList.contains('dv2'),
                search: shown(document.querySelector('#vinylCrateView .crate-search-btn')),
                title: shown(document.querySelector('#vinylCrateView .greeting-text')),
                radius: getComputedStyle(document.querySelector('#vinylCrateView .room-content')).borderTopLeftRadius,
            };
        });
        const hasRecent = await p.evaluate(() => Array.isArray(recentSongs) && recentSongs.length > 0 && !!document.querySelector('#recentSongsTrack .recent-song'));
        if (hasRecent) await p.evaluate(() => document.querySelector('#recentSongsTrack .recent-song').click());
        await p.waitForTimeout(1000);
        const st = await playState(p);
        check('I app shell (?app=1) at 1440: its own crate (the toolbar\'s Search, "My Collection", no panel)', !s.dv2 && s.search && s.title && s.radius === '0px', s);
        check('I app shell: Jump back in still opens the player', hasRecent && st.player, { hasRecent, st });
        check('I app errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
