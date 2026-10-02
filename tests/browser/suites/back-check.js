// Back-button walk: every screen opened on a phone (portrait + landscape) is a
// history layer, so back closes it and never leaves the app mid-stack.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const VIEWPORTS = { landscape: { width: 844, height: 390 } };

(async () => {
    const b = await L.launch();
    const report = {};
    for (const [tag, viewport] of Object.entries(VIEWPORTS)) {
        const ctx = await b.newContext({ viewport, isMobile: true, hasTouch: true, storageState: L.state('mid') });
        const p = await ctx.newPage();
        const errs = []; p.on('pageerror', e => errs.push(e.message));
        await p.route(/youtube\.com\/(iframe_api|embed|s\/player)|sdk\.scdn|spotify\.com/, r => r.abort());
        const wait = (ms) => p.waitForTimeout(ms);
        const fresh = async () => { await p.goto('about:blank'); await p.goto(APP); await wait(1200); };
        const look = () => p.evaluate(() => ({
            url: location.href,
            layer: history.state && history.state.mLayer || null,
            depth: history.state && history.state.mDepth || 0,
            crate: !document.getElementById('vinylCrateView').classList.contains('hidden'),
            player: document.getElementById('musicPlayerView').classList.contains('active'),
            open: ['searchModal', 'statsModal', 'queueModal', 'vinylGifModal']
                .filter(id => document.getElementById(id) && document.getElementById(id).classList.contains('active')),
        }));
        const back = async () => {
            await p.evaluate(() => history.back()).catch(() => {}); await wait(500);
            return look().catch(() => ({ url: p.url(), left: true }));
        };
        const r = { unreachable: [] };
        // Tap like a finger; if the element can't be reached, click it and note that.
        const press = async (sel) => {
            try { await p.tap(sel, { timeout: 3000 }); }
            catch (e) { r.unreachable.push(sel); await p.evaluate((s) => document.querySelector(s).click(), sel); }
        };

        // Search: open, back closes it; open again, the × closes it without a stray entry
        await fresh();
        await press('.crate-search-btn'); await wait(300);
        r.searchOpen = await look();
        r.searchBack = await back();
        await press('.crate-search-btn'); await wait(300);
        await press('#searchModal .add-song-modal-close'); await wait(500);
        r.searchX = await look();

        // Stats
        await press('.crate-stats-btn'); await wait(300);
        r.statsOpen = await look();
        r.statsBack = await back();

        // A search hit opens its playlist as a layer; back returns to the crate
        await fresh();
        const q = await p.evaluate(() => {
            const s = [...songsData, ...(Array.isArray(recentSongs) ? recentSongs : [])].find(s => s.title && s.title.length >= 4);
            return s ? s.title.slice(0, 4) : 'an';
        });
        await press('.crate-search-btn'); await wait(300);
        await p.fill('#librarySearchInput', q); await p.waitForSelector('#searchResults .search-result', { timeout: 5000 });
        await press('#searchResults .search-result'); await wait(1200);
        r.hitOpen = await look();
        r.hitBack = await back();

        // Jump back in
        await fresh();
        const hasRecent = await p.evaluate(() => !!document.querySelector('.recent-song'));
        if (hasRecent) {
            await p.evaluate(() => document.querySelector('.recent-song').scrollIntoView());
            await press('.recent-song'); await wait(800);
            r.recentOpen = await look();
            r.recentBack = await back();
        } else r.recentOpen = 'no recent songs on this account';

        // Playlist → Queue → back (queue only) → back (crate)
        await fresh();
        await press('.record-card[data-playlist]'); await wait(1200);
        r.plOpen = await look();
        await p.evaluate(() => openQueueModal()); await wait(300);
        r.queueOpen = await look();
        r.queueBack = await back();
        await p.evaluate(() => openVinylGifModal()); await wait(300);
        r.gifOpen = await look();
        r.gifBack = await back();
        r.plBack = await back();
        r.rootBack = await back(); // the only back allowed to leave the app

        // A failed playlist request resets the in-flight guard: the next tap works
        await fresh();
        let failOnce = true;
        await p.route('**/save-music', (route) => {
            const body = route.request().postData() || '';
            // Step 12: the phone opens a playlist with getPlaylist (switchPlaylist
            // only on desktop): fail whichever comes first.
            if (failOnce && (body.includes('switchPlaylist') || body.includes('getPlaylist'))) { failOnce = false; return route.abort(); }
            return route.continue();
        });
        const target = await p.evaluate(() => {
            const cards = [...document.querySelectorAll('.record-card[data-playlist]')];
            const other = cards.find(c => c.dataset.playlist !== String(activePlaylistId));
            return other ? other.dataset.playlist : null;
        });
        if (target) {
            await press(`.record-card[data-playlist="${target}"]`); await wait(1000);
            r.failFirst = { ...(await look()), guard: await p.evaluate(() => isChangingPlaylist),
                toast: await p.evaluate(() => (document.getElementById('clientToast') || {}).textContent || null) };
            // Step 12: a failed open keeps the playlist screen up with Retry
            // (it covers the cards), so the retry is that button when shown.
            const retry = await p.evaluate(() => { const x = document.querySelector('.song-list-retry'); return !!(x && x.getClientRects().length); });
            await press(retry ? '.song-list-retry' : `.record-card[data-playlist="${target}"]`); await wait(1200);
            r.failRetry = { ...(await look()), active: await p.evaluate(() => String(activePlaylistId)) };
            // put the account's active playlist back (the retry really switched it)
            await p.evaluate(() => fetch('/save-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switchPlaylist', playlist: 'favorites' }) }));
        } else r.failFirst = 'only one playlist';

        r.errs = errs;
        report[tag] = r;
        await ctx.close();
    }
    console.log(JSON.stringify(report, null, 1));
    await b.close();
})().catch(e => { console.error(e); process.exit(1); });
