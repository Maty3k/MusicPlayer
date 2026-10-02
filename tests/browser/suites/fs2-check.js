// Full-screen switches on the phone You page: "Open in full screen" and "Button on Home".
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state(opts.acct || 'demo') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'stats') return route.fulfill({ contentType: 'application/json', body: '{"success":true,"stats":{"totalPlays":0,"distinctSongs":0,"distinctArtists":0,"topSongs":[],"topArtists":[]}}' });
            return route.continue();
        });
        if (opts.prefs) {
            await p.addInitScript((prefs) => { try { if (sessionStorage.getItem('__prefsSet')) return; sessionStorage.setItem('__prefsSet', '1'); Object.entries(prefs).forEach(([k, v]) => { if (v) localStorage.setItem(k, '1'); else localStorage.removeItem(k); }); } catch (e) {} }, opts.prefs);
        }
        if (opts.standalone) {
            await p.addInitScript(() => {
                const real = window.matchMedia.bind(window);
                window.matchMedia = (q) => {
                    if (/display-mode:\s*(browser|standalone)/.test(q)) {
                        const m = /standalone/.test(q);
                        return { matches: m, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
                    }
                    return real(q);
                };
            });
        }
        await p.goto(APP); await p.waitForTimeout(1300);
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => {
        const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
        return {
            layer: history.state && history.state.mLayer || null,
            fs: document.fullscreenElement === document.documentElement,
            you: document.documentElement.classList.contains('m-you'),
            auto: vis('mYouFsAuto'), autoOn: document.getElementById('mYouFsAuto').getAttribute('aria-checked'),
            btnRow: vis('mYouFsButton'), btnOn: document.getElementById('mYouFsButton').getAttribute('aria-checked'),
            homeBtn: vis('mFsBtn'), homeLabel: document.getElementById('mFsBtn').getAttribute('aria-label'),
            ls: { auto: localStorage.getItem('mFullscreenAuto'), btn: localStorage.getItem('mFullscreenButton') },
        };
    });
    const toYouBottom = async (p) => {
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(200);
    };
    const bounce = (p) => p.evaluate(() => {
        // The page goes away (app switch) and comes back
        const set = (v) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        set('hidden'); document.dispatchEvent(new Event('visibilitychange'));
        set('visible'); document.dispatchEvent(new Event('visibilitychange'));
    });

    // 1. The switches and the Home button
    {
        const { ctx, p } = await open({ prefs: { mFullscreenAuto: false, mFullscreenButton: false } });
        let s = await look(p);
        check('S1 Home has no full-screen button by default', !s.homeBtn, s);
        await toYouBottom(p);
        s = await look(p);
        const order = await p.evaluate(() => ['mYouFullscreen', 'mYouFsAuto', 'mYouFsButton', 'mYouInstall'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().top)));
        check('S2 two switches, off, under Full screen and above Install', s.auto && s.btnRow && s.autoOn === 'false' && s.btnOn === 'false' && order[0] < order[1] && order[1] < order[2] && order[2] < order[3], { s, order });
        await p.tap('#mYouFsButton'); await p.waitForTimeout(400);
        s = await look(p);
        check('S3 Button on Home switches on, is kept, and does not go full screen by itself', s.btnOn === 'true' && s.ls.btn === '1' && !s.fs && s.you, s);
        await p.goBack(); await p.waitForTimeout(700);
        s = await look(p);
        const geo = await p.evaluate(() => {
            const r = (id) => document.getElementById(id).getBoundingClientRect();
            const head = document.getElementById('mHomeHead');
            return { title: r('mGreeting').right, btnL: r('mFsBtn').left, btnR: r('mFsBtn').right, avL: r('mAvatarBtn').left, w: r('mFsBtn').width, h: r('mFsBtn').height, over: head.scrollWidth - head.clientWidth };
        });
        check('S4 the Home button sits next to the avatar, 44px, no overflow', s.homeBtn && geo.btnR <= geo.avL + 1 && geo.btnL >= geo.title && geo.w >= 44 && geo.h >= 44 && geo.over <= 0, { s, geo });
        await p.tap('#mFsBtn'); await p.waitForTimeout(700);
        s = await look(p);
        const icons = await p.evaluate(() => [...document.querySelectorAll('#mFsBtn svg')].map(x => getComputedStyle(x).display));
        check('S5 the Home button goes full screen and turns into Exit', s.fs && s.homeLabel === 'Exit full screen' && icons[0] === 'none' && icons[1] !== 'none' && s.layer === null, { s, icons });
        await p.tap('#mFsBtn'); await p.waitForTimeout(700);
        s = await look(p);
        check('S6 ...and back out', !s.fs && s.homeLabel === 'Full screen', s);
        check('S7 no page errors (button)', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // 2. Open in full screen
    {
        const { ctx, p } = await open({ prefs: { mFullscreenAuto: false, mFullscreenButton: false } });
        await toYouBottom(p);
        await p.tap('#mYouFsAuto'); await p.waitForTimeout(800);
        let s = await look(p);
        const toast = await p.evaluate(() => [...document.querySelectorAll('.m-toast, #mToast, [class*="toast"]')].map(t => t.textContent.trim()).filter(Boolean).join(' | '));
        check('A1 turning it on arms it (no full screen over You) and says so', s.autoOn === 'true' && s.ls.auto === '1' && !s.fs && s.you && /next tap/.test(toast), { s, toast });
        await p.tap('#mYouBack'); await p.waitForTimeout(800);
        s = await look(p);
        check('A1b the next tap (You\'s back arrow) lands on Home in full screen', s.fs && !s.you && s.layer === null, s);
        await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await p.waitForTimeout(500);
        await p.tap('#mGreeting'); await p.waitForTimeout(600);
        s = await look(p);
        check('A2 after leaving full screen, taps leave it left (until the app comes back)', !s.fs, s);
        await bounce(p);
        await p.tap('#mGreeting'); await p.waitForTimeout(700);
        s = await look(p);
        check('A3 back from another app, the first tap goes full screen again', s.fs, s);
        await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await p.waitForTimeout(500);
        // Reload: armed again; the first tap both opens a playlist and goes full screen
        await p.reload(); await p.waitForTimeout(1300);
        s = await look(p);
        check('A4 nothing happens before a tap', !s.fs, s);
        const tile = await p.$('.m-rp-tile');
        if (tile) {
            await tile.tap(); await p.waitForTimeout(1200);
            s = await look(p);
            check('A5 the first tap does its own job and goes full screen', s.fs && s.layer === 'playlist', s);
        } else {
            await p.tap('#mGreeting'); await p.waitForTimeout(700);
            s = await look(p);
            check('A5 the first tap goes full screen', s.fs, s);
        }
        check('A6 no page errors (auto)', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // 2b. Entering with the Home button spends the arming too
    {
        const { ctx, p } = await open({ prefs: { mFullscreenAuto: true, mFullscreenButton: true } });
        await p.tap('#mFsBtn'); await p.waitForTimeout(700);
        let s = await look(p);
        const inBtn = s.fs;
        await p.tap('#mFsBtn'); await p.waitForTimeout(700);
        s = await look(p);
        const outBtn = !s.fs;
        await p.tap('#mGreeting'); await p.waitForTimeout(700);
        s = await look(p);
        check('R1 Home button in, Exit, then a tap: stays out', inBtn && outBtn && !s.fs, { inBtn, outBtn, s });
        await ctx.close();
    }
    // 2c. A control that stops the click still counts as the first tap
    {
        const { ctx, p } = await open({ acct: 'many', prefs: { mFullscreenAuto: true, mFullscreenButton: false } });
        await p.tap('.m-rp-tile'); await p.waitForTimeout(1300);
        let s = await look(p);
        const first = s.fs && s.layer === 'playlist';
        await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await p.waitForTimeout(500);
        await bounce(p);
        const stops = await p.evaluate(() => { const b = document.querySelector('#songList .song-list-item .song-send-btn'); return b ? (b.getAttribute('onclick') || '') : null; });
        await p.tap('#songList .song-list-item:first-child .song-send-btn'); await p.waitForTimeout(800);
        s = await look(p);
        check('R2 a tile tap goes full screen; after coming back a song\'s ⋯ (which stops the click) does too', first && s.fs, { first, s, stops });
        check('R2b no page errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // 2d. Desktop width: the switch can't be seen there, so it does nothing
    {
        const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, storageState: L.state('demo') });
        const p = await ctx.newPage();
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.addInitScript(() => { try { localStorage.setItem('mFullscreenAuto', '1'); } catch (e) {} });
        await p.goto(APP); await p.waitForTimeout(1300);
        await p.mouse.click(700, 120); await p.waitForTimeout(600);
        const fs = await p.evaluate(() => !!document.fullscreenElement);
        check('R3 desktop width: no full screen on a click', !fs, { fs });
        await ctx.close();
    }
    // 3. Turning it off
    {
        const { ctx, p } = await open({ prefs: { mFullscreenAuto: true, mFullscreenButton: false } });
        await toYouBottom(p);
        let s = await look(p);
        // That tap on the avatar already went full screen (armed on load)
        check('O1 armed on load: the avatar tap went full screen', s.fs && s.autoOn === 'true', s);
        await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await p.waitForTimeout(500);
        await p.tap('#mYouFsAuto'); await p.waitForTimeout(500);
        s = await look(p);
        check('O2 switching it off does not go full screen and forgets it', !s.fs && s.autoOn === 'false' && s.ls.auto === null, s);
        await bounce(p);
        await p.tap('#mYouBack'); await p.waitForTimeout(600);
        await p.tap('#mGreeting'); await p.waitForTimeout(600);
        s = await look(p);
        check('O3 off: taps after coming back stay out of full screen', !s.fs, s);
        await ctx.close();
    }
    // 4. Keyboard: the switches are switches
    {
        const { ctx, p } = await open({ prefs: { mFullscreenAuto: false, mFullscreenButton: false } });
        await toYouBottom(p);
        await p.focus('#mYouFsButton'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        let s = await look(p);
        const role = await p.evaluate(() => document.getElementById('mYouFsButton').getAttribute('role'));
        check('K1 Enter flips a switch (role=switch, aria-checked)', role === 'switch' && s.btnOn === 'true', { role, s });
        await p.keyboard.press('Space'); await p.waitForTimeout(300);
        s = await look(p);
        check('K2 Space flips it back', s.btnOn === 'false' && !s.fs, s);
        await ctx.close();
    }
    // 5. Installed app: none of it
    {
        const { ctx, p } = await open({ standalone: true, prefs: { mFullscreenAuto: true, mFullscreenButton: true } });
        let s = await look(p);
        await p.tap('#mGreeting'); await p.waitForTimeout(600);
        const s2 = await look(p);
        check('I1 installed app: no Home button and no full screen on a tap', !s.homeBtn && !s2.fs, { s, s2 });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        s = await look(p);
        check('I2 installed app: no switches', !s.auto && !s.btnRow, s);
        await ctx.close();
    }
    // 6. Small phone: header still fits with the button
    {
        const { ctx, p } = await open({ viewport: { width: 360, height: 740 }, prefs: { mFullscreenButton: true } });
        const geo = await p.evaluate(() => {
            const head = document.getElementById('mHomeHead');
            const t = document.getElementById('mGreeting').getBoundingClientRect();
            const bt = document.getElementById('mFsBtn').getBoundingClientRect();
            return { over: head.scrollWidth - head.clientWidth, titleR: t.right, btnL: bt.left, text: document.getElementById('mGreeting').textContent };
        });
        check('P1 360px: greeting and both buttons fit', geo.over <= 0 && geo.titleR <= geo.btnL + 1, geo);
        await p.screenshot({ path: L.shot('shots', 'fs2-home-360.png') });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(200);
        await p.tap('#mYouFsAuto'); await p.waitForTimeout(600);
        await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await p.waitForTimeout(500);
        await p.screenshot({ path: L.shot('shots', 'fs2-you-360.png') });
        await ctx.close();
    }

    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
