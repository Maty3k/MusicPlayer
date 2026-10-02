// Step 4: Library cards (captions, ⋯, long-press), the + menu, chips.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(acct = 'mid', vp = { width: 390, height: 844 }) {
        const ctx = await b.newContext({ viewport: vp, isMobile: true, hasTouch: true, storageState: L.state(acct) });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__writes = [];
        await p.route(/youtube\.com\/(iframe_api|embed|s\/player)|sdk\.scdn|spotify\.com/, r => r.abort());
        // Fake every write: nothing here may change the test accounts.
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (['recordPlay', 'rename', 'recolor', 'setCover', 'createPlaylist', 'deletePlaylist'].includes(body.action)) {
                p.__writes.push(body.action);
                return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            }
            return route.continue();
        });
        await p.goto('about:blank'); await p.goto(APP); await p.waitForTimeout(1300);
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({
        depth: history.state && history.state.mDepth || 0,
        layer: history.state && history.state.mLayer,
        player: document.getElementById('musicPlayerView').classList.contains('active'),
        modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
    }));
    const back = async (p) => { await p.evaluate(() => history.back()); await p.waitForTimeout(600); return look(p); };
    async function longPress(p, sel, ms = 700) {
        const box = await (await p.$(sel)).boundingBox();
        const cdp = await p.context().newCDPSession(p);
        const pt = { x: box.x + box.width / 2, y: box.y + box.height / 3 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
        await p.waitForTimeout(ms);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(500);
    }

    {
        const { ctx, p } = await open('mid');
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        const ui = await p.evaluate(() => {
            const cards = [...document.querySelectorAll('#roomCenter .conveyor-track > .record-card')];
            const vis = (el) => el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
            const card = cards[0];
            return {
                n: cards.length,
                pencil: cards.some(c => vis(c.querySelector('.playlist-edit-btn'))),
                badge: cards.some(c => vis(c.querySelector('.cover-badge'))),
                overlayTitle: cards.some(c => vis(c.querySelector('.cover-info'))),
                captions: cards.every(c => vis(c.querySelector('.card-caption'))),
                counts: cards.map(c => [c.dataset.playlist, c.querySelector('.card-caption-count').textContent, playlistsMeta[c.dataset.playlist].songCount]),
                nowPlayingTitleColor: getComputedStyle(document.querySelector('.record-card.now-playing .card-caption-title')).color,
                eq: vis(document.querySelector('.record-card.now-playing .card-eq')),
                chips: vis(document.querySelector('#roomCenter .collection-toolbar')),
                hasSpotify: document.documentElement.classList.contains('m-has-spotify'),
            };
        });
        check('S1 no pencil / badge / overlay title on Library cards', !ui.pencil && !ui.badge && !ui.overlayTitle && ui.captions, ui);
        check('S2 caption counts match', ui.counts.every(([id, text, n]) => text === n + (n === 1 ? ' song' : ' songs')), ui.counts);
        check('S3 now playing: amber title + bars', ui.eq && ui.nowPlayingTitleColor !== 'rgb(251, 245, 234)', ui);
        check('S4 chips hidden without Spotify playlists', ui.hasSpotify ? ui.chips : !ui.chips, ui);

        // ⋯ opens the editor as a layer; the playlist does not open
        const target = await p.evaluate(() => document.querySelector('#roomCenter .conveyor-track > .record-card:nth-child(2)').dataset.playlist);
        await p.tap(`#roomCenter .record-card[data-playlist="${target}"] .card-more`); await p.waitForTimeout(500);
        let s = await look(p);
        check('S5 ⋯ opens Edit playlist, not the playlist', s.modals.includes('playlistEditModal') && !s.player && s.layer === 'modal:playlistEdit', s);
        s = await back(p);
        check('S6 back closes it → Library', s.modals.length === 0 && s.depth === 1, s);

        // long-press: edit opens, the release doesn't open the playlist
        await longPress(p, `#roomCenter .record-card[data-playlist="${target}"] .record-card-cover`);
        s = await look(p);
        check('S7 long-press opens Edit playlist, release swallowed', s.modals.includes('playlistEditModal') && !s.player, s);
        s = await back(p);
        // a normal tap afterwards still opens the playlist (the swallow flag is spent)
        await p.tap(`#roomCenter .record-card[data-playlist="${await p.evaluate(() => String(activePlaylistId))}"] .record-card-cover`); await p.waitForTimeout(900);
        s = await look(p);
        check('S8 a normal tap still opens the playlist', s.player && s.layer === 'playlist', s);
        s = await back(p);

        // + menu
        await p.tap('#mLibraryNew'); await p.waitForTimeout(400);
        s = await look(p);
        const focused = await p.evaluate(() => document.activeElement && document.activeElement.dataset.mAdd);
        check('S9 + opens the add menu, focus on its first row', s.modals.includes('mAddSheet') && s.layer === 'modal:libraryAdd' && focused === 'playlist', { s, focused });
        await p.tap('#mAddSheet [data-m-add="playlist"]'); await p.waitForTimeout(700);
        s = await look(p);
        check('S10 New playlist replaces the menu', s.modals.includes('playlistEditModal') && !s.modals.includes('mAddSheet') && s.depth === 2 && s.layer === 'modal:playlistEdit', s);
        s = await back(p);
        await p.tap('#mLibraryNew'); await p.waitForTimeout(400);
        await p.tap('#mAddSheet [data-m-add="import"]'); await p.waitForTimeout(700);
        s = await look(p);
        check('S11 Import opens the import sheet', s.modals.includes('spotifyImportModal') && !s.modals.includes('mAddSheet') && s.depth === 2, s);
        s = await back(p);
        check('S12 back → Library root', s.modals.length === 0 && s.depth === 1, s);
        await p.tap('#mLibraryNew'); await p.waitForTimeout(400);
        await p.tap('#mAddSheet .add-song-modal-close'); await p.waitForTimeout(600);
        s = await look(p);
        const f2 = await p.evaluate(() => document.activeElement && document.activeElement.id);
        check('S13 × closes the menu, focus back on +', s.modals.length === 0 && s.depth === 1 && f2 === 'mLibraryNew', { s, f2 });

        // caption follows a count change and a rename
        const cap = await p.evaluate((id) => {
            setCrateCardCount(id, 1);
            const a = document.querySelector(`.record-card[data-playlist="${id}"] .card-caption-count`).textContent;
            setCrateCardCount(id, playlistsMeta[id].songCount);
            return a;
        }, target);
        check('S14 count change updates the caption', cap === '1 song', cap);
        await p.tap(`#roomCenter .record-card[data-playlist="${target}"] .card-more`); await p.waitForTimeout(500);
        await p.fill('#playlistEditName', 'Renamed <b>x</b>');
        await p.evaluate(() => savePlaylistEdit()); await p.waitForTimeout(800);
        const renamed = await p.evaluate((id) => ({ t: document.querySelector(`.record-card[data-playlist="${id}"] .card-caption-title`).innerHTML, a: document.querySelector(`.record-card[data-playlist="${id}"] .card-more`).getAttribute('aria-label') }), target);
        check('S15 rename updates the caption (as text)', renamed.t === 'Renamed &lt;b&gt;x&lt;/b&gt;' && renamed.a === 'Edit Renamed <b>x</b>', { renamed, writes: p.__writes });
        check('S errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // desktop + landscape keep their cards
    {
        const desk = await b.newContext({ viewport: { width: 1440, height: 900 }, storageState: L.state('mid') });
        const p = await desk.newPage(); await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.goto(APP); await p.waitForTimeout(1000);
        const d = await p.evaluate(() => ({ caption: getComputedStyle(document.querySelector('.record-card .card-caption')).display, badge: getComputedStyle(document.querySelector('.record-card .cover-badge')).display, sheet: getComputedStyle(document.getElementById('mAddSheet')).display }));
        check('S16 desktop: no captions, badges stay', d.caption === 'none' && d.badge !== 'none' && d.sheet === 'none', d);
        await desk.close();
        const land = await open('mid', { width: 844, height: 390 });
        const l = await land.p.evaluate(() => ({ caption: getComputedStyle(document.querySelector('.record-card .card-caption')).display, pencil: getComputedStyle(document.querySelector('.record-card .playlist-edit-btn')).display }));
        check('S17 landscape: pencil stays, no captions', l.caption === 'none' && l.pencil !== 'none', l);
        await land.ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
