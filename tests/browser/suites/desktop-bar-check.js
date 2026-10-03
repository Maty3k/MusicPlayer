// Desktop step 1 + 2: the desktop-only scope (html.dv2) and the persistent
// bottom player bar (#dvBar) at 1440x900 and 1024x768. Checks that the bar
// shows on the crate and the player view when a song is loaded and hides
// when nothing is; that every control reaches the engine function it
// should and reflects its state; seek (click, drag, keys); volume both ways
// with the deck's knob; that the page ends above the bar; and that phones
// (390x844, 844x390) and the app shell (?app=1) never get the scope or the bar.
// (Desktop step 3 changed F: opening a playlist only shows it now.)
// Writes to /save-music are faked and recorded (reads go through).
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
            // A stub player that remembers seeks and volume
            window.__seeks = []; window.__vol = []; window.__calls = [];
            const stub = { _s: 5, _t: 0, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {},
                seekTo(t) { window.__seeks.push(t); this._t = t; }, setVolume(v) { window.__vol.push(v); }, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; },
                getPlayerState() { return this._s; }, getCurrentTime() { return this._t; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); };
            // Record the engine calls the bar makes (no call-through: no playback side effects)
            ['toggleMusic', 'prevSong', 'nextSong'].forEach((fn) => { window[fn] = function () { window.__calls.push(fn); }; });
            // Recorded, then passed on (the bar must reflect what they did)
            ['openQueueModal', 'toggleShuffle', 'toggleLoopMode', 'setSleepTimer', 'toggleLyrics', 'openPlayerView', 'showPlaylistPicker'].forEach((fn) => {
                const orig = window[fn];
                window[fn] = function () { window.__calls.push(fn); return orig.apply(this, arguments); };
            });
            // No outside services: radio and lyrics lookups are no-ops here
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            window.__toasts = [];
            const t = window.mToast; if (t) window.mToast = function (m) { window.__toasts.push(m); return t.apply(this, arguments); };
        });
        return { ctx, p };
    }

    const calls = (p) => p.evaluate(() => window.__calls.slice());
    const clearCalls = (p) => p.evaluate(() => { window.__calls.length = 0; });
    const barState = (p) => p.evaluate(() => {
        const bar = document.getElementById('dvBar');
        const r = bar.getBoundingClientRect();
        const ms = document.getElementById('music-section').getBoundingClientRect();
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            barCls: document.documentElement.classList.contains('dv2-bar'),
            display: getComputedStyle(bar).display,
            top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), vh: innerHeight,
            msBottom: Math.round(ms.bottom),
            title: bar.querySelector('.song-title').textContent.trim(),
            artist: bar.querySelector('.song-artist').textContent.trim(),
            sleeveTitle: (document.querySelector('.sleeve-mobile-nowplaying .song-title') || {}).textContent,
            crate: !document.getElementById('vinylCrateView').classList.contains('hidden'),
            player: document.getElementById('musicPlayerView').classList.contains('active'),
        };
    });
    const attr = (p, id, a) => p.evaluate(([i, x]) => document.getElementById(i).getAttribute(x), [id, a]);

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. Visible on the crate with a song loaded; the page ends above it
        {
            const { ctx, p } = await open({ vp });
            const s = await barState(p);
            const cur = await p.evaluate(() => ({ n: songsData.length, title: songsData[currentSongIndex] && songsData[currentSongIndex].title }));
            check(`${tag} A html.dv2 is set and the bar shows on the crate`, s.dv2 && s.barCls && s.display !== 'none' && s.crate && s.bottom === s.vh && s.h >= 60, s);
            check(`${tag} A the bar shows the loaded song (setNowPlayingText fan-out)`, cur.n > 0 && s.title === s.sleeveTitle && s.title === cur.title, { s, cur });
            check(`${tag} A #music-section ends at the bar's top`, s.msBottom <= s.top, s);
            const ids = await p.evaluate(() => [...document.querySelectorAll('#dvBar [id], #dvBar')].map(e => e.id).filter(id => document.querySelectorAll(`[id="${id}"]`).length !== 1));
            check(`${tag} A no duplicate ids in the bar`, ids.length === 0, ids);
            const cover = await p.evaluate(() => {
                // Scroll the crate's scroller to the end; the lowest card must sit above the bar
                const cards = [...document.querySelectorAll('#vinylCrateView .record-card')].filter(c => !c.closest('.conveyor-dupes') && c.getClientRects().length);
                const scrollerOf = (el) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return null; };
                const sc = cards.length ? scrollerOf(cards[cards.length - 1]) : null;
                if (sc) sc.scrollTop = sc.scrollHeight;
                const low = cards.map(c => c.getBoundingClientRect().bottom).reduce((a, x) => Math.max(a, x), 0);
                const barTop = document.getElementById('dvBar').getBoundingClientRect().top;
                return { n: cards.length, scroller: sc ? (sc.className || sc.id) : null, low: Math.round(low), barTop: Math.round(barTop), scBottom: sc ? Math.round(sc.getBoundingClientRect().bottom) : null };
            });
            check(`${tag} A crate scrolled to the end: the last playlist card is fully above the bar`, cover.n > 0 && cover.low <= cover.barTop, cover);
            // Focus ring on a keyboard focus
            await p.keyboard.press('Shift');
            const ring = await p.evaluate(() => { const el = document.getElementById('dvBarNext'); el.focus(); const cs = getComputedStyle(el); return { style: cs.outlineStyle, w: cs.outlineWidth }; });
            check(`${tag} A buttons show a focus ring`, ring.style === 'solid' && parseFloat(ring.w) >= 2, ring);
            const a11y = await p.evaluate(() => {
                const bar = document.getElementById('dvBar');
                const unlabeled = [...bar.querySelectorAll('button, input, [role="slider"]')].filter(e => !e.getAttribute('aria-label') && !e.closest('[role="menu"]')).map(e => e.id || e.className);
                return { role: bar.getAttribute('role'), label: bar.getAttribute('aria-label'), tb: bar.querySelector('[role="toolbar"]').getAttribute('aria-label'), unlabeled };
            });
            check(`${tag} A region + toolbar labelled, every control has an aria-label`, a11y.role === 'region' && a11y.label === 'Player' && a11y.tb === 'Playback' && a11y.unlabeled.length === 0, a11y);
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. Transport: play/pause, prev, next, shuffle, loop
        {
            const { ctx, p } = await open({ vp });
            await p.click('#dvBarPlay'); await p.click('#dvBarPrev'); await p.click('#dvBarNext');
            const c = await calls(p);
            check(`${tag} B play, previous, next call toggleMusic, prevSong, nextSong`, JSON.stringify(c) === JSON.stringify(['toggleMusic', 'prevSong', 'nextSong']), c);
            await p.evaluate(() => document.getElementById('vinyl').classList.add('playing'));
            await p.waitForTimeout(100);
            const playing = await p.evaluate(() => ({
                label: document.getElementById('dvBarPlay').getAttribute('aria-label'),
                pause: getComputedStyle(document.querySelector('#dvBarPlay .dv-ic-pause')).display,
                play: getComputedStyle(document.querySelector('#dvBarPlay .dv-ic-play')).display,
                spin: getComputedStyle(document.querySelector('#dvBar .dv-bar-disc')).animationPlayState,
            }));
            check(`${tag} B playing: Pause label and icon, the record spins`, playing.label === 'Pause' && playing.pause !== 'none' && playing.play === 'none' && playing.spin === 'running', playing);
            await p.evaluate(() => document.getElementById('vinyl').classList.remove('playing'));
            await p.waitForTimeout(100);
            const paused = await p.evaluate(() => ({ label: document.getElementById('dvBarPlay').getAttribute('aria-label'), spin: getComputedStyle(document.querySelector('#dvBar .dv-bar-disc')).animationPlayState }));
            check(`${tag} B paused: Play label, the record stops`, paused.label === 'Play' && paused.spin === 'paused', paused);

            const seen = [];
            for (let i = 0; i < 3; i++) {
                await p.click('#dvBarShuffle');
                seen.push(await p.evaluate(() => { const b = document.getElementById('dvBarShuffle'); return { mode: shuffleMode, data: b.dataset.mode, pressed: b.getAttribute('aria-pressed'), rail: document.getElementById('shuffleBtn').dataset.shuffle }; }));
            }
            check(`${tag} B shuffle cycles through toggleShuffle; the bar and the rail follow`,
                new Set(seen.map(x => x.mode)).size === 3 && seen.every(x => x.data === x.mode && x.rail === x.mode && x.pressed === String(x.mode !== 'off')), seen);
            const loops = [];
            for (let i = 0; i < 3; i++) {
                await p.click('#dvBarLoop');
                loops.push(await p.evaluate(() => { const b = document.getElementById('dvBarLoop'); return { mode: loopMode, data: b.dataset.mode, pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'), one: getComputedStyle(b.querySelector('.dv-bar-loop-one')).display !== 'none', rail: document.getElementById('loopCoaster').dataset.loop }; }));
            }
            check(`${tag} B repeat cycles through toggleLoopMode; "1" shows on repeat one`,
                new Set(loops.map(x => x.mode)).size === 3 && loops.every(x => x.data === x.mode && x.rail === x.mode && x.pressed === String(x.mode !== 'off') && x.one === (x.mode === 'single')
                    && x.label === (x.mode === 'single' ? 'Repeat one' : x.mode === 'playlist' ? 'Repeat all' : 'Repeat')), loops);
            const c2 = await calls(p);
            check(`${tag} B the toggles went through toggleShuffle / toggleLoopMode`, c2.filter(x => x === 'toggleShuffle').length === 3 && c2.filter(x => x === 'toggleLoopMode').length === 3, c2);
            // The rail's own buttons update the bar too (one state)
            await p.evaluate(() => toggleShuffle());
            const fromRail = await p.evaluate(() => ({ mode: shuffleMode, data: document.getElementById('dvBarShuffle').dataset.mode }));
            check(`${tag} B a toggle from the deck/rail updates the bar`, fromRail.mode === fromRail.data, fromRail);
            check(`${tag} B errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- C. Seek: the sleeve's tick drives it; click, drag and keys seek
        {
            const { ctx, p } = await open({ vp });
            await p.evaluate(() => { ytPlayer._t = 50; updateSleeveProgress(); });
            const tick = await p.evaluate(() => ({ el: document.getElementById('dvBarElapsed').textContent, tot: document.getElementById('dvBarTotal').textContent,
                now: document.getElementById('dvBarSeek').getAttribute('aria-valuenow'), max: document.getElementById('dvBarSeek').getAttribute('aria-valuemax'),
                text: document.getElementById('dvBarSeek').getAttribute('aria-valuetext'), fill: document.getElementById('dvBarFill').style.width }));
            check(`${tag} C the progress tick fills the bar (0:50 of 3:20)`, tick.el === '0:50' && tick.tot === '3:20' && tick.now === '50' && tick.max === '200' && tick.text === '0:50 of 3:20' && tick.fill === '25%', tick);
            const box = await p.locator('#dvBarSeek').boundingBox();
            const y = box.y + box.height / 2;
            await p.mouse.click(box.x + box.width * 0.5, y);
            const s1 = await p.evaluate(() => ({ seeks: window.__seeks.slice(), el: document.getElementById('dvBarElapsed').textContent, sleeve: document.getElementById('sleeveTimeElapsed').textContent }));
            check(`${tag} C click at the middle seeks to ~1:40 (bar and sleeve)`, s1.seeks.length === 1 && Math.abs(s1.seeks[0] - 100) <= 3 && /^1:(3[7-9]|4[0-3])$/.test(s1.el) && s1.sleeve === s1.el, s1);
            await p.mouse.move(box.x + box.width * 0.2, y);
            await p.mouse.down();
            await p.mouse.move(box.x + box.width * 0.5, y, { steps: 4 });
            await p.mouse.move(box.x + box.width * 0.75, y, { steps: 4 });
            const mid = await p.evaluate(() => ({ seeks: window.__seeks.length, el: document.getElementById('dvBarElapsed').textContent, drag: document.getElementById('dvBarSeek').classList.contains('is-dragging') }));
            await p.mouse.up();
            const s2 = await p.evaluate(() => window.__seeks.slice());
            check(`${tag} C drag previews without seeking, then seeks once on release (~2:30)`, mid.seeks === 1 && mid.drag && /^2:(2[7-9]|3[0-3])$/.test(mid.el) && s2.length === 2 && Math.abs(s2[1] - 150) <= 3, { mid, s2 });
            await p.evaluate(() => { ytPlayer._t = 100; });
            await p.focus('#dvBarSeek');
            await p.keyboard.press('ArrowRight');
            await p.keyboard.press('ArrowLeft');
            await p.keyboard.press('ArrowLeft');
            await p.keyboard.press('Home');
            await p.keyboard.press('End');
            const s3 = await p.evaluate(() => ({ seeks: window.__seeks.slice(2), now: document.getElementById('dvBarSeek').getAttribute('aria-valuenow') }));
            check(`${tag} C keys: arrows ±5s, Home to the start, End just short of the end`, JSON.stringify(s3.seeks) === JSON.stringify([105, 100, 95, 0, 199]) && s3.now === '199', s3);
            check(`${tag} C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. Volume: the slider drives setVolume and the knob; the knob drives the slider
        {
            const { ctx, p } = await open({ vp });
            const visible = await p.evaluate(() => getComputedStyle(document.getElementById('dvBarVolume')).display !== 'none');
            check(`${tag} D the volume slider shows`, visible, visible);
            await p.evaluate(() => { const r = document.getElementById('dvBarVolume'); r.value = 40; r.dispatchEvent(new Event('input', { bubbles: true })); });
            const v1 = await p.evaluate(() => ({ cur: currentVolume, label: document.getElementById('volumeLabel').textContent, knob: document.getElementById('volumeKnob').style.transform, yt: window.__vol[window.__vol.length - 1], text: document.getElementById('dvBarVolume').getAttribute('aria-valuetext') }));
            check(`${tag} D slider to 40: setVolume ran (player, knob, label)`, v1.cur === 40 && v1.label === '40' && v1.yt === 40 && v1.knob.includes('rotate(-26deg)') && v1.text === '40%', v1);
            await p.focus('#dvBarVolume'); await p.keyboard.press('ArrowRight');
            const v2 = await p.evaluate(() => currentVolume);
            check(`${tag} D the slider works from the keyboard (41)`, v2 === 41, v2);
            await p.evaluate(() => setVolume(70));
            const v3 = await p.evaluate(() => ({ v: document.getElementById('dvBarVolume').value, text: document.getElementById('dvBarVolume').getAttribute('aria-valuetext') }));
            check(`${tag} D the knob (setVolume) moves the slider`, v3.v === '70' && v3.text === '70%', v3);
            await p.click('#dvBarMute');
            const m1 = await p.evaluate(() => ({ cur: currentVolume, pressed: document.getElementById('dvBarMute').getAttribute('aria-pressed'), v: document.getElementById('dvBarVolume').value }));
            await p.click('#dvBarMute');
            const m2 = await p.evaluate(() => ({ cur: currentVolume, pressed: document.getElementById('dvBarMute').getAttribute('aria-pressed') }));
            check(`${tag} D mute goes to 0 and back to 70`, m1.cur === 0 && m1.pressed === 'true' && m1.v === '0' && m2.cur === 70 && m2.pressed === 'false', { m1, m2 });
            check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- E. Queue, sleep, lyrics, turntable
        {
            const { ctx, p } = await open({ vp });
            await p.click('#dvBarQueue');
            const q = await p.evaluate(() => ({ calls: window.__calls.slice(), open: document.getElementById('queueModal').classList.contains('active') }));
            check(`${tag} E queue opens the queue (openQueueModal)`, q.calls.includes('openQueueModal') && q.open, q);
            await p.evaluate(() => hideQueueModal());
            await p.evaluate(() => { playQueue.push(songToQueueItem(songsData[0])); updateQueueBadge(); });
            const badge = await p.evaluate(() => ({ t: document.getElementById('dvBarQueueCount').textContent, hidden: document.getElementById('dvBarQueueCount').hidden, label: document.getElementById('dvBarQueue').getAttribute('aria-label') }));
            check(`${tag} E the queue count shows on the button`, badge.t === '1' && !badge.hidden && badge.label === 'Up next: 1 queued', badge);
            await p.evaluate(() => { playQueue.length = 0; updateQueueBadge(); });

            await clearCalls(p);
            await p.click('#dvBarSleep');
            const s1 = await p.evaluate(() => ({ hidden: document.getElementById('dvBarSleepMenu').hidden, exp: document.getElementById('dvBarSleep').getAttribute('aria-expanded'), focus: document.activeElement && document.activeElement.dataset.dvSleep, off: document.getElementById('dvBarSleepOff').hidden }));
            await p.keyboard.press('ArrowDown');
            const f2 = await p.evaluate(() => document.activeElement.dataset.dvSleep);
            await p.keyboard.press('Escape');
            const s2 = await p.evaluate(() => ({ hidden: document.getElementById('dvBarSleepMenu').hidden, exp: document.getElementById('dvBarSleep').getAttribute('aria-expanded'), focus: document.activeElement.id }));
            check(`${tag} E sleep menu: opens with focus on the first item, arrows move, Escape closes back to the button`,
                !s1.hidden && s1.exp === 'true' && s1.focus === '15' && s1.off && f2 === '30' && s2.hidden && s2.exp === 'false' && s2.focus === 'dvBarSleep', { s1, f2, s2 });
            await p.click('#dvBarSleep');
            await p.click('#dvBarSleepMenu [data-dv-sleep="30"]');
            const s3 = await p.evaluate(() => ({ calls: window.__calls.slice(), deadline: sleepDeadline > 0, label: document.getElementById('dvBarSleepLabel').textContent, aria: document.getElementById('dvBarSleep').getAttribute('aria-label'), on: document.getElementById('dvBarSleep').classList.contains('is-on'), hidden: document.getElementById('dvBarSleepMenu').hidden, toast: window.__toasts.slice(-1)[0] }));
            check(`${tag} E 30 minutes sets the timer (setSleepTimer) and the button says 30m`,
                s3.calls.includes('setSleepTimer') && s3.deadline && s3.label === '30m' && s3.aria === 'Sleep timer: 30 min left' && s3.on && s3.hidden && s3.toast === 'Pausing in 30 minutes', s3);
            await p.click('#dvBarSleep');
            const offShown = await p.evaluate(() => !document.getElementById('dvBarSleepOff').hidden);
            await p.click('#dvBar .dv-bar-meta'); // outside the menu closes it
            const closedOutside = await p.evaluate(() => document.getElementById('dvBarSleepMenu').hidden);
            await p.click('#dvBarSleep');
            await p.click('#dvBarSleepOff');
            const s4 = await p.evaluate(() => ({ deadline: sleepDeadline, end: sleepEndOfTrack, label: document.getElementById('dvBarSleepLabel').textContent, on: document.getElementById('dvBarSleep').classList.contains('is-on') }));
            check(`${tag} E "Turn off" shows while set, an outside click closes the menu, Turn off clears it`, offShown && closedOutside && s4.deadline === 0 && !s4.end && s4.label === '' && !s4.on, { offShown, closedOutside, s4 });

            // Lyrics: from the crate, opens the turntable with lyrics on; again turns them off
            await p.evaluate(() => { lyricsEnabled = false; updateLyricsControls(); });
            await clearCalls(p);
            await p.click('#dvBarLyrics');
            const l1 = await p.evaluate(() => ({ calls: window.__calls.slice(), on: lyricsEnabled, player: document.getElementById('musicPlayerView').classList.contains('active'), deck: document.getElementById('musicPlayerView').classList.contains('dv-deck'), pressed: document.getElementById('dvBarLyrics').getAttribute('aria-pressed') }));
            await p.click('#dvBarLyrics');
            const l2 = await p.evaluate(() => ({ on: lyricsEnabled, player: document.getElementById('musicPlayerView').classList.contains('active'), pressed: document.getElementById('dvBarLyrics').getAttribute('aria-pressed'), sleeveOff: document.getElementById('lyricsToggleBtn').classList.contains('off') }));
            // (Desktop step 5: the lyrics live on the deck, .dv-deck)
            check(`${tag} E lyrics: opens the player view's deck with lyrics on (openPlayerView + toggleLyrics), again turns them off`,
                l1.calls.includes('openPlayerView') && l1.calls.includes('toggleLyrics') && l1.on && l1.player && l1.deck && l1.pressed === 'true'
                && !l2.on && l2.player && l2.pressed === 'false' && l2.sleeveOff, { l1, l2 });

            // Turntable: toggles the player view
            await p.evaluate(() => showPlaylistPicker());
            await p.waitForTimeout(100);
            const d0 = await attr(p, 'dvBarDeck', 'aria-pressed');
            await clearCalls(p);
            await p.click('#dvBarDeck');
            await p.waitForTimeout(100);
            // (Desktop step 5: the turntable is the player view's deck mode, .dv-deck)
            const d1 = await p.evaluate(() => ({ calls: window.__calls.slice(), player: document.getElementById('musicPlayerView').classList.contains('active'), deck: document.getElementById('musicPlayerView').classList.contains('dv-deck'), pressed: document.getElementById('dvBarDeck').getAttribute('aria-pressed') }));
            await p.click('#dvBarDeck');
            await p.waitForTimeout(100);
            const d2 = await p.evaluate(() => ({ crate: !document.getElementById('vinylCrateView').classList.contains('hidden'), pressed: document.getElementById('dvBarDeck').getAttribute('aria-pressed') }));
            check(`${tag} E turntable opens the player view's deck (openPlayerView, .dv-deck) and goes back`, d0 === 'false' && d1.calls.includes('openPlayerView') && d1.player && d1.deck && d1.pressed === 'true' && d2.crate && d2.pressed === 'false', { d0, d1, d2 });
            check(`${tag} E errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- F. Player view: the bar stays; the last song row is above it; ♥
        {
            const { ctx, p } = await open({ vp });
            // In Favorites the ♥ is on and locked (remove from the song menu)
            const fav = await p.evaluate(() => ({ active: String(activePlaylistId), pressed: document.getElementById('dvBarLike').getAttribute('aria-pressed'), dis: document.getElementById('dvBarLike').getAttribute('aria-disabled') }));
            await p.evaluate(() => { window.__favCalls = []; window.toggleFavoriteSong = async function (s) { window.__favCalls.push(s && s.title); const k = songPlayKey(s); if (favoriteKeys.has(k)) favoriteKeys.delete(k); else favoriteKeys.add(k); updateFavoriteHearts(); }; });
            if (fav.active === 'favorites') {
                await p.click('#dvBarLike', { force: true }); // aria-disabled on purpose: the click must only hint
                const lk = await p.evaluate(() => ({ n: window.__favCalls.length, toast: window.__toasts.slice(-1)[0] }));
                check(`${tag} F in Favorites the ♥ is on and locked (no toggle, a hint)`, fav.pressed === 'true' && fav.dis === 'true' && lk.n === 0 && /Favorites/.test(lk.toast || ''), { fav, lk });
            }
            // Another playlist with songs: make it the playing one. Desktop step 3:
            // opening a playlist only shows it now (it used to switch to it), so
            // a song tap on it starts it, as the user would.
            const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 3));
            await p.evaluate((i) => selectPlaylistFromCrate(i), id);
            await p.waitForTimeout(1200);
            await p.click('#songList .song-list-item[data-index="0"]');
            await p.waitForTimeout(1500);
            await p.evaluate(() => openPlayerView());
            await p.waitForTimeout(700);
            const s = await barState(p);
            const cur = await p.evaluate(() => songsData[currentSongIndex] && songsData[currentSongIndex].title);
            const adopted = await p.evaluate(() => String(activePlaylistId));
            check(`${tag} F the bar shows on the player view with the new list's song`, adopted === id && s.player && s.barCls && s.display !== 'none' && s.title === cur && s.msBottom <= s.top, { s, cur, adopted, id });
            const rows = await p.evaluate(() => {
                const sc = songListScroller();
                if (sc) sc.scrollTop = sc.scrollHeight;
                const items = [...document.querySelectorAll('#songList .song-list-item')].filter(r => r.getClientRects().length);
                const last = items[items.length - 1];
                const r = last ? last.getBoundingClientRect() : null;
                return { n: items.length, bottom: r ? Math.round(r.bottom) : null, barTop: Math.round(document.getElementById('dvBar').getBoundingClientRect().top) };
            });
            check(`${tag} F song list scrolled to the end: the last row is fully above the bar`, rows.n > 0 && rows.bottom <= rows.barTop, rows);
            const before = await p.evaluate(() => ({ pressed: document.getElementById('dvBarLike').getAttribute('aria-pressed'), dis: document.getElementById('dvBarLike').getAttribute('aria-disabled') }));
            await p.click('#dvBarLike');
            await p.waitForTimeout(150);
            const after = await p.evaluate(() => ({ calls: window.__favCalls.slice(), pressed: document.getElementById('dvBarLike').getAttribute('aria-pressed'), np: document.getElementById('mNpLike').getAttribute('aria-pressed'), toast: window.__toasts.slice(-1)[0] }));
            const want = before.pressed === 'true' ? 'false' : 'true';
            check(`${tag} F ♥ toggles the playing song's favorite (toggleFavoriteSong); the phone ♥ agrees`,
                before.dis === null && after.calls.length === 1 && after.calls[0] === cur && after.pressed === want && after.np === want
                && after.toast === (want === 'true' ? 'Added to Favorites' : 'Removed from Favorites'), { before, after, cur });

            // An empty playlist on screen doesn't touch the bar now (desktop
            // step 3: opening only shows it; this used to switch to it and
            // check the bar went). The bar still goes when the playing list
            // empties with nothing playing: its last song removed.
            const empty = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount === 0));
            if (empty) {
                await p.evaluate((i) => selectPlaylistFromCrate(i), empty);
                await p.waitForTimeout(1200);
                const e = await barState(p);
                const shown = await p.evaluate(() => String(listId()));
                check(`${tag} F opening an empty playlist shows it and keeps the bar`, shown === empty && e.barCls && e.display !== 'none' && e.title === cur, { e, shown, cur });
            }
            await p.evaluate(() => { songsData.length = 0; showPlaylistPicker(); rebuildSongList(); });
            await p.waitForTimeout(300);
            const gone = await barState(p);
            check(`${tag} F the playing list emptied (nothing playing) hides the bar`, !gone.barCls && gone.display === 'none' && gone.msBottom === gone.vh, gone);
            check(`${tag} F errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- G. Nothing loaded: demo (an empty Favorites) and empty (no playlists)
    for (const acct of ['demo', 'empty']) {
        const { ctx, p } = await open({ acct });
        const s = await barState(p);
        check(`G ${acct}: html.dv2 is set but the bar is hidden and the page reaches the bottom`, s.dv2 && !s.barCls && s.display === 'none' && s.msBottom === s.vh, s);
        check(`G ${acct}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- H. Resizing across 600px keeps the scope in step
    {
        const { ctx, p } = await open({});
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
        const narrow = await barState(p);
        await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300);
        const wide = await barState(p);
        check('H a window narrowed to 390px drops html.dv2 and the bar; widened again, both come back',
            !narrow.dv2 && !narrow.barCls && narrow.display === 'none' && wide.dv2 && wide.barCls && wide.display !== 'none', { narrow, wide });
        check('H errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- I. Phones and the app shell never get the scope or the bar
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const { ctx, p } = await open({ vp, phone: true });
        const s = await barState(p);
        const dock = await p.evaluate(() => getComputedStyle(document.getElementById('mDock')).display);
        check(`I phone ${vp.width}x${vp.height}: no html.dv2, no bar, the phone dock as before`, !s.dv2 && !s.barCls && s.display === 'none' && dock !== 'none', { s, dock });
        check(`I phone ${vp.width}x${vp.height}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ query: '?app=1', raw: true });
        const s = await barState(p);
        check('I app shell (?app=1) at 1440: no html.dv2, no bar', !s.dv2 && !s.barCls && s.display === 'none', s);
        check('I app shell errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
