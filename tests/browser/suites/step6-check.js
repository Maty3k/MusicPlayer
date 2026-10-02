// Step 6: the song sheet (short first page) and its "Add to playlist…" page.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(acct = 'many', opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, storageState: L.state(acct) });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (opts.fail && opts.fail.includes(body.action)) return route.abort();
            if (body.action === 'copySong') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, toCount: 99 }) });
            if (body.action === 'moveSong') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, newIndex: 0, fromCount: 0, toCount: 99 }) });
            if (['recordPlay', 'switch', 'favorite'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.openPlaylist !== false) {
            const active = await p.evaluate(() => String(activePlaylistId));
            await p.tap(`.m-rp-tile[data-playlist="${active}"]`); await p.waitForTimeout(900);
        }
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({
        depth: history.state && history.state.mDepth || 0, layer: history.state && history.state.mLayer,
        sheet: !!document.querySelector('.send-menu-sheet'),
        page: (() => { const m = document.querySelector('.send-menu-sheet'); if (!m) return null; return m.querySelector('.send-menu-picker') && !m.querySelector('.send-menu-picker').hidden ? 'picker' : 'main'; })(),
        np: document.body.classList.contains('m-np-open'),
        player: document.getElementById('musicPlayerView').classList.contains('active'),
    }));
    const back = async (p) => { await p.evaluate(() => history.back()); await p.waitForTimeout(600); return look(p); };
    const toast = (p) => p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);
    const openSheet = async (p, n = 2) => { await p.tap(`#songList .song-list-item:nth-child(${n}) .song-send-btn`); await p.waitForTimeout(450); };

    // first page + picker navigation
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { activePlaylistId = 'favorites'; });
        await openSheet(p);
        const rows = await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-main .send-menu-name')].map(e => e.textContent.trim()));
        const tags = await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-main .send-menu-item')].every(e => e.tagName === 'BUTTON'));
        const noLists = await p.evaluate(() => !document.querySelector('.send-menu-sheet .send-menu-main .send-menu-title'));
        check('S1 first page: Play next, Add to queue, Add to playlist…, Remove — as buttons, no long lists', JSON.stringify(rows) === JSON.stringify(['Play next', 'Add to queue', 'Add to playlist…', 'Remove from this playlist']) && tags && noLists, { rows, tags, noLists });
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        let s = await look(p);
        const picks = await p.evaluate(() => [...document.querySelectorAll('.send-menu-pick')].map(r => r.dataset.playlist));
        const nMeta = await p.evaluate(() => Object.keys(playlistsMeta).length);
        check('S2 Add to playlist… opens the picker (a step), every other playlist listed', s.page === 'picker' && s.layer === 'songPicker' && picks.length === nMeta - 1 && !picks.includes('favorites'), { s, picks });
        s = await back(p);
        check('S3 back returns to the first page', s.sheet && s.page === 'main' && s.layer === 'songSheet', s);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        await p.tap('.send-menu-picker-back'); await p.waitForTimeout(600);
        s = await look(p);
        check('S4 the picker\'s own back arrow does the same', s.sheet && s.page === 'main' && s.layer === 'songSheet', s);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        await p.evaluate(() => document.querySelector('.send-menu-backdrop').click()); await p.waitForTimeout(700);
        s = await look(p);
        check('S5 closing from the picker closes the sheet in one go', !s.sheet && s.layer === 'playlist' && s.depth === 1, s);
        // copy
        await openSheet(p);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        const target = await p.evaluate(() => document.querySelector('.send-menu-pick').dataset.playlist);
        await p.tap('.send-menu-pick'); await p.tap('.send-menu-pick', { timeout: 300 }).catch(() => {}); await p.waitForTimeout(900);
        s = await look(p);
        const copies = p.__posts.filter(x => x.action === 'copySong');
        const t = await toast(p);
        check('S6 picking copies (once), says so, closes the sheet', copies.length === 1 && copies[0].toPlaylist === target && copies[0].songIndex === 1 && t && t.startsWith('Copied to') && !s.sheet && s.layer === 'playlist', { copies, t, s });
        // move
        const n0 = await p.evaluate(() => songsData.length);
        await openSheet(p, 3);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        await p.tap('.send-menu-move'); await p.waitForTimeout(200);
        const checked = await p.evaluate(() => document.querySelector('.send-menu-move-input').checked);
        await p.tap('.send-menu-pick'); await p.waitForTimeout(900);
        const moves = p.__posts.filter(x => x.action === 'moveSong');
        const n1 = await p.evaluate(() => songsData.length);
        const t2 = await toast(p);
        check('S7 with the switch on, picking moves the song', checked && moves.length === 1 && moves[0].songIndex === 2 && n1 === n0 - 1 && t2 && t2.startsWith('Moved to'), { checked, moves, n0, n1, t2 });
        check('S errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // a failed copy says so
    {
        const { ctx, p } = await open('many', { fail: ['copySong'] });
        await openSheet(p);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        await p.tap('.send-menu-pick'); await p.waitForTimeout(900);
        const t = await toast(p);
        check('F1 a failed copy says so', t && t.startsWith('Couldn'), t);
        await ctx.close();
    }
    // moving the only song away resets the deck
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { songsData.splice(1); currentSongIndex = 0; rebuildSongList(); });
        await openSheet(p, 1);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(400);
        await p.tap('.send-menu-move'); await p.tap('.send-menu-pick'); await p.waitForTimeout(900);
        const r = await p.evaluate(() => ({ n: songsData.length, title: (document.querySelector('.sleeve-mobile-nowplaying .song-title, .song-title') || {}).textContent, empty: !!document.querySelector('#songList .song-list-empty') }));
        check('F2 moving the last song away shows the empty playlist', r.n === 0 && r.empty && /No songs/.test(r.title || ''), r);
        await ctx.close();
    }
    // Like row on other playlists
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { activePlaylistId = 'pl-1'; });
        await openSheet(p);
        const rows = await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-main .send-menu-name')].map(e => e.textContent.trim()));
        check('L1 outside Favorites the first page has the Like row', rows.some(r => r.includes('Favorites')) && rows.length === 5, rows);
        await p.evaluate(() => { activePlaylistId = 'favorites'; closeSendMenu(); });
        await ctx.close();
    }
    // Show in playlist from Now Playing (opened over Home)
    {
        const { ctx, p } = await open('many', { openPlaylist: false });
        await p.tap('#mDockInfo'); await p.waitForTimeout(700);
        await p.tap('#mNpKebab'); await p.waitForTimeout(450);
        const has = await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-name')].some(e => e.textContent.trim() === 'Show in playlist'));
        const idx = await p.evaluate(() => currentSongIndex);
        await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-item')].find(e => e.textContent.includes('Show in playlist')).click());
        await p.waitForTimeout(1200);
        const s = await look(p);
        const flash = await p.evaluate((i) => { const r = document.querySelector(`#songList .song-list-item[data-index="${i}"]`); const box = r.getBoundingClientRect(); return { flash: r.classList.contains('m-row-flash'), visible: box.top > 40 && box.bottom < innerHeight - 100 }; }, idx);
        check('N1 Now Playing\'s menu → Show in playlist opens the playlist at the song', has && !s.np && !s.sheet && s.player && s.layer === 'playlist' && flash.visible && flash.flash, { has, s, flash });
        const b1 = await back(p);
        check('N2 back from there → Home', !b1.player && b1.depth === 0, b1);
        await ctx.close();
    }
    // desktop popover unchanged; app shell sheet works without the phone shell
    {
        const { ctx, p } = await open('many', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(600);
        await p.evaluate(() => showSendMenu(document.querySelectorAll('#songList .song-send-btn')[1], 1)); await p.waitForTimeout(300);
        const d = await p.evaluate(() => ({ sheet: !!document.querySelector('.send-menu-sheet'), title: (document.querySelector('.send-menu .send-menu-title') || {}).textContent, rows: document.querySelectorAll('.send-menu .send-menu-dot').length, picker: !!document.querySelector('.send-menu-picker') }));
        check('O1 desktop keeps the Send to… popover', !d.sheet && d.title === 'Send to...' && d.rows > 0 && !d.picker, d);
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { query: '?app=1', openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(600);
        await p.evaluate(() => showSendMenu(document.querySelectorAll('#songList .song-send-btn')[1], 1)); await p.waitForTimeout(300);
        await p.evaluate(() => document.querySelector('.send-menu-open-picker').click()); await p.waitForTimeout(200);
        const a1 = await p.evaluate(() => !document.querySelector('.send-menu-picker').hidden);
        await p.evaluate(() => document.querySelector('.send-menu-picker-back').click()); await p.waitForTimeout(200);
        const a2 = await p.evaluate(() => document.querySelector('.send-menu-picker').hidden && !document.querySelector('.send-menu-main').hidden);
        check('O2 app shell: the picker opens and its back arrow returns', a1 && a2 && p.__errs.length === 0, { a1, a2, errs: p.__errs });
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
