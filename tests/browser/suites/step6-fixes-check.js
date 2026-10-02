// Regression checks for the step 6 review findings.
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
            if (opts.slow && opts.slow.includes(body.action)) await new Promise(r => setTimeout(r, opts.slowMs || 2000));
            if (body.action === 'copySong') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, toCount: 99 }) });
            if (body.action === 'moveSong') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, newIndex: 0, fromCount: 1, toCount: 99 }) });
            if (['recordPlay', 'switch', 'favorite', 'delete'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true,"newIndex":0}' });
            return route.continue();
        });
        if (opts.init) await p.addInitScript(opts.init);
        await p.goto(APP); await p.waitForTimeout(1200);
        if (opts.openPlaylist !== false) {
            const active = await p.evaluate(() => String(activePlaylistId));
            if (opts.hasTouch === false) await p.click(`.m-rp-tile[data-playlist="${active}"]`); else await p.tap(`.m-rp-tile[data-playlist="${active}"]`);
            await p.waitForTimeout(900);
        }
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({
        depth: history.state && history.state.mDepth || 0, layer: history.state && history.state.mLayer,
        stack: history.state && history.state.mStack ? history.state.mStack.map(x => x.n).join('>') : '',
        sheet: !!document.querySelector('.send-menu-sheet'),
        page: (() => { const m = document.querySelector('.send-menu-sheet'); if (!m) return null; return m.querySelector('.send-menu-picker') && !m.querySelector('.send-menu-picker').hidden ? 'picker' : 'main'; })(),
        np: document.body.classList.contains('m-np-open'),
        player: document.getElementById('musicPlayerView').classList.contains('active'),
    }));
    const toast = (p) => p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);
    const openSheet = async (p, n = 2) => { await p.tap(`#songList .song-list-item:nth-child(${n}) .song-send-btn`); await p.waitForTimeout(450); };
    const touchAt = async (p, x, y) => { const c = await p.context().newCDPSession(p); await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };

    // 1 + 7 + 10: double tap on "Add to playlist…", focus on open, headings/aria
    {
        const { ctx, p } = await open('many');
        await openSheet(p);
        const box = await (await p.$('.send-menu-open-picker')).boundingBox();
        await touchAt(p, box.x + box.width / 2, box.y + box.height / 2);
        await p.waitForTimeout(120);
        await touchAt(p, box.x + box.width / 2, box.y + box.height / 2);
        await p.waitForTimeout(700);
        const s = await look(p);
        const copies = p.__posts.filter(x => x.action === 'copySong').length;
        check('T1 a double tap on Add to playlist… picks nothing', s.page === 'picker' && copies === 0, { s, copies });
        await p.evaluate(() => document.querySelector('.send-menu-picker-back').click()); await p.waitForTimeout(700);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(500);
        const a = await p.evaluate(() => ({ focus: document.activeElement.className, heading: document.querySelector('.send-menu-picker-title').getAttribute('role'), art: [...document.querySelectorAll('.send-menu-pick-art')].every(e => e.getAttribute('aria-hidden') === 'true') }));
        check('T2 picker focus starts at Back; title is a heading; art hidden from readers', a.focus.includes('send-menu-picker-back') && a.heading === 'heading' && a.art, a);
        // double tap on the back arrow: stays on the first page
        const bb = await (await p.$('.send-menu-picker-back')).boundingBox();
        await touchAt(p, bb.x + bb.width / 2, bb.y + bb.height / 2);
        await p.waitForTimeout(120);
        await touchAt(p, bb.x + bb.width / 2, bb.y + bb.height / 2);
        await p.waitForTimeout(700);
        const s2 = await look(p);
        check('T3 a double tap on the picker\'s Back keeps the sheet open', s2.sheet && s2.page === 'main', s2);
        await ctx.close();
    }
    // 2: one song change at a time
    {
        const { ctx, p } = await open('many', { slow: ['moveSong'], slowMs: 5000 });
        await openSheet(p, 3);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(600);
        await p.tap('.send-menu-move'); await p.tap('.send-menu-pick'); await p.waitForTimeout(300);
        // back out and try to remove another song while the move is saving
        await p.evaluate(() => history.back()); await p.waitForTimeout(500);
        await p.evaluate(() => history.back()); await p.waitForTimeout(500);
        await openSheet(p, 4);
        await p.tap('.send-menu-delete'); await p.waitForTimeout(150); await p.tap('.send-menu-delete'); await p.waitForTimeout(400);
        const t = await toast(p);
        const deletes = p.__posts.filter(x => x.action === 'delete').length;
        check('B1 while a move saves, Remove waits ("Still saving…")', t && t.includes('Still saving') && deletes === 0, { t, deletes });
        await p.waitForTimeout(5200);
        await ctx.close();
    }
    // 5: favorites stay in step
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { activePlaylistId = 'pl-1'; favoriteKeys.delete(songPlayKey(songsData[1])); });
        await openSheet(p);
        const liked0 = await p.evaluate(() => document.querySelector('.send-menu-like .send-menu-name').textContent);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(600);
        await p.tap('.send-menu-pick[data-playlist="favorites"]'); await p.waitForTimeout(900);
        await openSheet(p);
        const after = await p.evaluate(() => ({ like: document.querySelector('.send-menu-like .send-menu-name').textContent, favOffered: !!document.querySelector('.send-menu-pick[data-playlist="favorites"]') }));
        check('V1 copying into Favorites counts as a like (and Favorites isn\'t offered again)', liked0 === 'Add to Favorites' && after.like === 'Remove from Favorites' && !after.favOffered, { liked0, after });
        await p.evaluate(() => { activePlaylistId = 'favorites'; closeSendMenu(); });
        await ctx.close();
    }
    // 3 + 8: Show in playlist with find hiding the song; focus lands on the song
    {
        const { ctx, p } = await open('many');
        const cur = await p.evaluate(() => currentSongIndex);
        await p.tap('#mPlFind'); await p.keyboard.type('zzz-no-such'); await p.waitForTimeout(300);
        await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
        await p.tap('#mDockInfo'); await p.waitForTimeout(700);
        await p.tap('#mNpKebab'); await p.waitForTimeout(450);
        await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-item')].find(e => e.textContent.includes('Show in playlist')).click());
        await p.waitForTimeout(1300);
        const s = await look(p);
        const r = await p.evaluate((i) => { const row = document.querySelector(`#songList .song-list-item[data-index="${i}"]`); return { filtered: row.classList.contains('m-filtered-out'), v: document.getElementById('mFilterInput').value, focus: document.activeElement.className, inRow: row.contains(document.activeElement) }; }, cur);
        check('N1 Show in playlist closes a find that hid the song and focuses it', !s.np && s.layer === 'playlist' && !r.filtered && r.v === '' && r.inRow, { s, r });
        await ctx.close();
    }
    // 4: NP kebab after the playlist emptied
    {
        const { ctx, p } = await open('many');
        await p.tap('#mDockInfo'); await p.waitForTimeout(700);
        await p.evaluate(() => { songsData.splice(0); });
        await p.tap('#mNpKebab'); await p.waitForTimeout(450);
        const s = await look(p);
        check('E1 Now Playing\'s ⋯ opens nothing when there is no song', !s.sheet, s);
        await ctx.close();
    }
    // 6: Now Playing from the mini player while a sheet is up (keyboard)
    {
        const { ctx, p } = await open('many', { viewport: { width: 390, height: 844 } });
        await openSheet(p);
        await p.tap('.send-menu-open-picker'); await p.waitForTimeout(500);
        // Step 11: the sheet covers the mini player, so it's inert (no Tab, no tap)
        await p.focus('#mDockInfo');
        const k = await p.evaluate(() => ({ inert: document.getElementById('mDock').inert, focus: document.activeElement.id || document.activeElement.className }));
        check('K0 the mini player is out of reach while a sheet covers it', k.inert && k.focus !== 'mDockInfo', k);
        // Anything that still opens Now Playing over the sheet closes it cleanly
        await p.evaluate(() => document.getElementById('mDockInfo').click()); await p.waitForTimeout(1200);
        const s = await look(p);
        check('K1 Now Playing over an open sheet: the sheet closes, no orphan steps', s.np && !s.sheet && s.stack === 'playlist>np', s);
        await ctx.close();
    }
    // 9: flash visible in a themed room with reduced motion
    {
        const { ctx, p } = await open('many', { reducedMotion: 'reduce', init: () => { try { localStorage.setItem('musicTheme', 'velvet'); } catch (e) {} }, openPlaylist: false });
        await p.tap('#mDockInfo'); await p.waitForTimeout(700);
        await p.tap('#mNpKebab'); await p.waitForTimeout(450);
        await p.evaluate(() => [...document.querySelectorAll('.send-menu-sheet .send-menu-item')].find(e => e.textContent.includes('Show in playlist')).click());
        await p.waitForTimeout(900);
        const bg = await p.evaluate(() => { const r = document.querySelector('#songList .song-list-item.m-row-flash'); return r ? getComputedStyle(r).backgroundColor : null; });
        check('R1 the flash shows in a themed room with reduced motion', bg && bg.includes('0.22'), bg);
        await p.evaluate(() => { try { localStorage.removeItem('musicTheme'); } catch (e) {} });
        await ctx.close();
    }
    // 12: desktop popover stays on screen
    {
        const { ctx, p } = await open('many', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(600);
        await p.evaluate(() => { const rows = document.querySelectorAll('#songList .song-send-btn'); showSendMenu(rows[rows.length - 1], rows.length - 1); });
        await p.waitForTimeout(300);
        const r = await p.evaluate(() => { const m = document.querySelector('.send-menu'); const b = m.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight, scrolls: m.scrollHeight >= m.clientHeight }; });
        check('D1 the desktop menu stays within the window', r.top >= 0 && r.bottom <= r.h, r);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
