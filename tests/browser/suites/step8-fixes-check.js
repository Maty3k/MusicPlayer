// Step 8 review fixes: preview+add, shuffle, empty playlist cue, stale taps,
// focus across re-renders and the add sheet, recents clear, tile refresh,
// announcements, fonts and long titles.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ytFor = (q) => [0, 1].map(i => ({ videoId: (q.replace(/\W/g, '') + i + 'xxxxxxxxxxx').slice(0, 11), title: `${q} ${i ? 'Two' : 'One'}`, channel: 'Chan', thumbnail: '' }));

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state(opts.acct || 'many') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = []; p.__opts = opts;
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/search-youtube', async (route) => {
            const o = p.__opts;
            const q = JSON.parse(route.request().postData() || '{}').query;
            if (o.ytDelay) await sleep(o.ytDelay);
            if (o.yt === 'limited') return route.fulfill({ contentType: 'application/json', body: '{"success":false,"rateLimited":true}' });
            if (o.yt === 'error') return route.fulfill({ contentType: 'application/json', body: '{"success":false,"error":"Failed to fetch YouTube results"}' });
            if (o.yt === 'none') return route.fulfill({ contentType: 'application/json', body: '{"success":true,"results":[]}' });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: ytFor(q) }) });
        });
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (body.action === 'searchLibrary' && p.__opts.libDelayFor === body.q) {
                await sleep(p.__opts.libDelayMs || 1200);
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: [{ title: body.q + ' (library)', artist: 'Artist', cover: '', youtube_id: 'libhitxxxxx', playlistSlug: 'favorites', playlistName: 'Favorites', playlistColor: '#d4a574', position: 0 }] }) });
            }
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: 1, skipped: 0 }) });
            if (body.action === 'recordPlay') return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            if (body.action === 'delete') return route.fulfill({ contentType: 'application/json', body: '{"success":true,"newIndex":0}' });
            return route.continue();
        });
        await p.addInitScript((recent) => { try { localStorage.setItem('mRecentSearches', JSON.stringify(recent)); sessionStorage.removeItem('mSearchQuery'); } catch (e) {} }, opts.recent || []);
        await p.goto(APP); await p.waitForTimeout(1200);
        await p.evaluate((stub) => {
            window.__radio = []; window.__played = []; window.__cued = [];
            if (stub) window.playRadioSong = function (s) { window.__radio.push(s && s.title); };
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); (cue ? window.__cued : window.__played).push(s && s.title); };
        }, opts.stubRadio !== false);
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        return { ctx, p };
    }
    const type = async (p, q, wait = 1200) => { await p.fill('#mSearchInput', q); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(wait); };
    const status = (p) => p.evaluate(() => document.getElementById('mSearchStatus').textContent);
    const pickActive = async (p) => { await p.tap(`#mAddToSheet [data-addto="${await p.evaluate(() => String(activePlaylistId))}"]`); await p.waitForTimeout(900); };

    // F1 preview, then add to the open playlist: no live + left on the preview
    {
        const { ctx, p } = await open({ stubRadio: false });
        await type(p, 'Refute Tune');
        await p.tap('#mSearchResults [data-yt="0"]'); await p.waitForTimeout(600);
        const before = await p.evaluate(() => ({ radio: currentRadioSong && currentRadioSong.youtube_id, saved: currentRadioSongSaved }));
        await p.tap('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
        await pickActive(p);
        const after = await p.evaluate(() => { const btn = document.querySelector('#songList .radio-song-item .song-save-btn'); return { saved: currentRadioSongSaved, btnDisabled: btn ? btn.disabled : null, copies: songsData.filter(s => s.youtube_id === currentRadioSong.youtube_id).length }; });
        check('F1 preview then add: the preview counts as saved (✓, no second +)', before.radio && before.saved === false && after.saved === true && after.btnDisabled === true && after.copies === 1, { before, after });
        check('F1 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // F2 shuffle picks up the added song
    {
        const { ctx, p } = await open();
        await p.evaluate(() => { shuffleMode = 'on'; buildShuffleQueue(); });
        await type(p, 'Shuffle Add');
        await p.tap('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
        await pickActive(p);
        const q = await p.evaluate(() => ({ idx: songsData.length - 1, inQueue: shuffleQueue.includes(songsData.length - 1) || currentSongIndex === songsData.length - 1 }));
        check('F2 with shuffle on, the added song joins the shuffle queue', q.inQueue, q);
        await p.evaluate(() => { shuffleMode = 'off'; });
        await ctx.close();
    }
    // F3 an empty active playlist cues the added song
    {
        const { ctx, p } = await open({ acct: 'demo' });
        const pre = await p.evaluate(() => ({ n: songsData.length, active: activePlaylistId }));
        await type(p, 'First Song');
        await p.tap('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
        await pickActive(p);
        const post = await p.evaluate(() => ({ n: songsData.length, idx: currentSongIndex, cued: window.__cued.slice() }));
        check('F3 adding to an empty active playlist cues the song', pre.n === 0 && post.n === 1 && post.idx === 0 && post.cued.includes('First Song One'), { pre, post });
        await ctx.close();
    }
    // F4 a tap acts on the row it shows, even with a newer query in flight
    {
        const { ctx, p } = await open({ libDelayFor: 'bravo', libDelayMs: 4000 });
        await type(p, 'alpha', 1500);
        await type(p, 'bravo', 900); // YouTube for bravo is in, the library isn't
        const shown = await p.evaluate(() => document.querySelector('#mSearchResults [data-yt="0"] .search-result-title').textContent);
        await p.tap('#mSearchResults [data-yt="0"]'); await p.waitForTimeout(300);
        const radio = await p.evaluate(() => window.__radio.slice());
        check('F4 the tapped row plays what it shows', shown === 'alpha One' && radio[0] === 'alpha One', { shown, radio });
        await p.waitForFunction(() => /bravo/.test((document.querySelector('#mSearchResults [data-yt="0"] .search-result-title') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
        const now = await p.evaluate(() => document.querySelector('#mSearchResults [data-yt="0"] .search-result-title').textContent);
        check('F4 then the new query shows', now === 'bravo One', now);
        await ctx.close();
    }
    // F5 focus on a library row survives YouTube's loading and answer
    {
        const { ctx, p } = await open({ ytDelay: 1500 });
        await type(p, 'Song 1', 0);
        await p.waitForSelector('#mSearchResults [data-lib="0"]');
        await p.evaluate(() => { const el = document.querySelector('#mSearchResults [data-lib="0"]'); el.dataset.mark = 'x'; el.focus(); });
        await p.waitForTimeout(2300);
        const f = await p.evaluate(() => ({ mark: document.activeElement.dataset && document.activeElement.dataset.mark, yt: document.querySelectorAll('#mSearchResults [data-yt]').length, st: document.getElementById('mSearchStatus').textContent }));
        check('F5 focus stays on the library row while YouTube loads and answers', f.mark === 'x' && f.yt === 2, f);
        check('F5 then "2 more from YouTube" is announced', f.st === '2 more from YouTube', f.st);
        // the add sheet hands focus back to its +
        await p.focus('#mSearchResults [data-add="1"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
        const inSheet = await p.evaluate(() => !!document.activeElement.closest('#mAddToSheet'));
        await p.click('#mAddToSheet .add-song-modal-close'); await p.waitForTimeout(500);
        const back = await p.evaluate(() => document.activeElement.dataset && document.activeElement.dataset.add);
        await p.focus('#mSearchResults [data-add="0"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
        await p.keyboard.press('Enter'); await p.waitForTimeout(900); // picks the first playlist
        const back2 = await p.evaluate(() => ({ add: document.activeElement.dataset && document.activeElement.dataset.add, layer: history.state && history.state.mLayer }));
        check('F6 closing Add to playlist returns focus to its +', inSheet && back === '1' && back2.add === '0' && back2.layer === 'tab', { inSheet, back, back2 });
        await ctx.close();
    }
    // F7 clearing recents doesn't pop the keyboard
    {
        const { ctx, p } = await open({ recent: ['queen', 'daft punk'] });
        await p.tap('.m-recent-x'); await p.waitForTimeout(300);
        const one = await p.evaluate(() => ({ left: document.querySelectorAll('.m-recent-q').length, active: document.activeElement.className }));
        await p.tap('#mSearchResults [data-clear-recent]'); await p.waitForTimeout(400);
        const f = await p.evaluate(() => ({ active: document.activeElement.id, kb: document.body.classList.contains('m-kb'), left: document.querySelectorAll('.m-recent-q').length }));
        check('F7 × moves to the next ×; Clear parks focus in the results (no keyboard)', one.left === 1 && one.active === 'm-recent-x' && f.active === 'mSearchResults' && !f.kb && f.left === 0, { one, f });
        // F8 tiles follow a rename and a switch
        const renamed = await p.evaluate(() => { const id = String(activePlaylistId); const old = playlistsMeta[id].name; playlistsMeta[id].name = 'Renamed RV8'; updateCrateRecords(); const t = document.querySelector(`#mSearchResults .m-rp-tile[data-playlist="${id}"]`).textContent.trim(); playlistsMeta[id].name = old; updateCrateRecords(); return t; });
        check('F8 the playlist tiles follow a rename', renamed === 'Renamed RV8', renamed);
        await ctx.close();
    }
    // F9 announcements
    {
        const { ctx, p } = await open({ yt: 'none' });
        await type(p, 'zzqqxx');
        const none = await status(p);
        p.__opts = { yt: 'limited' };
        await type(p, 'Song 2');
        const lim = await status(p);
        const limText = await p.evaluate(() => document.querySelector('#mSearchResults .m-sr-yt').textContent);
        p.__opts = { yt: 'error' };
        await type(p, 'Song 3');
        const err = await status(p);
        p.__opts = {};
        await type(p, 'Song 4');
        await type(p, 'Song 5');
        await type(p, 'Song 4'); // from the cache
        const cached = await status(p);
        check('F9 nothing anywhere: "No songs found"', none === 'No songs found', none);
        check('F9 rate-limited and failed YouTube searches are announced', /busy/.test(lim) && /too fast/.test(limText) && err === 'YouTube search failed', { lim, err });
        check('F9 cached YouTube results are announced too', cached === '2 more from YouTube', cached);
        // F10 fonts and spacing
        const css = await p.evaluate(() => ({ chip: getComputedStyle(document.querySelector('#mSearchResults .m-sr-open')).fontFamily, ytGap: parseFloat(getComputedStyle(document.querySelector('#mSearchResults .m-sr-yt .m-search-section')).marginTop), chipW: document.querySelector('#mSearchResults .m-sr-open').getBoundingClientRect().width }));
        check('F10 the playlist chip uses the app font, YouTube heading spaced, chip ≥ 44px', /Inter/.test(css.chip) && css.ytGap >= 18 && css.chipW >= 44, css);
        await ctx.close();
    }
    // F11 a long unbroken title wraps in the add sheet
    {
        const { ctx, p } = await open();
        await p.evaluate(() => window.mShowAddToSheet({ title: '#music#viral#trending#fyp#song#love#explore#foryou#newmusic#hits', artist: '', youtube_id: 'aaaaaaaaaa1' }));
        await p.waitForTimeout(400);
        const w = await p.evaluate(() => { const el = document.querySelector('#mAddToSheet .m-addto-song'); const panel = el.closest('.add-song-modal-panel'); return { sw: el.scrollWidth, cw: el.clientWidth, psw: panel.scrollWidth, pcw: panel.clientWidth }; });
        check('F11 a long unbroken title wraps inside the add sheet', w.sw <= w.cw + 1 && w.psw <= w.pcw + 1, w);
        check('F errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // G1 an add into an empty playlist doesn't cut off music still playing,
    // and the added song still starts (tap, Next, the old track ending)
    const leftover = async (p, title, mutate) => {
        await p.evaluate(() => { document.getElementById('vinyl').classList.add('playing'); lastRequestedSong = { youtube_id: 'oldtrackxxx', title: 'Old Track' }; });
        await type(p, title);
        if (mutate) await p.evaluate(mutate);
        await p.tap('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
        await pickActive(p);
    };
    {
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Keep Playing');
        const g = await p.evaluate(() => ({ n: songsData.length, cued: window.__cued.slice(), idx: currentSongIndex, started: currentRowStarted() }));
        check('G1 adding to an empty playlist while music plays: no cue (the music goes on)', g.n === 1 && g.cued.length === 0 && g.idx === 0 && g.started === false, g);
        const next = await p.evaluate(async () => { nextSong(); await new Promise(r => setTimeout(r, 1500)); return { played: window.__played.slice(), idx: currentSongIndex }; });
        check('G1b then Next starts the added song', next.played.includes('Keep Playing One') && next.idx === 0, next);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Row Tap');
        const tap = await p.evaluate(async () => { switchSong(0); await new Promise(r => setTimeout(r, 1500)); return { played: window.__played.slice() }; });
        check('G1c ...and so does tapping its row', tap.played.includes('Row Tap One'), tap);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Paused Old');
        const t = await p.evaluate(async () => {
            const calls = [];
            const stub = { _s: 2, loadVideoById(id) { calls.push('load ' + id); }, playVideo() { calls.push('play'); }, pauseVideo() { calls.push('pause'); }, cueVideoById() {}, seekTo() {}, setVolume() {}, getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; } };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            toggleMusic();
            await new Promise(r => setTimeout(r, 1800));
            const first = { calls: calls.slice(), played: window.__played.slice(), title: (document.querySelector('.song-title') || {}).textContent, unloaded: currentRowUnloaded };
            stub._s = 2; toggleMusic(); // its own song now: a pause/play resumes
            return { first, then: calls.slice(first.calls.length) };
        });
        check('G1f the old track paused: Play starts the added song (screen updated); after that, Play resumes', t.first.played.includes('Paused Old One') && !t.first.calls.includes('play') && t.first.title === 'Paused Old One' && t.first.unloaded === false && t.then[0] === 'play', t);
        await ctx.close();
    }
    {
        // several songs added under the old track: its end, Next and Previous start the first
        for (const how of ['end', 'next', 'prev']) {
            const { ctx, p } = await open({ acct: 'demo' });
            await leftover(p, 'Multi ' + how);
            await p.tap('#mSearchResults [data-add="1"]'); await p.waitForTimeout(500);
            await pickActive(p);
            const r = await p.evaluate(async (how) => { loopMode = 'off'; shuffleMode = 'off'; if (how === 'end') playNextByLoop(); else if (how === 'next') nextSong(); else prevSong(); await new Promise(r => setTimeout(r, 1500)); return { n: songsData.length, played: window.__played.slice(), idx: currentSongIndex }; }, how);
            check(`G1g two songs added under the old track: ${how} starts the first`, r.n === 2 && r.played[0] === `Multi ${how} One` && r.idx === 0, r);
            await ctx.close();
        }
    }
    {
        // hearing the added song from Search: the full switch (screen updated)
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Hear It');
        await p.tap('#mSearchResults [data-yt="0"]'); await p.waitForTimeout(1800);
        const h = await p.evaluate(() => ({ played: window.__played.slice(), radio: window.__radio.slice(), title: (document.querySelector('.song-title') || {}).textContent, unloaded: currentRowUnloaded }));
        check('G1h tapping the added song in Search plays it with the screen updated', h.played.includes('Hear It One') && h.radio.length === 0 && h.title === 'Hear It One' && h.unloaded === false, h);
        await ctx.close();
    }
    {
        // removing the waiting song leaves the old track alone; Pause pauses the old track
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Undo Me');
        const d = await p.evaluate(async () => {
            const calls = [];
            const stub = { _s: 1, loadVideoById(id) { calls.push('load ' + id); }, playVideo() { calls.push('play'); }, pauseVideo() { calls.push('pause'); }, cueVideoById(id) { calls.push('cue ' + id); }, seekTo() {}, setVolume() {}, getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; } };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            let activated = 0; const origAct = window.activatePlayerForSong; window.activatePlayerForSong = function () { activated++; return origAct.apply(this, arguments); };
            toggleMusic(); // the old track is PLAYING: Pause pauses it, nothing else
            const pause = { calls: calls.slice(), played: window.__played.slice(), activated };
            stub._s = 1;
            await deleteSong(0, { skipConfirm: true });
            return { pause, afterDelete: calls.slice(pause.calls.length), n: songsData.length, unloaded: currentRowUnloaded };
        });
        check('G1i Pause with the added song waiting pauses the old track (same engine, no new song)', d.pause.calls.length === 1 && d.pause.calls[0] === 'pause' && d.pause.played.length === 0 && d.pause.activated === 0, d.pause);
        check('G1j removing the waiting song leaves the old track playing', d.n === 0 && d.afterDelete.length === 0 && d.unloaded === false, d);
        await ctx.close();
    }
    {
        // add A (waits), then the playing track itself, then remove A: the track is current and started
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Remove A');
        const k = await p.evaluate(async () => {
            songsData.push({ youtube_id: 'oldtrackxxx', title: 'Old Track', artist: '' }); rebuildSongList();
            const before = currentRowUnloaded;
            await deleteSong(0, { skipConfirm: true });
            return { before, after: currentRowUnloaded, cur: songsData[currentSongIndex] && songsData[currentSongIndex].title };
        });
        check('G1k removing the waiting row so the playing track becomes current: it counts as started', k.before === true && k.after === false && k.cur === 'Old Track', k);
        await ctx.close();
    }
    for (const loop of ['off', 'playlist']) {
        const { ctx, p } = await open({ acct: 'demo' });
        await leftover(p, 'Ends ' + loop);
        const end = await p.evaluate(async (lm) => { loopMode = lm; let restarted = 0; window.restartSong = () => { restarted++; }; playNextByLoop(); await new Promise(r => setTimeout(r, 1500)); return { played: window.__played.slice(), restarted }; }, loop);
        check(`G1d the old track ending (loop ${loop}) starts the added song`, end.played.includes(`Ends ${loop} One`) && end.restarted === 0, end);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'demo' });
        // the playing track is the one being added ("save what I'm hearing")
        await leftover(p, 'Same Song', () => { lastRequestedSong = { youtube_id: 'SameSong0xx', title: 'Same Song One' }; });
        const same = await p.evaluate(async () => { loopMode = 'playlist'; let restarted = 0; window.restartSong = () => { restarted++; }; const started = currentRowStarted(); const tapBefore = window.__played.length; switchSong(0); await new Promise(r => setTimeout(r, 300)); const tapPlayed = window.__played.length - tapBefore; playNextByLoop(); await new Promise(r => setTimeout(r, 800)); return { started, tapPlayed, played: window.__played.slice(), restarted }; });
        check('G1e adding the song that is playing: it counts as current (a tap is a no-op, its end loops it once)', same.started === true && same.tapPlayed === 0 && same.restarted === 1 && same.played.length === 0, same);
        check('G1 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // G2 + first, then preview: plays the listed copy, no radio row with a +
    {
        const { ctx, p } = await open();
        await type(p, 'Order Test');
        await p.tap('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
        await pickActive(p);
        await p.tap('#mSearchResults [data-yt="0"]'); await p.waitForTimeout(900);
        const g = await p.evaluate(() => ({ radio: window.__radio.slice(), played: window.__played.slice(), idx: currentSongIndex, last: songsData.length - 1 }));
        check('G2 add, then tap the same YouTube row: it plays from the playlist (no preview copy)', g.radio.length === 0 && g.played.includes('Order Test One') && g.idx === g.last, g);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ stubRadio: false });
        const saved = await p.evaluate(async () => { await playRadioSong(Object.assign({}, songsData[1])); return { saved: currentRadioSongSaved, btn: (document.querySelector('#songList .radio-song-item .song-save-btn') || {}).disabled }; });
        check('G3 a radio pick that is already in the list shows ✓, not +', saved.saved === true && saved.btn === true, saved);
        const ids = await p.evaluate(() => ({ mp3: extractYoutubeId('https://media.example.org/live/sundayservice_2024.mp3'), live: extractYoutubeId('https://www.youtube.com/live/jfKfPfyJRdk?si=abc'), olive: extractYoutubeId('https://cdn.example.com/olive/abcdefghijklmnop.mp3') }));
        check('G4 /live/ in an audio link is not a YouTube id; YouTube live still is', ids.mp3 === '' && ids.olive === '' && ids.live === 'jfKfPfyJRdk', ids);
        await p.fill('#mSearchInput', 'https://music.youtube.com/playlist?list=RDCLAK5uy_k5DxhF_abcdefg&si=x'); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(200);
        const rows = await p.evaluate(() => [...document.querySelectorAll('.m-search-link')].map(r => r.dataset.link).join(','));
        await p.fill('#mSearchInput', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDCLAK5uy_k5DxhF_abcdefg'); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(200);
        const rows2 = await p.evaluate(() => [...document.querySelectorAll('.m-search-link')].map(r => r.dataset.link).join(','));
        check('G5 YouTube Music curated playlists (RDCLAK…) can be imported', rows === 'import-yt' && rows2 === 'import-yt,add-song', { rows, rows2 });
        await ctx.close();
    }
    // G6 YouTube from the cache before a slow library: one line with both counts
    {
        const { ctx, p } = await open();
        await type(p, 'Song 1');
        await type(p, 'Song 2');
        p.__opts = { libDelayFor: 'Song 1' };
        await type(p, 'Song 1', 0);
        await p.waitForFunction(() => /in your library/.test(document.getElementById('mSearchStatus').textContent), null, { timeout: 8000 }).catch(() => {});
        const st = await status(p);
        check('G6 YouTube first, then the library: both counts are announced', /songs? in your library\. 2 more from YouTube$/.test(st), st);
        await ctx.close();
    }
    // G7 removing a recent search moves to the next ×
    {
        const { ctx, p } = await open({ recent: ['alpha one', 'bravo two', 'charlie three'] });
        await p.tap('.m-recent-x[data-recent-x="1"]'); await p.waitForTimeout(300);
        const f = await p.evaluate(() => ({ x: document.activeElement.dataset.recentX, label: document.activeElement.getAttribute('aria-label') }));
        check('G7 removing the 2nd recent search focuses the next ×', f.x === '1' && /charlie three/.test(f.label), f);
        check('G errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
