// Step 7: Now Playing tools row (like · sleep · up next · volume on demand).
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(acct = 'many', opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, userAgent: opts.ua, storageState: L.state(acct) });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (opts.fail && opts.fail.includes(body.action)) return route.abort();
            if (body.action === 'favorite') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, favorited: true, key: 'k-' + p.__posts.length }) });
            if (['recordPlay', 'switch'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        return { ctx, p };
    }
    const vis = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
    const look = (p) => p.evaluate(() => ({ layer: history.state && history.state.mLayer, modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id), np: document.body.classList.contains('m-np-open') }));
    const toast = (p) => p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);

    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { queueAdd(1); queueAdd(2); });
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        const ui = { tools: await vis(p, '#mNpTools'), vol: await vis(p, '#mVolume'), n: await p.evaluate(() => [...document.querySelectorAll('#mNpTools button')].filter(b => getComputedStyle(b).display !== 'none').length), badge: await p.evaluate(() => document.getElementById('mNpQueueCount').textContent) };
        check('N1 the tools row shows; the volume slider waits for its button', ui.tools && !ui.vol && ui.n === 4 && ui.badge === '2', ui);
        // volume on demand
        await p.tap('#mNpVolume'); await p.waitForTimeout(300);
        const v1 = { vol: await vis(p, '#mVolume'), exp: await p.evaluate(() => document.getElementById('mNpVolume').getAttribute('aria-expanded')) };
        await p.waitForTimeout(5400);
        const v2 = await vis(p, '#mVolume');
        check('V1 🔊 opens the slider, which tucks away after a few seconds', v1.vol && v1.exp === 'true' && !v2, { v1, v2 });
        // ♥ in Favorites: liked, and it says how to unlike
        const l0 = await p.evaluate(() => ({ on: document.getElementById('mNpLike').classList.contains('is-on'), label: document.getElementById('mNpLike').getAttribute('aria-label'), pressed: document.getElementById('mNpLike').getAttribute('aria-pressed'), locked: document.getElementById('mNpLike').getAttribute('aria-disabled') }));
        await p.tap('#mNpLike', { force: true }); await p.waitForTimeout(400);
        const t0 = await toast(p);
        check('H1 in Favorites the ♥ is filled (pressed, locked) and explains removal', l0.on && l0.label === 'Favorite' && l0.pressed === 'true' && l0.locked === 'true' && t0 && t0.includes('song menu') && !p.__posts.some(x => x.action === 'favorite'), { l0, t0 });
        // toasts drop from the top while Now Playing is open
        const tt = await p.evaluate(() => { const t = document.querySelector('.m-toast'); return t ? t.getBoundingClientRect().top : null; });
        check('T1 toasts sit near the top over Now Playing, below its header', tt !== null && tt >= 72 && tt < 140, tt);
        // sleep timer
        await p.tap('#mNpSleep'); await p.waitForTimeout(450);
        let s = await look(p);
        const off0 = await p.evaluate(() => document.getElementById('mSleepOff').hidden);
        check('S1 sleep opens its sheet (a back step); no "Turn off" while off', s.modals.includes('mSleepSheet') && s.layer === 'modal:sleep' && off0, { s, off0 });
        await p.tap('.m-sleep-opt[data-m-sleep="30"]'); await p.waitForTimeout(700);
        s = await look(p);
        const lbl = await p.evaluate(() => ({ text: document.getElementById('mNpSleepLabel').textContent, on: document.getElementById('mNpSleep').classList.contains('is-on'), deadline: sleepDeadline > Date.now() }));
        check('S2 picking 30 minutes sets the timer and labels the button', !s.modals.length && s.layer === 'np' && lbl.text === '30m' && lbl.on && lbl.deadline, { s, lbl });
        await p.tap('#mNpSleep'); await p.waitForTimeout(450);
        const off1 = await p.evaluate(() => ({ hidden: document.getElementById('mSleepOff').hidden, status: document.getElementById('mSleepStatus').textContent }));
        await p.tap('#mSleepOff'); await p.waitForTimeout(700);
        const lbl2 = await p.evaluate(() => ({ text: document.getElementById('mNpSleepLabel').textContent, on: document.getElementById('mNpSleep').classList.contains('is-on'), deadline: sleepDeadline }));
        check('S3 "Turn off" shows while it runs and switches it off', !off1.hidden && off1.status.includes('30 min') && lbl2.text === '' && !lbl2.on && lbl2.deadline === 0, { off1, lbl2 });
        await p.tap('#mNpSleep'); await p.waitForTimeout(450);
        await p.tap('.m-sleep-opt[data-m-sleep="end"]'); await p.waitForTimeout(600);
        const endL = await p.evaluate(() => document.getElementById('mNpSleepLabel').textContent);
        check('S4 End of this song labels "End"', endL === 'End', endL);
        await p.evaluate(() => setSleepTimer(0));
        // up next
        await p.tap('#mNpQueue'); await p.waitForTimeout(500);
        s = await look(p);
        check('Q1 Up next opens the queue', s.modals.includes('queueModal') && s.layer === 'modal:queue', s);
        await p.evaluate(() => history.back()); await p.waitForTimeout(500);
        await p.evaluate(() => clearQueue());
        check('N errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // ♥ outside Favorites: likes, and a failure says so
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { activePlaylistId = 'pl-1'; favoriteKeys.delete(songPlayKey(songsData[currentSongIndex])); });
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        await p.evaluate(() => setNowPlayingText(songsData[currentSongIndex].title, songsData[currentSongIndex].artist, ''));
        const before = await p.evaluate(() => document.getElementById('mNpLike').classList.contains('is-on'));
        await p.tap('#mNpLike'); await p.waitForTimeout(700);
        const after = await p.evaluate(() => document.getElementById('mNpLike').classList.contains('is-on'));
        const t = await toast(p);
        check('H2 outside Favorites the ♥ likes the song', !before && after && t === 'Added to Favorites' && p.__posts.filter(x => x.action === 'favorite').length === 1, { before, after, t });
        await p.evaluate(() => { activePlaylistId = 'favorites'; });
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { fail: ['favorite'] });
        await p.evaluate(() => { currentRadioSong = Object.assign({}, recentSongs[0], { youtube_id: 'radioXYZ1234' }); });
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        await p.evaluate(() => setNowPlayingText('x', 'y', ''));
        const before = await p.evaluate(() => document.getElementById('mNpLike').classList.contains('is-on'));
        await p.tap('#mNpLike'); await p.waitForTimeout(700);
        const after = await p.evaluate(() => document.getElementById('mNpLike').classList.contains('is-on'));
        const t = await toast(p);
        const sent = p.__posts.filter(x => x.action === 'favorite').map(x => x.song && x.song.youtube_id);
        check('H3 a radio song can be liked; a failed save rolls back and says so', !before && !after && t && t.startsWith('Couldn') && sent[0] === 'radioXYZ1234', { before, after, t, sent });
        await p.evaluate(() => { currentRadioSong = null; });
        await ctx.close();
    }
    // iPhone: no volume button; landscape/desktop: no tools row
    {
        const { ctx, p } = await open('many', { ua: IOS });
        await p.tap('#mDockInfo'); await p.waitForTimeout(800);
        const r = { vol: await vis(p, '#mNpVolume'), tools: await vis(p, '#mNpTools') };
        check('I1 iPhone: the row shows without 🔊', r.tools && !r.vol, r);
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { viewport: { width: 844, height: 390 } });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(500);
        const r = { tools: await vis(p, '#mNpTools') };
        check('O1 landscape: no tools row', !r.tools, r);
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(500);
        const r = { tools: await vis(p, '#mNpTools'), sleepCoaster: await vis(p, '#sleepBtn') };
        check('O2 desktop: no tools row, sleep coaster unchanged', !r.tools && r.sleepCoaster, r);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
