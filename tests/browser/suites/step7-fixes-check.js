// Regression checks for the step 7 review findings.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(acct = 'many', opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state(acct) });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (opts.slow && opts.slow.includes(body.action)) await new Promise(r => setTimeout(r, opts.slowMs || 2000));
            if (body.action === 'favorite') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, favorited: !opts.unfav, key: 'k' }) });
            if (['recordPlay', 'switch'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        await p.goto(APP); await p.waitForTimeout(1200);
        return { ctx, p };
    }
    const like = (p) => p.evaluate(() => ({ on: document.getElementById('mNpLike').classList.contains('is-on'), title: document.querySelector('.sleeve-mobile-nowplaying .song-title, #mDock .song-title').textContent }));

    // ♥ follows the song on screen, also mid-switch
    {
        const { ctx, p } = await open('many', { slow: ['switch'], slowMs: 2000 });
        await p.evaluate(() => {
            activePlaylistId = 'pl-1';
            currentSongIndex = 0;
            shuffleMode = 'off'; shuffleQueue = []; loopMode = 'playlist';
            favoriteKeys.add(songPlayKey(songsData[0]));
            favoriteKeys.delete(songPlayKey(songsData[1]));
        });
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        await p.evaluate(() => { window.YT = window.YT || { PlayerState: { PLAYING: 1 } }; window.ytPlayer = window.ytPlayerReal = { loadVideoById() {}, cueVideoById() {}, playVideo() {}, pauseVideo() {}, seekTo() {}, setVolume() {}, getPlayerState() { return 1; }, getCurrentTime() { return 0; }, getDuration() { return 200; } }; ytPlayerReady = true; });
        await p.evaluate(() => switchSong(0).catch(() => {})); await p.waitForTimeout(300);
        await p.evaluate(() => { songsData[0] && updateSongDisplay(songsData[0]); });
        await p.waitForTimeout(2300);
        const a = await like(p);
        await p.tap('#mNextBtn'); await p.waitForTimeout(400);  // the switch save is still in flight
        const mid = await like(p);
        await p.tap('#mNpLike'); await p.waitForTimeout(500);
        const posted = p.__posts.filter(x => x.action === 'favorite').map(x => x.song.title);
        check('L1 during and after a track change the ♥ follows the song shown', a.on && !mid.on && mid.title.includes('2') && posted[0] === mid.title, { a, mid, posted });
        await p.waitForTimeout(2200);
        await p.evaluate(() => { activePlaylistId = 'favorites'; });
        await ctx.close();
    }
    // Favorites: a listed song played as a one-off stays locked; double taps send one request
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { currentRadioSong = Object.assign({}, songsData[2]); });
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        await p.evaluate(() => setNowPlayingText(currentRadioSong.title, currentRadioSong.artist, ''));
        await p.tap('#mNpLike', { force: true }); await p.waitForTimeout(400);
        const f = await p.evaluate(() => ({ locked: document.getElementById('mNpLike').getAttribute('aria-disabled'), n: songsData.length }));
        check('F1 in Favorites a listed song played as a one-off can\'t be unliked from ♥', f.locked === 'true' && !p.__posts.some(x => x.action === 'favorite'), f);
        // a radio pick that's not in Favorites: liking it adds it to the list too
        const n0 = await p.evaluate(() => songsData.length);
        await p.evaluate(() => { currentRadioSong = { title: 'Radio pick', artist: 'Someone', youtube_id: 'radioABC1234', cover: '' }; setNowPlayingText('Radio pick', 'Someone', ''); });
        await p.tap('#mNpLike', { force: true }); await p.tap('#mNpLike', { force: true }); await p.waitForTimeout(700);
        const r = await p.evaluate(() => ({ n: songsData.length, last: songsData[songsData.length - 1].title }));
        const favs = p.__posts.filter(x => x.action === 'favorite').length;
        check('F2 liking a radio pick in Favorites lists it; a double tap sends one request', r.n === n0 + 1 && r.last === 'Radio pick' && favs === 1, { r, n0, favs });
        await p.evaluate(() => { currentRadioSong = null; });
        await ctx.close();
    }
    // sleep sheet follows the timer while open
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => setSleepTimer(30));
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        await p.tap('#mNpSleep'); await p.waitForTimeout(400);
        const a = await p.evaluate(() => ({ off: document.getElementById('mSleepOff').hidden, st: document.getElementById('mSleepStatus').textContent }));
        await p.evaluate(() => clearSleepTimer());
        await p.waitForTimeout(200);
        const bb = await p.evaluate(() => ({ off: document.getElementById('mSleepOff').hidden, st: document.getElementById('mSleepStatus').textContent }));
        check('S1 the open sleep sheet follows the timer', !a.off && a.st.includes('30') && bb.off && !bb.st.includes('min'), { a, bb });
        await ctx.close();
    }
    // volume: stays under a finger / focus, second tap closes, reopen is clean
    {
        const { ctx, p } = await open('many');
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        const vb = await (await p.$('#mNpVolume')).boundingBox();
        await p.tap('#mNpVolume'); await p.waitForTimeout(300);
        const vb2 = await (await p.$('#mNpVolume')).boundingBox();
        const vol0 = await p.evaluate(() => currentVolume);
        await p.touchscreen.tap(vb.x + vb.width / 2, vb.y + vb.height / 2); await p.waitForTimeout(300);
        const r1 = await p.evaluate(() => ({ open: document.body.classList.contains('m-vol-open'), vol: currentVolume }));
        check('V1 🔊 stays put; a second tap there closes the slider, volume untouched', Math.abs(vb2.y - vb.y) < 2 && !r1.open && r1.vol === vol0, { vb, vb2, r1, vol0 });
        await p.tap('#mNpVolume'); await p.waitForTimeout(300);
        await p.focus('#mVolumeRange'); await p.waitForTimeout(5600);
        const r2 = await p.evaluate(() => ({ open: document.body.classList.contains('m-vol-open'), focus: document.activeElement.id }));
        check('V2 the slider stays while it has focus', r2.open && r2.focus === 'mVolumeRange', r2);
        await p.evaluate(() => document.activeElement.blur());
        await p.evaluate(() => history.back()); await p.waitForTimeout(600);
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        const r3 = await p.evaluate(() => ({ open: document.body.classList.contains('m-vol-open'), exp: document.getElementById('mNpVolume').getAttribute('aria-expanded') }));
        check('V3 reopening Now Playing starts with the slider closed', !r3.open && r3.exp === 'false', r3);
        // toast doesn't block the chevron
        await p.evaluate(() => mToast('A message to read here'));
        const hit = await p.evaluate(() => { const r = document.getElementById('mNpCollapse').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el && (el.id === 'mNpCollapse' || !!el.closest('#mNpCollapse')); });
        check('T1 a toast never covers Now Playing\'s close chevron', hit, hit);
        check('V errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // short phone: the expand-lyrics button stays reachable
    for (const vp of [{ width: 360, height: 640 }, { width: 375, height: 667 }]) {
        const { ctx, p } = await open('many', { viewport: vp });
        await p.tap('#mDockInfo'); await p.waitForTimeout(900);
        const r = await p.evaluate(() => { const b = document.getElementById('mLyricsExpand').getBoundingClientRect(); const el = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); const disc = document.querySelector('.record-player').getBoundingClientRect(); const head = document.getElementById('mNpHeader').getBoundingClientRect(); return { hit: !!el && (el.id === 'mLyricsExpand' || !!el.closest('#mLyricsExpand')), discTop: disc.top, headBottom: head.bottom }; });
        check(`P1 ${vp.width}x${vp.height}: the lyrics expand button is visible; the record clears the header`, r.hit && r.discTop >= r.headBottom - 2, r);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
