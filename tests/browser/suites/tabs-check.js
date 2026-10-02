// Phone tabs: history walks, tab switching, reload restore, rotation,
// member welcome guard, app shell and desktop sanity. Prints PASS/FAIL per check.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const STATE = L.state('mid');
const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); };

(async () => {
    const b = await L.launch();
    async function phone(opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, storageState: STATE });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com\/(iframe_api|embed|s\/player)|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: [] }) }));
        // Never switch the account's active playlist on the server: fake switchPlaylist
        // with the real playlist data from getAll-free boot meta (read it from the page).
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'recordPlay') return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        if (opts.before) await opts.before(p);
        await p.goto('about:blank'); await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1300);
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({
        url: location.href,
        tab: document.documentElement.dataset.mTab,
        layer: history.state && history.state.mLayer || null,
        depth: history.state && history.state.mDepth || 0,
        stack: history.state && history.state.mStack ? history.state.mStack.map(x => x.n + (x.t ? ':' + x.t : '') + (x.p ? ':' + x.p : '')).join(',') : '',
        player: document.getElementById('musicPlayerView').classList.contains('active'),
        np: document.body.classList.contains('m-np-open'),
        searchVisible: (() => { const s = document.getElementById('mSearchPage'); const cs = getComputedStyle(s); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
        tabsVisible: (() => { const t = document.getElementById('mTabs'); const cs = getComputedStyle(t); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
        current: (document.querySelector('#mTabs .m-tab[aria-current="page"]') || {}).dataset?.tab || null,
        modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
        youVisible: (() => { const y = document.getElementById('mYouPage'); const cs = getComputedStyle(y); return cs.display !== 'none' && cs.visibility !== 'hidden'; })(),
        settingsTab: (document.querySelector('#settingsTabs .settings-tab.active') || {}).dataset?.tab || null,
    })).catch(() => ({ url: p.url(), left: true }));
    const back = async (p, ms = 600) => { await p.evaluate(() => history.back()).catch(() => {}); await p.waitForTimeout(ms); return look(p); };
    const tapTab = async (p, t, ms = 500) => { await p.tap(`#mTabs .m-tab[data-tab="${t}"]`); await p.waitForTimeout(ms); return look(p); };
    const otherPlaylist = (p) => p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)));

    // A. Home → Library → card (active playlist) → back → back → leaves
    {
        const { ctx, p } = await phone();
        let s = await look(p);
        check('A0 boots on Home with tab bar', s.tab === 'home' && s.current === 'home' && s.tabsVisible && s.depth === 0, s);
        s = await tapTab(p, 'library');
        check('A1 Library pushes one tab layer', s.tab === 'library' && s.depth === 1 && s.stack === 'tab:library', s);
        const active = await p.evaluate(() => String(activePlaylistId));
        await p.evaluate((id) => document.querySelector(`.record-card[data-playlist="${id}"]`).scrollIntoView({ block: 'center' }), active);
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        s = await look(p);
        check('A2 card opens playlist over Library, tabs stay', s.player && s.depth === 2 && s.stack === `tab:library,playlist:${active}` && s.tabsVisible && s.current === 'library', s);
        s = await back(p);
        check('A3 back → Library root', !s.player && s.tab === 'library' && s.depth === 1, s);
        s = await back(p);
        check('A4 back → Home', s.tab === 'home' && s.depth === 0 && !s.left, s);
        s = await back(p);
        check('A5 back on Home leaves the app', s.left || s.url === 'about:blank', s);
        check('A errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // B. Library → Search (relabel, no new entry) → back → Home
    {
        const { ctx, p } = await phone();
        await tapTab(p, 'library');
        const len1 = await p.evaluate(() => history.length);
        let s = await tapTab(p, 'search');
        const len2 = await p.evaluate(() => history.length);
        check('B1 Library→Search relabels (no new entry)', s.tab === 'search' && s.depth === 1 && s.stack === 'tab:search' && len1 === len2 && s.searchVisible, { s, len1, len2 });
        s = await back(p);
        check('B2 back from Search → Home', s.tab === 'home' && s.depth === 0 && !s.searchVisible, s);
        // Many switches keep history bounded
        for (let i = 0; i < 6; i++) { await tapTab(p, 'library', 150); await tapTab(p, 'search', 150); await tapTab(p, 'home', 250); }
        s = await look(p);
        check('B3 many switches end on Home at depth 0', s.tab === 'home' && s.depth === 0, s);
        s = await back(p);
        check('B4 then back leaves', s.left || s.url === 'about:blank', s);
        await ctx.close();
    }

    // C. Search hit → playlist over Search → back → Search with results intact; D. NP over Search
    {
        const { ctx, p } = await phone();
        await tapTab(p, 'search');
        const q = await p.evaluate(() => { const s = [...songsData, ...recentSongs].find(s => s.title && s.title.length >= 4); return s.title.slice(0, 4); });
        await p.tap('#mSearchInput'); await p.keyboard.type(q); await p.waitForTimeout(900);
        await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
        const n1 = await p.evaluate(() => document.querySelectorAll('#mSearchResults [data-lib]').length);
        // pick a hit in the ACTIVE playlist so the server's active playlist doesn't change
        const idx = await p.evaluate(() => [...document.querySelectorAll('#mSearchResults [data-open]')].findIndex(r => r.querySelector('.search-result-pl').textContent === playlistsMeta[activePlaylistId].name));
        await p.evaluate((i) => document.querySelectorAll('#mSearchResults [data-open]')[i].scrollIntoView({ block: 'center' }), Math.max(0, idx));
        await p.tap(`#mSearchResults [data-open="${Math.max(0, idx)}"]`); await p.waitForTimeout(1200);
        let s = await look(p);
        check('C1 hit opens playlist over Search', s.player && s.depth === 2 && s.stack.startsWith('tab:search,playlist') && !s.searchVisible && s.current === 'search', { s, n1, idx });
        s = await back(p);
        const after = await p.evaluate(() => ({ n: document.querySelectorAll('#mSearchResults [data-lib]').length, v: document.getElementById('mSearchInput').value }));
        check('C2 back → Search with results intact', s.searchVisible && !s.player && s.depth === 1 && after.n === n1 && after.v === q, { s, after, n1 });
        await p.tap('#mDockInfo'); await p.waitForTimeout(700);
        s = await look(p);
        check('D1 NP opens over Search, tabs hide', s.np && s.depth === 2 && !s.tabsVisible && s.stack === 'tab:search,np', s);
        const npHit = await p.evaluate(() => { const r = document.getElementById('mPlayBtn').getBoundingClientRect(); const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el && (el.id === 'mPlayBtn' || !!el.closest('#mPlayBtn')); });
        check('D2 NP play button is the tap target', npHit, npHit);
        s = await back(p);
        check('D3 back closes NP → Search', !s.np && s.searchVisible && s.depth === 1 && s.tabsVisible, s);
        check('C/D errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // E. switching tabs while a playlist is open; F. re-tap pops to root
    {
        const { ctx, p } = await phone();
        const active = await p.evaluate(() => String(activePlaylistId));
        await tapTab(p, 'library');
        await p.evaluate((id) => document.querySelector(`.record-card[data-playlist="${id}"]`).scrollIntoView({ block: 'center' }), active);
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        let s = await tapTab(p, 'search', 900);
        check('E1 Search while playlist open: playlist closes, Search shows', s.tab === 'search' && !s.player && s.depth === 1 && s.stack === 'tab:search' && s.searchVisible, s);
        await tapTab(p, 'library');
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        s = await tapTab(p, 'library', 800);
        check('F1 re-tap Library pops the playlist', s.tab === 'library' && !s.player && s.depth === 1, s);
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        s = await tapTab(p, 'home', 900);
        check('E2 Home while playlist open over Library → Home root', s.tab === 'home' && !s.player && s.depth === 0, s);
        // Home tile → playlist over Home → Library tab → Library root (not playlist)
        await p.tap(`.m-rp-tile[data-playlist="${active}"]`); await p.waitForTimeout(900);
        s = await look(p);
        check('E3 Home tile opens playlist over Home', s.player && s.depth === 1 && s.stack === `playlist:${active}` && s.current === 'home', s);
        s = await tapTab(p, 'library', 900);
        check('E4 then Library: playlist closed, Library root', s.tab === 'library' && !s.player && s.depth === 1 && s.stack === 'tab:library', s);
        // rapid taps converge on the last one
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.tap('#mTabs .m-tab[data-tab="home"]'); await p.tap('#mTabs .m-tab[data-tab="library"]');
        await p.waitForTimeout(1200);
        s = await look(p);
        check('E5 rapid taps end on the last tab', s.tab === 'library' && s.depth === 1 && s.current === 'library', s);
        check('E/F errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // G. Reload restore
    {
        const { ctx, p } = await phone();
        const active = await p.evaluate(() => String(activePlaylistId));
        await tapTab(p, 'library');
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        await p.tap('#mDockInfo'); await p.waitForTimeout(600);
        let s = await look(p);
        check('G0 stack before reload', s.stack === `tab:library,playlist:${active},np`, s);
        await p.reload(); await p.waitForTimeout(1500);
        s = await look(p);
        check('G1 reload restores Library + playlist, drops NP entry', s.tab === 'library' && s.player && !s.np && s.depth === 2 && s.current === 'library', s);
        s = await back(p);
        check('G2 back → Library root (no dead press)', s.tab === 'library' && !s.player && s.depth === 1, s);
        s = await back(p);
        check('G3 back → Home', s.tab === 'home' && s.depth === 0 && !s.left, s);
        s = await back(p);
        check('G4 back leaves', s.left || s.url === 'about:blank', s);
        // Reload on Search keeps the query
        const r2 = await phone();
        await tapTab(r2.p, 'search');
        await r2.p.tap('#mSearchInput'); await r2.p.keyboard.type('Song'); await r2.p.waitForTimeout(800);
        await r2.p.reload(); await r2.p.waitForTimeout(1500);
        s = await look(r2.p);
        const v = await r2.p.evaluate(() => ({ v: document.getElementById('mSearchInput').value, n: document.querySelectorAll('#mSearchResults [data-lib]').length }));
        check('G5 reload on Search keeps tab and query', s.tab === 'search' && s.searchVisible && v.v === 'Song' && v.n > 0, { s, v });
        check('G errors', p.__errs.length === 0 && r2.p.__errs.length === 0, [p.__errs, r2.p.__errs]);
        await r2.ctx.close();
        await ctx.close();
    }

    // I. Jump back in plays in place; J. account sheet → settings
    {
        const { ctx, p } = await phone();
        const before = await p.evaluate(() => ({ idx: currentSongIndex, radio: !!currentRadioSong }));
        await p.evaluate(() => document.querySelector('.recent-song').scrollIntoView({ block: 'center' }));
        await p.evaluate(() => { window.__played = []; const o = window.playSongSource; window.playSongSource = function (s, cue) { window.__played.push([s && s.title, cue]); }; });
        await p.tap('.recent-song:nth-child(2)'); await p.waitForTimeout(600);
        let s = await look(p);
        const played = await p.evaluate(() => window.__played);
        check('I1 Jump back in plays in place (stays on Home)', s.tab === 'home' && !s.player && s.depth === 0, { s, played, before });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(400);
        s = await look(p);
        check('J1 avatar opens the You page as a layer', s.layer === 'you' && s.depth === 1 && s.modals.length === 0 && s.youVisible, s);
        await p.tap('#mYouPage [data-m-you="account"]'); await p.waitForTimeout(700);
        s = await look(p);
        check('J2 the Account row opens Settings on Account, over the page', s.modals.includes('settingsModal') && s.depth === 2 && s.layer === 'modal:settings' && s.settingsTab === 'account', s);
        s = await back(p);
        check('J3 back closes Settings → the You page', s.modals.length === 0 && s.depth === 1 && s.layer === 'you' && s.youVisible, s);
        await p.waitForTimeout(600);
        await p.tap('#mYouSeeAll'); await p.waitForTimeout(700);
        s = await look(p);
        check('J4 See all opens Stats over the page', s.modals.includes('statsModal') && s.depth === 2, s);
        s = await back(p);
        check('J5 back closes Stats, then the page → Home', s.modals.length === 0 && s.depth === 1 && s.youVisible, s);
        s = await back(p);
        check('J5 ...and back again → Home', s.depth === 0 && !s.youVisible && s.tab === 'home', s);
        await tapTab(p, 'library');
        await p.tap('#mLibraryNew'); await p.waitForTimeout(400);
        await p.tap('#mAddSheet [data-m-add="playlist"]'); await p.waitForTimeout(700);
        s = await look(p);
        check('J6 Library + → New playlist opens it', s.modals.includes('playlistEditModal') && !s.modals.includes('mAddSheet') && s.depth === 2, s);
        s = await back(p);
        check('J7 back closes it → Library', s.modals.length === 0 && s.depth === 1 && s.tab === 'library', s);
        check('I/J errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // K. Rotation
    {
        const { ctx, p } = await phone();
        await tapTab(p, 'search');
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(900);
        let s = await look(p);
        check('K1 landscape: tab layer folded, no tab bar, no search page', s.depth === 0 && !s.tabsVisible && !s.searchVisible && s.tab === 'home', s);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(900);
        s = await look(p);
        check('K2 back to portrait: Home, tabs visible', s.tab === 'home' && s.tabsVisible && s.depth === 0, s);
        // playlist survives rotation; back in landscape returns to crate without a dead press
        const active = await p.evaluate(() => String(activePlaylistId));
        await tapTab(p, 'library');
        await p.tap(`.record-card[data-playlist="${active}"]`); await p.waitForTimeout(900);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(900);
        s = await look(p);
        check('K3 landscape keeps the playlist', s.player && s.stack === `tab:library,playlist:${active}`, s);
        s = await back(p, 1000);
        check('K4 landscape back → crate, bare tab folded (depth 0)', !s.player && s.depth === 0, s);
        // landscape search modal → rotate to portrait → Search tab
        await p.evaluate(() => showSearchModal()); await p.waitForTimeout(400);
        s = await look(p);
        check('K5 landscape search is the modal', s.modals.includes('searchModal') && s.depth === 1, s);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(1200);
        s = await look(p);
        check('K6 portrait again: modal closed, Search tab', !s.modals.includes('searchModal') && s.tab === 'search' && s.searchVisible && s.depth === 1, s);
        check('K errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // L. Member welcome guard: back and rotation must not freeze; continue drops the guard
    {
        const { ctx, p } = await phone({
            before: async (p) => {
                await p.route(APP, async (route) => {
                    const resp = await route.fetch();
                    let html = await resp.text();
                    html = html.replace('<!-- Settings Modal', '<div class="add-song-modal" id="memberWelcomeModal"><div class="add-song-modal-panel"><input id="memberWelcomeName"><button id="memberWelcomeContinue" onclick="finishMemberWelcome()">Continue</button></div></div><!-- Settings Modal');
                    route.fulfill({ response: resp, body: html, headers: { ...resp.headers(), 'content-type': 'text/html; charset=utf-8' } });
                });
            },
        });
        let s = await look(p);
        check('L0 welcome guard up', s.modals.includes('memberWelcomeModal') && s.layer === 'memberWelcome', s);
        const t0 = Date.now();
        s = await back(p, 700);
        check('L1 back with the card up: no freeze, card stays, guard re-armed', !s.left && s.modals.includes('memberWelcomeModal') && s.layer === 'memberWelcome' && Date.now() - t0 < 4000, s);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(700);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(700);
        s = await look(p);
        check('L2 rotation with the card up: no freeze', !s.left && s.modals.includes('memberWelcomeModal'), s);
        await p.tap('#memberWelcomeContinue'); await p.waitForTimeout(900);
        s = await look(p);
        check('L3 continue drops the guard', !s.modals.includes('memberWelcomeModal') && s.depth === 0, s);
        s = await tapTab(p, 'library');
        check('L4 tabs work after', s.tab === 'library' && s.depth === 1, s);
        await ctx.close();
    }

    // M. Landscape + desktop + app shell sanity
    {
        const land = await phone({ viewport: { width: 844, height: 390 } });
        let s = await look(land.p);
        const landUi = await land.p.evaluate(() => ({ toolbar: getComputedStyle(document.querySelector('.collection-toolbar')).display, greet: getComputedStyle(document.querySelector('.greeting-text')).display, home: getComputedStyle(document.getElementById('mHomeHead')).display }));
        check('M1 landscape: full crate, no tabs/home header', !s.tabsVisible && landUi.toolbar !== 'none' && landUi.greet !== 'none' && landUi.home === 'none', { s, landUi });
        await land.ctx.close();
        const desk = await phone({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
        s = await look(desk.p);
        const deskUi = await desk.p.evaluate(() => ({ tabs: getComputedStyle(document.getElementById('mTabs')).display, home: getComputedStyle(document.getElementById('mHomeHead')).display, rp: getComputedStyle(document.getElementById('mRecentPlaylists')).display, search: getComputedStyle(document.getElementById('mSearchPage')).display, greet: getComputedStyle(document.querySelector('.greeting-text')).display, dock: getComputedStyle(document.getElementById('mDock')).display }));
        check('M2 desktop: nothing new shows', deskUi.tabs === 'none' && deskUi.home === 'none' && deskUi.rp === 'none' && deskUi.search === 'none' && deskUi.greet !== 'none' && deskUi.dock === 'none', deskUi);
        await desk.p.screenshot({ path: L.shot('tabs-shots', 'desktop.png') });
        check('M2 desktop errors', desk.p.__errs.length === 0, desk.p.__errs);
        await desk.ctx.close();
        const app = await phone({ query: '?app=1' });
        const appUi = await app.p.evaluate(() => ({ cls: document.documentElement.className, tab: document.documentElement.dataset.mTab || null, tabs: getComputedStyle(document.getElementById('mTabs')).display, dock: getComputedStyle(document.getElementById('mDock')).display, toolbar: getComputedStyle(document.querySelector('.collection-toolbar')).display, greet: getComputedStyle(document.querySelector('.greeting-text')).display, home: getComputedStyle(document.getElementById('mHomeHead')).display }));
        check('M3 app shell: no tabs, no dead dock, crate intact', appUi.cls.includes('app-shell') && !appUi.tab && appUi.tabs === 'none' && appUi.dock === 'none' && appUi.toolbar !== 'none' && appUi.greet !== 'none' && appUi.home === 'none', appUi);
        await app.p.screenshot({ path: L.shot('tabs-shots', 'app-shell.png') });
        check('M3 app errors', app.p.__errs.length === 0, app.p.__errs);
        await app.ctx.close();
    }

    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
