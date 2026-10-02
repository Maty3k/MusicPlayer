// Regression checks for the step 5 review findings.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(acct = 'many', opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, reducedMotion: opts.reducedMotion || 'no-preference', storageState: L.state(acct) });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (opts.fail && opts.fail.includes(body.action)) return route.abort();
            if (['recordPlay', 'reorder', 'favorite', 'deletePlaylist', 'switch', 'delete'].includes(body.action)) {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, favorited: true, key: 'k', newIndex: 0 }) });
            }
            if (body.action === 'share') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, url: 'http://127.0.0.1:8123/s/fresh' }) });
            return route.continue();
        });
        if (opts.init) await p.addInitScript(opts.init);
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.openPlaylist !== false) {
            const active = await p.evaluate(() => String(activePlaylistId));
            if (opts.hasTouch === false) await p.click(`.m-rp-tile[data-playlist="${active}"]`);
            else await p.tap(`.m-rp-tile[data-playlist="${active}"]`);
            await p.waitForTimeout(900);
        }
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({ depth: history.state && history.state.mDepth || 0, layer: history.state && history.state.mLayer, player: document.getElementById('musicPlayerView').classList.contains('active'), cls: document.getElementById('musicSidebar').className }));
    const toast = (p) => p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);

    // 1. drag auto-scroll: stops on release, no ghost row, next drag saves
    {
        const { ctx, p } = await open('many');
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        await p.tap('#mPlaylistSheet [data-m-pl="reorder"]'); await p.waitForTimeout(800);
        const cdp = await ctx.newCDPSession(p);
        const h = await (await p.$('#songList .song-list-item:nth-child(2) .song-drag-handle')).boundingBox();
        const x = h.x + h.width / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: h.y + h.height / 2 }] });
        for (let y = h.y + h.height / 2; y <= 670; y += 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await p.waitForTimeout(250);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const a = await p.evaluate(() => document.getElementById('musicSidebar').scrollTop);
        await p.waitForTimeout(500);
        const bb = await p.evaluate(() => ({ top: document.getElementById('musicSidebar').scrollTop, rows: document.querySelectorAll('#songList .song-list-item:not(.discover-item):not(.radio-song-item)').length, n: songsData.length, dup: (() => { const ids = [...document.querySelectorAll('#songList .song-list-item:not(.discover-item)')].map(r => r.dataset.index); return ids.length !== new Set(ids).size; })() }));
        check('D1 auto-scroll stops on release; no ghost row', bb.top === a && bb.rows === bb.n && !bb.dup, { a, bb });
        const postsBefore = p.__posts.filter(x => x.action === 'reorder').length;
        await p.evaluate(() => { document.getElementById('musicSidebar').scrollTop = 0; }); await p.waitForTimeout(200);
        const h3 = await (await p.$('#songList .song-list-item:nth-child(3) .song-drag-handle')).boundingBox();
        const r4 = await (await p.$('#songList .song-list-item:nth-child(4)')).boundingBox();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: h3.y + h3.height / 2 }] });
        for (let y = h3.y + h3.height / 2; y <= r4.y + r4.height * 0.85; y += 8) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(400);
        const postsAfter = p.__posts.filter(x => x.action === 'reorder').length;
        check('D2 the next drag still reorders and saves', postsAfter === postsBefore + 1, { postsBefore, postsAfter });
        check('D errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // 8. desktop: the sidebar is the scroller and drag auto-scroll works
    {
        const { ctx, p } = await open('many', { viewport: { width: 1280, height: 720 }, isMobile: false, hasTouch: false, openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(700);
        const sc = await p.evaluate(() => songListScroller().id);
        const h = await (await p.$('#songList .song-list-item:nth-child(2) .song-drag-handle')).boundingBox();
        await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
        for (let y = h.y; y <= 700; y += 25) await p.mouse.move(h.x + h.width / 2, y);
        await p.waitForTimeout(700);
        const mid = await p.evaluate(() => document.getElementById('musicSidebar').scrollTop);
        await p.mouse.up(); await p.waitForTimeout(300);
        check('D3 desktop: sidebar scroller, auto-scroll while dragging', sc === 'musicSidebar' && mid > 40, { sc, mid });
        await ctx.close();
    }
    // 2. find query typed in landscape doesn't linger in portrait
    {
        const { ctx, p } = await open('many', { viewport: { width: 844, height: 390 }, openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(500);
        await p.fill('#mFilterInput', 'Song 1'); await p.waitForTimeout(300);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
        const r = await p.evaluate(() => ({ v: document.getElementById('mFilterInput').value, shown: [...document.querySelectorAll('#songList .song-list-item:not(.discover-item)')].filter(x => getComputedStyle(x).display !== 'none').length, n: songsData.length }));
        check('F1 a landscape query is cleared in portrait', r.v === '' && r.shown === r.n, r);
        await ctx.close();
    }
    // 3. delete fails offline: says so
    {
        const { ctx, p } = await open('many', { fail: ['deletePlaylist'] });
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        await p.tap('#mPlaylistSheet [data-m-pl="delete"]'); await p.waitForTimeout(200);
        await p.tap('#mPlaylistSheet [data-m-pl="delete"]'); await p.waitForTimeout(800);
        const t = await toast(p);
        const row = await p.evaluate(() => document.querySelector('#mPlaylistSheet [data-m-pl="delete"] b').textContent);
        check('X1 a failed delete says so (no uncaught error)', t && t.includes('Couldn') && row === 'Delete playlist' && p.__errs.length === 0, { t, row, errs: p.__errs });
        await ctx.close();
    }
    // 4 + 10 + 12. Like: fails honestly; shows in a narrow mouse window; is a button
    {
        const { ctx, p } = await open('many', { fail: ['favorite'] });
        await p.evaluate(() => { activePlaylistId = 'pl-1'; });
        await p.evaluate(() => showSendMenu(document.querySelector('#songList .song-send-btn'), 0)); await p.waitForTimeout(300);
        const tag = await p.evaluate(() => { const r = document.querySelector('.send-menu-like'); return r && r.tagName; });
        await p.evaluate(() => document.querySelector('.send-menu-like').click()); await p.waitForTimeout(800);
        const t = await toast(p);
        check('L1 Like is a button; a failed save says so', tag === 'BUTTON' && t && t.includes('Couldn'), { tag, t });
        await p.evaluate(() => { activePlaylistId = 'favorites'; });
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { viewport: { width: 500, height: 900 }, isMobile: false, hasTouch: false });
        await p.evaluate(() => { activePlaylistId = 'pl-1'; });
        await p.evaluate(() => showSendMenu(document.querySelector('#songList .song-send-btn'), 0)); await p.waitForTimeout(300);
        const r = await p.evaluate(() => ({ sheet: !!document.querySelector('.send-menu-sheet'), like: !!document.querySelector('.send-menu .send-menu-like') }));
        check('L2 narrow mouse window: the menu offers Like', !r.sheet && r.like, r);
        await p.evaluate(() => { activePlaylistId = 'favorites'; closeSendMenu(); });
        await ctx.close();
    }
    // 5. reorder mode ends when fewer than two songs remain
    {
        const { ctx, p } = await open('many');
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        await p.tap('#mPlaylistSheet [data-m-pl="reorder"]'); await p.waitForTimeout(700);
        await p.evaluate(() => { songsData.splice(1); rebuildSongList(); }); await p.waitForTimeout(700);
        const s = await look(p);
        check('R1 reorder mode ends when one song is left', !s.cls.includes('m-reordering') && s.layer === 'playlist', s);
        await ctx.close();
    }
    // 6. share asks the server each time
    {
        const { ctx, p } = await open('many', { init: () => { window.__shared = []; Object.defineProperty(navigator, 'share', { value: (d) => { window.__shared.push(d); return Promise.resolve(); }, configurable: true }); } });
        await p.evaluate(() => { shareTokens[String(activePlaylistId)] = 'http://127.0.0.1:8123/s/stale'; });
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        await p.tap('#mPlaylistSheet [data-m-pl="share"]'); await p.waitForTimeout(800);
        const shared = await p.evaluate(() => window.__shared);
        check('S1 share uses the server\'s current link, not a stale one', shared.length === 1 && shared[0].url.endsWith('/s/fresh') && p.__posts.some(x => x.action === 'share'), shared);
        await ctx.close();
    }
    // 7. offline: one save at a time, the menu shows it
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { songsData[0].mp3_url = '/media/test.mp3'; offlineSaving = true; });
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        const row = await p.evaluate(() => { const r = document.querySelector('#mPlaylistSheet [data-m-pl="offline"]'); return { hidden: r.hidden, disabled: r.disabled, text: r.querySelector('b').textContent }; });
        check('O1 while saving, the offline row says so and is disabled', !row.hidden && row.disabled && row.text.startsWith('Saving'), row);
        await p.evaluate(() => { offlineSaving = false; });
        await ctx.close();
    }
    // 9. no ghost playlist screen after the last playlist was deleted
    {
        const { ctx, p } = await open('empty', { openPlaylist: false });
        await p.evaluate(() => history.replaceState({ mLayer: 'playlist', mDepth: 1, mTab: 'home', mStack: [{ n: 'playlist', p: 'favorites' }] }, ''));
        await p.reload(); await p.waitForTimeout(1300);
        const s = await look(p);
        check('G1 a deleted playlist is not restored after the reload', !s.player, s);
        await ctx.close();
    }
    // 11. app shell empty card stacks
    {
        const { ctx, p } = await open('demo', { query: '?app=1', openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(500);
        const r = await p.evaluate(() => ({ dir: getComputedStyle(document.querySelector('#songList .song-list-empty')).flexDirection, w: document.querySelector('#songList .song-list-empty-text').getBoundingClientRect().width }));
        check('A1 app shell: empty card is a column', r.dir === 'column' && r.w > 100, r);
        await ctx.close();
    }
    // 13. keyboard focus around reorder mode
    {
        const { ctx, p } = await open('many', { viewport: { width: 500, height: 900 }, isMobile: false, hasTouch: false });
        await p.focus('#mPlMore'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
        await p.focus('#mPlaylistSheet [data-m-pl="reorder"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
        const f1 = await p.evaluate(() => document.activeElement.id);
        await p.keyboard.press('Enter'); await p.waitForTimeout(700);
        const f2 = await p.evaluate(() => document.activeElement.id);
        check('K1 focus goes to Done in reorder mode, back to ⋯ after', f1 === 'mPlDone' && f2 === 'mPlMore', { f1, f2 });
        await ctx.close();
    }
    // 14 + 15 + 16 + 17: css details
    {
        const { ctx, p } = await open('many', { reducedMotion: 'reduce' });
        const r = await p.evaluate(() => ({
            sheetWrap: getComputedStyle(document.querySelector('.m-menu-sheet .m-sheet-title')).overflowWrap,
            barTitle: getComputedStyle(document.getElementById('mPlBarTitle')).transform,
        }));
        await p.tap('#mPlFind'); await p.keyboard.type('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'); await p.waitForTimeout(300);
        const fe = await p.evaluate(() => { const e = document.getElementById('mFilterEmpty'); return { wrap: getComputedStyle(e).overflowWrap, over: e.scrollWidth - e.clientWidth, text: e.textContent }; });
        check('C1 long names and queries wrap; reduced motion honoured', r.sheetWrap === 'anywhere' && r.barTitle === 'none' && fe.wrap === 'anywhere' && fe.over <= 0 && fe.text.includes('…'), { r, fe });
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
