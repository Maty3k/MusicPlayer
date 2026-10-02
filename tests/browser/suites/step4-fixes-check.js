// Regression checks for the step 4 review findings.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(acct, vp, opts = {}) {
        const ctx = await b.newContext({ viewport: vp || { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state(acct) });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (['recordPlay', 'rename', 'recolor', 'setCover', 'createPlaylist', 'deletePlaylist', 'switchPlaylist', 'delete'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":false}' });
            return route.continue();
        });
        if (opts.html) {
            await p.route(APP, async (route) => {
                const resp = await route.fetch(); const html = opts.html(await resp.text());
                route.fulfill({ response: resp, body: html, headers: { ...resp.headers(), 'content-type': 'text/html; charset=utf-8' } });
            });
        }
        if (opts.init) await p.addInitScript(opts.init);
        await p.goto(APP); await p.waitForTimeout(1200);
        return { ctx, p };
    }

    // 1. Long press whose release produces no click: the next tap elsewhere works first time
    {
        const { ctx, p } = await open('few');
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        const box = await (await p.$('#roomCenter .conveyor-track > .record-card:nth-child(2) .record-card-cover')).boundingBox();
        const cdp = await ctx.newCDPSession(p);
        const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
        await p.waitForTimeout(700);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await p.waitForTimeout(400);
        const opened = await p.evaluate(() => document.getElementById('playlistEditModal').classList.contains('active'));
        await p.tap('#playlistEditModal .add-song-modal-close'); await p.waitForTimeout(700);
        const closed = await p.evaluate(() => !document.getElementById('playlistEditModal').classList.contains('active'));
        check('F1 after a clickless long press, the first tap on the editor works', opened && closed, { opened, closed });
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(500);
        const tab = await p.evaluate(() => document.documentElement.dataset.mTab);
        check('F1b and the next tab tap works too', tab === 'search', tab);
        await ctx.close();
    }
    // 2. Spotify filter chosen in landscape → portrait Library still shows the cards
    {
        const { ctx, p } = await open('many', { width: 844, height: 390 });
        await p.evaluate(() => setSourceFilter('spotify'));
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(700);
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        const r = await p.evaluate(() => ({ src: document.getElementById('roomCenter').dataset.activeSource, vis: [...document.querySelectorAll('#roomCenter .conveyor-track > .record-card')].filter(c => getComputedStyle(c).display !== 'none').length }));
        check('F2 landscape Spotify filter is dropped in portrait', r.src === 'all' && r.vis > 0, r);
        await ctx.close();
    }
    // 3. Empty active playlist: no ring / amber title / bars
    {
        const { ctx, p } = await open('demo');
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        const r = await p.evaluate(() => {
            const c = document.querySelector('#roomCenter .record-card.now-playing');
            return { cls: c.className, eq: getComputedStyle(c.querySelector('.card-eq')).display, title: getComputedStyle(c.querySelector('.card-caption-title')).color, ring: getComputedStyle(c.querySelector('.record-card-cover')).boxShadow };
        });
        check('F3 empty active playlist is not marked as playing', r.cls.includes('is-empty') && r.eq === 'none' && !r.title.includes('242, 180, 92') && !r.ring.includes('242, 180, 92'), r);
        await ctx.close();
    }
    // 4. Long names keep two equal columns on screen at 320 / 360 / 390
    for (const w of [320, 360, 390]) {
        const { ctx, p } = await open('few', { width: w, height: 800 }, {
            html: (h) => h.replace(/(<span class="card-caption-title">)[^<]*(<\/span>)/, '$1Songs for the long drive home tonight$2'),
        });
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        const r = await p.evaluate(() => {
            const cards = [...document.querySelectorAll('#roomCenter .conveyor-track > .record-card')];
            const widths = [...new Set(cards.map(c => Math.round(c.getBoundingClientRect().width)))];
            const off = cards.filter(c => c.getBoundingClientRect().right > innerWidth + 1).length;
            const t = document.querySelector('#roomCenter .card-caption-title');
            return { widths, off, ellipsis: t.scrollWidth > t.clientWidth };
        });
        check(`F4 long name @${w}: equal columns, none off-screen, title ellipsized`, r.widths.length === 1 && r.off === 0 && r.ellipsis, r);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
