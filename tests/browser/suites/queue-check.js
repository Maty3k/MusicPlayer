// The queue (Up next) everywhere, with the Cloudflare source on, at phone
// size (390x844) unless noted:
//   A. Cloudflare Search rows have a ⋯ (44px): its sheet queues the song
//      (Add to queue, Play next) and likes it, and offers nothing that edits
//      a playlist by position.
//   B. Repeated Play next keeps the order the songs came in; after the queue
//      the Cloudflare list goes on after the song before it.
//   C. Queued playlist songs while the Cloudflare list plays: then the list
//      goes on after the song before the queue ("Playing from" and Up next's
//      "Next from" say so); and the reverse (queued Cloudflare songs during
//      a playlist hand back to the playlist).
//   D. Back during a queued song (shuffle off): the song before the queue,
//      a playlist row and a Cloudflare song alike; more than 3 s in, Back
//      starts the queued song again.
//   E. Up next shows the song that plays after Play now and after a song's
//      end, while it is open.
//   F. A queued song that fails moves on to the next queued one (with
//      repeat one too).
//   G. A reload brings the queue back.
//   H. Repeat one: the queue still plays first, then the song on repeat.
//   I. The phone's drag handle is 44px at the row's right edge and
//      reorders; Clear takes a second tap.
//   J. Now Playing's ⋯ on a Cloudflare song: its own sheet, not the "not in
//      this playlist" toast.
//   K. Desktop (1024x768): the Search page's Cloudflare rows' ⋯, Now
//      Playing's "Playing from" and its ⋯'s queue items; a song change has
//      its crackle and record animation first, on a hidden tab too. On iOS
//      (an iPad at that size), an automatic song change on a hidden page
//      starts the next song inside the 'ended' event instead (the
//      locked-iPhone rule: a queued song, a playlist's MP3 row, the
//      Cloudflare list).
//   L. Cloudflare shuffle plays every song once before any comes again.
//   M. The ⋯ on library and YouTube rows of the Search page (phone and
//      desktop), and on the library search window's hits (landscape).
//   N. A queue started on a page just opened (nothing played) notes no
//      list: after it the last queued Cloudflare song's list goes on, with
//      the playing playlist empty too, and Up next says so.
//   O. The song playing ends while a queued song's record change is still
//      going: the change decides (the list to go back to stays).
//   P. Up next's "Next from Cloudflare" after a Cloudflare song played on
//      its own (Jump back in): its rows play when tapped.
//   Q. The + on a queued song's row saves the song whole.
//   R. A list noted for a queue counts for that queue only: after a
//      Cloudflare song from Jump back in, Up next and a new queue follow
//      the Cloudflare list (the playlist went back to before had played
//      through).
// The page includes the Cloudflare source only when CLOUD_MUSIC_URL and
// CLOUD_MUSIC_TOKEN are set, and the shared server runs without them, so
// this suite starts its own pair: a stand-in Worker on 127.0.0.1:8787
// (fixtures/cloud-worker.php: 8 silent MP3s, "Cloud 1" … "Cloud 8" by
// "Tester") and the app on port 8125 pointed at it, with the environment
// (database, logins) of the shared server. Writes to /save-music are faked
// and recorded (reads go through); /search-youtube is faked; YouTube songs
// play on a stub, Cloudflare songs on the page's own MP3 engine.
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const L = require('../lib');

// The app on a port of its own, on the shared server's host (the saved
// logins' cookies belong to the host, whatever the port)
const HOST = new URL(L.APP).hostname;
const APP = `http://${HOST}:8125/`;
const WORKER = 'http://127.0.0.1:8787';
const TOKEN = 'queue-check-token';
const REPO = path.resolve(L.ROOT, '..', '..');
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

const KEY = (n) => `Cloud ${n} - Tester.mp3`;
const MISSING = 'Missing - Tester.mp3'; // not in the bucket: its file answers 404
// iOS at a desktop size (script.js's IS_IOS)
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - Great Song (Official Video)', channel: 'Band One', thumbnail: '' },
    { videoId: 'bbbbbbbbbb2', title: 'Another Tune', channel: 'Someone', thumbnail: '' },
];
// The page's own song key (songPlayKey), for the faked Favorites answers
const keyOf = (s) => (s.youtube_id ? 'yt:' + s.youtube_id : s.spotify_id ? 'sp:' + s.spotify_id
    : s.mp3_url ? 'mp3:' + String(s.mp3_url).trim()
        : 'tt:' + String(s.title || '').trim().toLowerCase() + '|' + String(s.artist || '').trim().toLowerCase());

// ---- The two servers, stopped however the suite ends. PHP's server forks
// its workers (PHP_CLI_SERVER_WORKERS) and they keep the port when only the
// first process stops: each server gets a process group of its own, and
// the whole group is stopped.
const children = [];
function serve(name, args, cwd, env) {
    const log = fs.openSync(L.shot('logs', `queue-check.${name}.txt`), 'w');
    const child = spawn('php', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', log, log], detached: true });
    child.on('error', () => {}); // no php: the wait below says so
    children.push(child);
    return child;
}
const running = (c) => !!c.pid && c.exitCode === null && c.signalCode === null;
function stopServers() {
    for (const c of children.splice(0)) {
        try { process.kill(-c.pid, 'SIGTERM'); } catch (e) { /* gone */ }
    }
}
process.on('exit', stopServers);
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => { stopServers(); process.exit(1); }));
// Anything already listening there (servers a killed run left behind,
// wrangler dev on 8787) would answer instead of the ones started here
function listening(host, port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const done = (yes) => { socket.destroy(); resolve(yes); };
        socket.setTimeout(1000, () => done(false));
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
    });
}
async function up(url, ms = 30000) {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
        try { if ((await fetch(url)).ok) return true; } catch (e) { /* not yet */ }
        await new Promise((r) => setTimeout(r, 300));
    }
    return false;
}

async function run(b) {
    // ---- Helpers
    // After every load: YouTube songs play on a stub (Cloudflare songs on the
    // page's own MP3 engine), no radio or lyrics lookups, and every toast is kept
    const setup = (p) => p.evaluate(() => {
        window.__yt = [];
        const stub = { _s: 5, loadVideoById(id) { window.__yt.push(id); this._s = 1; }, cueVideoById() { this._s = 5; },
            playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
            mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
            getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
        ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
        window.fetchRadioRecommendations = function () {};
        window.loadLyricsForSong = async function () {};
        window.__toasts = [];
        ['showToast', 'mToast', 'showBulkToast'].forEach((name) => {
            const f = window[name];
            if (typeof f === 'function') window[name] = function (msg) { window.__toasts.push(String(msg)); return f.apply(this, arguments); };
        });
    });

    async function open(opts = {}) {
        const vp = opts.vp || { width: 390, height: 844 };
        const phone = opts.phone !== false;
        const ctx = await b.newContext({
            viewport: vp, isMobile: phone, hasTouch: phone, storageState: L.state(opts.acct || 'mid'),
            // Straight to the network: the routes below see every request
            serviceWorkers: 'block',
            ...(opts.ua ? { userAgent: opts.ua } : {}),
        });
        await ctx.addInitScript((source) => {
            try {
                localStorage.setItem('songSource', source);
                // Once per tab (a reload keeps them): no queue or search left from before
                if (!sessionStorage.getItem('queueCheck')) {
                    sessionStorage.setItem('queueCheck', '1');
                    localStorage.removeItem('playQueue');
                    sessionStorage.removeItem('mSearchQuery');
                }
            } catch (e) { /* private mode */ }
        }, opts.source || 'cloud');
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', (e) => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|ytimg\.com|sdk\.scdn|spotify\.com|lrclib\.net/, (r) => r.abort());
        await p.route('**/search-youtube', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) }));
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            if (body.action === 'favorite') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, favorited: true, key: keyOf(body.song || {}) }) });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        await setup(p);
        return { ctx, p };
    }

    const until = async (p, fn, arg, ms = 6000) => {
        try { await p.waitForFunction(fn, arg, { timeout: ms, polling: 50 }); return true; } catch (e) { return false; }
    };
    // A song change done (switchSong waits for its save, faked here)
    const settle = async (p) => { await p.waitForTimeout(60); await until(p, () => !isChangingSong); await p.waitForTimeout(120); };
    // What plays, the queue, and the list it goes back to
    const now = (p) => p.evaluate(() => {
        const s = currentRadioSong || songsData[currentSongIndex] || null;
        return {
            title: s ? s.title : null,
            radio: !!currentRadioSong,
            cloud: currentRadioSong ? currentRadioSong.cloud_key || '' : '',
            queued: !!(currentRadioSong && currentRadioSong._queued),
            idx: currentSongIndex,
            queue: playQueue.map((q) => q.title),
            back: queueReturn ? queueReturn.list : null,
        };
    });
    // The song playing ends: the MP3 engine's own 'ended' (Cloudflare songs),
    // or the stub reporting it (YouTube songs). Then the change settles.
    async function end(p) {
        await p.evaluate(() => {
            if (mp3PlayerProxy && ytPlayer === mp3PlayerProxy) mp3PlayerProxy._audio.dispatchEvent(new Event('ended'));
            else onPlayerStateChange({ data: 0 });
        });
        await settle(p);
        return now(p);
    }
    // Songs straight into the queue (the ⋯ that does it is checked in A):
    // Cloudflare songs by key, the playing list's songs by index
    const enqueue = (p, songs) => p.evaluate((list) => list.forEach((s) => queueSong(typeof s === 'number' ? songsData[s]
        : { title: s.title, artist: 'Tester', album: '', cover: '', youtube_id: '', spotify_id: '', mp3_url: '/cloud-music/file?key=' + encodeURIComponent(s.key), cloud_key: s.key }, false)),
        songs.map((s) => (typeof s === 'number' ? s : { title: s.replace(/ - Tester\.mp3$/, ''), key: s })));
    // The song menu (a phone's sheet, the desktop's popover) as it stands
    const sheetLook = (p) => p.evaluate(() => {
        const m = document.querySelector('.send-menu');
        if (!m) return { open: false };
        return {
            open: true,
            sheet: m.classList.contains('send-menu-sheet'),
            role: m.getAttribute('role'),
            label: m.getAttribute('aria-label'),
            title: (m.querySelector('.send-menu-song-title') || {}).textContent || m.dataset.songTitle,
            items: [...m.querySelectorAll('.send-menu-item .send-menu-name')].map((x) => x.textContent.trim()),
            cancel: !!m.querySelector('.send-menu-cancel'),
            remove: !!m.querySelector('.send-menu-delete'),
            picker: !!m.querySelector('.send-menu-picker, .send-menu-open-picker'),
        };
    });
    const pick = (p, label, how = 'tap') => p[how](`.send-menu .send-menu-item:has-text("${label}")`);
    // The Up next list as it stands
    const queueLook = (p) => p.evaluate(() => {
        const body = document.getElementById('queueBody');
        const t = (el) => (el ? el.textContent.trim() : null);
        return {
            open: document.getElementById('queueModal').classList.contains('active'),
            now: t(body.querySelector('.queue-now .queue-item-title')),
            items: [...body.querySelectorAll('.queue-item[data-qindex] .queue-item-title')].map((x) => x.textContent.trim()),
            nfLabel: t(body.querySelector('.dv-nf-label')),
            nf: [...body.querySelectorAll('.dv-nf-row .queue-item-title')].map((x) => x.textContent.trim()),
            clear: t(body.querySelector('.queue-clear-btn')),
            empty: !!body.querySelector('.queue-empty'),
        };
    });
    const npFrom = (p) => p.evaluate(() => document.getElementById('mNpFromName').textContent.trim());
    const order = (p) => p.evaluate(() => { shuffleMode = 'off'; shuffleQueue = []; loopMode = 'playlist'; });
    // The phone's Search tab, with the Cloudflare songs in
    async function searchTab(p) {
        await p.tap('#mTabs .m-tab[data-tab="search"]');
        await p.waitForSelector('#mSearchResults [data-cloud="0"]', { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(250);
    }
    // A control in a list, scrolled to the middle first (clear of the mini
    // player and the tab bar), then tapped like a finger
    async function tapIn(p, sel) {
        await p.evaluate((x) => { const el = document.querySelector(x); if (el) el.scrollIntoView({ block: 'center' }); }, sel);
        await p.waitForTimeout(100);
        await p.tap(sel);
    }
    // The Cloudflare song playing ends, with the page hidden (as on a locked
    // iPhone) or not. seen: play() on any media element and a 0 ms timer, in
    // order (play() first: the next song started inside the 'ended' event);
    // crackled: the crackle was asked for meanwhile.
    const syncEnd = (p, hidden) => p.evaluate(async (hide) => {
        const seen = [];
        let crackled = false;
        const play = HTMLMediaElement.prototype.play;
        const crackle = window.playCrackleSound;
        HTMLMediaElement.prototype.play = function () { seen.push('play'); return play.apply(this, arguments); };
        window.playCrackleSound = function () { crackled = true; return crackle.apply(this, arguments); };
        if (hide) Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        let during = 0;
        try {
            setTimeout(() => seen.push('timer'), 0);
            mp3PlayerProxy._audio.dispatchEvent(new Event('ended'));
            during = seen.length;
            await new Promise((r) => setTimeout(r, 60));
        } finally {
            HTMLMediaElement.prototype.play = play;
            window.playCrackleSound = crackle;
            if (hide) delete document.hidden;
        }
        return { during, seen, crackled };
    }, hidden);
    // Each part on a page of its own. A part that throws is a failed check
    // (with the error) and the next part still runs.
    async function part(name, opts, fn) {
        let ctx = null;
        try {
            const opened = await open(opts);
            ctx = opened.ctx;
            await fn(opened.p);
            check(`${name} errors`, opened.p.__errs.length === 0, opened.p.__errs);
        } catch (e) {
            check(`${name} ran to the end`, false, String((e && e.message) || e).slice(0, 600));
        } finally {
            if (ctx) await ctx.close().catch(() => {});
        }
    }

    // ---- Setup: the page has the source on
    let on = false;
    await part('setup', {}, async (p) => {
        const cfg = await p.evaluate(() => ({ on: typeof CLOUD_MUSIC !== 'undefined' && CLOUD_MUSIC === true, api: !!window.cloudMusic, search: !!window.cloudMusic && cloudMusic.searchActive() }));
        on = cfg.on && cfg.api && cfg.search;
        check('setup: the page has the Cloudflare source, picked for Search', on, cfg);
    });
    if (!on) return;

    // ---- A + B. The ⋯ on Cloudflare rows; Play next keeps its order; after the queue the list goes on
    await part('A/B', {}, async (p) => {
        await searchTab(p);
        const rows = await p.evaluate(() => [...document.querySelectorAll('#mSearchResults .m-sr-row')].map((r) => {
            const m = r.querySelector('.m-sr-more[data-cloud-more]');
            const box = m ? m.getBoundingClientRect() : null;
            return { title: (r.querySelector('.search-result-title') || {}).textContent, more: box ? { w: Math.round(box.width), h: Math.round(box.height), label: m.getAttribute('aria-label') } : null };
        }));
        check('A Cloudflare Search lists the bucket\'s songs, each row with a ⋯ of at least 44px named for its song',
            rows.length === 8 && rows.every((r, i) => r.title === `Cloud ${i + 1}` && r.more && r.more.w >= 44 && r.more.h >= 44 && r.more.label === `More options for Cloud ${i + 1}`), rows);
        await tapIn(p, '#mSearchResults [data-cloud-more="2"]'); await p.waitForTimeout(500);
        const s1 = await sheetLook(p);
        check('A a row\'s ⋯ opens the song sheet for that song: Play next, Add to queue, Add to Favorites, Cancel; nothing that goes by position',
            s1.open && s1.sheet && s1.title === 'Cloud 3' && s1.items.join('|') === 'Play next|Add to queue|Add to Favorites' && s1.cancel && !s1.remove && !s1.picker, s1);
        await pick(p, 'Add to queue'); await p.waitForTimeout(500);
        const q1 = await p.evaluate(() => playQueue.map((q) => ({ title: q.title, key: q.cloud_key, url: q.mp3_url, queued: q._queued })));
        const t1 = await p.evaluate(() => window.__toasts.slice());
        const s1b = await sheetLook(p);
        check('A Add to queue queues that Cloudflare song (its file and key), says so, and the sheet closes',
            q1.length === 1 && q1[0].title === 'Cloud 3' && q1[0].key === KEY(3) && q1[0].url === '/cloud-music/file?key=' + encodeURIComponent(KEY(3)) && q1[0].queued
            && t1.includes('Added to queue') && !s1b.open, { q1, t1, s1b });
        for (const n of [5, 7]) {
            await tapIn(p, `#mSearchResults [data-cloud-more="${n - 1}"]`); await p.waitForTimeout(500);
            await pick(p, 'Play next'); await p.waitForTimeout(500);
        }
        const q2 = await p.evaluate(() => playQueue.map((q) => q.title));
        check('B repeated Play next keeps the order the songs came in, ahead of the songs added to the queue', q2.join('|') === 'Cloud 5|Cloud 7|Cloud 3', q2);
        // Played from the last song: the queue first, then the list after that
        // song (not after the last queued one)
        await order(p);
        await tapIn(p, '#mSearchResults [data-cloud="7"]'); await settle(p);
        const first = await now(p);
        const played = [];
        for (let k = 0; k < 4; k++) played.push((await end(p)).title);
        check('B the queue plays first, in its order, then the Cloudflare list goes on after the song before the queue (shuffle off)',
            first.cloud === KEY(8) && played.join('|') === 'Cloud 5|Cloud 7|Cloud 3|Cloud 1', { first: first.title, played });
        // ♥ from the sheet (last: a like joins the loaded Favorites list)
        await tapIn(p, '#mSearchResults [data-cloud-more="0"]'); await p.waitForTimeout(500);
        await pick(p, 'Add to Favorites'); await p.waitForTimeout(700);
        const fav = p.__posts.filter((x) => x.action === 'favorite').pop();
        const url = '/cloud-music/file?key=' + encodeURIComponent(KEY(1));
        const liked = await p.evaluate((u) => favoriteKeys.has('mp3:' + u), url);
        check('A the sheet\'s ♥ likes the Cloudflare song (kept by its address)', !!fav && !!fav.song && fav.song.mp3_url === url && liked, { fav: fav && fav.song, liked });
    });

    // ---- C. Back to the list the queue interrupted: Cloudflare, and the reverse
    await part('C', {}, async (p) => {
        const titles = await p.evaluate(() => songsData.map((s) => s.title));
        const listName = await p.evaluate(() => playlistsMeta[String(activePlaylistId)].name);
        await searchTab(p);
        await order(p);
        await tapIn(p, '#mSearchResults [data-cloud="1"]'); await settle(p);
        await enqueue(p, [3, 4]);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(700);
        const f0 = await npFrom(p);
        const c1 = await end(p);
        const f1 = await npFrom(p);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        const u1 = await queueLook(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(500);
        const c2 = await end(p);
        const c3 = await end(p);
        const f2 = await npFrom(p);
        check('C queued playlist songs play after the Cloudflare song, then the Cloudflare list goes on after the song before the queue',
            c1.queued && c1.title === titles[3] && c1.back === 'cloud' && c2.queued && c2.title === titles[4] && c3.cloud === KEY(3) && !c3.queued && c3.back === null, { c1, c2, c3 });
        check('C "Playing from" follows the song while Now Playing is open: Cloudflare, Up next, Cloudflare again', f0 === 'Cloudflare' && f1 === 'Up next' && f2 === 'Cloudflare', { f0, f1, f2 });
        check('C Up next during a queued song: it is "Now playing", the rest of the queue under it, then "Next from Cloudflare" from the song after the one the queue interrupted',
            u1.now === titles[3] && u1.items.join('|') === titles[4] && u1.nfLabel === 'Next from Cloudflare' && u1.nf[0] === 'Cloud 3', u1);
        // The reverse: a playlist song playing, Cloudflare songs queued from Search
        await p.evaluate(() => history.back()); await p.waitForTimeout(700); // Now Playing closes
        await p.evaluate(() => playListRow(1)); await settle(p);
        for (const n of [4, 6]) {
            await tapIn(p, `#mSearchResults [data-cloud-more="${n - 1}"]`); await p.waitForTimeout(500);
            await pick(p, 'Add to queue'); await p.waitForTimeout(500);
        }
        const r1 = await end(p);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        const u2 = await queueLook(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(500);
        const r2 = await end(p);
        const r3 = await end(p);
        check('C the reverse: queued Cloudflare songs play after the playlist song, then the playlist goes on from its own place (not the Cloudflare list)',
            r1.cloud === KEY(4) && r1.queued && r1.back === 'playlist' && r2.cloud === KEY(6) && r2.queued && !r3.radio && r3.idx === 2 && r3.title === titles[2], { r1, r2, r3 });
        check('C Up next during a queued Cloudflare song: "Next from <the playlist>", from the row after the one the queue interrupted',
            u2.now === 'Cloud 4' && u2.nfLabel === 'Next from ' + listName && u2.nf[0] === titles[2], u2);
    });

    // ---- D + E + J. Back from a queued song; Up next follows the song; Now Playing's ⋯
    await part('D/E/J', {}, async (p) => {
        const titles = await p.evaluate(() => songsData.map((s) => s.title));
        await order(p);
        await p.evaluate(() => playListRow(3)); await settle(p);
        await enqueue(p, [7]);
        await p.evaluate(() => nextSong()); await settle(p);
        const d1 = await now(p);
        await p.evaluate(() => prevSong()); await settle(p);
        const d2 = await now(p);
        check('D Back during a queued song (shuffle off) plays the song before the queue, not the row before that one',
            d1.queued && d1.title === titles[7] && !d2.radio && d2.idx === 3, { d1, d2 });
        await searchTab(p);
        await tapIn(p, '#mSearchResults [data-cloud="4"]'); await settle(p);
        await enqueue(p, [8]);
        await p.evaluate(() => nextSong()); await settle(p);
        const d3 = await now(p);
        await p.evaluate(() => prevSong()); await settle(p);
        const d4 = await now(p);
        check('D ...and back to the Cloudflare song before the queue (not into the playlist)', d3.queued && d3.title === titles[8] && d4.cloud === KEY(5) && !d4.queued, { d3, d4 });
        // E: Play now in the open Up next, then a song ending under it
        await enqueue(p, [KEY(1), KEY(2), KEY(3)]);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        await tapIn(p, '#queueModal .queue-item[data-qindex="2"] .queue-item-play'); await settle(p);
        const e1 = await queueLook(p);
        const e1s = await now(p);
        check('E Play now in Up next: the tapped song plays, the ones before it go, and Up next shows it as "Now playing"',
            e1s.cloud === KEY(3) && e1.open && e1.now === 'Cloud 3' && e1.items.length === 0, { e1, e1s });
        await enqueue(p, [KEY(4)]);
        await end(p);
        const e2 = await queueLook(p);
        check('E a song ending with Up next open: it shows the queued song that plays now', e2.open && e2.now === 'Cloud 4' && e2.items.length === 0, e2);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(500);
        // J: Now Playing's ⋯ on a Cloudflare song
        await tapIn(p, '#mSearchResults [data-cloud="5"]'); await settle(p);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(700);
        await p.evaluate(() => { window.__toasts = []; });
        await p.tap('#mNpKebab'); await p.waitForTimeout(500);
        const j1 = await sheetLook(p);
        const jt = await p.evaluate(() => window.__toasts.slice());
        check('J Now Playing\'s ⋯ on a Cloudflare song opens that song\'s own sheet (no "not in this playlist"): queue it, like it, nothing by position',
            j1.open && j1.title === 'Cloud 6' && j1.items.join('|') === 'Play next|Add to queue|Add to Favorites' && !j1.remove && !jt.some((x) => /not in this playlist/.test(x)), { j1, jt });
        await pick(p, 'Play next'); await p.waitForTimeout(500);
        const jq = await p.evaluate(() => playQueue.map((q) => q.title));
        check('J its Play next queues the song playing, to come again next', jq[0] === 'Cloud 6', jq);
    });

    // ---- D, a few seconds in: Back starts the queued song again
    await part('D 3 s', {}, async (p) => {
        await searchTab(p);
        await order(p);
        await tapIn(p, '#mSearchResults [data-cloud="1"]'); await settle(p);
        await enqueue(p, [KEY(6), KEY(7)]);
        const d0 = await end(p);
        // 30 s into the queued song (the silent test files are shorter)
        await p.evaluate(() => {
            window.__restarts = 0;
            const restart = window.restartSong;
            window.restartSong = function () { window.__restarts++; return restart.apply(this, arguments); };
            window.__at = 30;
            mp3PlayerProxy.getCurrentTime = () => window.__at;
        });
        await p.evaluate(() => prevSong()); await settle(p);
        const d1 = await now(p);
        const restarts = await p.evaluate(() => window.__restarts);
        await p.evaluate(() => { window.__at = 1; });
        await p.evaluate(() => prevSong()); await settle(p);
        const d2 = await now(p);
        check('D Back more than 3 s into a queued song starts it again: it keeps playing, the rest of the queue stays',
            d0.queued && d0.cloud === KEY(6) && restarts === 1 && d1.queued && d1.cloud === KEY(6) && d1.queue.join('|') === 'Cloud 7', { d0, d1, restarts });
        check('D ...within its first 3 s, Back plays the song before the queue', d2.cloud === KEY(2) && !d2.queued && d2.queue.join('|') === 'Cloud 7', d2);
    });

    // ---- F + G + H + I. A song that fails; a reload; repeat one; the handle and Clear
    await part('F/G/H/I', {}, async (p) => {
        const titles = await p.evaluate(() => songsData.map((s) => s.title));
        await searchTab(p);
        await order(p);
        await tapIn(p, '#mSearchResults [data-cloud="0"]'); await settle(p);
        await enqueue(p, [MISSING, KEY(2)]);
        await p.evaluate(() => { window.__toasts = []; });
        await end(p);
        const moved = await until(p, (k) => !!currentRadioSong && currentRadioSong.cloud_key === k && !isChangingSong, KEY(2), 10000);
        const f = await now(p);
        const ft = await p.evaluate(() => window.__toasts.slice());
        check('F a queued song that can\'t play (its file is gone) is skipped for the next queued one, saying why',
            moved && f.queued && f.queue.length === 0 && ft.some((x) => /“Missing” can't play: .*Skipping to the next song/.test(x)), { f, ft });
        // G: a reload
        await enqueue(p, [KEY(3), 1]);
        const before = await p.evaluate(() => playQueue.map((q) => q.title));
        await p.reload(); await p.waitForTimeout(1500);
        await setup(p);
        const g = await p.evaluate(() => ({ queue: playQueue.map((q) => q.title), tagged: playQueue.every((q) => q._queued), badge: (document.getElementById('mNpQueueCount') || {}).textContent }));
        check('G a reload brings the queue back (its songs still tagged as queued; the badge counts them)',
            g.queue.length === 2 && g.queue.join('|') === before.join('|') && g.tagged && g.badge === '2', { before, g });
        // H: repeat one
        await searchTab(p);
        await p.evaluate(() => { shuffleMode = 'off'; shuffleQueue = []; loopMode = 'single'; playQueue = []; afterQueueChange(); });
        await tapIn(p, '#mSearchResults [data-cloud="1"]'); await settle(p);
        await enqueue(p, [2]);
        const h1 = await end(p);
        const h2 = await end(p);
        const h3 = await end(p);
        check('H repeat one: the queue still plays first, then the song that was on repeat comes back (not the last queued one), and repeats',
            h1.queued && h1.title === titles[2] && h2.cloud === KEY(2) && !h2.queued && h3.cloud === KEY(2), { h1, h2, h3 });
        await p.evaluate(() => { loopMode = 'playlist'; });
        // I: the phone's drag handle, then Clear
        await enqueue(p, [KEY(4), KEY(5), KEY(6)]);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        const hd = await p.evaluate(() => {
            const li = document.querySelector('#queueModal .queue-item[data-qindex="0"]');
            const h = li.querySelector('.queue-drag-handle').getBoundingClientRect();
            const x = li.querySelector('.queue-item-remove').getBoundingClientRect();
            const r = li.getBoundingClientRect();
            return { w: Math.round(h.width), h: Math.round(h.height), toEdge: Math.round(r.right - h.right), afterRemove: h.left >= x.right - 1, removeW: Math.round(x.width), removeH: Math.round(x.height) };
        });
        check('I phones: a queued song\'s drag handle is 44px at the row\'s right edge, after its 44px ×', hd.w >= 44 && hd.h >= 44 && hd.toEdge <= 12 && hd.afterRemove && hd.removeW >= 44 && hd.removeH >= 44, hd);
        // The last song's handle dragged above the first, as a finger's pointer events
        await p.evaluate(() => {
            const handle = document.querySelector('#queueModal .queue-item[data-qindex="2"] .queue-drag-handle');
            const h = handle.getBoundingClientRect();
            const to = document.querySelector('#queueModal .queue-item[data-qindex="0"]').getBoundingClientRect().top + 4;
            const x = h.left + h.width / 2;
            const send = (type, y, el) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y }));
            send('pointerdown', h.top + h.height / 2, handle);
            [h.top, (h.top + to) / 2, to].forEach((y) => send('pointermove', y, document));
            send('pointerup', to, document);
        });
        await p.waitForTimeout(300);
        const dq = await p.evaluate(() => ({ queue: playQueue.map((q) => q.title), saved: JSON.parse(localStorage.getItem('playQueue') || '[]').map((q) => q.title),
            rows: [...document.querySelectorAll('#queueModal .queue-item[data-qindex] .queue-item-title')].map((x) => x.textContent) }));
        check('I dragging a song by its handle reorders the queue (saved)', dq.queue.join('|') === 'Cloud 6|Cloud 4|Cloud 5' && dq.saved.join('|') === dq.queue.join('|') && dq.rows.join('|') === dq.queue.join('|'), dq);
        await p.tap('#queueModal .queue-clear-btn'); await p.waitForTimeout(250);
        const c1 = await queueLook(p);
        const c1q = await p.evaluate(() => playQueue.length);
        await p.tap('#queueModal .queue-clear-btn'); await p.waitForTimeout(300);
        const c2 = await queueLook(p);
        const c2q = await p.evaluate(() => playQueue.length);
        check('I Clear takes a second tap: the first says "Tap again to clear" and keeps the queue, the second empties it',
            c1.clear === 'Tap again to clear' && c1q === 3 && c2q === 0 && c2.empty, { c1, c1q, c2, c2q });
        await enqueue(p, [KEY(7)]);
        await p.tap('#queueModal .queue-clear-btn'); await p.waitForTimeout(3400);
        const c3 = await queueLook(p);
        await p.tap('#queueModal .queue-clear-btn'); await p.waitForTimeout(250);
        const c3q = await p.evaluate(() => playQueue.length);
        check('I left alone, Clear says "Clear" again after 3 s (a tap then only arms it)', c3.clear === 'Clear' && c3q === 1, { c3, c3q });
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(400);
    });

    // ---- F with repeat one: a failed queued song isn't the song on repeat
    // (repeat one on its own stops at a song that can't play)
    await part('F repeat one', {}, async (p) => {
        await searchTab(p);
        await p.evaluate(() => { shuffleMode = 'off'; shuffleQueue = []; loopMode = 'single'; });
        await tapIn(p, '#mSearchResults [data-cloud="0"]'); await settle(p);
        await enqueue(p, [MISSING, KEY(2)]);
        await p.evaluate(() => { window.__toasts = []; });
        await end(p);
        const moved = await until(p, (k) => !!currentRadioSong && currentRadioSong.cloud_key === k && !isChangingSong, KEY(2), 10000);
        const f = await now(p);
        const ft = await p.evaluate(() => window.__toasts.slice());
        check('F with repeat one on: a queued song that can\'t play is skipped for the next queued one, not stopped at',
            moved && f.queued && f.queue.length === 0 && ft.some((x) => /“Missing” can't play: .*Skipping to the next song/.test(x)), { f, ft });
    });

    // ---- K. Desktop: the ⋯ there, Now Playing, and songs started inside 'ended'
    await part('K', { vp: { width: 1024, height: 768 }, phone: false }, async (p) => {
        await order(p);
        await p.evaluate(() => window.dvSearch && window.dvSearch.open()); await p.waitForTimeout(400);
        await p.waitForSelector('#mSearchResults [data-cloud="0"]', { timeout: 10000 }).catch(() => {});
        const dm = await p.evaluate(() => {
            const m = document.querySelector('#mSearchResults .m-sr-more[data-cloud-more="1"]');
            const box = m ? m.getBoundingClientRect() : null;
            return { dv2: document.documentElement.classList.contains('dv2'), w: box ? Math.round(box.width) : 0, h: box ? Math.round(box.height) : 0 };
        });
        await p.click('#mSearchResults [data-cloud-more="1"]'); await p.waitForTimeout(400);
        const dmenu = await sheetLook(p);
        check('K desktop: the Search page\'s Cloudflare rows have the ⋯ (36px); it opens a menu for that song with Play next, Add to queue, Add to Favorites',
            dm.dv2 && dm.w === 36 && dm.h === 36 && dmenu.open && !dmenu.sheet && dmenu.role === 'menu' && dmenu.label === 'Cloud 2: song options'
            && dmenu.items.join('|') === 'Play next|Add to queue|Add to Favorites', { dm, dmenu });
        await pick(p, 'Add to queue', 'click'); await p.waitForTimeout(400);
        await p.click('#mSearchResults [data-cloud="0"]'); await settle(p);
        await p.click('#dvBarDeck'); await p.waitForTimeout(900);
        const from = await p.evaluate(() => document.getElementById('dvNpFromName').textContent.trim());
        await p.click('#dvNpMore'); await p.waitForTimeout(250);
        const items = await p.evaluate(() => [...document.querySelectorAll('#dvNpMenu [role="menuitem"]')].map((x) => x.textContent.trim()));
        await p.click('#dvNpMenu [data-dv-np="next"]'); await p.waitForTimeout(300);
        const dq = await p.evaluate(() => playQueue.map((q) => q.title));
        check('K desktop Now Playing: "Playing from Cloudflare" for a Cloudflare song; its ⋯ adds Play next and Add to queue for the song playing',
            from === 'Cloudflare' && items.join('|') === 'Make a GIF|Show in playlist|Play next|Add to queue' && dq.join('|') === 'Cloud 1|Cloud 2', { from, items, dq });
        // The song playing ends with the tab hidden (in the background): a
        // desktop browser goes on playing there, so the crackle and the
        // record change still come first, as on a visible page. (The queued
        // song is the one playing, again: it is the one playing once the
        // change is done.)
        await p.evaluate(() => setCrackleEnabled(true));
        const k1 = await syncEnd(p, true);
        const k1late = await until(p, (k) => !!currentRadioSong && currentRadioSong._queued && currentRadioSong.cloud_key === k && !isChangingSong, KEY(1), 8000);
        check('K a hidden desktop tab (not iOS) keeps the crackle: it plays, then the record change, then the queued song',
            k1.crackled && k1.during === 0 && k1.seen[0] === 'timer' && k1late, { k1, k1late });
        const k2 = await syncEnd(p, false);
        const k2late = await until(p, (k) => !!currentRadioSong && currentRadioSong.cloud_key === k && !isChangingSong
            && mp3PlayerProxy._audio.src.includes(encodeURIComponent(k)), KEY(2), 8000);
        check('K a visible page (not iOS) as before: the crackle and the record animation first, then the song',
            k2.crackled && k2.during === 0 && k2.seen[0] === 'timer' && k2late, { k2, k2late });
        await p.evaluate(() => setCrackleEnabled(false));
    });

    // ---- K on iOS (an iPad, desktop size): songs started inside 'ended'
    await part('K iPad', { vp: { width: 1024, height: 768 }, phone: false, ua: IPAD }, async (p) => {
        await order(p);
        await p.evaluate(() => window.dvSearch && window.dvSearch.open()); await p.waitForTimeout(400);
        await p.waitForSelector('#mSearchResults [data-cloud="0"]', { timeout: 10000 }).catch(() => {});
        const ios = await p.evaluate(() => IS_IOS && document.documentElement.classList.contains('dv2'));
        await p.click('#mSearchResults [data-cloud="0"]'); await settle(p);
        await enqueue(p, [KEY(2)]);
        // The page hidden (a locked iPhone): the next song must start inside
        // the 'ended' event, before any timer, even with the crackle on and
        // the desktop's record animation
        await p.evaluate(() => setCrackleEnabled(true));
        const k1 = await syncEnd(p, true);
        await settle(p);
        const k1s = await now(p);
        check('K iPad hidden page: a song\'s end starts the queued song inside the event (play() before a 0 ms timer), crackle on, desktop animation',
            ios && k1.during >= 1 && k1.seen[0] === 'play' && k1s.cloud === KEY(2) && k1s.queued, { ios, k1, k1s });
        // A playlist's MP3 rows (as an upload is): its next row starts inside the event too
        const n = await p.evaluate((keys) => {
            const mk = (k, t) => ({ title: t, artist: 'Tester', album: '', cover: '', youtube_id: '', spotify_id: '', mp3_url: '/cloud-music/file?key=' + encodeURIComponent(k) });
            songsData.push(mk(keys[0], 'Upload A'), mk(keys[1], 'Upload B'));
            rebuildSongList();
            return songsData.length;
        }, [KEY(7), KEY(8)]);
        await p.evaluate((i) => switchSong(i), n - 2); await settle(p);
        const k3 = await syncEnd(p, true);
        await settle(p);
        const k3s = await now(p);
        check('K iPad ...and so does the playlist\'s next song (an MP3 row on the shared <audio>)',
            k3.during >= 1 && k3.seen[0] === 'play' && !k3s.radio && k3s.idx === n - 1 && k3s.title === 'Upload B', { k3, k3s });
        await p.evaluate(() => document.querySelector('#mSearchResults [data-cloud="2"]').click()); await settle(p);
        const k4 = await syncEnd(p, true);
        await settle(p);
        const k4s = await now(p);
        check('K iPad ...and the Cloudflare list\'s next song', k4.during >= 1 && k4.seen[0] === 'play' && k4s.cloud === KEY(4), { k4, k4s });
        await p.evaluate(() => setCrackleEnabled(false));
    });

    // ---- L. Cloudflare shuffle: a pass at a time
    await part('L', {}, async (p) => {
        await searchTab(p);
        await p.evaluate(() => {
            shuffleMode = 'shuffle';
            // Only which song comes next matters here: nothing loads
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); };
        });
        await tapIn(p, '#mSearchResults [data-cloud-all]'); await settle(p);
        const keys = await p.evaluate(() => {
            const out = [currentRadioSong && currentRadioSong.cloud_key];
            for (let k = 0; k < 14; k++) {
                cloudMusic.step(1, false);
                out.push(currentRadioSong && currentRadioSong.cloud_key);
            }
            return out;
        });
        const pass1 = keys.slice(0, 8);
        const pass2 = keys.slice(8);
        check('L Cloudflare shuffle plays every song once before any comes again (all 8, then the 7 others, with no repeat)',
            pass1.every(Boolean) && new Set(pass1).size === 8 && pass2.length === 7 && new Set(pass2).size === 7 && !pass2.includes(pass1[7]), keys);
    });

    // ---- M. The ⋯ on library and YouTube rows: phone, desktop, the library search window
    const box = (p, sel) => p.evaluate((x) => {
        const m = document.querySelector(x);
        if (!m) return null;
        const r = m.getBoundingClientRect();
        const row = m.closest('.m-sr-row, .search-result-line');
        const rr = row ? row.getBoundingClientRect() : r;
        return { w: Math.round(r.width), h: Math.round(r.height), l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom),
            inRow: r.left >= rr.left - 1 && r.right <= rr.right + 1 && r.top >= rr.top - 1 && r.bottom <= rr.bottom + 1,
            label: m.getAttribute('aria-label'), title: row ? (row.querySelector('.search-result-title') || {}).textContent : null };
    }, sel);
    await part('M', { source: 'library' }, async (p) => {
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        await p.fill('#mSearchInput', 'song 1');
        await p.waitForSelector('#mSearchResults [data-lib-more="0"]', { timeout: 8000 }).catch(() => {});
        await p.waitForSelector('#mSearchResults [data-yt-more="0"]', { timeout: 8000 }).catch(() => {});
        await p.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
        await p.waitForTimeout(300);
        const lib = await box(p, '#mSearchResults [data-lib-more="0"]');
        await tapIn(p, '#mSearchResults [data-lib-more="0"]'); await p.waitForTimeout(500);
        const ls = await sheetLook(p);
        check('M a library row of the Search page has a 44px ⋯: queue, like, add to a playlist, nothing by position',
            !!lib && lib.w >= 44 && lib.h >= 44 && lib.label === 'More options for ' + lib.title && ls.open && ls.title === lib.title
            && ls.items.length === 4 && ls.items[0] === 'Play next' && ls.items[1] === 'Add to queue' && /Favorites$/.test(ls.items[2]) && ls.items[3] === 'Add to playlist…' && !ls.remove, { lib, ls });
        await pick(p, 'Add to queue'); await p.waitForTimeout(500);
        const lq = await p.evaluate(() => playQueue.map((q) => ({ title: q.title, yt: q.youtube_id })));
        check('M its Add to queue queues the library song (with its YouTube id)', lq.length === 1 && !!lib && lq[0].title === lib.title && !!lq[0].yt, lq);
        const yt = await box(p, '#mSearchResults [data-yt-more="0"]');
        await tapIn(p, '#mSearchResults [data-yt-more="0"]'); await p.waitForTimeout(500);
        const ys = await sheetLook(p);
        check('M a YouTube row has a 44px ⋯ too: Play next, Add to queue, Add to Favorites, Add to playlist…',
            !!yt && yt.w >= 44 && yt.h >= 44 && yt.label === 'More options for Great Song' && ys.title === 'Great Song' && ys.items.join('|') === 'Play next|Add to queue|Add to Favorites|Add to playlist…', { yt, ys });
        await pick(p, 'Play next'); await p.waitForTimeout(500);
        const yq = await p.evaluate(() => playQueue.map((q) => ({ title: q.title, artist: q.artist, yt: q.youtube_id })));
        check('M its Play next puts the YouTube song first', !!yq[0] && yq[0].title === 'Great Song' && yq[0].artist === 'Band One' && yq[0].yt === 'aaaaaaaaaa1', yq);
        await tapIn(p, '#mSearchResults [data-yt-more="0"]'); await p.waitForTimeout(500);
        await pick(p, 'Add to playlist'); await p.waitForTimeout(900);
        const add = await p.evaluate(() => ({ open: document.getElementById('mAddToSheet').classList.contains('active'), song: (document.querySelector('#mAddToSheet .m-addto-song') || {}).textContent, menu: !!document.querySelector('.send-menu') }));
        check('M "Add to playlist…" opens the playlist picker for that YouTube song (the song sheet closed)', add.open && add.song === 'Great Song · Band One' && !add.menu, add);
    });
    await part('M desktop', { vp: { width: 1440, height: 900 }, phone: false, source: 'library' }, async (p) => {
        await p.evaluate(() => window.dvSearch.open()); await p.waitForTimeout(300);
        await p.fill('#mSearchInput', 'song 1');
        await p.waitForSelector('#mSearchResults [data-yt-more="0"]', { timeout: 8000 }).catch(() => {});
        const look = { lib: await box(p, '#mSearchResults [data-lib-more="0"]'), yt: await box(p, '#mSearchResults [data-yt-more="0"]'), add: await box(p, '#mSearchResults [data-add="0"]') };
        await p.click('#mSearchResults [data-lib-more="0"]'); await p.waitForTimeout(300);
        const dm = await sheetLook(p);
        await pick(p, 'Add to queue', 'click'); await p.waitForTimeout(300);
        await p.click('#mSearchResults [data-yt-more="0"]'); await p.waitForTimeout(300);
        await pick(p, 'Add to queue', 'click'); await p.waitForTimeout(300);
        const q = await p.evaluate(() => playQueue.map((x) => x.title));
        check('M desktop Search page: library and YouTube rows have a 36px ⋯ (on a YouTube card, under its +) opening a menu with the queue items',
            !!look.lib && look.lib.w === 36 && look.lib.inRow && !!look.yt && look.yt.w === 36 && look.yt.inRow && !!look.add && look.yt.t >= look.add.b
            && dm.role === 'menu' && dm.items[0] === 'Play next' && dm.items[1] === 'Add to queue' && q.length === 2 && q[1] === 'Great Song', { look, dm, q });
    });
    await part('M landscape', { vp: { width: 844, height: 390 }, source: 'library' }, async (p) => {
        await p.evaluate(() => showSearchModal()); await p.waitForTimeout(400);
        await p.fill('#librarySearchInput', 'song 1');
        await p.waitForSelector('#searchResults .m-sr-more', { timeout: 6000 }).catch(() => {});
        const m = await box(p, '#searchResults .m-sr-more');
        await p.tap('#searchResults .m-sr-more'); await p.waitForTimeout(400);
        const om = await sheetLook(p);
        await pick(p, 'Add to queue'); await p.waitForTimeout(400);
        const oq = await p.evaluate(() => playQueue.map((x) => x.title));
        check('M landscape: the library search window\'s hits have a 44px ⋯ that queues them',
            !!m && m.w >= 44 && m.h >= 44 && m.label === 'More options for ' + m.title && om.open && om.items[1] === 'Add to queue' && oq[0] === m.title, { m, om, oq });
    });

    // ---- N. A queue started on a page just opened: nothing had played, so
    // it notes no list to go back to
    await part('N', {}, async (p) => {
        await order(p);
        await enqueue(p, [KEY(3), KEY(5)]);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        const u0 = await queueLook(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(400);
        await p.evaluate(() => nextSong()); await settle(p);
        const n1 = await now(p);
        const n2 = await end(p);
        const n3 = await end(p);
        check('N a queue started on a page just opened notes no list; after it the last queued Cloudflare song\'s list goes on (Cloud 6, not the playlist)',
            n1.queued && n1.cloud === KEY(3) && n1.back === null && n2.queued && n2.cloud === KEY(5) && n3.cloud === KEY(6) && !n3.queued, { n1, n2, n3 });
        check('N ...and Up next says so before it starts: "Next from Cloudflare", from the song after the last queued one',
            u0.items.join('|') === 'Cloud 3|Cloud 5' && u0.nfLabel === 'Next from Cloudflare' && u0.nf[0] === 'Cloud 6', u0);
    });
    await part('N empty playlist', {}, async (p) => {
        await order(p);
        // The playing playlist has no songs (a new one, or all removed)
        await p.evaluate(() => { songsData.splice(0); rebuildSongList(); });
        await enqueue(p, [KEY(3), KEY(5)]);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        await tapIn(p, '#queueModal .queue-item[data-qindex="0"] .queue-item-play'); await settle(p);
        const e1 = await now(p);
        const u1 = await queueLook(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(400);
        const e2 = await end(p);
        await p.evaluate(() => nextSong()); await settle(p);
        const e3 = await now(p);
        check('N with the playing playlist empty: Play now in Up next, then Next on the last queued song goes on in the Cloudflare list (Cloud 6)',
            e1.queued && e1.cloud === KEY(3) && e1.back === null && e2.queued && e2.cloud === KEY(5) && e3.cloud === KEY(6) && !e3.queued, { e1, e2, e3 });
        check('N Up next during the first queued song: the second under it, then "Next from Cloudflare" from the song after that one',
            u1.now === 'Cloud 3' && u1.items.join('|') === 'Cloud 5' && u1.nfLabel === 'Next from Cloudflare' && u1.nf[0] === 'Cloud 6', u1);
    });

    // ---- O. The song playing ends while a queued song's record change is
    // still going (Next in its last moments): the change decides
    await part('O', {}, async (p) => {
        const titles = await p.evaluate(() => songsData.map((s) => s.title));
        await searchTab(p);
        await order(p);
        await tapIn(p, '#mSearchResults [data-cloud="1"]'); await settle(p);
        await enqueue(p, [3]);
        const changing = await p.evaluate(() => {
            nextSong();
            const was = isChangingSong;
            mp3PlayerProxy._audio.dispatchEvent(new Event('ended')); // Cloud 2's own end
            return was;
        });
        await settle(p);
        const o1 = await now(p);
        const o2 = await end(p);
        check('O a song\'s end during a queued song\'s record change starts nothing under it: the queued song plays, the list to go back to stays',
            changing && o1.queued && o1.title === titles[3] && o1.back === 'cloud', { changing, o1 });
        check('O ...then the Cloudflare list goes on after the song the queue interrupted (Cloud 3)', o2.cloud === KEY(3) && !o2.queued, o2);
    });

    // ---- P. "Next from Cloudflare" after a Cloudflare song played on its own
    await part('P', {}, async (p) => {
        await searchTab(p);
        await order(p);
        // A search narrows the list: Next walks its one hit
        await p.fill('#mSearchInput', 'cloud 1');
        await until(p, () => document.querySelectorAll('#mSearchResults [data-cloud]').length === 1);
        await tapIn(p, '#mSearchResults [data-cloud="0"]'); await settle(p);
        // Then one outside it plays on its own, as from Home's Jump back in
        await p.evaluate((k) => {
            recentSongs.unshift({ title: 'Cloud 5', artist: 'Tester', album: '', cover: '', youtube_id: '', spotify_id: '',
                mp3_url: '/cloud-music/file?key=' + encodeURIComponent(k), cloud_key: k });
            playRecentSong(0, { stay: true });
        }, KEY(5));
        await settle(p);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        const u = await queueLook(p);
        await tapIn(p, '#queueModal .dv-nf-row'); await settle(p);
        const p1 = await now(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(400);
        await p.evaluate(() => nextSong()); await settle(p);
        const p2 = await now(p);
        check('P after a Cloudflare song played on its own, "Next from Cloudflare" lists the songs after it in the whole list',
            u.nfLabel === 'Next from Cloudflare' && u.nf.join('|') === 'Cloud 6|Cloud 7|Cloud 8|Cloud 1|Cloud 2', u);
        check('P a row there plays when tapped (not only songs of the list played before), and Next goes on in the order shown',
            p1.cloud === KEY(6) && p2.cloud === KEY(7), { p1, p2 });
    });

    // ---- Q. The + on a queued song's row: the song whole, file and Spotify id
    await part('Q', {}, async (p) => {
        await order(p);
        const song = { title: 'Own Upload', artist: 'Tester', album: 'Demos', cover: '', youtube_id: '',
            mp3_url: '/cloud-music/file?key=' + encodeURIComponent(KEY(7)), spotify_id: '4uLU6hMCjMI75M1A2tKUQC' };
        await p.evaluate((s) => queueSong(s, false), song);
        await p.evaluate(() => nextSong()); await settle(p);
        const row = await p.evaluate(() => {
            const li = document.querySelector('#songList .radio-song-item');
            const btn = li ? li.querySelector('.song-save-btn') : null;
            if (btn) btn.click();
            return { btn: !!btn, title: li ? li.querySelector('.song-list-title').textContent : null };
        });
        await p.waitForTimeout(500);
        const add = p.__posts.filter((x) => x.action === 'add').pop();
        check('Q the + on a queued upload\'s row saves it with its file, Spotify id and album (not as a title-only copy)',
            row.btn && row.title === 'Own Upload' && !!add && !!add.song && add.song.mp3_url === song.mp3_url
            && add.song.spotify_id === song.spotify_id && add.song.album === 'Demos', { row, add });
    });

    // ---- R. A noted list counts for its own queue only. Repeat off: the
    // playlist's last row, one song queued after it. The queue goes back to
    // the playlist, which has played through, so the music stops there.
    // Then a Cloudflare song from Jump back in, and another song queued.
    await part('R', {}, async (p) => {
        await order(p);
        await p.evaluate(() => { loopMode = 'off'; });
        await p.evaluate(() => playListRow(songsData.length - 1)); await settle(p);
        await enqueue(p, [KEY(3)]);
        const r1 = await end(p);
        const r2 = await end(p);
        await p.evaluate((k) => {
            recentSongs.unshift({ title: 'Cloud 6', artist: 'Tester', album: '', cover: '', youtube_id: '', spotify_id: '',
                mp3_url: '/cloud-music/file?key=' + encodeURIComponent(k), cloud_key: k });
            playRecentSong(0, { stay: true });
        }, KEY(6));
        await settle(p);
        const r3 = await now(p);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        const u = await queueLook(p);
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(400);
        await enqueue(p, [KEY(2)]);
        const r4 = await end(p);
        const r5 = await end(p);
        check('R (setup) the first queue goes back to the playlist, which has played through: the music stops after it',
            r1.queued && r1.cloud === KEY(3) && r1.back === 'playlist' && r2.queued && r2.cloud === KEY(3), { r1, r2 });
        check('R then a Cloudflare song from Jump back in: Up next says "Next from Cloudflare", the songs after it (repeat off: to the end)',
            r3.cloud === KEY(6) && !r3.queued && u.nfLabel === 'Next from Cloudflare' && u.nf.join('|') === 'Cloud 7|Cloud 8', { r3, u });
        check('R ...and a song queued then notes the Cloudflare list: after it, the song after Cloud 6 plays (not the playlist, nor a stop)',
            r4.queued && r4.cloud === KEY(2) && r4.back === 'cloud' && r5.cloud === KEY(7) && !r5.queued, { r4, r5 });
    });
}

(async () => {
    const taken = { worker: await listening('127.0.0.1', 8787), app: await listening(HOST, 8125) };
    check('setup: nothing else listens on 8787 or 8125 (else stop it: lsof -nP -iTCP:8787 -iTCP:8125 -sTCP:LISTEN)', !taken.worker && !taken.app, taken);
    if (!taken.worker && !taken.app) {
        const worker = serve('worker', ['-S', '127.0.0.1:8787', path.join(L.ROOT, 'fixtures', 'cloud-worker.php')], path.join(L.ROOT, 'fixtures'),
            { CLOUD_MUSIC_TOKEN: TOKEN, PHP_CLI_SERVER_WORKERS: '4' });
        // Laravel's server.php serves from the working directory: public/.
        // Its cache lives in each request's memory: in the database, the
        // rate limits' counters (written on every song file asked for) had
        // its four workers writing the shared SQLite file at once, and one
        // that found it locked failed its request (that song "can't play").
        const app = serve('app', ['-S', `${HOST}:8125`, '../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php'], path.join(REPO, 'public'),
            { CLOUD_MUSIC_URL: WORKER, CLOUD_MUSIC_TOKEN: TOKEN, APP_URL: APP.slice(0, -1), PHP_CLI_SERVER_WORKERS: '4', CACHE_STORE: 'array' });
        const servers = { worker: await up(`${WORKER}/list?t=${TOKEN}`), app: await up(APP + 'up') };
        // (a server that couldn't take its port has already exited)
        servers.running = running(worker) && running(app);
        check('setup: the stand-in Worker and the app with the Cloudflare source came up', servers.worker && servers.app && servers.running, servers);
        if (servers.worker && servers.app && servers.running) {
            const b = await L.launch();
            try {
                await run(b);
            } finally {
                await b.close();
            }
        }
    }
    stopServers();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 1500)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); stopServers(); process.exit(1); });
