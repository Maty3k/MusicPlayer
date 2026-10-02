// Full screen + Install rows on the phone You page (browser tab only).
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: opts.ua, storageState: L.state(opts.acct || 'demo') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'stats') return route.fulfill({ contentType: 'application/json', body: '{"success":true,"stats":{"totalPlays":0,"distinctSongs":0,"distinctArtists":0,"topSongs":[],"topArtists":[]}}' });
            return route.continue();
        });
        if (opts.standalone) {
            // Chrome can't emulate display-mode: answer the two queries as an installed app would
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
    const look = (p) => p.evaluate(() => ({
        layer: history.state && history.state.mLayer || null,
        depth: history.state && history.state.mDepth || 0,
        fs: document.fullscreenElement === document.documentElement,
        mfs: document.documentElement.classList.contains('m-fs'),
        you: document.documentElement.classList.contains('m-you'),
        group: !document.getElementById('mYouDevice').hidden,
        fsRow: !document.getElementById('mYouFullscreen').hidden,
        fsLabel: document.querySelector('#mYouFullscreen b').textContent,
        installRow: !document.getElementById('mYouInstall').hidden,
        modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
        active: document.activeElement && document.activeElement.id,
    }));

    {
        const { ctx, p } = await open();
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        let s = await look(p);
        const rowsVis = await p.evaluate(() => ['mYouFullscreen', 'mYouInstall'].map(id => getComputedStyle(document.getElementById(id)).display));
        check('F1 in a browser tab the You page offers Full screen and Install', s.group && s.fsRow && s.installRow && rowsVis.every(d => d !== 'none') && s.fsLabel === 'Full screen', { s, rowsVis });
        await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(200);
        await p.tap('#mYouFullscreen'); await p.waitForTimeout(900);
        s = await look(p);
        check('F2 Full screen takes the whole document and lands on Home', s.fs && s.mfs && s.depth === 0 && !s.you, s);
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        s = await look(p);
        check('F3 the row now reads Exit full screen', s.fsLabel === 'Exit full screen' && s.fs, s);
        await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(200);
        await p.tap('#mYouFullscreen'); await p.waitForTimeout(900);
        s = await look(p);
        check('F4 Exit full screen leaves it (the page stays open)', !s.fs && !s.mfs && s.fsLabel === 'Full screen' && s.you && s.layer === 'you', s);
        // layers still in step inside full screen: open/close Now Playing and a playlist
        await p.tap('#mYouFullscreen'); await p.waitForTimeout(900);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(800);
        s = await look(p);
        const npOk = s.layer === 'np' && s.fs;
        await p.evaluate(() => history.back()); await p.waitForTimeout(800);
        s = await look(p);
        check('F5 history layers still work inside full screen (and do not end it)', npOk && s.depth === 0 && s.fs, s);
        await p.evaluate(() => document.exitFullscreen()); await p.waitForTimeout(400);
        // install without a browser prompt: the how-to sheet
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(200);
        await p.tap('#mYouInstall'); await p.waitForTimeout(600);
        s = await look(p);
        const steps = await p.evaluate(() => ({ android: !document.getElementById('mInstallSteps').hidden, ios: !document.getElementById('mInstallStepsIos').hidden }));
        check('F6 Install with no browser prompt shows how (a back step over the page)', s.modals.includes('mInstallSheet') && s.layer === 'modal:installHelp' && s.depth === 2 && steps.android && !steps.ios, { s, steps });
        await p.tap('#mInstallSheet .add-song-modal-close'); await p.waitForTimeout(700);
        s = await look(p);
        check('F6 closing it returns to the page, focus on the Install row', s.layer === 'you' && s.modals.length === 0 && s.active === 'mYouInstall', s);
        // install with a browser prompt
        await p.evaluate(() => {
            const e = new Event('beforeinstallprompt', { cancelable: true });
            e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
            e.userChoice = Promise.resolve({ outcome: 'accepted' });
            window.dispatchEvent(e);
        });
        await p.tap('#mYouInstall'); await p.waitForTimeout(600);
        const pr = await p.evaluate(() => ({ prompted: window.__prompted || 0, toast: (document.querySelector('.m-toast') || {}).textContent || '', modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id) }));
        check('F7 with the browser prompt, Install uses it', pr.prompted === 1 && /Installing/.test(pr.toast) && pr.modals.length === 0, pr);
        await p.evaluate(() => window.dispatchEvent(new Event('appinstalled'))); await p.waitForTimeout(300);
        const inst = await p.evaluate(() => ({ row: !document.getElementById('mYouInstall').hidden, toast: (document.querySelector('.m-toast') || {}).textContent || '' }));
        check('F7b once installed, the Install row goes', !inst.row && /Installed/.test(inst.toast), inst);
        check('F errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ standalone: true });
        const mq = await p.evaluate(() => matchMedia('(display-mode: standalone)').matches);
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        const s = await look(p);
        check('F8 the installed app shows neither row', mq && !s.group && !s.fsRow && !s.installRow, { mq, s });
        await ctx.close();
    }
    {
        const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
        const { ctx, p } = await open({ ua });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(200);
        await p.tap('#mYouInstall'); await p.waitForTimeout(600);
        const steps = await p.evaluate(() => ({ android: !document.getElementById('mInstallSteps').hidden, ios: !document.getElementById('mInstallStepsIos').hidden }));
        const fsRowShown = await p.evaluate(() => !document.getElementById('mYouFullscreen').hidden);
        check('F9 on an iPhone the steps are Safari\'s, and no Full screen row', !steps.android && steps.ios && !fsRowShown, { steps, fsRowShown });
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
