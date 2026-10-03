// Desktop step 6: Now Playing (the player view's deck mode under html.dv2)
// at 1440x900, 1024x768 and 800x600 (beside the icon rail). Checks the
// ways in (the bar's cover/title, its turntable button, its lyrics button
// with lyrics on) and out (the turntable button again, Esc, the page's back
// button), each going back to where it was opened from (Home or the
// playlist page) with focus back on the control that opened it; the layout
// (the turntable centred, bigger than step 5's deck, nothing overflowing;
// the lyrics beside it on wide pages and below it on narrower ones, gone
// while lyrics are off); the song, artist and "Playing from" (also after
// adopting a playlist that was only shown); the turntable extras (pitch as
// a keyboard slider, crackle in step with the sidebar and Settings, ⋯ with
// Make a GIF and Show in playlist); the deck's old transport and volume
// knob hidden (the knob still following the bar's volume); the bar's
// progress ticking with the page open; axe; reduced motion stopping the
// platter; and that phones (390x844, 844x390) and the app shell (?app=1)
// don't get any of it.
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
            reducedMotion: opts.reduce ? 'reduce' : 'no-preference',
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
        await p.evaluate(() => {
            // A stub player; record what the engine asks of it
            window.__yt = [];
            const stub = { _s: 5, _t: 0, loadVideoById() { window.__yt.push('load'); this._s = 1; }, cueVideoById() { window.__yt.push('cue'); this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__cued = []; window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); (cue ? window.__cued : window.__played).push(s && s.title); };
            // No outside services: radio and lyrics lookups are no-ops here
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            window.__toasts = [];
            const toast = window.mToast;
            window.mToast = function (m) { window.__toasts.push(m); return toast && toast.apply(this, arguments); };
        });
        return { ctx, p };
    }
    // ---- end open

    async function axeScan(p) {
        await p.addScriptTag({ path: AXE });
        return p.evaluate(async () => {
            const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
            return res.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        });
    }
    // Now Playing as it stands
    const npState = (p) => p.evaluate(() => {
        const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const view = document.getElementById('musicPlayerView');
        const main = view.querySelector('.music-main');
        const area = main.querySelector('.turntable-area');
        const deck = main.querySelector('.record-player');
        const sleeve = document.getElementById('vinylSleeve');
        const info = document.getElementById('dvNpInfo');
        const acs = getComputedStyle(area);
        const song = (currentRadioSong || songsData[currentSongIndex]) || {};
        const a = document.activeElement;
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            open: view.classList.contains('active') && view.classList.contains('dv-deck'),
            mainShown: shown(main), pageShown: shown(document.getElementById('musicSidebar')),
            crate: !document.getElementById('vinylCrateView').classList.contains('hidden'),
            head: shown(document.getElementById('dvNpHead')),
            heading: document.getElementById('dvNpHeading').textContent.trim(), headingTag: document.getElementById('dvNpHeading').tagName,
            back: shown(document.getElementById('dvNpBack')), backLabel: document.getElementById('dvNpBack').getAttribute('aria-label'),
            role: main.getAttribute('role'), labelledby: main.getAttribute('aria-labelledby'),
            focus: a ? (a.id || a.getAttribute('data-dv-np') || a.className || a.tagName) : null,
            main: rect(main), area: rect(area), deck: rect(deck), info: rect(info),
            sleeve: shown(sleeve) ? rect(sleeve) : null,
            areaPad: { l: parseFloat(acs.paddingLeft), r: parseFloat(acs.paddingRight) }, areaClientW: area.clientWidth, areaClientL: area.clientLeft, colGap: parseFloat(acs.columnGap) || 0,
            overflowX: document.documentElement.scrollWidth > innerWidth || area.scrollWidth > area.clientWidth + 1 || main.scrollWidth > main.clientWidth + 1,
            wide: main.classList.contains('dv-np-wide'), nolyrics: main.classList.contains('dv-np-nolyrics'),
            zoom: parseFloat(getComputedStyle(main).getPropertyValue('--dv-np-zoom')) || 0,
            title: info.querySelector('.song-title').textContent.trim(),
            artist: info.querySelector('.song-artist').textContent.trim(),
            album: info.querySelector('.song-album').textContent.trim(),
            from: document.getElementById('dvNpFromName').textContent.trim(),
            fromLine: shown(document.querySelector('#dvNpInfo .dv-np-from')) ? document.querySelector('#dvNpInfo .dv-np-from').textContent.replace(/\s+/g, ' ').trim() : null,
            infoShown: shown(info),
            want: { title: song.title || '', artist: song.artist || '', album: song.album || '', from: (playlistsMeta[String(activePlaylistId)] || {}).name || '' },
            old: { controls: shown(main.querySelector('.record-player-controls')), knob: shown(document.getElementById('volumeKnobWrapper')), panel: shown(main.querySelector('.rp-song-info')), playBtn: shown(document.getElementById('playBtn')) },
            knobInDom: !!document.getElementById('volumeKnob'),
            extras: shown(document.getElementById('dvNpExtras')), pitch: shown(document.getElementById('pitchTrack')),
            crackle: shown(document.getElementById('dvNpCrackle')), more: shown(document.getElementById('dvNpMore')),
            backdrop: shown(document.getElementById('musicBackdrop')), backdropFilter: getComputedStyle(document.getElementById('backdropImg')).filter,
            deckPressed: document.getElementById('dvBarDeck').getAttribute('aria-pressed'),
            lyricsPressed: document.getElementById('dvBarLyrics').getAttribute('aria-pressed'),
            lyricsOn: lyricsEnabled,
            side: [...document.querySelectorAll('#dvSideList .dv-side-pl')].filter(x => x.classList.contains('is-open') || x.getAttribute('aria-current')).map(x => x.dataset.playlist),
            homeCurrent: document.getElementById('dvSideHome').getAttribute('aria-current'),
            viewedId, onScreen: String(listId()), active: String(activePlaylistId),
        };
    });
    const otherWithSongs = (p, min = 3) => p.evaluate((n) => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= n), min);
    const openList = async (p, id) => { await p.evaluate((i) => selectPlaylistFromCrate(i), id); await p.waitForTimeout(1500); };
    const setLyrics = (p, on) => p.evaluate((v) => { if (lyricsEnabled !== v) toggleLyrics(); }, on);
    const fakeLyrics = (p) => p.evaluate(() => {
        renderLyrics({ type: 'synced', lines: Array.from({ length: 24 }, (_, i) => ({ time: i * 4, text: 'Lyric line ' + (i + 1) })) });
    });
    // Step 5's deck at these sizes: 1000px art at zoom 0.66 (601-1440px)
    const BEFORE_W = 660;

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. From Home with the turntable button: the page, its layout, the song
        {
            const { ctx, p } = await open({ vp });
            await setLyrics(p, true);
            await p.evaluate(() => { if (document.getElementById('musicPlayerView').classList.contains('active')) showPlaylistPicker(); });
            await p.waitForTimeout(300);
            await p.click('#dvBarDeck'); await p.waitForTimeout(700);
            await fakeLyrics(p);
            const s = await npState(p);
            check(`${tag} A the turntable button opens Now Playing: its page (no playlist page), "Now Playing" as the h1, a back button, a labelled region; focus on the heading`,
                s.dv2 && s.open && s.mainShown && !s.pageShown && s.head && s.heading === 'Now Playing' && s.headingTag === 'H1' && s.back && s.backLabel === 'Back'
                && s.role === 'region' && s.labelledby === 'dvNpHeading' && s.focus === 'dvNpHeading' && s.deckPressed === 'true',
                { open: s.open, main: s.mainShown, page: s.pageShown, head: s.head, heading: s.heading, role: s.role, focus: s.focus, pressed: s.deckPressed });
            check(`${tag} A the sidebar shows no current row (and Home isn't current) while it's open`, s.side.length === 0 && !s.homeCurrent, { side: s.side, home: s.homeCurrent });
            // Layout: centred in its column, bigger than step 5's deck (fits beside the rail at 800), no overflow
            const colL = s.area.l + s.areaClientL + s.areaPad.l;
            const colR = s.wide && s.sleeve ? s.sleeve.l - s.colGap : s.area.l + s.areaClientL + s.areaClientW - s.areaPad.r;
            const centre = Math.abs((s.deck.l + s.deck.r) / 2 - (colL + colR) / 2);
            const big = vp.width >= 1024 ? s.deck.w > BEFORE_W : s.deck.w >= 380;
            check(`${tag} A the turntable is centred, ${vp.width >= 1024 ? 'bigger than step 5\'s deck' : 'a usable size beside the rail'}, fully on screen, and nothing overflows`,
                centre <= 2 && big && s.deck.l >= s.main.l && s.deck.r <= s.main.r && s.deck.t >= s.main.t && s.deck.b <= s.main.b && !s.overflowX && Math.abs(s.deck.w / s.deck.h - 10 / 7) < 0.02,
                { centre, w: Math.round(s.deck.w), h: Math.round(s.deck.h), zoom: s.zoom, deck: s.deck, main: s.main, overflowX: s.overflowX });
            check(`${tag} A the song under it: title, artist (album when there is one) and "Playing from <the playing playlist>"`,
                s.infoShown && s.info.t >= s.deck.b && s.info.b <= s.main.b && s.title === s.want.title && s.title && s.artist === s.want.artist && s.album === s.want.album
                && s.from === s.want.from && s.fromLine === 'Playing from ' + s.want.from, { title: s.title, artist: s.artist, album: s.album, from: s.fromLine, want: s.want, info: s.info, deck: s.deck });
            if (vp.width >= 1440) {
                check(`${tag} A wide: the lyrics sit beside the turntable, from its top to the song's bottom`,
                    s.wide && s.sleeve && s.sleeve.l >= s.deck.r && s.sleeve.r <= s.main.r && Math.abs(s.sleeve.t - s.deck.t) <= 2 && Math.abs(s.sleeve.b - s.info.b) <= 2,
                    { wide: s.wide, sleeve: s.sleeve, deck: s.deck, info: s.info });
            } else {
                check(`${tag} A narrower: the lyrics go below the song, their top showing without scrolling`,
                    !s.wide && s.sleeve && s.sleeve.t >= s.info.b && s.sleeve.t < s.main.b - 8 && s.sleeve.l >= s.main.l && s.sleeve.r <= s.main.r,
                    { wide: s.wide, sleeve: s.sleeve, info: s.info, main: s.main });
            }
            const ly = await p.evaluate(() => {
                ytPlayer.getCurrentTime = () => 21; updateSleeveProgress();
                const lines = [...document.querySelectorAll('#sleeveLyrics .lyrics-line')];
                const act = document.querySelector('#sleeveLyrics .lyrics-line.active');
                return { n: lines.length, shown: lines.length > 0 && lines[0].getClientRects().length > 0, active: act ? act.textContent : null };
            });
            check(`${tag} A the synced lyrics show in the sleeve and follow the song`, ly.n === 24 && ly.shown && ly.active === 'Lyric line 6', ly);
            check(`${tag} A the deck's song panel, transport and volume knob are hidden (the bar has them); pitch, crackle and ⋯ are on the deck; the cover's backdrop blurs`,
                !s.old.controls && !s.old.knob && !s.old.panel && !s.old.playBtn && s.knobInDom && s.extras && s.pitch && s.crackle && s.more && s.backdrop && /blur/.test(s.backdropFilter), { old: s.old, extras: s.extras, pitch: s.pitch, backdrop: s.backdrop, filter: s.backdropFilter });
            // The knob's sync still runs: the bar's volume moves it (and its label)
            const v = await p.evaluate(() => {
                const r = document.getElementById('dvBarVolume');
                r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true }));
                const out = { cur: currentVolume, label: document.getElementById('volumeLabel').textContent, knob: document.getElementById('volumeKnob').style.transform };
                r.value = '100'; r.dispatchEvent(new Event('input', { bubbles: true }));
                out.knob2 = document.getElementById('volumeKnob').style.transform;
                return out;
            });
            check(`${tag} A the hidden knob still follows the bar's volume`, v.cur === 40 && v.label === '40' && v.knob && v.knob2 && v.knob !== v.knob2, v);
            // The bar's progress keeps ticking with the page open
            await p.evaluate(() => { ytPlayer.getCurrentTime = () => 42; ytPlayer.getDuration = () => 200; startSleeveProgress(); });
            await p.waitForTimeout(400);
            const pr = await p.evaluate(() => ({ bar: document.getElementById('dvBarElapsed').textContent, total: document.getElementById('dvBarTotal').textContent, now: document.getElementById('dvBarSeek').getAttribute('aria-valuenow') }));
            await p.evaluate(() => { ytPlayer.getCurrentTime = () => 61; });
            await p.waitForTimeout(400);
            const pr2 = await p.evaluate(() => document.getElementById('dvBarElapsed').textContent);
            await p.evaluate(() => stopSleeveProgress());
            check(`${tag} A the bar's progress keeps ticking with Now Playing open`, pr.bar === '0:42' && pr.total === '3:20' && pr.now === '42' && pr2 === '1:01', { pr, pr2 });
            // The turntable button again: back Home, focus stays on it
            await p.click('#dvBarDeck'); await p.waitForTimeout(500);
            const c = await npState(p);
            check(`${tag} A the turntable button again closes it, back to Home (focus stays on the button)`,
                !c.open && c.crate && c.deckPressed === 'false' && c.focus === 'dvBarDeck' && c.role === null, { open: c.open, crate: c.crate, pressed: c.deckPressed, focus: c.focus, role: c.role });
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. The other ways in and out, each back to where it came from
        {
            const { ctx, p } = await open({ vp });
            await setLyrics(p, true);
            const id = await otherWithSongs(p);
            await openList(p, id);
            // The bar's cover/title, from a playlist that's only shown; Esc goes back to it
            await p.click('#dvBarOpen'); await p.waitForTimeout(600);
            const s1 = await npState(p);
            check(`${tag} B the bar's cover/title opens it (from a shown playlist: the playing list behind it, "Playing from" the playing one); focus on the heading`,
                s1.open && s1.mainShown && s1.focus === 'dvNpHeading' && s1.viewedId === null && s1.from === s1.want.from && s1.from !== '' && s1.side.length === 0,
                { open: s1.open, focus: s1.focus, viewedId: s1.viewedId, from: s1.from, side: s1.side });
            const nm = await p.evaluate(() => ({ text: document.getElementById('dvBarOpen').textContent.replace(/\s+/g, ' ').trim(), title: document.getElementById('dvBarOpen').title, want: (songsData[currentSongIndex] || {}).title || '' }));
            check(`${tag} B the cover/title button is named "Open Now Playing: <title> <artist>"`, nm.want && nm.text.startsWith('Open Now Playing: ' + nm.want) && nm.title === 'Open Now Playing', nm);
            // The cover/title again: stays open, focus to the heading
            await p.focus('#dvBarOpen');
            await p.click('#dvBarOpen'); await p.waitForTimeout(200);
            const s1b = await npState(p);
            check(`${tag} B the cover/title while it's open keeps it open and moves focus to the heading`, s1b.open && s1b.focus === 'dvNpHeading', { open: s1b.open, focus: s1b.focus });
            // The sleep menu's Esc closes only the menu
            await p.click('#dvBarSleep'); await p.waitForTimeout(100);
            await p.keyboard.press('Escape'); await p.waitForTimeout(200);
            const s1c = await npState(p);
            const sleepHidden = await p.evaluate(() => document.getElementById('dvBarSleepMenu').hidden);
            check(`${tag} B Esc in the sleep menu closes just the menu`, s1c.open && sleepHidden && s1c.focus === 'dvBarSleep', { open: s1c.open, sleepHidden, focus: s1c.focus });
            await p.focus('#dvNpHeading');
            await p.keyboard.press('Escape'); await p.waitForTimeout(1500);
            const s2 = await npState(p);
            check(`${tag} B Esc closes it, back to the playlist page it was opened from, focus back on the cover/title`,
                !s2.open && s2.pageShown && !s2.mainShown && s2.onScreen === id && s2.side[0] === id && s2.focus === 'dvBarOpen' && s2.role === null,
                { open: s2.open, page: s2.pageShown, on: s2.onScreen, side: s2.side, focus: s2.focus });
            // Keyboard on the turntable button from Home; the back button returns Home, focus on the button
            await p.click('#dvSideHome'); await p.waitForTimeout(500);
            await p.focus('#dvBarDeck');
            await p.keyboard.press('Enter'); await p.waitForTimeout(600);
            const s3 = await npState(p);
            await p.click('#dvNpBack'); await p.waitForTimeout(600);
            const s4 = await npState(p);
            check(`${tag} B Enter on the turntable button opens it; the back button returns Home with focus on the turntable button`,
                s3.open && s3.focus === 'dvNpHeading' && !s4.open && s4.crate && s4.focus === 'dvBarDeck', { s3: { open: s3.open, focus: s3.focus }, s4: { open: s4.open, crate: s4.crate, focus: s4.focus } });
            // Lyrics: opens it with lyrics on; again turns them off (the page stays; the turntable takes the room)
            await setLyrics(p, false);
            await p.click('#dvBarLyrics'); await p.waitForTimeout(600);
            const l1 = await npState(p);
            await p.click('#dvBarLyrics'); await p.waitForTimeout(600);
            const l2 = await npState(p);
            check(`${tag} B lyrics opens it with lyrics on (pressed); again turns them off: the page stays, the lyrics go and the turntable grows`,
                l1.open && l1.lyricsOn && l1.lyricsPressed === 'true' && !!l1.sleeve && l1.focus === 'dvNpHeading'
                && l2.open && !l2.lyricsOn && l2.lyricsPressed === 'false' && !l2.sleeve && l2.nolyrics && l2.deck.w > l1.deck.w && !l2.overflowX && l2.deck.b <= l2.main.b,
                { l1: { open: l1.open, on: l1.lyricsOn, pressed: l1.lyricsPressed, sleeve: !!l1.sleeve, w: Math.round(l1.deck.w) }, l2: { open: l2.open, on: l2.lyricsOn, sleeve: !!l2.sleeve, w: Math.round(l2.deck.w), b: l2.deck.b, mb: l2.main.b } });
            // The sleeve's own lyrics switch turns them off too: focus moves to the bar's lyrics button
            await p.click('#dvBarLyrics'); await p.waitForTimeout(400);
            await p.click('#lyricsToggleBtn'); await p.waitForTimeout(300);
            const l3 = await npState(p);
            check(`${tag} B the sleeve's own switch turns lyrics off; focus lands on the bar's lyrics button`, l3.open && !l3.lyricsOn && !l3.sleeve && l3.focus === 'dvBarLyrics', { open: l3.open, on: l3.lyricsOn, focus: l3.focus });
            check(`${tag} B errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- C. "Playing from" after adopting a playlist that was only shown
        {
            const { ctx, p } = await open({ vp });
            const id = await otherWithSongs(p);
            const name = await p.evaluate((i) => playlistsMeta[i].name, id);
            await openList(p, id);
            await p.click('#songList .song-list-item[data-index="1"]'); await p.waitForTimeout(800);
            const want = await p.evaluate(() => ({ active: String(activePlaylistId), title: songsData[1] && songsData[1].title }));
            await p.click('#dvBarDeck'); await p.waitForTimeout(600);
            const s = await npState(p);
            check(`${tag} C after playing a song from a shown playlist, Now Playing shows that song and "Playing from" that playlist`,
                want.active === id && s.open && s.from === name && s.title === want.title, { want, name, from: s.from, title: s.title });
            await p.keyboard.press('Escape'); await p.waitForTimeout(800);
            const s2 = await npState(p);
            check(`${tag} C closing goes back to that playlist's page (now the playing one)`, !s2.open && s2.pageShown && s2.onScreen === id && s2.viewedId === null, { open: s2.open, on: s2.onScreen, viewed: s2.viewedId });
            check(`${tag} C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. The turntable extras: pitch, crackle, ⋯
        {
            const { ctx, p } = await open({ vp });
            await setLyrics(p, true);
            // A started row (Show in playlist needs the song to be the playing row)
            await p.evaluate(() => { if (document.getElementById('musicPlayerView').classList.contains('active')) showPlaylistPicker(); });
            await p.evaluate(() => openPlayerView()); await p.waitForTimeout(800);
            await p.click('#songList .song-list-item[data-index="1"]'); await p.waitForTimeout(600);
            await p.click('#dvBarDeck'); await p.waitForTimeout(600);
            // Pitch: a labelled slider; keys move it
            const p0 = await p.evaluate(() => { const t = document.getElementById('pitchTrack'); return { role: t.getAttribute('role'), label: t.getAttribute('aria-label'), tab: t.tabIndex, min: t.getAttribute('aria-valuemin'), max: t.getAttribute('aria-valuemax'), now: t.getAttribute('aria-valuenow') }; });
            await p.focus('#pitchTrack');
            for (let k = 0; k < 3; k++) await p.keyboard.press('ArrowUp');
            const p1 = await p.evaluate(() => ({ pitch: currentPitch, now: document.getElementById('pitchTrack').getAttribute('aria-valuenow'), text: document.getElementById('pitchTrack').getAttribute('aria-valuetext'), shown: document.getElementById('pitchValue').textContent }));
            await p.keyboard.press('End');
            const p2 = await p.evaluate(() => currentPitch);
            await p.keyboard.press('PageDown');
            const p3 = await p.evaluate(() => currentPitch);
            await p.keyboard.press('0');
            const p4 = await p.evaluate(() => ({ pitch: currentPitch, shown: document.getElementById('pitchValue').textContent }));
            check(`${tag} D pitch is a labelled slider (-25..25): ↑ steps 1%, End the top, PageDown -5%, 0 resets; the deck's readout follows`,
                p0.role === 'slider' && p0.label === 'Pitch' && p0.tab === 0 && p0.min === '-25' && p0.max === '25' && p0.now === '0'
                && p1.pitch === 3 && p1.now === '3' && p1.text === '+3%' && p1.shown === '+3%' && p2 === 25 && p3 === 20 && p4.pitch === 0 && p4.shown === '0%', { p0, p1, p2, p3, p4 });
            // The deck's drag still works (and a double-click resets)
            const tr = await p.evaluate(() => { const r = document.getElementById('pitchTrack').getBoundingClientRect(); return { x: r.left + r.width / 2, t: r.top, b: r.bottom }; });
            await p.mouse.click(tr.x, tr.b - 1);
            const pd = await p.evaluate(() => currentPitch);
            await p.mouse.dblclick(tr.x, (tr.t + tr.b) / 2);
            const pz = await p.evaluate(() => currentPitch);
            check(`${tag} D pitch still drags on the deck (an end of the track) and double-click resets`, Math.abs(pd) >= 15 && pz === 0, { pd, pz, tr });
            // Crackle: in step with the sidebar's and Settings
            const c0 = await p.evaluate(() => crackleEnabled);
            await p.click('#dvNpCrackle');
            const c1 = await p.evaluate(() => ({ on: crackleEnabled, np: document.getElementById('dvNpCrackle').getAttribute('aria-pressed'), side: document.getElementById('dvSideCrackle').getAttribute('aria-pressed'), rail: document.getElementById('crackleBtn').dataset.crackle }));
            await p.evaluate(() => { showSettingsModal(); });
            const set1 = await p.evaluate(() => document.getElementById('settingsCrackleToggle').checked);
            await p.evaluate(() => { const t = document.getElementById('settingsCrackleToggle'); t.click(); hideSettingsModal(); });
            await p.waitForTimeout(200);
            const c2 = await p.evaluate(() => ({ on: crackleEnabled, np: document.getElementById('dvNpCrackle').getAttribute('aria-pressed') }));
            await p.click('#dvSideCrackle');
            const c3 = await p.evaluate(() => ({ on: crackleEnabled, np: document.getElementById('dvNpCrackle').getAttribute('aria-pressed') }));
            const tf = (x) => (x ? 'true' : 'false');
            check(`${tag} D crackle on the deck flips the switch; the sidebar's, the rail's and Settings agree, and it follows Settings and the sidebar`,
                c1.on === !c0 && c1.np === tf(!c0) && c1.side === tf(!c0) && c1.rail === (!c0 ? 'on' : 'off') && set1 === !c0
                && c2.on === c0 && c2.np === tf(c0) && c3.on === !c0 && c3.np === tf(!c0), { c0, c1, set1, c2, c3 });
            if (c3.on !== c0) await p.click('#dvSideCrackle');
            // ⋯: a keyboard menu over the page
            await p.click('#dvNpMore'); await p.waitForTimeout(150);
            const m1 = await p.evaluate(() => {
                const m = document.getElementById('dvNpMenu');
                const r = m.getBoundingClientRect();
                const bar = document.getElementById('dvBar').getBoundingClientRect();
                return { shown: !m.hidden && r.width > 0, exp: document.getElementById('dvNpMore').getAttribute('aria-expanded'), items: [...m.querySelectorAll('[role="menuitem"]')].map(x => x.textContent.trim()), focus: document.activeElement.textContent.trim(),
                    inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= bar.top };
            });
            await p.keyboard.press('ArrowDown');
            const f2 = await p.evaluate(() => document.activeElement.textContent.trim());
            await p.keyboard.press('Escape'); await p.waitForTimeout(150);
            const m2 = await p.evaluate(() => ({ hidden: document.getElementById('dvNpMenu').hidden, exp: document.getElementById('dvNpMore').getAttribute('aria-expanded'), focus: document.activeElement.id, open: document.getElementById('musicPlayerView').classList.contains('dv-deck') }));
            check(`${tag} D ⋯ opens Make a GIF / Show in playlist on screen above the bar, focus on the first; ↓ moves; Esc closes back onto ⋯ (the page stays)`,
                m1.shown && m1.exp === 'true' && m1.items.join('|') === 'Make a GIF|Show in playlist' && m1.focus === 'Make a GIF' && m1.inView
                && f2 === 'Show in playlist' && m2.hidden && m2.exp === 'false' && m2.focus === 'dvNpMore' && m2.open, { m1, f2, m2 });
            // Make a GIF opens its window
            await p.click('#dvNpMore'); await p.waitForTimeout(100);
            await p.click('#dvNpMenu [data-dv-np="gif"]'); await p.waitForTimeout(300);
            const g = await p.evaluate(() => ({ modal: document.getElementById('vinylGifModal').classList.contains('active'), menu: document.getElementById('dvNpMenu').hidden }));
            // Esc under the window doesn't close Now Playing
            await p.evaluate(() => document.body.focus());
            await p.keyboard.press('Escape'); await p.waitForTimeout(200);
            const gOpen = await p.evaluate(() => document.getElementById('musicPlayerView').classList.contains('dv-deck'));
            await p.evaluate(() => closeVinylGifModal()); await p.waitForTimeout(300);
            check(`${tag} D ⋯ → Make a GIF opens the GIF window (and Esc there leaves Now Playing open)`, g.modal && g.menu && gOpen, { g, gOpen });
            // Show in playlist: the playing list's page, the song's row lit and focused
            const idx = await p.evaluate(() => currentSongIndex);
            await p.click('#dvNpMore'); await p.waitForTimeout(100);
            await p.click('#dvNpMenu [data-dv-np="show"]'); await p.waitForTimeout(400);
            const sh = await p.evaluate((i) => {
                const row = document.querySelector(`#songList .song-list-item[data-index="${i}"]:not(.discover-item)`);
                const r = row ? row.getBoundingClientRect() : null;
                return { open: document.getElementById('musicPlayerView').classList.contains('dv-deck'), page: document.getElementById('musicSidebar').getClientRects().length > 0,
                    onScreen: String(listId()), active: String(activePlaylistId), flash: !!row && row.classList.contains('m-row-flash'), focus: document.activeElement === row,
                    inView: !!r && r.top >= 0 && r.bottom <= innerHeight };
            }, idx);
            check(`${tag} D ⋯ → Show in playlist opens the playing playlist's page with the song's row lit, in view and focused`,
                !sh.open && sh.page && sh.onScreen === sh.active && sh.flash && sh.focus && sh.inView, sh);
            check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- E. axe: Now Playing with lyrics, with ⋯ open, and with lyrics off
        {
            const { ctx, p } = await open({ vp });
            await setLyrics(p, true);
            await p.click('#dvBarDeck'); await p.waitForTimeout(600);
            await fakeLyrics(p);
            await p.evaluate(() => { ytPlayer.getCurrentTime = () => 9; updateSleeveProgress(); });
            const v1 = await axeScan(p);
            await p.click('#dvNpMore'); await p.waitForTimeout(150);
            const v2 = await axeScan(p);
            await p.keyboard.press('Escape');
            await p.click('#dvBarLyrics'); await p.waitForTimeout(400);
            const v3 = await axeScan(p);
            const heads = await p.evaluate(() => [...document.querySelectorAll('#musicPlayerView h1')].filter(h => h.getClientRects().length).map(h => h.textContent.trim()));
            check(`${tag} E axe: no violations with lyrics, with ⋯ open, and with lyrics off`, v1.length === 0 && v2.length === 0 && v3.length === 0, { v1, v2, v3 });
            check(`${tag} E one visible h1 on the player view: Now Playing`, heads.length === 1 && heads[0] === 'Now Playing', heads);
            check(`${tag} E errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- F. Reduced motion stops the platter; otherwise it spins while playing
    for (const reduce of [false, true]) {
        const { ctx, p } = await open({ reduce });
        await p.click('#dvBarDeck'); await p.waitForTimeout(500);
        const s = await p.evaluate(() => {
            const v = document.getElementById('vinyl');
            v.classList.add('playing');
            const cs = getComputedStyle(v);
            const out = { name: cs.animationName, state: cs.animationPlayState };
            v.classList.remove('playing');
            return out;
        });
        if (reduce) check('F reduced motion: the platter stands still on Now Playing', s.name === 'none', s);
        else check('F the platter spins while playing on Now Playing', s.name !== 'none' && s.state === 'running', s);
        check(`F ${reduce ? 'reduced' : 'normal'} errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- G. Phones and the app don't get any of it
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        const { ctx, p } = await open({ vp, phone: true });
        const s = await p.evaluate(() => {
            const shown = (el) => !!el && el.getClientRects().length > 0;
            return {
                dv2: document.documentElement.classList.contains('dv2'),
                head: shown(document.getElementById('dvNpHead')), info: shown(document.getElementById('dvNpInfo')),
                extras: shown(document.getElementById('dvNpExtras')), menu: shown(document.getElementById('dvNpMenu')), open: shown(document.getElementById('dvBarOpen')),
                role: document.querySelector('.music-main').getAttribute('role'), pitchRole: document.getElementById('pitchTrack').getAttribute('role'),
                deck: document.getElementById('musicPlayerView').classList.contains('dv-deck'),
            };
        });
        check(`G phone ${vp.width}x${vp.height}: no Now Playing page pieces, no deck mode, the pitch track untouched`,
            !s.dv2 && !s.head && !s.info && !s.extras && !s.menu && !s.open && !s.role && !s.pitchRole && !s.deck, s);
        check(`G phone ${vp.width}x${vp.height}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ query: '?app=1' });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(800);
        const s = await p.evaluate(() => {
            const shown = (el) => !!el && el.getClientRects().length > 0;
            return {
                dv2: document.documentElement.classList.contains('dv2'),
                head: shown(document.getElementById('dvNpHead')), info: shown(document.getElementById('dvNpInfo')), extras: shown(document.getElementById('dvNpExtras')),
                controls: shown(document.querySelector('.record-player-controls')), knob: shown(document.getElementById('volumeKnobWrapper')), panel: shown(document.querySelector('.rp-song-info')),
                pitchRole: document.getElementById('pitchTrack').getAttribute('role'), zoom: getComputedStyle(document.querySelector('.turntable-area')).zoom,
            };
        });
        check('G app shell (?app=1) at 1440: its own deck (transport, knob and song panel showing; no Now Playing pieces; pitch untouched)',
            !s.dv2 && !s.head && !s.info && !s.extras && s.controls && s.knob && s.panel && !s.pitchRole, s);
        check('G app errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
