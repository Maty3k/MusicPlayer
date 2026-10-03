// Desktop step 8: the side panel (#dvPanel: Up next and Lyrics on the right
// of the page, above the bar) at 1440x900, 1024x768 and 800x600 (beside the
// icon rail). Checks the bar's queue button opening it on Up next (not the
// queue window) with focus on its tab; the queue there (now playing, the
// queued songs; Alt+arrows and the drag handle reorder them, × removes one,
// a click plays one, Clear empties it, focus staying in the panel); a song
// row's ⋯ → Add to queue showing up in it; the playlist page's ⋯ → Up next
// opening it; "Next from <the playing playlist>" (shuffle off: its next
// songs, which play when clicked; shuffle on: a note); the bar's lyrics
// button opening the Lyrics tab with lyrics on (the synced lines highlight,
// follow the song and seek; the offset controls work) on Home, a playlist
// page and the Search page; Now Playing taking the lyrics back (never two
// copies; the tab says where they are) and returning them; the tabs (click,
// arrows); pressing the open tab's button, Esc and × closing it, focus back
// on the bar's button; the layout (the page narrows, nothing under the bar,
// no sideways scroll); the open tab remembered over a reload; axe; and that
// phones (390x844, 844x390), narrowing to a phone, and the app shell
// (?app=1) keep the queue window and the sleeve's lyrics.
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
        await p.evaluate(() => {
            // A stub player; record seeks and what plays
            window.__seeks = [];
            const stub = { _s: 5, _t: 0, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo(t) { window.__seeks.push(t); }, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); if (!cue) window.__played.push(s && s.title); };
            // No outside services: radio and lyrics lookups are no-ops here
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            // Start from an empty queue (a saved one may be left on the account)
            playQueue = []; afterQueueChange();
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
    // The panel as it stands
    const panelState = (p) => p.evaluate(() => {
        const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const rect = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const panel = document.getElementById('dvPanel');
        const a = document.activeElement;
        const bar = document.getElementById('dvBar');
        const page = [document.getElementById('vinylCrateView'), document.getElementById('musicPlayerView'), document.getElementById('mSearchPage')].filter(shown);
        const qb = document.getElementById('queueBody');
        const box = document.getElementById('sleeveLyrics');
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            cls: document.documentElement.classList.contains('dv-panel'),
            shown: shown(panel), tag: panel.tagName, label: panel.getAttribute('aria-label'),
            tab: document.getElementById('dvPanelTabQueue').getAttribute('aria-selected') === 'true' ? 'queue'
                : (document.getElementById('dvPanelTabLyrics').getAttribute('aria-selected') === 'true' ? 'lyrics' : null),
            tablist: panel.querySelector('[role="tablist"]') ? panel.querySelector('[role="tablist"]').getAttribute('aria-label') : null,
            tabRoles: [...panel.querySelectorAll('[role="tab"]')].map(t => t.textContent.trim() + ':' + t.tabIndex),
            queueBodyShown: shown(document.getElementById('dvPanelQueue')), lyricsBodyShown: shown(document.getElementById('dvPanelLyrics')),
            live: panel.querySelectorAll('[aria-live]').length,
            modal: document.getElementById('queueModal').classList.contains('active'),
            queueIn: qb ? (qb.closest('#dvPanel') ? 'panel' : (qb.closest('#queueModal') ? 'modal' : 'other')) : null,
            lyricsIn: box.closest('#dvPanel') ? 'panel' : (box.closest('#vinylSleeve') ? 'sleeve' : 'other'),
            lyricsRole: box.getAttribute('role'), lyricsLabel: box.getAttribute('aria-label'), lyricsTab: box.getAttribute('tabindex'),
            note: shown(document.getElementById('dvPanelLyricsNote')) ? document.getElementById('dvPanelLyricsNote').textContent.trim() : null,
            qPressed: document.getElementById('dvBarQueue').getAttribute('aria-pressed'),
            lPressed: document.getElementById('dvBarLyrics').getAttribute('aria-pressed'),
            focus: a ? (a.id || (a.getAttribute('aria-label') || '') || a.className || a.tagName) : null,
            focusInPanel: !!a && panel.contains(a) && a !== document.body,
            now: (document.querySelector('#dvPanel .queue-now .queue-item-title') || {}).textContent || null,
            items: [...document.querySelectorAll('#dvPanel .queue-item[data-qindex] .queue-item-title')].map(x => x.textContent),
            queue: playQueue.map(s => s.title),
            empty: shown(document.querySelector('#dvPanel .queue-empty')),
            nf: [...document.querySelectorAll('#dvPanel .dv-nf-row .queue-item-title')].map(x => x.textContent),
            nfLabel: (document.querySelector('#dvPanel .dv-nf-label') || {}).textContent || null,
            nfNote: shown(document.querySelector('#dvPanel .dv-nf-note')),
            badge: document.getElementById('dvBarQueueCount').hidden ? '' : document.getElementById('dvBarQueueCount').textContent,
            panel: shown(panel) ? rect(panel) : null,
            ms: rect(document.getElementById('music-section')),
            pages: page.map(rect),
            bar: shown(bar) ? rect(bar) : null,
            vw: innerWidth, vh: innerHeight,
            overflowX: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
            lyricsOn: lyricsEnabled,
            np: document.getElementById('musicPlayerView').classList.contains('active') && document.getElementById('musicPlayerView').classList.contains('dv-deck'),
            visibleLines: [...document.querySelectorAll('.lyrics-line')].filter(shown).length,
            nowWant: ((currentRadioSong || songsData[currentSongIndex]) || {}).title || '',
        };
    });
    const mk = (t) => ({ title: t, artist: 'Queue Artist', cover: '', youtube_id: 'Q' + t.replace(/\W/g, '').slice(0, 10).padEnd(10, 'x') });
    const seedQueue = (p, titles) => p.evaluate((list) => { playQueue = list.map(songToQueueItem); afterQueueChange(); }, titles.map(mk));
    const setLyrics = (p, on) => p.evaluate((v) => { if (lyricsEnabled !== v) toggleLyrics(); }, on);
    const fakeLyrics = (p) => p.evaluate(() => {
        renderLyrics({ type: 'synced', lines: Array.from({ length: 24 }, (_, i) => ({ time: i * 4, text: 'Lyric line ' + (i + 1) })) });
    });
    // Shuffle through the bar's own button (off → shuffle → smart → off)
    const setShuffle = async (p, mode) => { for (let k = 0; k < 3 && (await p.evaluate(() => shuffleMode)) !== mode; k++) await p.click('#dvBarShuffle'); await p.waitForTimeout(150); };
    const at = (p, t) => p.evaluate((x) => { ytPlayer.getCurrentTime = () => x; updateSleeveProgress(); }, t);
    // The active line, and whether it sits inside the lyrics box (scrolled to)
    const activeLine = (p) => p.evaluate(() => {
        const box = document.getElementById('sleeveLyrics');
        const act = box.querySelector('.lyrics-line.active');
        if (!act) return { text: null };
        const a = act.getBoundingClientRect(), r = box.getBoundingClientRect();
        return { text: act.textContent, inView: a.top >= r.top - 1 && a.bottom <= r.bottom + 1, scrolled: box.scrollTop };
    });
    const otherWithSongs = (p, min = 1) => p.evaluate((n) => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= n), min);
    const openList = async (p, id) => { await p.evaluate((i) => selectPlaylistFromCrate(i), id); await p.waitForTimeout(1500); };
    const home = async (p) => { await p.evaluate(() => { if (window.dvNowPlaying) window.dvNowPlaying.close(); if (window.dvSearch) window.dvSearch.close(); if (document.getElementById('musicPlayerView').classList.contains('active')) showPlaylistPicker(); }); await p.waitForTimeout(400); };
    // The layout with the panel open: on the right, above the bar, the page beside it
    function layoutOk(s) {
        return !!s.panel && !!s.bar && Math.abs(s.panel.r - s.vw) <= 1 && s.panel.t >= 0 && s.panel.b <= s.bar.t + 1
            && s.panel.w >= 270 && s.panel.w <= 370 && s.ms.r <= s.panel.l + 1 && Math.abs(s.ms.r - (s.vw - s.panel.w)) <= 1
            && s.ms.b <= s.bar.t + 1 && s.pages.length > 0 && s.pages.every(r => r.r <= s.panel.l + 1) && !s.overflowX;
    }
    const lay = (s) => ({ panel: s.panel, ms: s.ms, pages: s.pages, bar: s.bar && s.bar.t, vw: s.vw, overflowX: s.overflowX });

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. Up next: the bar's queue button opens the panel (no window)
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            const s0 = await panelState(p);
            check(`${tag} A closed to begin with: no panel, the page reaches the window's right edge`, !s0.shown && !s0.cls && Math.abs(s0.ms.r - s0.vw) <= 1 && s0.qPressed === 'false', { shown: s0.shown, ms: s0.ms, pressed: s0.qPressed });
            await seedQueue(p, ['Queued Alpha', 'Queued Bravo', 'Queued Charlie']);
            await p.click('#dvBarQueue'); await p.waitForTimeout(400);
            const s = await panelState(p);
            check(`${tag} A the queue button opens the side panel on Up next (not the queue window); pressed; focus on the Up next tab`,
                s.dv2 && s.shown && s.cls && s.tab === 'queue' && s.queueBodyShown && !s.lyricsBodyShown && !s.modal && s.queueIn === 'panel' && s.qPressed === 'true' && s.lPressed === 'false' && s.focus === 'dvPanelTabQueue',
                { shown: s.shown, tab: s.tab, modal: s.modal, queueIn: s.queueIn, pressed: s.qPressed, focus: s.focus });
            check(`${tag} A a labelled complementary landmark with a labelled tablist (Up next, Lyrics; one tab stop) and no live regions`,
                s.tag === 'ASIDE' && s.label === 'Up next and lyrics' && s.tablist === 'Side panel' && s.tabRoles.join('|') === 'Up next:0|Lyrics:-1' && s.live === 0, { tag: s.tag, label: s.label, tablist: s.tablist, tabs: s.tabRoles, live: s.live });
            check(`${tag} A Up next shows the playing song and the queued songs in order; the badge counts them`,
                s.now === s.nowWant && !!s.now && s.items.join('|') === 'Queued Alpha|Queued Bravo|Queued Charlie' && s.badge === '3', { now: s.now, want: s.nowWant, items: s.items, badge: s.badge });
            check(`${tag} A layout: the panel runs down the right from the top to the bar, the page narrows beside it, no sideways scroll`, layoutOk(s), lay(s));
            const names = await p.evaluate(() => [...document.querySelectorAll('#dvPanel .queue-item[data-qindex]')].map(li => li.querySelector('.queue-item-play').getAttribute('aria-label') + ' / ' + li.querySelector('.queue-item-remove').getAttribute('aria-label')));
            check(`${tag} A each queued song's buttons name it`, names[0] === 'Play now: Queued Alpha / Remove from queue: Queued Alpha' && names.length === 3, names);
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. Reorder (keys, drag), remove, play, clear
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await seedQueue(p, ['Queued Alpha', 'Queued Bravo', 'Queued Charlie']);
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            // Alt+↓ on the first song moves it down; focus follows it
            await p.focus('#dvPanel .queue-item[data-qindex="0"] .queue-item-play');
            await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(150);
            const k1 = await panelState(p);
            await p.keyboard.press('Alt+ArrowUp'); await p.waitForTimeout(150);
            const k2 = await panelState(p);
            check(`${tag} B Alt+↓ moves a queued song down and Alt+↑ back up, focus following it`,
                k1.queue.join('|') === 'Queued Bravo|Queued Alpha|Queued Charlie' && k1.items.join('|') === k1.queue.join('|') && k1.focus === 'Play now: Queued Alpha'
                && k2.queue.join('|') === 'Queued Alpha|Queued Bravo|Queued Charlie' && k2.focus === 'Play now: Queued Alpha', { k1: { q: k1.queue, f: k1.focus }, k2: { q: k2.queue, f: k2.focus } });
            // Drag the last song's handle above the first
            const hd = await p.evaluate(() => {
                const r = (sel) => document.querySelector(sel).getBoundingClientRect();
                const h = r('#dvPanel .queue-item[data-qindex="2"] .queue-drag-handle');
                const first = r('#dvPanel .queue-item[data-qindex="0"]');
                return { x: h.left + h.width / 2, y: h.top + h.height / 2, to: first.top + 4 };
            });
            await p.mouse.move(hd.x, hd.y); await p.mouse.down();
            await p.mouse.move(hd.x, (hd.y + hd.to) / 2, { steps: 4 });
            await p.mouse.move(hd.x, hd.to, { steps: 4 });
            await p.mouse.up(); await p.waitForTimeout(200);
            const d = await panelState(p);
            check(`${tag} B dragging a song's handle reorders the queue (saved)`, d.queue.join('|') === 'Queued Charlie|Queued Alpha|Queued Bravo' && d.items.join('|') === d.queue.join('|')
                && (await p.evaluate(() => JSON.parse(localStorage.getItem('playQueue') || '[]').map(s => s.title).join('|'))) === d.queue.join('|'), { queue: d.queue, items: d.items });
            // × removes one; focus stays on the row now in its place
            await p.focus('#dvPanel .queue-item[data-qindex="1"] .queue-item-remove');
            await p.keyboard.press('Enter'); await p.waitForTimeout(150);
            const r = await panelState(p);
            check(`${tag} B × removes that song (badge follows); focus stays on the × now in its place`,
                r.queue.join('|') === 'Queued Charlie|Queued Bravo' && r.items.join('|') === r.queue.join('|') && r.badge === '2' && r.focus === 'Remove from queue: Queued Bravo', { queue: r.queue, badge: r.badge, focus: r.focus });
            // A click plays it now (the ones before it go); Now playing follows
            await p.click('#dvPanel .queue-item[data-qindex="1"] .queue-item-play'); await p.waitForTimeout(1500);
            const pl = await panelState(p);
            const played = await p.evaluate(() => ({ radio: currentRadioSong && currentRadioSong.title }));
            check(`${tag} B clicking a queued song plays it now (those before it leave the queue) and Now playing shows it`,
                played.radio === 'Queued Bravo' && pl.queue.length === 0 && pl.empty && pl.now === 'Queued Bravo', { played, queue: pl.queue, now: pl.now });
            // Clear
            await seedQueue(p, ['Queued Delta', 'Queued Echo']);
            await p.waitForTimeout(100);
            await p.focus('#dvPanel .queue-clear-btn');
            await p.keyboard.press('Enter'); await p.waitForTimeout(150);
            const c = await panelState(p);
            check(`${tag} B Clear empties the queue ("Nothing queued yet"), the badge goes, focus stays in the panel`, c.queue.length === 0 && c.items.length === 0 && c.empty && c.badge === '' && c.focusInPanel && c.shown, { queue: c.queue, empty: c.empty, badge: c.badge, focus: c.focus });
            check(`${tag} B errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- C. Add to queue from a song's ⋯; the playlist ⋯'s Up next; Next from
        {
            const { ctx, p } = await open({ vp });
            await p.evaluate(() => openPlayerView()); await p.waitForTimeout(800);
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            const row = '#songList .song-list-item[data-index="0"]:not(.discover-item)';
            const want = await p.evaluate(() => listSongs()[0] && listSongs()[0].title);
            await p.hover(row);
            await p.click(row + ' .song-send-btn'); await p.waitForTimeout(300);
            await p.click('.send-menu [role="menuitem"]:nth-child(2)'); await p.waitForTimeout(300);
            const a = await panelState(p);
            check(`${tag} C a song row's ⋯ → Add to queue: the song shows in the open panel's Up next`, !!want && a.shown && a.tab === 'queue' && a.items[a.items.length - 1] === want && a.queue[a.queue.length - 1] === want, { want, items: a.items });
            check(`${tag} C layout on the playlist page: the page narrows beside the panel`, layoutOk(a), lay(a));
            // Close (the button again: focus stays on it), then the playlist ⋯ → Up next opens it
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            const z = await panelState(p);
            check(`${tag} C the queue button again closes it (not pressed, focus stays on it, the page widens back)`, !z.shown && !z.cls && z.qPressed === 'false' && z.focus === 'dvBarQueue' && Math.abs(z.ms.r - z.vw) <= 1, { shown: z.shown, pressed: z.qPressed, focus: z.focus, ms: z.ms });
            const more = await p.evaluate(() => !!document.getElementById('dvPlMore') && document.getElementById('dvPlMore').getClientRects().length > 0);
            if (more) {
                await p.click('#dvPlMore'); await p.waitForTimeout(150);
                await p.click('#dvPlMenu [data-dv-pl="queue"]'); await p.waitForTimeout(400);
                const m = await panelState(p);
                check(`${tag} C the playlist page's ⋯ → Up next opens the panel on Up next (no window), focus on its tab`, m.shown && m.tab === 'queue' && !m.modal && m.focus === 'dvPanelTabQueue', { shown: m.shown, tab: m.tab, modal: m.modal, focus: m.focus });
            } else {
                check(`${tag} C the playlist page's ⋯ (not shown: skipped)`, true);
            }
            // Next from the playing playlist: in order with shuffle off, a note with it on
            await p.evaluate(() => { playQueue = []; afterQueueChange(); });
            const n0 = await p.evaluate(() => shuffleMode);
            await setShuffle(p, 'off');
            const nf = await panelState(p);
            const nfWant = await p.evaluate(() => {
                const n = songsData.length, out = [];
                const start = currentRowStarted() && !currentRadioSong ? currentSongIndex + 1 : currentSongIndex;
                for (let k = 0; out.length < 5 && k < n; k++) {
                    let i = start + k;
                    if (i >= n) { if (loopMode === 'off') break; i %= n; }
                    if (currentRowStarted() && !currentRadioSong && i === currentSongIndex) break;
                    out.push(songsData[i].title);
                }
                return { titles: out, name: playlistsMeta[String(activePlaylistId)].name };
            });
            check(`${tag} C "Next from <the playing playlist>" lists its next songs in order (shuffle off)`,
                nf.nfLabel === 'Next from ' + nfWant.name && nf.nf.join('|') === nfWant.titles.join('|') && (nfWant.titles.length > 0 || nf.nf.length === 0), { label: nf.nfLabel, nf: nf.nf, want: nfWant });
            if (nf.nf.length) {
                const idx = await p.evaluate(() => parseInt(document.querySelector('#dvPanel .dv-nf-row').dataset.nfIndex, 10));
                await p.click('#dvPanel .dv-nf-row'); await p.waitForTimeout(1500);
                const after = await p.evaluate(() => ({ cur: currentSongIndex, played: window.__played.slice(-1)[0] }));
                check(`${tag} C a "Next from" song plays when clicked`, after.cur === idx && after.played === nfWant.titles[0], { idx, after, want: nfWant.titles[0] });
            } else {
                check(`${tag} C a "Next from" song (none listed: skipped)`, true);
            }
            await setShuffle(p, 'shuffle');
            const ns = await panelState(p);
            check(`${tag} C with shuffle on, "Next from" only says the songs are picked as they play`, ns.nf.length === 0 && ns.nfNote && ns.nfLabel === 'Next from ' + nfWant.name, { nf: ns.nf, note: ns.nfNote, label: ns.nfLabel });
            await setShuffle(p, n0);
            check(`${tag} C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. Lyrics: the bar's lyrics button, on Home, a playlist page and Search; Now Playing takes them back
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await setLyrics(p, false);
            await p.click('#dvBarLyrics'); await p.waitForTimeout(400);
            await fakeLyrics(p);
            await at(p, 21); await p.waitForTimeout(500);
            const s = await panelState(p);
            const a1 = await activeLine(p);
            check(`${tag} D the lyrics button on Home opens the panel on Lyrics with lyrics on (pressed; Now Playing stays closed); focus on the Lyrics tab`,
                s.shown && s.tab === 'lyrics' && s.lyricsBodyShown && !s.queueBodyShown && s.lyricsOn && s.lPressed === 'true' && s.qPressed === 'false' && !s.np && s.focus === 'dvPanelTabLyrics',
                { shown: s.shown, tab: s.tab, on: s.lyricsOn, pressed: s.lPressed, np: s.np, focus: s.focus });
            check(`${tag} D the synced lyrics show in the panel (one copy, a labelled scrollable region) and highlight the line being sung`,
                s.lyricsIn === 'panel' && s.visibleLines === 24 && s.lyricsRole === 'region' && s.lyricsLabel === 'Lyrics' && s.lyricsTab === '0' && a1.text === 'Lyric line 6' && a1.inView,
                { in: s.lyricsIn, lines: s.visibleLines, role: s.lyricsRole, label: s.lyricsLabel, a1 });
            await at(p, 85); await p.waitForTimeout(900);
            const a2 = await activeLine(p);
            check(`${tag} D the lyrics scroll to follow the song`, a2.text === 'Lyric line 22' && a2.inView && a2.scrolled > 0, a2);
            // A line seeks; the offset controls nudge and reset
            await p.evaluate(() => { window.__seeks.length = 0; });
            await p.evaluate(() => { const l = [...document.querySelectorAll('#dvPanel .lyrics-line')].find(x => x.textContent === 'Lyric line 20'); l.scrollIntoView({ block: 'center' }); });
            await p.click('#dvPanel .lyrics-line >> text="Lyric line 20"'); await p.waitForTimeout(150);
            const seeks = await p.evaluate(() => window.__seeks.slice());
            await p.click('#lyricsOffsetPlus');
            const off1 = await p.evaluate(() => document.getElementById('lyricsOffsetValue').textContent);
            await p.click('#lyricsOffsetValue');
            const off2 = await p.evaluate(() => document.getElementById('lyricsOffsetValue').textContent);
            check(`${tag} D a lyric line seeks there; + nudges the offset (+0.5s) and the value resets it`, seeks[0] === 76 && off1 === '+0.5s' && off2 === '0s', { seeks, off1, off2 });
            check(`${tag} D layout on Home: the page narrows beside the panel`, layoutOk(s), lay(s));
            // A playlist page and the Search page keep them in the panel
            const id = await otherWithSongs(p);
            if (id) await openList(p, id);
            const s2 = await panelState(p);
            check(`${tag} D on a playlist page the lyrics stay in the panel`, !!id && s2.shown && s2.tab === 'lyrics' && s2.lyricsIn === 'panel' && s2.visibleLines === 24 && layoutOk(s2), { id, shown: s2.shown, in: s2.lyricsIn, lines: s2.visibleLines, lay: lay(s2) });
            await p.evaluate(() => window.dvSearch && window.dvSearch.open()); await p.waitForTimeout(500);
            const s3 = await panelState(p);
            check(`${tag} D on the Search page the lyrics stay in the panel`, s3.shown && s3.tab === 'lyrics' && s3.lyricsIn === 'panel' && s3.visibleLines === 24 && layoutOk(s3), { shown: s3.shown, in: s3.lyricsIn, lines: s3.visibleLines, lay: lay(s3) });
            // Now Playing takes them (one copy); the tab says where they went
            await p.click('#dvBarDeck'); await p.waitForTimeout(700);
            const n = await panelState(p);
            check(`${tag} D Now Playing open: its page shows the lyrics (one copy), the panel's Lyrics tab says they're there`,
                n.np && n.shown && n.tab === 'lyrics' && n.lyricsIn === 'sleeve' && n.visibleLines === 24 && n.note === 'The lyrics are on the Now Playing page.' && n.lPressed === 'true' && layoutOk(n),
                { np: n.np, in: n.lyricsIn, lines: n.visibleLines, note: n.note, pressed: n.lPressed, lay: lay(n) });
            await p.click('#dvBarDeck'); await p.waitForTimeout(700);
            const n2 = await panelState(p);
            check(`${tag} D closing Now Playing brings the lyrics back to the panel`, !n2.np && n2.shown && n2.lyricsIn === 'panel' && n2.note === null && n2.visibleLines === 24 && n2.lPressed === 'true', { np: n2.np, in: n2.lyricsIn, note: n2.note, lines: n2.visibleLines });
            // The tabs: click Up next (the lyrics go home), arrows back to Lyrics
            await p.click('#dvPanelTabQueue'); await p.waitForTimeout(200);
            const t1 = await panelState(p);
            await p.focus('#dvPanelTabQueue');
            await p.keyboard.press('ArrowRight'); await p.waitForTimeout(200);
            const t2 = await panelState(p);
            await p.keyboard.press('Home'); await p.waitForTimeout(200);
            const t3 = await panelState(p);
            check(`${tag} D the tabs: Up next by click (lyrics back in the sleeve, the bar's buttons follow); → selects and focuses Lyrics; Home goes back`,
                t1.tab === 'queue' && t1.queueBodyShown && t1.lyricsIn === 'sleeve' && t1.qPressed === 'true' && t1.lPressed === 'false' && t1.tabRoles.join('|') === 'Up next:0|Lyrics:-1'
                && t2.tab === 'lyrics' && t2.focus === 'dvPanelTabLyrics' && t2.lyricsIn === 'panel' && t2.tabRoles.join('|') === 'Up next:-1|Lyrics:0'
                && t3.tab === 'queue' && t3.focus === 'dvPanelTabQueue', { t1: { tab: t1.tab, in: t1.lyricsIn, q: t1.qPressed, l: t1.lPressed }, t2: { tab: t2.tab, focus: t2.focus, in: t2.lyricsIn }, t3: { tab: t3.tab, focus: t3.focus } });
            check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- E. Closing: the open tab's button, Esc, ×; focus back on the bar
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await setLyrics(p, true);
            await p.click('#dvBarLyrics'); await p.waitForTimeout(300);
            await p.click('#dvBarLyrics'); await p.waitForTimeout(300);
            const c1 = await panelState(p);
            check(`${tag} E the lyrics button again closes the panel (lyrics back in the sleeve, not pressed, focus on it, the page widens back)`,
                !c1.shown && !c1.cls && c1.lyricsIn === 'sleeve' && c1.lPressed === 'false' && c1.focus === 'dvBarLyrics' && Math.abs(c1.ms.r - c1.vw) <= 1, { shown: c1.shown, in: c1.lyricsIn, pressed: c1.lPressed, focus: c1.focus });
            // The queue button while Lyrics shows switches to Up next
            await p.click('#dvBarLyrics'); await p.waitForTimeout(300);
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            const sw = await panelState(p);
            check(`${tag} E the queue button while Lyrics shows switches the panel to Up next`, sw.shown && sw.tab === 'queue' && sw.qPressed === 'true' && sw.lPressed === 'false' && sw.lyricsIn === 'sleeve', { shown: sw.shown, tab: sw.tab, q: sw.qPressed, l: sw.lPressed });
            // Esc inside it closes it, focus back on the queue button
            await p.keyboard.press('Escape'); await p.waitForTimeout(300);
            const e1 = await panelState(p);
            check(`${tag} E Esc in the panel closes it, focus back on the queue button`, !e1.shown && e1.focus === 'dvBarQueue', { shown: e1.shown, focus: e1.focus });
            // × closes it, focus back on the button for the tab it showed
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            await p.click('#dvPanelTabLyrics'); await p.waitForTimeout(200);
            await p.click('#dvPanelClose'); await p.waitForTimeout(300);
            const x1 = await panelState(p);
            check(`${tag} E × closes it, focus back on the bar's lyrics button (the tab it showed)`, !x1.shown && x1.focus === 'dvBarLyrics' && x1.lyricsIn === 'sleeve', { shown: x1.shown, focus: x1.focus, in: x1.lyricsIn });
            // Esc with Now Playing open and focus in the panel closes only the panel
            await p.click('#dvBarDeck'); await p.waitForTimeout(600);
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            await p.keyboard.press('Escape'); await p.waitForTimeout(300);
            const e2 = await panelState(p);
            check(`${tag} E with Now Playing open, Esc in the panel closes just the panel`, !e2.shown && e2.np && e2.focus === 'dvBarQueue', { shown: e2.shown, np: e2.np, focus: e2.focus });
            check(`${tag} E errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- F. Remembered per device over a reload
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await p.click('#dvBarLyrics'); await p.waitForTimeout(300);
            await p.reload(); await p.waitForTimeout(1500);
            const r1 = await panelState(p);
            check(`${tag} F after a reload the panel is open again on Lyrics (the lyrics in it)`, r1.shown && r1.cls && r1.tab === 'lyrics' && r1.lyricsIn === 'panel' && r1.lPressed === 'true' && layoutOk(r1), { shown: r1.shown, tab: r1.tab, in: r1.lyricsIn, lay: lay(r1) });
            await p.click('#dvPanelTabQueue'); await p.waitForTimeout(200);
            await p.reload(); await p.waitForTimeout(1500);
            const r2 = await panelState(p);
            await p.click('#dvBarQueue'); await p.waitForTimeout(200);
            await p.reload(); await p.waitForTimeout(1500);
            const r3 = await panelState(p);
            check(`${tag} F the tab is remembered (Up next), and closed stays closed`, r2.shown && r2.tab === 'queue' && r2.queueIn === 'panel' && !r3.shown && !r3.cls && r3.lyricsIn === 'sleeve',
                { r2: { shown: r2.shown, tab: r2.tab }, r3: { shown: r3.shown, cls: r3.cls } });
            check(`${tag} F errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- G. axe: Up next with songs, Lyrics, Lyrics under Now Playing
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await seedQueue(p, ['Queued Alpha', 'Queued Bravo']);
            await setShuffle(p, 'off');
            await p.click('#dvBarQueue'); await p.waitForTimeout(300);
            const v1 = await axeScan(p);
            await setLyrics(p, true);
            await p.click('#dvPanelTabLyrics'); await p.waitForTimeout(200);
            await fakeLyrics(p); await at(p, 9);
            const v2 = await axeScan(p);
            await p.click('#dvBarDeck'); await p.waitForTimeout(600);
            const v3 = await axeScan(p);
            check(`${tag} G axe: no violations with Up next, with Lyrics, and with Now Playing beside the panel`, v1.length === 0 && v2.length === 0 && v3.length === 0, { v1, v2, v3 });
            check(`${tag} G errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- H. Narrowing to a phone with the panel open: the queue and lyrics go home
    {
        const { ctx, p } = await open({});
        await home(p);
        await p.click('#dvBarLyrics'); await p.waitForTimeout(300);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
        const s = await panelState(p);
        check('H narrowed to 390px with the panel open: no panel, the lyrics back in the sleeve, the queue list back in its window',
            !s.dv2 && !s.shown && !s.cls && s.lyricsIn === 'sleeve' && s.queueIn === 'modal' && !s.lyricsRole, { dv2: s.dv2, shown: s.shown, in: s.lyricsIn, q: s.queueIn, role: s.lyricsRole });
        await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(800);
        const s2 = await panelState(p);
        check('H widened again: the panel is back on Lyrics', s2.dv2 && s2.shown && s2.tab === 'lyrics' && s2.lyricsIn === 'panel', { dv2: s2.dv2, shown: s2.shown, in: s2.lyricsIn });
        check('H errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- I. Phones and the app keep the queue window and the sleeve's lyrics
    // (even with the panel left open on this device)
    for (const c of [{ vp: { width: 390, height: 844 }, phone: true }, { vp: { width: 844, height: 390 }, phone: true }, { vp: { width: 1440, height: 900 }, query: '?app=1' }]) {
        const tag = c.query ? 'app (?app=1) 1440x900' : `phone ${c.vp.width}x${c.vp.height}`;
        const { ctx, p } = await open(c);
        await p.evaluate(() => { try { localStorage.setItem('dvPanel', 'lyrics'); } catch (e) {} });
        await p.reload(); await p.waitForTimeout(1500);
        const s0 = await panelState(p);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(400);
        const s = await panelState(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(300);
        check(`I ${tag}: no side panel (even left open on this device); the queue opens its window; the lyrics stay in the sleeve`,
            !s0.dv2 && !s0.shown && !s0.cls && s0.lyricsIn === 'sleeve' && s0.queueIn === 'modal' && !s0.lyricsRole && s.modal && s.queueIn === 'modal' && !s.shown,
            { dv2: s0.dv2, shown: s0.shown, cls: s0.cls, in: s0.lyricsIn, q: s0.queueIn, modal: s.modal });
        check(`I ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
