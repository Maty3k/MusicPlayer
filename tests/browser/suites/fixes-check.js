// Regression checks for the confirmed review findings on the phone tabs.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, storageState: L.state(opts.acct || 'many') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com\/(iframe_api|embed|s\/player)|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: [] }) }));
        // Keep server data untouched: fake writes; delay switchPlaylist so a load is "in flight".
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (['recordPlay', 'delete'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true,"newIndex":0}' });
            if (body.action === 'switchPlaylist') {
                const resp = await route.fetch({ postData: JSON.stringify(body) });
                const json = await resp.json();
                await new Promise(r => setTimeout(r, opts.switchDelay || 0));
                // undo the server-side switch so the account keeps its active playlist
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify(json) });
            }
            return route.continue();
        });
        if (opts.before) await opts.before(p, ctx);
        await p.goto('about:blank'); await p.goto(APP); await p.waitForTimeout(1300);
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({
        tab: document.documentElement.dataset.mTab,
        depth: history.state && history.state.mDepth || 0,
        stack: history.state && history.state.mStack ? history.state.mStack.map(x => x.n + (x.t ? ':' + x.t : '') + (x.p ? ':' + x.p : '')).join(',') : '',
        player: document.getElementById('musicPlayerView').classList.contains('active'),
        np: document.body.classList.contains('m-np-open'),
        kb: document.body.classList.contains('m-kb'),
        tabsVis: getComputedStyle(document.getElementById('mTabs')).visibility,
        active: document.activeElement && (document.activeElement.id || document.activeElement.className),
        modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
    })).catch(() => ({ left: true }));
    const back = async (p, ms = 600) => { await p.evaluate(() => history.back()).catch(() => {}); await p.waitForTimeout(ms); return look(p); };

    // H1: a tile's playlist that loads after Now Playing opened doesn't land on top
    {
        const { ctx, p } = await open({ switchDelay: 900 });
        const target = await p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)));
        const originalActive = await p.evaluate(() => String(activePlaylistId));
        await p.tap(`.m-rp-tile[data-playlist="${target}"]`); await p.waitForTimeout(150);
        await p.tap('#mDockInfo'); await p.waitForTimeout(1600);
        let s = await look(p);
        // Step 12: a tile shows its playlist screen at once (it loads there),
        // so Now Playing opened during the load lands on top of that screen.
        check('H1 load after NP opened: NP stays top, over the playlist screen', s.np && s.stack === `playlist:${target},np` && s.player, s);
        await p.tap('#mNpCollapse'); await p.waitForTimeout(700);
        s = await look(p);
        const loaded = await p.evaluate(() => ({ viewedId, loading: listLoading() }));
        check('H1 NP chevron closes it → the playlist, loaded meanwhile', !s.np && s.depth === 1 && s.player && loaded.viewedId === target && !loaded.loading, { s, loaded });
        // restore the server's active playlist
        await p.evaluate((id) => fetch('/save-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switchPlaylist', playlist: id }) }), originalActive);
        await ctx.close();
    }
    // H1b: avatar sheet during the load
    {
        const { ctx, p } = await open({ switchDelay: 900 });
        const originalActive = await p.evaluate(() => String(activePlaylistId));
        const target = await p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)));
        await p.tap(`.m-rp-tile[data-playlist="${target}"]`); await p.waitForTimeout(150);
        // Step 12: the screen covers Home (and the avatar) at once; back off
        // it during the load, then open the You page: the load must not
        // bring the playlist back on top.
        await back(p, 200);
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(1600);
        let s = await look(p);
        check('H1b load after back + the You page opened: page on top, no playlist layer', s.stack === 'you' && !s.player, s);
        s = await back(p);
        check('H1b one back closes the page → Home', s.modals.length === 0 && s.depth === 0, s);
        await p.evaluate((id) => fetch('/save-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switchPlaylist', playlist: id }) }), originalActive);
        await ctx.close();
    }
    // H2: landscape reload keeps [tab, playlist]
    {
        const { ctx, p } = await open();
        const active = await p.evaluate(() => String(activePlaylistId));
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        await p.evaluate((id) => document.querySelector(`.record-card[data-playlist="${id}"]`).scrollIntoView({ block: 'center' }), active);
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(700);
        await p.reload(); await p.waitForTimeout(1500);
        let s = await look(p);
        check('H2 landscape reload restores the playlist over a tab', s.player && s.stack === `tab:library,playlist:${active}`, s);
        s = await back(p, 1200);
        check('H2 then back → crate at depth 0 (bare tab folded)', !s.player && s.depth === 0, s);
        await ctx.close();
    }
    // H3: rotating while a Library card loads still opens it
    {
        const { ctx, p } = await open({ switchDelay: 900 });
        const originalActive = await p.evaluate(() => String(activePlaylistId));
        const target = await p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)));
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        await p.evaluate((id) => document.querySelector(`.record-card[data-playlist="${id}"]`).scrollIntoView({ block: 'center' }), target);
        await p.tap(`.record-card[data-playlist="${target}"]`); await p.waitForTimeout(150);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(1800);
        const s = await look(p);
        check('H3 rotation during the load: the playlist still opens', s.player && s.stack.includes('playlist:' + target), s);
        await p.evaluate((id) => fetch('/save-music', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switchPlaylist', playlist: id }) }), originalActive);
        await ctx.close();
    }
    // L1: no old crate while a search hit opens; D1: stale position after a delete
    {
        const { ctx, p } = await open();
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        await p.tap('#mSearchInput'); await p.keyboard.type('of ' + await p.evaluate(() => playlistsMeta[activePlaylistId].name)); await p.waitForTimeout(900);
        await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
        const idx = await p.evaluate(() => [...document.querySelectorAll('#mSearchResults [data-open]')].findIndex(r => r.querySelector('.search-result-pl').textContent === playlistsMeta[activePlaylistId].name));
        await p.evaluate(() => { window.__crateVis = []; new MutationObserver(() => window.__crateVis.push(getComputedStyle(document.getElementById('vinylCrateView')).visibility)).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); });
        await p.tap(`#mSearchResults [data-open="${idx}"]`); await p.waitForTimeout(150);
        const vis = await p.evaluate(() => ({ now: getComputedStyle(document.getElementById('vinylCrateView')).visibility, seen: window.__crateVis }));
        check('L1 crate stays hidden while a search hit opens', vis.now === 'hidden' && !vis.seen.includes('visible'), vis);
        await p.waitForTimeout(900);
        // delete song 0 locally (server faked), back to Search, tap the 10th hit: must play that exact song
        await p.evaluate(() => deleteSong(0, { skipConfirm: true })); await p.waitForTimeout(400);
        await back(p);
        const pick = await p.evaluate(() => { const rows = [...document.querySelectorAll('#mSearchResults .m-sr-row')].filter(r => r.querySelector('[data-open]')); const i = rows.findIndex((r, k) => k > 3 && r.querySelector('.search-result-pl').textContent === playlistsMeta[activePlaylistId].name); return { i, title: rows[i].querySelector('.search-result-title').textContent }; });
        await p.evaluate(() => { window.__played = []; window.playSongSource = function (s) { window.__played.push(s && s.title); }; });
        await p.evaluate((i) => document.querySelector(`#mSearchResults [data-open="${i}"]`).scrollIntoView({ block: 'center' }), pick.i);
        await p.tap(`#mSearchResults [data-open="${pick.i}"]`); await p.waitForTimeout(1200);
        const cur = await p.evaluate(() => ({ played: window.__played, cur: songsData[currentSongIndex] && songsData[currentSongIndex].title }));
        check('D1 stale search position still plays the tapped song', cur.cur === pick.title, { pick, cur });
        check('L1/D1 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // L2/L3/L4: safe-area top inset
    {
        const { ctx, p } = await open({
            viewport: { width: 393, height: 852 },
            before: async (p, ctx) => { const c = await ctx.newCDPSession(p); await c.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, bottom: 34, left: 0, right: 0 } }).catch(e => { p.__noInset = e.message; }); },
        });
        const home = await p.evaluate(() => document.getElementById('mGreeting').getBoundingClientRect().top);
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(400);
        const lib = await p.evaluate(() => ({ title: document.querySelector('#mLibraryHead .m-tab-title').getBoundingClientRect().top, chips: document.querySelector('.collection-toolbar').getBoundingClientRect().top, plus: document.getElementById('mLibraryNew').getBoundingClientRect().bottom }));
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        const srch = await p.evaluate(() => document.querySelector('#mSearchPage .m-tab-title').getBoundingClientRect().top);
        await p.tap('#mSearchInput'); await p.keyboard.type('Song'); await p.waitForTimeout(900);
        await p.evaluate(() => { document.activeElement.blur(); document.getElementById('mSearchPage').scrollTop = 600; }); await p.waitForTimeout(300);
        const field = await p.evaluate(() => document.querySelector('#mSearchPage .m-search-field').getBoundingClientRect().top);
        const inset = await p.evaluate(() => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top)'; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h; });
        check('L2 Library title level with Home, clear of the chips', Math.abs(lib.title - home) < 2 && (lib.chips === 0 || lib.plus <= lib.chips + 1), { home, lib, inset, noInset: p.__noInset });
        check('L4 Search title level with Home', Math.abs(srch - home) < 2, { home, srch });
        check('L3 sticky field below the status bar', field >= inset, { field, inset });
        await ctx.close();
    }
    // L6: narrow mouse window: focusing search keeps the tab bar
    {
        const { ctx, p } = await open({ viewport: { width: 500, height: 900 }, isMobile: false, hasTouch: false });
        await p.click('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(300);
        await p.click('#mSearchInput'); await p.keyboard.type('Song'); await p.waitForTimeout(700);
        const s = await look(p);
        check('L6 mouse window: tab bar stays while typing', !s.kb && s.tabsVis === 'visible', s);
        await ctx.close();
    }
    // R1: back with the find field focused leaves the tab bar visible; A1: no focusable ghost controls
    {
        const { ctx, p } = await open();
        const ghosts = await p.evaluate(() => [...document.querySelectorAll('#musicSidebar button, #musicSidebar input')].filter(el => getComputedStyle(el).visibility !== 'hidden').length);
        check('A1 inactive sidebar controls are hidden', ghosts === 0, ghosts);
        const active = await p.evaluate(() => String(activePlaylistId));
        await p.tap(`.m-rp-tile[data-playlist="${active}"]`); await p.waitForTimeout(900);
        await p.tap('#mPlFind'); await p.keyboard.type('a'); await p.waitForTimeout(300);
        let s = await back(p, 900);
        const findShut = await p.evaluate(() => !document.getElementById('musicSidebar').classList.contains('m-find-open') && document.getElementById('mFilterInput').value === '');
        check('R1a back closes find first (cleared, keyboard flag off)', s.player && !s.kb && findShut, { s, findShut });
        s = await back(p, 900);
        check('R1 then back closes the playlist: tab bar back', !s.player && !s.kb && s.tabsVis === 'visible', s);
        await p.evaluate(() => { document.getElementById('mFilterInput').value = ''; document.getElementById('mFilterInput').dispatchEvent(new Event('input')); });
        const pad = await p.evaluate(() => getComputedStyle(document.getElementById('roomCenter')).scrollPaddingBottom);
        check('A2 scroll-padding keeps focus clear of the bars', parseFloat(pad) >= 120, pad);
        // A3: the You page takes focus; its back button returns it to the avatar
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(400);
        s = await look(p);
        check('A3 the You page takes focus (its back button)', s.active === 'mYouBack', s);
        await p.tap('#mYouBack'); await p.waitForTimeout(700);
        s = await look(p);
        check('A3 its back button closes it, focus back on the avatar', s.modals.length === 0 && s.depth === 0 && s.active === 'mAvatarBtn', s);
        // A6: live status
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(300);
        await p.tap('#mSearchInput'); await p.keyboard.type('zzqqxx'); await p.waitForTimeout(900);
        const st = await p.evaluate(() => document.getElementById('mSearchStatus').textContent);
        check('A6 search status announced', st === 'No songs found', st);
        check('R1/A errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
