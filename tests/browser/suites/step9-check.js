// Step 9: the phone You page (Home avatar) and the Settings / Stats it opens.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });
const STATS = { totalPlays: 12345, distinctSongs: 87, distinctArtists: 1, topSongs: [{ title: 'Top Tune', artist: 'Top Artist', cover: '', plays: 42 }], topArtists: [{ artist: 'Top Artist', plays: 42 }] };

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, locale: opts.locale, storageState: L.state(opts.acct || 'many') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__opts = opts; p.__statsCalls = 0;
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'stats') {
                p.__statsCalls++;
                const mode = p.__opts.stats || 'full';
                if (mode === 'fail') return route.fulfill({ status: 500, contentType: 'text/html', body: '<h1>oops</h1>' });
                const stats = mode === 'empty' ? { totalPlays: 0, distinctSongs: 0, distinctArtists: 0, topSongs: [], topArtists: [] } : (p.__opts.statsData || STATS);
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, range: body.range, stats }) });
            }
            if (body.action === 'recordPlay') return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        if (opts.before) await p.addInitScript(opts.before);
        await p.goto(APP); await p.waitForTimeout(1300);
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => {
        const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
        return {
            tab: document.documentElement.dataset.mTab,
            layer: history.state && history.state.mLayer || null,
            depth: history.state && history.state.mDepth || 0,
            stack: history.state && history.state.mStack ? history.state.mStack.map(x => x.n).join(',') : '',
            you: vis(document.getElementById('mYouPage')),
            crate: vis(document.getElementById('vinylCrateView')),
            tabs: vis(document.getElementById('mTabs')),
            player: document.getElementById('musicPlayerView').classList.contains('active'),
            np: document.body.classList.contains('m-np-open'),
            modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
            settingsTab: (document.querySelector('#settingsTabs .settings-tab.active') || {}).dataset?.tab || null,
            active: document.activeElement && (document.activeElement.id || (document.activeElement.dataset && document.activeElement.dataset.mYou) || document.activeElement.tagName),
        };
    });
    const back = async (p, ms = 650) => { await p.evaluate(() => history.back()); await p.waitForTimeout(ms); return look(p); };

    {
        const { ctx, p } = await open();
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(700);
        let s = await look(p);
        check('Y1 the avatar opens the You page as one back step over Home', s.layer === 'you' && s.depth === 1 && s.you && !s.crate && s.tabs && s.tab === 'home' && s.active === 'mYouBack', s);
        const head = await p.evaluate(() => {
            const ids = Object.keys(playlistsMeta); const songs = ids.reduce((n, id) => n + (Number(playlistsMeta[id].songCount) || 0), 0);
            return { name: document.getElementById('mAccountName').textContent, sub: document.getElementById('mYouSub').textContent, counts: document.getElementById('mYouCounts').textContent, want: `${songs.toLocaleString()} songs in ${ids.length} playlists` };
        });
        check('Y2 header: name, email and live counts', head.name === 'Many' && head.sub === 'many@example.com' && head.counts === head.want, head);
        const card = await p.evaluate(() => ({ tiles: [...document.querySelectorAll('.m-you-stat')].map(t => t.textContent.replace(/\s+/g, ' ').trim()), top: (document.querySelector('.m-you-top') || {}).textContent?.replace(/\s+/g, ' ').trim(), seeAll: !document.getElementById('mYouSeeAll').hidden }));
        check('Y3 Your listening: plays (compact), artists (singular), songs played, most played', JSON.stringify(card.tiles) === JSON.stringify(['12.3K plays', '1 artist', '87 songs played']) && /Most played Top Tune Top Artist 42 plays/.test(card.top) && card.seeAll && p.__statsCalls === 1, card);
        // rows open Settings on their tab, back returns to the page with focus on the row
        for (const tab of ['playback', 'appearance', 'account']) {
            await p.tap(`#mYouPage [data-m-you="${tab}"]`); await p.waitForTimeout(650);
            s = await look(p);
            const ok1 = s.modals.includes('settingsModal') && s.settingsTab === tab && s.depth === 2 && s.layer === 'modal:settings';
            s = await back(p);
            check(`Y4 ${tab} row → Settings on ${tab}; back → the page, focus on the row`, ok1 && s.layer === 'you' && s.you && s.modals.length === 0 && s.active === tab, s);
        }
        await p.tap('#mYouSeeAll'); await p.waitForTimeout(700);
        s = await look(p);
        const range = await p.evaluate(() => (document.querySelector('#statsRange .settings-source-btn.active') || {}).dataset?.range);
        check('Y5 See all opens Stats on All time, over the page', s.modals.includes('statsModal') && s.depth === 2 && range === 'all', { s, range });
        s = await back(p);
        check('Y5 back → the page, focus on See all', s.layer === 'you' && s.active === 'mYouSeeAll', s);
        // Settings on phones: one scroller, no footer Close, no sleeve, source under Advanced
        await p.tap('#mYouPage [data-m-you="playback"]'); await p.waitForTimeout(650);
        const set = await p.evaluate(() => ({
            footer: getComputedStyle(document.querySelector('#settingsModal .add-song-modal-buttons')).display,
            sleeve: getComputedStyle(document.querySelector('#settingsModal .settings-sleeve-group')).display,
            innerMax: getComputedStyle(document.querySelector('#settingsModal .settings-panel-scroll')).maxHeight,
            advanced: !!document.querySelector('#settingsAdvancedDetails #settingsSourceOptions'),
            advancedOpen: document.getElementById('settingsAdvancedDetails').open,
            closeLabel: document.querySelector('#settingsModal .add-song-modal-close').getAttribute('aria-label'),
        }));
        check('Y6 phone Settings: no footer Close or sleeve, one scroller, source under a closed Advanced, labelled ×', set.footer === 'none' && set.sleeve === 'none' && set.innerMax === 'none' && set.advanced && !set.advancedOpen && set.closeLabel === 'Close', set);
        await back(p);
        // the page's back button
        await p.tap('#mYouBack'); await p.waitForTimeout(650);
        s = await look(p);
        check('Y7 the back chevron closes it → Home, focus on the avatar', s.depth === 0 && !s.you && s.crate && s.active === 'mAvatarBtn', s);
        // Home re-tap closes it; Library from it lands on the Library tab
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(500);
        await p.tap('#mTabs .m-tab[data-tab="home"]'); await p.waitForTimeout(650);
        s = await look(p);
        check('Y8 tapping Home closes the page', s.depth === 0 && !s.you && s.tab === 'home', s);
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(500);
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(900);
        s = await look(p);
        check('Y9 Library from the page: the Library tab (the page is gone)', s.tab === 'library' && s.stack === 'tab' && !s.you, s);
        s = await back(p);
        check('Y9 back → Home', s.depth === 0 && s.tab === 'home' && !s.you, s);
        check('Y errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // Now Playing and "Show in playlist" over the page
    {
        const { ctx, p } = await open();
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(500);
        await p.tap('#mDock .m-dock-info, #mDock').catch(() => {}); await p.waitForTimeout(900);
        let s = await look(p);
        const npOk = s.np && s.layer === 'np' && s.depth === 2;
        s = await back(p, 900);
        check('Y10 Now Playing over the page; back → the page', npOk && s.layer === 'you' && s.you && !s.np, s);
        await p.evaluate(() => window.mOpenNowPlaying && window.mOpenNowPlaying()); await p.waitForTimeout(900);
        const goTo = await p.evaluate(() => typeof window.mGoToSong === 'function');
        if (goTo) await p.evaluate(() => window.mGoToSong()); else await p.tap('#mNpKebab').catch(() => {});
        await p.waitForTimeout(1500);
        s = await look(p);
        const plOk = s.player && !s.you && s.stack.startsWith('you');
        s = await back(p, 900);
        check('Y11 Show in playlist over the page hides it; back → the page again', (goTo ? plOk : true) && s.layer === 'you' && s.you && !s.player, { goTo, s });
        await ctx.close();
    }
    // reload keeps the page; rotation closes it
    {
        const { ctx, p } = await open({ before: () => { document.addEventListener('DOMContentLoaded', () => { window.__youAtLoad = document.documentElement.classList.contains('m-you'); }); } });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        await p.reload(); await p.waitForTimeout(1500);
        let s = await look(p);
        const early = await p.evaluate(() => window.__youAtLoad);
        const card = await p.evaluate(() => document.querySelectorAll('.m-you-stat').length);
        check('Y12 a reload on the page brings it back (no Home flash), stats loaded', s.layer === 'you' && s.depth === 1 && s.you && early === true && card === 3, { s, early, card });
        s = await back(p);
        check('Y12 back → Home', s.depth === 0 && !s.you, s);
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(500);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(1200);
        s = await look(p);
        const cls = await p.evaluate(() => document.documentElement.classList.contains('m-you'));
        check('Y13 rotating to landscape closes the page', !s.stack.includes('you') && !cls && !s.you, { s, cls });
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(900);
        s = await look(p);
        check('Y13 and back in portrait it stays closed', !s.you && s.depth === 0, s);
        check('Y errors (reload/rotate)', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // stats states: empty, failure + retry
    {
        const { ctx, p } = await open({ acct: 'demo', stats: 'empty' });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(700);
        const e = await p.evaluate(() => ({ note: document.getElementById('mYouListen').textContent.trim(), seeAll: document.getElementById('mYouSeeAll').hidden, counts: document.getElementById('mYouCounts').textContent }));
        check('Y14 no plays yet: a sentence, no See all; counts say what there is', /Play some songs/.test(e.note) && e.seeAll === true && /^0 songs in 1 playlist$/.test(e.counts), e);
        await back(p);
        p.__opts.stats = 'fail';
        await p.evaluate(() => { /* forget the cached answer */ });
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'demo', stats: 'fail' });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(800);
        const f = await p.evaluate(() => ({ note: document.getElementById('mYouListen').textContent.trim(), retry: !!document.querySelector('.m-you-retry') }));
        p.__opts.stats = 'full';
        await p.tap('.m-you-retry'); await p.waitForTimeout(700);
        const r = await p.evaluate(() => document.querySelectorAll('.m-you-stat').length);
        check('Y15 a failed load says so and Try again works', /Couldn.t load/.test(f.note) && f.retry && r === 3, { f, r });
        await ctx.close();
    }
    // name / email hooks; log out; layout at 360x640
    {
        const { ctx, p } = await open({ viewport: { width: 360, height: 640 } });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        const h = await p.evaluate(() => {
            window.mOnAccountName('Zed');
            const a = { name: document.getElementById('mAccountName').textContent, coins: [...document.querySelectorAll('.m-avatar')].map(x => x.textContent) };
            window.mOnAccountEmail('zed@example.com');
            a.sub = document.getElementById('mYouSub').textContent;
            const f = document.querySelector('.m-you-logout-form');
            a.logout = { method: f.method, action: new URL(f.action).pathname, csrf: !!f.querySelector('input[name="_token"]'), type: f.querySelector('button').type };
            const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight;
            return a;
        });
        await p.waitForTimeout(300);
        const lay = await p.evaluate(() => {
            const lo = document.querySelector('.m-you-logout').getBoundingClientRect();
            const dock = document.getElementById('mDock').getBoundingClientRect();
            const tabs = document.getElementById('mTabs').getBoundingClientRect();
            const y = document.getElementById('mYouPage');
            return { logoutBottom: lo.bottom, dockTop: dock.top, tabsTop: tabs.top, dockShown: getComputedStyle(document.getElementById('mDock')).visibility !== 'hidden' && dock.height > 0, hScroll: y.scrollWidth > y.clientWidth, raised: y.classList.contains('m-you-raised') };
        });
        check('Y16 name and email updates reach the page and every avatar', h.name === 'Zed' && h.coins.every(c => c === 'Z') && h.sub === 'zed@example.com', h);
        check('Y17 Log out posts to /logout with the CSRF token', h.logout.method === 'post' && h.logout.action === '/logout' && h.logout.csrf && h.logout.type === 'submit', h.logout);
        check('Y18 at 360x640, scrolled down, Log out clears the mini player; no sideways scroll; the bar gets a background', lay.logoutBottom <= Math.min(lay.dockShown ? lay.dockTop : Infinity, lay.tabsTop) && !lay.hScroll && lay.raised, lay);
        await ctx.close();
    }
    // review fixes
    {
        const { ctx, p } = await open({ viewport: { width: 360, height: 640 }, before: () => { try { localStorage.setItem('statsRange', 'week'); } catch (e) {} } });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(700);
        // labels fit at 360
        const fit = await p.evaluate(() => [...document.querySelectorAll('.m-you-stat span')].every(sp => sp.scrollWidth <= sp.clientWidth + 1));
        check('Y20 stat labels fit (wrap, not cut) at 360px', fit, fit);
        // reopen at the top
        await p.mouse.wheel(0, 600); await p.evaluate(() => { const y = document.getElementById('mYouPage'); y.scrollTop = y.scrollHeight; }); await p.waitForTimeout(300);
        await p.tap('#mYouBack'); await p.waitForTimeout(600);
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        const top = await p.evaluate(() => ({ st: document.getElementById('mYouPage').scrollTop, nameTop: document.getElementById('mAccountName').getBoundingClientRect().top }));
        check('Y21 reopening starts at the top (header showing)', top.st === 0 && top.nameTop > 40, top);
        // See all's All time doesn't stick
        await p.tap('#mYouSeeAll'); await p.waitForTimeout(600);
        const during = await p.evaluate(() => statsRange);
        await p.evaluate(() => history.back()); await p.waitForTimeout(600);
        const after = await p.evaluate(() => statsRange);
        check('Y22 See all opens on All time; the remembered range (Week) comes back after', during === 'all' && after === 'week', { during, after });
        // counts refresh when the page shows again; playlist back label
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(800);
        await p.evaluate(() => { playlistsMeta[String(activePlaylistId)].songCount += 5; });
        await p.evaluate(() => window.mGoToSong()); await p.waitForTimeout(1500);
        const label = await p.evaluate(() => document.getElementById('mPlBack').getAttribute('aria-label'));
        await p.evaluate(() => history.back()); await p.waitForTimeout(800);
        const counts = await p.evaluate(() => { const ids = Object.keys(playlistsMeta); const n = ids.reduce((a, id) => a + (Number(playlistsMeta[id].songCount) || 0), 0); return { shown: document.getElementById('mYouCounts').textContent, want: `${n.toLocaleString()} songs` }; });
        check('Y23 a playlist over the page says "Back to You"; back on the page the counts are current', label === 'Back to You' && counts.shown.startsWith(counts.want), { label, counts });
        await p.evaluate(() => history.back()); await p.waitForTimeout(700);
        const label2 = await p.evaluate(() => document.getElementById('mPlBack').getAttribute('aria-label'));
        check('Y23 with the page closed it is "Back to Home" again', label2 === 'Back to Home', label2);
        await ctx.close();
    }
    {
        // landscape reload keeps [you, playlist]
        const { ctx, p } = await open();
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(500);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(800);
        await p.evaluate(() => window.mGoToSong()); await p.waitForTimeout(1500);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(1000);
        const before = await look(p);
        await p.reload(); await p.waitForTimeout(1600);
        let s = await look(p);
        check('Y24 landscape reload with a playlist over the page keeps the playlist', before.stack === 'you,playlist' && s.stack === 'you,playlist' && s.player, { before, s });
        s = await back(p, 1200);
        check('Y24 back there → the crate (the page folds)', s.depth === 0 && !s.player, s);
        check('Y errors (landscape reload)', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        // Try again keeps keyboard focus
        const { ctx, p } = await open({ acct: 'demo', stats: 'fail', isMobile: false, hasTouch: false });
        await p.setViewportSize({ width: 390, height: 844 });
        await p.evaluate(() => document.getElementById('mAvatarBtn').click()); await p.waitForTimeout(800);
        p.__opts.stats = 'full';
        await p.focus('.m-you-retry'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
        const f = await p.evaluate(() => document.activeElement && document.activeElement.id);
        check('Y25 Try again by keyboard: focus lands on See all, not <body>', f === 'mYouSeeAll', f);
        await ctx.close();
    }
    {
        // after a landscape reload under a playlist, rotating back shows a filled card
        const { ctx, p } = await open();
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(500);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(800);
        await p.evaluate(() => window.mGoToSong()); await p.waitForTimeout(1500);
        await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(1000);
        await p.reload(); await p.waitForTimeout(1600);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(900);
        let s = await back(p, 1000);
        const tiles = await p.evaluate(() => document.querySelectorAll('.m-you-stat').length);
        check('Y26 landscape reload, rotate back, back: the You page with its stats', s.layer === 'you' && s.you && tiles === 3, { s, tiles });
        await ctx.close();
    }
    {
        // wide compact numbers (ru) stay inside their tiles at 320px
        const { ctx, p } = await open({ viewport: { width: 320, height: 568 }, locale: 'ru-RU', statsData: { totalPlays: 123456, distinctSongs: 23456, distinctArtists: 3456, topSongs: [], topArtists: [] } });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(800);
        const w = await p.evaluate(() => [...document.querySelectorAll('.m-you-stat')].map(t => { const b = t.querySelector('b'); const tr = t.getBoundingClientRect(); const br = b.getBoundingClientRect(); return { txt: b.textContent, inside: br.right <= tr.right - 4 + 0.5 && b.scrollWidth <= b.clientWidth + 1 }; }));
        check('Y27 ru compact numbers fit their tiles at 320px', w.length === 3 && w.every(x => x.inside), w);
        await ctx.close();
    }
    // desktop and landscape never show the page
    for (const vp of [{ width: 1280, height: 800, isMobile: false, hasTouch: false }, { width: 844, height: 390 }]) {
        const { ctx, p } = await open({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
        const d = await p.evaluate(() => ({ you: getComputedStyle(document.getElementById('mYouPage')).display, avatar: getComputedStyle(document.getElementById('mHomeHead')).display, footer: getComputedStyle(document.querySelector('#settingsModal .add-song-modal-buttons')).display }));
        check(`Y19 ${vp.width}x${vp.height}: no You page or avatar; Settings keeps its Close`, d.you === 'none' && d.avatar === 'none' && d.footer !== 'none', d);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
