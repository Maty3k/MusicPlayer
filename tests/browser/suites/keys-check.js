// Media keys: play while buffering must not restart the song; pause while
// buffering pauses; paused + play resumes; YT.PlayerState exists without the API.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
(async () => {
    const b = await L.launch();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state('mid') });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(() => {
        window.__handlers = {};
        const orig = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
        navigator.mediaSession.setActionHandler = (a, h) => { window.__handlers[a] = h; return orig(a, h); };
    });
    await p.route(/youtube\.com\/(iframe_api|embed|s\/player)|sdk\.scdn|spotify\.com/, r => r.abort());
    await p.goto(L.APP); await p.waitForTimeout(1200);
    const r = await p.evaluate(() => {
        const calls = [];
        const stub = { _s: 3, loadVideoById(id) { calls.push('load ' + id); }, playVideo() { calls.push('play'); }, pauseVideo() { calls.push('pause'); }, cueVideoById() {}, seekTo() {}, setVolume() {},
            getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; } };
        const ytBeforeApi = typeof YT !== 'undefined' && YT.PlayerState && YT.PlayerState.PLAYING === 1 && !YT.Player;
        ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
        window.__handlers.play();              // buffering → must not reload
        const whilePlayBuffering = calls.slice();
        window.__handlers.pause();             // buffering → pause
        const whilePauseBuffering = calls.slice();
        stub._s = 2; window.__handlers.play(); // paused → resume
        return { url: location.pathname, ytBeforeApi, whilePlayBuffering, whilePauseBuffering, afterResume: calls.slice(), actions: Object.keys(window.__handlers) };
    });
    console.log(JSON.stringify({ ...r, errs }));
    await b.close();
})().catch(e => { console.error(e); process.exit(1); });
