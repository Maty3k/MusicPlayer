// Desktop step 5: the playlist page (the player view under html.dv2) at
// 1440x900, 1024x768 and 800x600 (beside the icon rail). Checks the header
// (cover, "Playlist", the name as the page's heading, the count; a total
// length only when every song has one), the round Play (a playlist that's
// only shown starts at its saved song and becomes the playing one; the
// playing one plays and pauses; "Pause" only while that list plays),
// shuffle (the global mode, in step with the bar), the ⋯ menu (keyboard,
// and each action opening its window or doing its write for the right
// playlist), "Find in these songs", the song table (a row click or Enter
// plays it, adopting a shown list; ♥ and ⋯ on hover; the row ⋯ popover is
// a keyboard menu; album and length columns only when the library has
// them), drag and Alt+arrow reorder saving the playlist on screen, the
// playing marker only on the playing list, the empty / loading / couldn't
// load states, the bar's turntable reaching the deck (and back), the bar's
// progress still ticking while the deck is hidden, axe, and that phones
// (390x844, 844x390) and the app shell (?app=1) keep their own screen.
// Writes to /save-music are faked and recorded (reads go through).
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
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.raw) return { ctx, p };
        // A playlist's songs can be held back (loading) or refused (couldn't
        // load) while p.__getMode says so; everything else goes on as usual
        p.__getMode = null;
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'getPlaylist' && p.__getMode === 'fail') {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false }) });
            }
            if (body.action === 'getPlaylist' && p.__getMode === 'hold') {
                await new Promise((r) => { p.__release = r; });
            }
            return route.fallback();
        });
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
            // Calls the page's buttons should make
            window.__calls = [];
            ['toggleMusic', 'openPlayerView', 'toggleLyrics', 'toggleOfflinePlaylist'].forEach((fn) => {
                const orig = window[fn];
                window[fn] = function () { window.__calls.push(fn); return orig.apply(this, arguments); };
            });
        });
        return { ctx, p };
    }
    // ---- end open

    const writes = (p, action) => p.__posts.filter(x => x.action === action);
    const modalOpen = (p, id) => p.evaluate((i) => { const m = document.getElementById(i); return !!m && m.classList.contains('active'); }, id);
    async function axeScan(p) {
        await p.addScriptTag({ path: AXE });
        return p.evaluate(async () => {
            const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
            return res.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        });
    }
    // The page as it stands
    const pageState = (p) => p.evaluate(() => {
        const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const page = document.getElementById('musicSidebar');
        const r = page.getBoundingClientRect();
        const ms = document.getElementById('music-section').getBoundingClientRect();
        const rows = [...document.querySelectorAll('#songList .song-list-item:not(.discover-item):not(.radio-song-item)')].map((li) => ({
            i: li.dataset.index,
            title: li.querySelector('.song-list-title').textContent,
            artist: li.querySelector('.song-list-artist').textContent,
            num: li.querySelector('.song-list-num').textContent,
            shown: shown(li),
            active: li.classList.contains('active'),
            current: li.getAttribute('aria-current'),
            eq: shown(li.querySelector('.song-list-playing-indicator')),
            tab: li.tabIndex,
            album: shown(li.querySelector('.song-list-album')),
            dur: shown(li.querySelector('.song-list-dur')) ? li.querySelector('.song-list-dur').textContent : null,
        }));
        const cover = document.getElementById('dvPlCover');
        const img = cover.querySelector('img');
        const play = document.getElementById('dvPlPlay');
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            player: document.getElementById('musicPlayerView').classList.contains('active'),
            deck: document.getElementById('musicPlayerView').classList.contains('dv-deck'),
            pageShown: shown(page), mainShown: shown(document.querySelector('.music-main')),
            left: Math.round(r.left), right: Math.round(r.right), msLeft: Math.round(ms.left), msRight: Math.round(ms.right),
            overflowX: page.scrollWidth > page.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth,
            head: shown(document.getElementById('dvPlHead')),
            kicker: document.querySelector('#dvPlHead .dv-pl-kicker').textContent.trim(),
            name: document.getElementById('dvPlName').textContent.trim(),
            nameTag: document.getElementById('dvPlName').tagName,
            meta: document.getElementById('dvPlMeta').textContent.trim(),
            coverShown: shown(cover), coverImg: img ? img.getAttribute('src') : null, coverNote: !!cover.querySelector('.dv-pl-cover-empty svg'),
            coverW: Math.round(cover.getBoundingClientRect().width),
            play: { shown: shown(play), label: play.textContent.trim(), dis: play.disabled, round: Math.abs(play.getBoundingClientRect().width - play.getBoundingClientRect().height) < 1 && play.getBoundingClientRect().width >= 48 },
            shuffle: shown(document.getElementById('dvPlShuffle')), more: shown(document.getElementById('dvPlMore')),
            find: shown(document.getElementById('mFilterInput')),
            cols: shown(document.getElementById('dvPlCols')),
            colAlbum: shown(document.querySelector('#dvPlCols .dv-col-album')), colDur: shown(document.querySelector('#dvPlCols .dv-col-dur')),
            oldHead: shown(document.querySelector('#musicSidebar .sidebar-header-row')),
            empty: shown(document.querySelector('#songList .song-list-empty')),
            loading: shown(document.querySelector('#songList .song-list-loading:not(.is-failed)')),
            failed: shown(document.querySelector('#songList .song-list-loading.is-failed')),
            retry: shown(document.querySelector('#songList .song-list-retry')),
            busy: document.getElementById('songList').getAttribute('aria-busy'),
            rows,
            active: String(activePlaylistId), viewedId, onScreen: String(listId()), cur: currentSongIndex,
            meta2: (playlistsMeta[String(listId())] || {}).songCount,
            sideOpen: [...document.querySelectorAll('#dvSideList .dv-side-pl.is-open')].map(x => x.dataset.playlist),
        };
    });
    const otherWithSongs = (p, min = 3) => p.evaluate((n) => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= n), min);
    const openList = async (p, id) => { await p.evaluate((i) => selectPlaylistFromCrate(i), id); await p.waitForTimeout(1500); };
    const shuffleOff = (p) => p.evaluate(() => { let n = 0; while (shuffleMode !== 'off' && n++ < 3) toggleShuffle(); });

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. A shown (not playing) playlist: header, table, layout
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p);
            const m = await p.evaluate((i) => ({ name: playlistsMeta[i].name, n: playlistsMeta[i].songCount, color: playlistsMeta[i].color }), id);
            await openList(p, id);
            const s = await pageState(p);
            check(`${tag} A the page fills the main area beside the sidebar; the turntable is gone from it; nothing overflows sideways`,
                s.dv2 && s.player && !s.deck && s.pageShown && !s.mainShown && s.left - s.msLeft <= 12 && s.msRight - s.right <= 12 && !s.overflowX,
                { left: s.left, right: s.right, msLeft: s.msLeft, msRight: s.msRight, main: s.mainShown, overflowX: s.overflowX });
            check(`${tag} A header: cover, "Playlist", the name as an h1, the count; the old header row is gone`,
                s.head && s.coverShown && (s.coverImg || s.coverNote) && s.coverW >= 100 && s.kicker === 'Playlist' && s.name === m.name && s.nameTag === 'H1'
                && s.meta === `${m.n} ${m.n === 1 ? 'song' : 'songs'}` && !s.oldHead, { s: { name: s.name, meta: s.meta, kicker: s.kicker, cover: s.coverImg, note: s.coverNote, w: s.coverW, old: s.oldHead }, m });
            check(`${tag} A the action row: a big round Play (labelled Play), shuffle, ⋯ and Find in these songs`,
                s.play.shown && s.play.round && s.play.label === 'Play' && !s.play.dis && s.shuffle && s.more && s.find, s.play);
            check(`${tag} A the table: column labels, every song a row with its number, title and artist; no album or length columns without data`,
                s.cols && !s.colAlbum && !s.colDur && s.rows.length === m.n && s.rows.every((r, k) => r.shown && Number(r.num) === k + 1 && r.title && !r.album && r.dur === null),
                { cols: s.cols, rows: s.rows.slice(0, 3), n: m.n });
            check(`${tag} A only shown, not playing: no row marked or with bars; the sidebar highlights it; one row in the Tab order`,
                s.viewedId === id && s.rows.every(r => !r.active && !r.eq && !r.current) && s.sideOpen.length === 1 && s.sideOpen[0] === id
                && s.rows.filter(r => r.tab === 0).length === 1, { viewedId: s.viewedId, side: s.sideOpen, tabs: s.rows.map(r => r.tab).join('') });
            // Album and length show once the songs have them (and the header totals the lengths)
            const d = await p.evaluate(() => {
                viewedSongs.forEach((x, k) => { x.album = k === 1 ? 'An album' : ''; x.duration = 125; });
                rebuildSongList();
                const shown = (el) => !!el && el.getClientRects().length > 0;
                const rows = [...document.querySelectorAll('#songList .song-list-item:not(.discover-item)')];
                return { meta: document.getElementById('dvPlMeta').textContent, n: viewedSongs.length,
                    album: shown(rows[1].querySelector('.song-list-album')) && rows[1].querySelector('.song-list-album').textContent,
                    dur: rows[0].querySelector('.song-list-dur').textContent, colA: shown(document.querySelector('#dvPlCols .dv-col-album')), colD: shown(document.querySelector('#dvPlCols .dv-col-dur')) };
            });
            const total = Math.round(d.n * 125 / 60);
            const want = total < 60 ? `${total} min` : `${Math.floor(total / 60)} hr${total % 60 ? ' ' + (total % 60) + ' min' : ''}`;
            check(`${tag} A with albums and lengths: the Album and length columns show, and the header adds the total`,
                d.album === 'An album' && d.dur === '2:05' && d.colA && d.colD && d.meta === `${d.n} songs, ${want}`, { d, want });
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. Play: adopt a shown list, toggle the playing one
        {
            const { ctx, p } = await open({ vp });
            await shuffleOff(p);
            const id = await otherWithSongs(p);
            const resume = await p.evaluate(() => 0);
            await openList(p, id);
            const st0 = await p.evaluate(() => ({ active: String(activePlaylistId), viewedResume, first: viewedSongs[viewedResume] && viewedSongs[viewedResume].title }));
            // Something plays elsewhere: Play here still says Play
            await p.evaluate(() => document.getElementById('vinyl').classList.add('playing'));
            await p.waitForTimeout(100);
            const l0 = await p.evaluate(() => document.getElementById('dvPlPlay').textContent.trim());
            await p.evaluate(() => document.getElementById('vinyl').classList.remove('playing'));
            await p.click('#dvPlPlay'); await p.waitForTimeout(1600);
            const s1 = await pageState(p);
            const played = await p.evaluate(() => window.__played.slice());
            check(`${tag} B Play on a shown list: still "Play" while another list plays; it then becomes the playing list at its saved song, the row marked`,
                l0 === 'Play' && s1.active === id && s1.viewedId === null && played[played.length - 1] === st0.first && s1.rows[st0.viewedResume].active && s1.rows[st0.viewedResume].current === 'true',
                { l0, st0, active: s1.active, played, resume });
            await p.evaluate(() => document.getElementById('vinyl').classList.add('playing'));
            await p.waitForTimeout(100);
            const l1 = await p.evaluate(() => document.getElementById('dvPlPlay').textContent.trim());
            await p.evaluate(() => { window.__calls = []; });
            await p.click('#dvPlPlay'); await p.waitForTimeout(300);
            const calls = await p.evaluate(() => window.__calls.slice());
            const sw = writes(p, 'switch');
            check(`${tag} B on the playing list it reads Pause while playing and toggles playback (toggleMusic); the adopt saved the switch for that playlist`,
                l1 === 'Pause' && calls.includes('toggleMusic') && sw.length >= 1 && sw[0].playlist === id && sw[0].activate === true, { l1, calls, sw });
            check(`${tag} B errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- C. Shuffle: the global mode, in step with the bar
        {
            const { ctx, p } = await open({ vp });
            await shuffleOff(p);
            const id = await otherWithSongs(p);
            await openList(p, id);
            const seen = [];
            for (let k = 0; k < 3; k++) {
                await p.click('#dvPlShuffle'); await p.waitForTimeout(100);
                seen.push(await p.evaluate(() => ({ mode: shuffleMode, pressed: document.getElementById('dvPlShuffle').getAttribute('aria-pressed'), label: document.getElementById('dvPlShuffle').getAttribute('aria-label'), bar: document.getElementById('dvBarShuffle').getAttribute('aria-pressed') })));
            }
            check(`${tag} C shuffle cycles off → shuffle → smart → off (aria-pressed, label), the bar's shuffle follows`,
                seen[0].mode === 'shuffle' && seen[0].pressed === 'true' && seen[0].bar === 'true' && seen[1].mode === 'smart' && seen[1].label === 'Smart shuffle'
                && seen[2].mode === 'off' && seen[2].pressed === 'false' && seen[2].bar === 'false', seen);
            await p.click('#dvPlShuffle'); await p.waitForTimeout(100);
            await p.click('#dvPlPlay'); await p.waitForTimeout(1600);
            const st = await p.evaluate(() => ({ active: String(activePlaylistId), played: window.__played.length }));
            check(`${tag} C Play with shuffle on still adopts the list and plays one song`, st.active === id && st.played >= 1, st);
            check(`${tag} C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. Find in these songs
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p, 4);
            await openList(p, id);
            const t = await p.evaluate(() => viewedSongs[2].title);
            await p.fill('#mFilterInput', t);
            await p.waitForTimeout(200);
            const s1 = await pageState(p);
            await p.fill('#mFilterInput', 'zzzz no such song');
            await p.waitForTimeout(200);
            const none = await p.evaluate(() => { const e = document.getElementById('mFilterEmpty'); return { text: e.textContent, shown: e.getClientRects().length > 0 }; });
            const s2 = await pageState(p);
            check(`${tag} D find shows only the matching songs; no match says so`,
                s1.rows.filter(r => r.shown).length >= 1 && s1.rows.filter(r => r.shown).every(r => (r.title + ' ' + r.artist).toLowerCase().includes(t.toLowerCase()))
                && s1.rows.some(r => !r.shown) && s2.rows.every(r => !r.shown) && none.shown && /No songs here match/.test(none.text), { shown1: s1.rows.filter(r => r.shown).map(r => r.title), none });
            const other = await p.evaluate((skip) => Object.keys(playlistsMeta).find(k => k !== skip && playlistsMeta[k].songCount > 0), id);
            await openList(p, other);
            const after = await p.evaluate(() => ({ q: document.getElementById('mFilterInput').value, hidden: document.querySelectorAll('#songList .m-filtered-out').length }));
            check(`${tag} D opening another playlist starts its find empty`, after.q === '' && after.hidden === 0, after);
            check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- E. Rows: click and keyboard play (adopting a shown list), ♥, ⋯
        {
            const { ctx, p } = await open({ vp });
            await shuffleOff(p);
            const id = await otherWithSongs(p, 4);
            await openList(p, id);
            const t1 = await p.evaluate(() => viewedSongs[1].title);
            await p.click('#songList .song-list-item[data-index="1"]'); await p.waitForTimeout(1600);
            const s1 = await pageState(p);
            const pl1 = await p.evaluate(() => window.__played.slice());
            check(`${tag} E a row click plays it; a shown list becomes the playing one, that row marked with the bars`,
                s1.active === id && s1.viewedId === null && pl1[pl1.length - 1] === t1 && s1.rows[1].active && s1.rows[1].eq && s1.rows.filter(r => r.active).length === 1, { active: s1.active, pl1, row: s1.rows[1] });
            // Keyboard: the row in the Tab order, arrows, Enter
            await p.evaluate(() => document.querySelector('#songList .song-list-item[tabindex="0"]').focus());
            await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
            await p.keyboard.press('ArrowDown'); await p.waitForTimeout(100);
            const f = await p.evaluate(() => ({ i: document.activeElement.dataset.index, tabs: [...document.querySelectorAll('#songList .song-list-item[tabindex="0"]')].length }));
            await p.keyboard.press('Enter'); await p.waitForTimeout(1600);
            const k = await p.evaluate(() => ({ cur: currentSongIndex, last: window.__played[window.__played.length - 1], want: songsData[3] && songsData[3].title }));
            check(`${tag} E keyboard: arrows move between rows (one in the Tab order), Enter plays the focused one`,
                f.i === '3' && f.tabs === 1 && k.cur === 3 && k.last === k.want, { f, k });
            // ♥ on hover, and it likes the song
            const fav = await p.evaluate(() => !!document.querySelector('#songList .song-list-item[data-index="2"] .song-fav-btn'));
            if (fav) {
                const op0 = await p.evaluate(() => getComputedStyle(document.querySelector('#songList .song-list-item[data-index="0"] .song-fav-btn')).opacity);
                await p.hover('#songList .song-list-item[data-index="2"]'); await p.waitForTimeout(250);
                const op1 = await p.evaluate(() => getComputedStyle(document.querySelector('#songList .song-list-item[data-index="2"] .song-fav-btn')).opacity);
                const song = await p.evaluate(() => listSongs()[2].title);
                await p.click('#songList .song-list-item[data-index="2"] .song-fav-btn'); await p.waitForTimeout(400);
                const fw = writes(p, 'favorite');
                check(`${tag} E ♥ shows on hover (hidden otherwise) and likes that song`, op0 === '0' && op1 === '1' && fw.length === 1 && fw[0].song.title === song, { op0, op1, fw: fw.map(x => x.song.title), song });
            } else {
                check(`${tag} E ♥ (Favorites shows none: skipped)`, true);
            }
            // Row ⋯: the popover as a keyboard menu
            await p.hover('#songList .song-list-item[data-index="0"]');
            await p.click('#songList .song-list-item[data-index="0"] .song-send-btn'); await p.waitForTimeout(300);
            const m1 = await p.evaluate(() => {
                const m = document.querySelector('.send-menu');
                return m && { role: m.getAttribute('role'), label: m.getAttribute('aria-label'), focus: document.activeElement.textContent.trim(), inMenu: m.contains(document.activeElement),
                    items: [...m.querySelectorAll('[role="menuitem"]')].map(x => x.textContent.trim()), sheet: m.classList.contains('send-menu-sheet') };
            });
            await p.keyboard.press('ArrowDown'); await p.waitForTimeout(80);
            const m2 = await p.evaluate(() => document.activeElement.textContent.trim());
            await p.keyboard.press('Escape'); await p.waitForTimeout(150);
            const m3 = await p.evaluate(() => ({ gone: !document.querySelector('.send-menu'), back: document.activeElement.classList.contains('song-send-btn') && document.activeElement.closest('.song-list-item').dataset.index === '0' }));
            check(`${tag} E a row's ⋯ opens the song menu as a keyboard menu (Play next, Add to queue, send to…); Esc closes it back onto ⋯`,
                !!m1 && m1.role === 'menu' && !m1.sheet && m1.inMenu && m1.focus === 'Play next' && m1.items[1] === 'Add to queue' && m1.items.length >= 3 && m2 === 'Add to queue' && m3.gone && m3.back, { m1, m2, m3 });
            await p.hover('#songList .song-list-item[data-index="0"]');
            await p.click('#songList .song-list-item[data-index="0"] .song-send-btn'); await p.waitForTimeout(300);
            await p.click('.send-menu [role="menuitem"]:nth-child(2)'); await p.waitForTimeout(300);
            const q = await p.evaluate(() => playQueue.length);
            check(`${tag} E its Add to queue queues the song`, q === 1, q);
            check(`${tag} E errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- F. Reorder: drag, Alt+arrow and the menu's reorder mode save
        // the playlist ON SCREEN (a shown one, not the playing one)
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p, 4);
            const active = await p.evaluate(() => String(activePlaylistId));
            await openList(p, id);
            const before = await p.evaluate(() => viewedSongs.map(s => s.title));
            const h = await p.evaluate(() => {
                const r0 = document.querySelector('#songList .song-list-item[data-index="0"]');
                const r2 = document.querySelector('#songList .song-list-item[data-index="2"]').getBoundingClientRect();
                return { y0: r0.getBoundingClientRect().top + r0.getBoundingClientRect().height / 2, y2: r2.bottom - 4 };
            });
            await p.hover('#songList .song-list-item[data-index="0"]'); await p.waitForTimeout(200);
            const hb = await p.evaluate(() => { const r = document.querySelector('#songList .song-list-item[data-index="0"] .song-drag-handle').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
            await p.mouse.move(hb.x, hb.y); await p.mouse.down();
            await p.mouse.move(hb.x, h.y2 - 10, { steps: 6 }); await p.mouse.move(hb.x, h.y2, { steps: 4 });
            await p.mouse.up(); await p.waitForTimeout(500);
            const ro = writes(p, 'reorder');
            const afterDrag = await p.evaluate(() => viewedSongs.map(s => s.title));
            check(`${tag} F dragging a row reorders the shown playlist and saves that playlist's order (not the playing one's)`,
                ro.length === 1 && ro[0].playlist === id && id !== active && ro[0].order.slice(0, 3).join(',') === '1,2,0' && afterDrag[2] === before[0] && afterDrag[0] === before[1],
                { ro, afterDrag: afterDrag.slice(0, 3), before: before.slice(0, 3) });
            // Alt+↓ on a focused row moves it one down, focus follows
            await p.evaluate(() => document.querySelector('#songList .song-list-item[data-index="0"]').focus());
            await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(400);
            const ro2 = writes(p, 'reorder');
            const k = await p.evaluate(() => ({ titles: viewedSongs.map(s => s.title).slice(0, 2), focus: document.activeElement.dataset ? document.activeElement.dataset.index : null }));
            check(`${tag} F Alt+↓ moves the focused song down one (saved the same way), focus stays on it`,
                ro2.length === 2 && ro2[1].playlist === id && ro2[1].order.slice(0, 2).join(',') === '1,0' && k.titles[1] === afterDrag[0] && k.focus === '1', { ro2: ro2[1], k });
            // Reorder mode from ⋯: handles show, a click doesn't play, Done ends it
            await p.click('#dvPlMore'); await p.waitForTimeout(150);
            await p.click('#dvPlMenu [data-dv-pl="reorder"]'); await p.waitForTimeout(200);
            const r1 = await p.evaluate(() => ({ mode: document.getElementById('musicSidebar').classList.contains('dv-reordering'), done: document.getElementById('dvPlDone').getClientRects().length > 0, focus: document.activeElement.id,
                handle: getComputedStyle(document.querySelector('#songList .song-list-item[data-index="3"] .song-drag-handle')).opacity }));
            await p.click('#songList .song-list-item[data-index="3"] .song-list-title'); await p.waitForTimeout(500);
            const st = await p.evaluate(() => ({ active: String(activePlaylistId), viewedId }));
            await p.click('#dvPlDone'); await p.waitForTimeout(150);
            const r2 = await p.evaluate(() => ({ mode: document.getElementById('musicSidebar').classList.contains('dv-reordering'), done: document.getElementById('dvPlDone').getClientRects().length > 0 }));
            check(`${tag} F ⋯ → Reorder songs: handles on every row, Done focused, a row click doesn't play; Done ends it`,
                r1.mode && r1.done && r1.focus === 'dvPlDone' && r1.handle === '1' && st.active === active && st.viewedId === id && !r2.mode && !r2.done, { r1, st, r2 });
            check(`${tag} F errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- G. The ⋯ menu: keyboard, and each action (1440, then 800 for the rail)
    for (const vp of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const { ctx, p } = await open({ vp });
        const id = await otherWithSongs(p);
        await openList(p, id);
        await p.click('#dvPlMore'); await p.waitForTimeout(150);
        const k0 = await p.evaluate(() => ({ open: !document.getElementById('dvPlMenu').hidden, exp: document.getElementById('dvPlMore').getAttribute('aria-expanded'), focus: document.activeElement.dataset.dvPl,
            items: [...document.querySelectorAll('#dvPlMenu [role="menuitem"]')].filter(b => !b.hidden).map(b => b.dataset.dvPl),
            box: (() => { const r = document.getElementById('dvPlMenu').getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom }; })(), vw: innerWidth, vh: innerHeight }));
        await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
        const k1 = await p.evaluate(() => document.activeElement.dataset.dvPl);
        await p.keyboard.press('End');
        const k2 = await p.evaluate(() => document.activeElement.dataset.dvPl);
        await p.keyboard.press('Escape'); await p.waitForTimeout(100);
        const k3 = await p.evaluate(() => ({ open: !document.getElementById('dvPlMenu').hidden, focus: document.activeElement.id, exp: document.getElementById('dvPlMore').getAttribute('aria-expanded') }));
        check(`${tag} G ⋯ opens a menu (focus on Add songs) inside the window; ↓/End move; Esc closes it back onto ⋯; no offline row for streamed songs`,
            k0.open && k0.exp === 'true' && k0.focus === 'add' && k0.items.join(',') === 'add,import,reorder,edit,share,queue,delete' && k0.box.l >= 0 && k0.box.r <= k0.vw && k0.box.b <= k0.vh
            && k1 === 'reorder' && k2 === 'delete' && !k3.open && k3.focus === 'dvPlMore' && k3.exp === 'false', { k0, k1, k2, k3 });
        const act = async (key) => {
            await p.click('#dvPlMore'); await p.waitForTimeout(150);
            await p.click(`#dvPlMenu [data-dv-pl="${key}"]`); await p.waitForTimeout(500);
        };
        await act('add');
        const add = await modalOpen(p, 'addSongModal');
        const addTo = await p.evaluate(() => (document.getElementById('mAddToName') || {}).textContent);
        await p.evaluate(() => hideAddSongModal()); await p.waitForTimeout(300);
        await act('import');
        const imp = await p.evaluate(() => ({ any: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id), into: importIntoCurrent, pl: importPlaylistId }));
        await p.evaluate(() => hideSpotifyImportModal()); await p.waitForTimeout(300);
        await act('edit');
        const edit = await p.evaluate(() => ({ open: document.getElementById('playlistEditModal').classList.contains('active'), id: editingPlaylistId }));
        await p.evaluate(() => hidePlaylistEditModal()); await p.waitForTimeout(300);
        await act('queue');
        const queue = await modalOpen(p, 'queueModal');
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(300);
        await act('share');
        const share = writes(p, 'share');
        const name = await p.evaluate((i) => playlistsMeta[i].name, id);
        check(`${tag} G its actions: Add songs (to this playlist), Import into this playlist, Edit details, Up next, Share all act on the playlist on screen`,
            add && addTo === name && imp.any.length === 1 && imp.into === true && imp.pl === id && edit.open && edit.id === id && queue && share.length === 1 && share[0].playlist === id,
            { add, addTo, name, imp, edit, queue, share });
        // Delete: two clicks; a shown playlist goes in place (what plays plays on)
        const active = await p.evaluate(() => String(activePlaylistId));
        await p.click('#dvPlMore'); await p.waitForTimeout(150);
        await p.click('#dvPlMenu [data-dv-pl="delete"]'); await p.waitForTimeout(150);
        const armed = await p.evaluate(() => ({ text: document.querySelector('#dvPlMenu [data-dv-pl="delete"]').textContent, open: !document.getElementById('dvPlMenu').hidden }));
        const d0 = writes(p, 'deletePlaylist').length;
        await p.click('#dvPlMenu [data-dv-pl="delete"]'); await p.waitForTimeout(900);
        const del = writes(p, 'deletePlaylist');
        const after = await p.evaluate((i) => ({ gone: !playlistsMeta[i], side: !!document.querySelector(`#dvSideList [data-playlist="${i}"]`), crate: !document.getElementById('vinylCrateView').classList.contains('hidden'), active: String(activePlaylistId) }), id);
        check(`${tag} G Delete asks for a second click, then deletes the shown playlist in place (Home, gone from the sidebar, the playing list untouched)`,
            armed.text === 'Click again to delete' && armed.open && d0 === 0 && del.length === 1 && del[0].playlist === id && after.gone && !after.side && after.crate && after.active === active, { armed, del, after });
        check(`${tag} G errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- H. The playing list: the playing row marked, only there
    {
        const { ctx, p } = await open();
        const active = await p.evaluate(() => String(activePlaylistId));
        await openList(p, active);
        const s = await pageState(p);
        const cur = await p.evaluate(() => currentSongIndex);
        await p.evaluate(() => document.getElementById('vinyl').classList.add('playing'));
        await p.waitForTimeout(100);
        const anim = await p.evaluate(() => { const sp = document.querySelector('#songList .song-list-item.active .song-list-playing-indicator span'); return sp ? getComputedStyle(sp).animationPlayState : null; });
        const id = await otherWithSongs(p);
        await openList(p, id);
        const s2 = await pageState(p);
        check('H on the playing list its current row is marked (amber, bars, aria-current); bars move only while playing; a shown list marks none',
            s.viewedId === null && s.rows[cur] && s.rows[cur].active && s.rows[cur].eq && s.rows[cur].current === 'true' && s.rows.filter(r => r.active).length === 1
            && anim === 'running' && s2.rows.every(r => !r.active && !r.eq), { cur, row: s.rows[cur], anim, viewed: s2.rows.filter(r => r.active) });
        check('H errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- I. Empty, loading, couldn't load
    for (const vp of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;
        {
            // mid's empty playlist (shown, not playing: its songs load, then none)
            const { ctx, p } = await open({ vp });
            const empty = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount === 0));
            await openList(p, empty);
            const s = await pageState(p);
            check(`${tag} I an empty playlist: the header, "0 songs", Play disabled, its empty card (Add songs, Import); no find, no column labels`,
                s.head && s.meta === '0 songs' && s.play.dis && s.empty && !s.find && !s.cols && s.rows.length === 0, { meta: s.meta, play: s.play, empty: s.empty, find: s.find, cols: s.cols });
            await p.click('#songList .song-list-empty-add'); await p.waitForTimeout(500);
            const add = await modalOpen(p, 'addSongModal');
            await p.evaluate(() => hideAddSongModal()); await p.waitForTimeout(300);
            check(`${tag} I its Add songs opens the add window`, add, add);
            const v = await axeScan(p);
            check(`${tag} I axe: no violations on the empty playlist page`, v.length === 0, v);
            check(`${tag} I empty errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p);
            const m = await p.evaluate((i) => ({ name: playlistsMeta[i].name, n: playlistsMeta[i].songCount }), id);
            p.__getMode = 'hold';
            await p.evaluate((i) => { selectPlaylistFromCrate(i); }, id);
            await p.waitForTimeout(500);
            const s1 = await pageState(p);
            check(`${tag} I loading: the header with its name and count at once, a loading row (aria-busy), Play disabled, no find or columns`,
                s1.player && s1.name === m.name && s1.meta === `${m.n} songs` && s1.loading && s1.busy === 'true' && s1.play.dis && !s1.find && !s1.cols && s1.rows.length === 0, { name: s1.name, meta: s1.meta, loading: s1.loading, busy: s1.busy, play: s1.play });
            const v = await axeScan(p);
            check(`${tag} I axe: no violations while it loads`, v.length === 0, v);
            p.__getMode = null;
            if (p.__release) p.__release();
            await p.waitForTimeout(800);
            const s2 = await pageState(p);
            check(`${tag} I then its songs`, !s2.loading && s2.rows.length === m.n && !s2.play.dis, { n: s2.rows.length });
            // Couldn't load: Retry
            const other = await p.evaluate((skip) => Object.keys(playlistsMeta).find(k => k !== skip && k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0), id);
            p.__getMode = 'fail';
            await openList(p, other);
            const s3 = await pageState(p);
            p.__getMode = null;
            await p.click('#songList .song-list-retry'); await p.waitForTimeout(1200);
            const s4 = await pageState(p);
            check(`${tag} I couldn't load: a Retry row; Retry loads the songs`,
                s3.failed && s3.retry && s3.rows.length === 0 && !s4.failed && s4.rows.length > 0 && s4.onScreen === other, { s3: { failed: s3.failed, retry: s3.retry }, s4: { failed: s4.failed, n: s4.rows.length } });
            check(`${tag} I errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- J. The turntable: the bar's button shows the deck instead of the
    // page and goes back; the bar's progress ticks while the deck is hidden
    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const { ctx, p } = await open({ vp });
        const id = await otherWithSongs(p);
        await openList(p, id);
        await p.click('#dvBarDeck'); await p.waitForTimeout(500);
        const s1 = await pageState(p);
        const b1 = await p.evaluate(() => document.getElementById('dvBarDeck').getAttribute('aria-pressed'));
        await p.click('#dvBarDeck'); await p.waitForTimeout(1500);
        const s2 = await pageState(p);
        const b2 = await p.evaluate(() => document.getElementById('dvBarDeck').getAttribute('aria-pressed'));
        check(`${tag} J the turntable button shows the deck (no page, no playlist highlighted); again, back to the playlist page it came from`,
            s1.deck && s1.mainShown && !s1.pageShown && b1 === 'true' && s1.sideOpen.length === 0
            && !s2.deck && s2.pageShown && !s2.mainShown && s2.onScreen === id && b2 === 'false' && s2.sideOpen[0] === id, { s1: { deck: s1.deck, main: s1.mainShown, page: s1.pageShown, side: s1.sideOpen }, b1, s2: { deck: s2.deck, page: s2.pageShown, on: s2.onScreen }, b2 });
        // Lyrics from the page: the deck with lyrics on
        await p.click('#dvBarLyrics'); await p.waitForTimeout(400);
        const ly = await p.evaluate(() => ({ deck: document.getElementById('musicPlayerView').classList.contains('dv-deck'), on: lyricsEnabled, pressed: document.getElementById('dvBarLyrics').getAttribute('aria-pressed') }));
        // A playlist from the sidebar leaves the deck for its page
        await p.click(`#dvSideList .dv-side-pl[data-playlist="${id}"]`); await p.waitForTimeout(1500);
        const s3 = await pageState(p);
        check(`${tag} J lyrics opens the deck with lyrics on; a sidebar playlist then shows its page`, ly.deck && ly.on && ly.pressed === 'true' && !s3.deck && s3.pageShown && s3.onScreen === id, { ly, s3: { deck: s3.deck, on: s3.onScreen } });
        // Home → turntable → back goes Home
        await p.click('#dvSideHome'); await p.waitForTimeout(500);
        await p.click('#dvBarDeck'); await p.waitForTimeout(500);
        const s4 = await pageState(p);
        await p.click('#dvBarDeck'); await p.waitForTimeout(500);
        const home = await p.evaluate(() => !document.getElementById('vinylCrateView').classList.contains('hidden'));
        check(`${tag} J from Home the turntable shows the deck with the playing list behind it; again goes Home`, s4.deck && s4.mainShown && s4.viewedId === null && home, { deck: s4.deck, home });
        // Progress: the sleeve's clock keeps the bar moving while the deck is hidden
        await openList(p, id);
        await p.evaluate(() => { ytPlayer.getCurrentTime = () => 42; ytPlayer.getDuration = () => 200; startSleeveProgress(); });
        await p.waitForTimeout(400);
        const pr = await p.evaluate(() => ({ bar: document.getElementById('dvBarElapsed').textContent, total: document.getElementById('dvBarTotal').textContent, sleeve: document.getElementById('sleeveTimeElapsed').textContent,
            main: getComputedStyle(document.querySelector('.music-main')).display, now: document.getElementById('dvBarSeek').getAttribute('aria-valuenow') }));
        await p.evaluate(() => { ytPlayer.getCurrentTime = () => 61; });
        await p.waitForTimeout(400);
        const pr2 = await p.evaluate(() => document.getElementById('dvBarElapsed').textContent);
        await p.evaluate(() => stopSleeveProgress());
        check(`${tag} J with the deck hidden the bar's progress keeps updating (and the deck's own clock with it)`,
            pr.main === 'none' && pr.bar === '0:42' && pr.total === '3:20' && pr.sleeve === '0:42' && pr.now === '42' && pr2 === '1:01', { pr, pr2 });
        check(`${tag} J errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- K. axe on the playlist page (shown list, menus open), wide and beside the rail
    for (const vp of [{ width: 1440, height: 900 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;
        const { ctx, p } = await open({ vp });
        const id = await otherWithSongs(p);
        await openList(p, id);
        const v1 = await axeScan(p);
        await p.click('#dvPlMore'); await p.waitForTimeout(150);
        const v2 = await axeScan(p);
        await p.keyboard.press('Escape');
        await p.hover('#songList .song-list-item[data-index="0"]');
        await p.click('#songList .song-list-item[data-index="0"] .song-send-btn'); await p.waitForTimeout(300);
        const v3 = await axeScan(p);
        await p.keyboard.press('Escape');
        const active = await p.evaluate(() => String(activePlaylistId));
        await openList(p, active);
        const v4 = await axeScan(p);
        const heads = await p.evaluate(() => [...document.querySelectorAll('#musicSidebar h1')].filter(h => h.getClientRects().length).map(h => h.textContent.trim()));
        check(`${tag} K axe: no violations on the page, with its ⋯ menu open, with a row's ⋯ open, and on the playing list`,
            v1.length === 0 && v2.length === 0 && v3.length === 0 && v4.length === 0, { v1, v2, v3, v4 });
        check(`${tag} K one visible h1 on the page: the playlist's name`, heads.length === 1, heads);
        check(`${tag} K errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- L. Phones and the app keep their own playlist screen
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const { ctx, p } = await open({ vp, phone: true });
        const id = await otherWithSongs(p);
        await openList(p, id);
        const s = await p.evaluate(() => {
            const shown = (el) => !!el && el.getClientRects().length > 0;
            return {
                dv2: document.documentElement.classList.contains('dv2'),
                head: shown(document.getElementById('dvPlHead')), shuffle: shown(document.getElementById('dvPlShuffle')), more: shown(document.getElementById('dvPlMore')),
                cols: shown(document.getElementById('dvPlCols')), album: [...document.querySelectorAll('#songList .song-list-album, #songList .song-list-dur')].some(shown),
                mainDisplay: getComputedStyle(document.querySelector('.music-main')).display,
                rowTab: [...document.querySelectorAll('#songList .song-list-item')].some(r => r.hasAttribute('tabindex')),
                deckClass: document.getElementById('musicPlayerView').classList.contains('dv-deck'),
            };
        });
        check(`L phone ${vp.width}x${vp.height}: no desktop page (no header, columns, album/length cells, row tab stops); the Now Playing sheet stays in the DOM`,
            !s.dv2 && !s.head && !s.shuffle && !s.more && !s.cols && !s.album && !s.rowTab && !s.deckClass && s.mainDisplay !== 'none', s);
        check(`L phone ${vp.width}x${vp.height}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ query: '?app=1' });
        const id = await otherWithSongs(p);
        await openList(p, id);
        const s = await p.evaluate(() => {
            const shown = (el) => !!el && el.getClientRects().length > 0;
            return { dv2: document.documentElement.classList.contains('dv2'), head: shown(document.getElementById('dvPlHead')), main: shown(document.querySelector('.music-main')), active: String(activePlaylistId) };
        });
        check('L app shell (?app=1) at 1440: its own player view (the turntable beside the list, no page header), opening still switches', !s.dv2 && !s.head && s.main && s.active === id, s);
        check('L app errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
