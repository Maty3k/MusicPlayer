// Step 5: the phone playlist screen (top bar, one scroller, action row, find,
// the ⋯ menu, reorder mode, empty state, song-sheet Like).
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
            if (['recordPlay', 'reorder', 'favorite', 'deletePlaylist', 'switch', 'rename', 'recolor', 'setCover'].includes(body.action)) {
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, favorited: true, key: 'k' }) });
            }
            if (body.action === 'share') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, url: 'http://127.0.0.1:8123/s/testtoken' }) });
            return route.continue();
        });
        if (opts.init) await p.addInitScript(opts.init);
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.openPlaylist !== false) {
            const active = await p.evaluate(() => String(activePlaylistId));
            await p.tap(`.m-rp-tile[data-playlist="${active}"]`); await p.waitForTimeout(900);
        }
        return { ctx, p };
    }
    const vis = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }, sel);
    const look = (p) => p.evaluate(() => ({
        depth: history.state && history.state.mDepth || 0,
        layer: history.state && history.state.mLayer,
        player: document.getElementById('musicPlayerView').classList.contains('active'),
        modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
        cls: document.getElementById('musicSidebar').className,
    }));
    const back = async (p) => { await p.evaluate(() => history.back()); await p.waitForTimeout(650); return look(p); };

    // ---- layout, scroller, title-in-bar
    {
        const { ctx, p } = await open('many');
        const ui = await p.evaluate(() => {
            const sb = document.getElementById('musicSidebar'), list = document.getElementById('songList');
            return {
                sbScrolls: sb.scrollHeight > sb.clientHeight + 50, listScrolls: list.scrollHeight > list.clientHeight + 5,
                count: document.querySelector('.sidebar-track-count').textContent,
                moreLabel: document.querySelector('#songList .song-send-btn').getAttribute('aria-label'),
                backLabel: document.getElementById('mPlBack').getAttribute('aria-label'),
                title: getComputedStyle(document.getElementById('mPlBarTitle')).opacity,
            };
        });
        check('P1 top bar shown; old back pill and header circles gone', await vis(p, '#mPlBar') && !(await vis(p, '#backToCrate')) && !(await vis(p, '.queue-btn')) && !(await vis(p, '.settings-gear-btn')), ui);
        check('P2 the sidebar is the one scroller', ui.sbScrolls && !ui.listScrolls, ui);
        check('P3 counts say songs; ⋯ and back have names', /^\d+ songs?$/.test(ui.count) && ui.moreLabel.startsWith('More options for') && ui.backLabel === 'Back to Home', ui);
        check('P4 bar title hidden at the top', ui.title === '0', ui);
        await p.evaluate(() => { document.getElementById('musicSidebar').scrollTop = 400; }); await p.waitForTimeout(400);
        const sc = await p.evaluate(() => ({ cls: document.getElementById('musicSidebar').className, op: getComputedStyle(document.getElementById('mPlBarTitle')).opacity, barTop: document.getElementById('mPlBar').getBoundingClientRect().top, text: document.getElementById('mPlBarTitle').textContent }));
        check('P5 scrolled: bar raised, title in the bar, bar stays at the top', sc.cls.includes('m-pl-raised') && sc.cls.includes('m-pl-titled') && sc.op === '1' && sc.barTop < 2 && sc.text.length > 0, sc);
        // leave and come back: starts at the top
        await back(p);
        const active = await p.evaluate(() => String(activePlaylistId));
        await p.tap(`.m-rp-tile[data-playlist="${active}"]`); await p.waitForTimeout(900);
        const top = await p.evaluate(() => document.getElementById('musicSidebar').scrollTop);
        check('P6 reopened playlist starts at the top', top === 0, top);
        // end of the list clears the dock and tab bar
        await p.evaluate(() => { const sb = document.getElementById('musicSidebar'); sb.scrollTop = sb.scrollHeight; }); await p.waitForTimeout(300);
        const clear = await p.evaluate(() => { const rows = [...document.querySelectorAll('#songList > .song-list-item:not(.discover-item)')]; const last = rows[rows.length - 1].getBoundingClientRect(); const dock = document.getElementById('mDock').getBoundingClientRect(); const lastAny = [...document.querySelectorAll('#songList > li')].pop().getBoundingClientRect(); return { lastAnyBottom: lastAny.bottom, dockTop: dock.top }; });
        check('P7 the list ends above the mini player', clear.lastAnyBottom <= clear.dockTop + 1, clear);
        check('P errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- action row: shuffle states, Play
    {
        const { ctx, p } = await open('many', { init: () => { try { localStorage.setItem('mShuffleMode', 'off'); } catch (e) {} } });
        const states = [];
        for (let i = 0; i < 3; i++) {
            states.push(await p.evaluate(() => { const c = document.getElementById('mShuffleChip'); return { mode: c.dataset.mode, pressed: c.getAttribute('aria-pressed'), label: c.getAttribute('aria-label'), text: c.querySelector('.m-shuffle-label').textContent, spark: getComputedStyle(c, '::before').content, icon: !!c.querySelector('svg') }; }));
            await p.evaluate(() => { window.fetchRadioRecommendations = () => {}; });
            await p.tap('#mShuffleChip'); await p.waitForTimeout(250);
        }
        check('A1 shuffle cycles off → on → smart, icon kept, labelled', states[0].mode === 'off' && states[1].mode === 'shuffle' && states[1].pressed === 'true' && states[2].mode === 'smart' && states[2].spark.includes('✦') && states.every(s => s.icon) && states[2].label.startsWith('Smart mix'), states);
        await p.evaluate(() => { window.__tm = 0; window.toggleMusic = () => { window.__tm++; document.getElementById('vinyl').classList.add('playing'); }; });
        await p.tap('#mPlayAll'); await p.waitForTimeout(700);
        const s = await look(p);
        const tm = await p.evaluate(() => window.__tm);
        check('A2 round Play starts playback and opens Now Playing', tm === 1 && s.layer === 'np', { s, tm });
        await back(p);
        await p.tap('#mPlAdd'); await p.waitForTimeout(500);
        const s2 = await look(p);
        check('A3 Add songs opens the add sheet', s2.modals.includes('addSongModal') && s2.layer === 'modal:addSong', s2);
        await back(p);
        await ctx.close();
    }

    // ---- find
    {
        const { ctx, p } = await open('many');
        await p.tap('#mPlFind'); await p.waitForTimeout(300);
        let s = await look(p);
        const f = await p.evaluate(() => ({ focused: document.activeElement.id, exp: document.getElementById('mPlFind').getAttribute('aria-expanded') }));
        check('F1 find opens as a layer, field focused', s.layer === 'find' && s.cls.includes('m-find-open') && f.focused === 'mFilterInput' && f.exp === 'true', { s, f });
        await p.keyboard.type('Song 1'); await p.waitForTimeout(300);
        const n = await p.evaluate(() => [...document.querySelectorAll('#songList .song-list-item:not(.discover-item)')].filter(r => getComputedStyle(r).display !== 'none').length);
        const all = await p.evaluate(() => songsData.length);
        await p.keyboard.type('zzz'); await p.waitForTimeout(300);
        const msg = await p.evaluate(() => document.getElementById('mFilterEmpty').textContent);
        check('F2 filters, then says when nothing matches', n > 0 && n < all && msg.includes('No songs here match'), { n, all, msg });
        s = await back(p);
        const after = await p.evaluate(() => ({ v: document.getElementById('mFilterInput').value, shown: [...document.querySelectorAll('#songList .song-list-item:not(.discover-item)')].filter(r => getComputedStyle(r).display !== 'none').length, msg: document.getElementById('mFilterEmpty').textContent }));
        const total = await p.evaluate(() => songsData.length);
        check('F3 back closes find and clears the filter', !s.cls.includes('m-find-open') && s.layer === 'playlist' && after.v === '' && after.shown === total && after.msg === '', { s, after, total });
        await p.tap('#mPlFind'); await p.waitForTimeout(300);
        await p.tap('#mPlFind'); await p.waitForTimeout(600);
        s = await look(p);
        check('F4 the icon closes it too', !s.cls.includes('m-find-open') && s.layer === 'playlist', s);
        await ctx.close();
    }

    // ---- the ⋯ menu
    {
        const { ctx, p } = await open('many', { init: () => { window.__shared = []; Object.defineProperty(navigator, 'share', { value: (d) => { window.__shared.push(d); return Promise.resolve(); }, configurable: true }); } });
        await p.tap('#mPlMore'); await p.waitForTimeout(450);
        let s = await look(p);
        const rows = await p.evaluate(() => [...document.querySelectorAll('#mPlaylistSheet .m-sheet-row')].filter(r => !r.hidden).map(r => r.dataset.mPl));
        const head = await p.evaluate(() => ({ t: document.getElementById('mPlaylistSheetTitle').textContent, f: document.activeElement.dataset.mPl, want: playlistsMeta[activePlaylistId].name, id: String(activePlaylistId) }));
        check('M1 ⋯ opens the playlist menu as a layer', s.modals.includes('mPlaylistSheet') && s.layer === 'modal:playlistMenu' && head.t === head.want && head.f === 'add', { s, head });
        check('M2 rows: offline hidden without uploads (Scan moved into Add songs)', JSON.stringify(rows) === JSON.stringify(['add', 'import', 'reorder', 'edit', 'share', 'queue', 'delete']), rows);
        const go = async (key, modal) => {
            await p.tap(`#mPlaylistSheet [data-m-pl="${key}"]`); await p.waitForTimeout(700);
            const r = await look(p);
            const ok = r.modals.includes(modal) && !r.modals.includes('mPlaylistSheet') && r.depth === 2;
            await back(p);
            await p.tap('#mPlMore'); await p.waitForTimeout(400);
            return { ok, r };
        };
        const add = await go('add', 'addSongModal');
        const imp = await go('import', 'spotifyImportModal');
        const edit = await go('edit', 'playlistEditModal');
        const queue = await go('queue', 'queueModal');
        check('M3 rows open Add songs / Import / Edit / Up next', add.ok && imp.ok && edit.ok && queue.ok, { add, imp, edit, queue });
        // Import from the menu pre-selects "Add to this playlist" even for a playlist link
        await p.tap('#mPlaylistSheet [data-m-pl="import"]'); await p.waitForTimeout(700);
        const target = await p.evaluate(() => { setImportTarget('Some YouTube playlist', true); return importTargetChoice(); });
        check('M4 Import into this playlist targets the open playlist', target === 'current', target);
        await back(p);
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        // Share uses the share sheet with the playlist's link
        await p.tap('#mPlaylistSheet [data-m-pl="share"]'); await p.waitForTimeout(900);
        const shared = await p.evaluate(() => window.__shared);
        check('M5 Share hands a link to the share sheet', shared.length === 1 && shared[0].url.includes('/s/') && shared[0].title === head.want, shared);
        // Delete: two taps, then the request and a reload
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        await p.tap('#mPlaylistSheet [data-m-pl="delete"]'); await p.waitForTimeout(200);
        const armed = await p.evaluate(() => { const r = document.querySelector('#mPlaylistSheet [data-m-pl="delete"]'); return { cls: r.className, text: r.querySelector('b').textContent }; });
        const postsBefore = p.__posts.filter(x => x.action === 'deletePlaylist').length;
        check('D1 first tap on Delete only arms it', armed.cls.includes('m-confirm-armed') && armed.text === 'Tap again to delete' && postsBefore === 0, armed);
        const nav = p.waitForNavigation({ timeout: 5000 }).catch(() => null);
        await p.tap('#mPlaylistSheet [data-m-pl="delete"]');
        const navd = await nav;
        const del = p.__posts.filter(x => x.action === 'deletePlaylist');
        check('D2 second tap deletes it and reloads', del.length === 1 && del[0].playlist === head.id && !!navd, { del, navd: !!navd });
        await p.waitForTimeout(1500);
        const toast = await p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);
        check('D3 after the reload: "Deleted" toast', toast && toast.includes('Deleted'), toast);
        check('M errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- reorder mode
    {
        const { ctx, p } = await open('many');
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        await p.tap('#mPlaylistSheet [data-m-pl="reorder"]'); await p.waitForTimeout(900);
        let s = await look(p);
        const ui = await p.evaluate(() => ({ bar: document.getElementById('mPlBarTitle').textContent, handle: getComputedStyle(document.querySelector('#songList .song-drag-handle')).display, more: getComputedStyle(document.querySelector('#songList .song-actions')).display, w: document.querySelector('#songList .song-drag-handle').getBoundingClientRect().width }));
        check('R1 reorder mode: a layer, handles 44px, ⋯ gone, bar says so', s.layer === 'reorder' && s.cls.includes('m-reordering') && ui.handle === 'flex' && ui.more === 'none' && ui.w >= 44 && ui.bar === 'Reorder songs', { s, ui });
        const before = await p.evaluate(() => currentSongIndex);
        await p.evaluate(() => { window.__sw = 0; const o = window.switchSong; window.switchSong = function () { window.__sw++; return o.apply(this, arguments); }; });
        await p.tap('#songList .song-list-item:nth-child(3) .song-list-title'); await p.waitForTimeout(400);
        const sw = await p.evaluate(() => window.__sw);
        check('R2 a tap on a row does not play it in reorder mode', sw === 0, sw);
        // drag row 1 below row 3 with touch
        const h = await (await p.$('#songList .song-list-item:nth-child(1) .song-drag-handle')).boundingBox();
        const r3 = await (await p.$('#songList .song-list-item:nth-child(3)')).boundingBox();
        const cdp = await ctx.newCDPSession(p);
        const x = h.x + h.width / 2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: h.y + h.height / 2 }] });
        for (let y = h.y + h.height / 2; y <= r3.y + r3.height * 0.8; y += 12) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(500);
        const ro = p.__posts.filter(x => x.action === 'reorder');
        check('R3 dragging a handle reorders (and saves)', ro.length === 1 && ro[0].order[0] === 1 && ro[0].order[2] === 0, ro);
        // auto-scroll near the bottom edge
        const sbTop = await p.evaluate(() => document.getElementById('musicSidebar').scrollTop);
        const h2 = await (await p.$('#songList .song-list-item:nth-child(2) .song-drag-handle')).boundingBox();
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: h2.y + h2.height / 2 }] });
        for (let y = h2.y + h2.height / 2; y <= 690; y += 20) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        await p.waitForTimeout(900);
        const sbMid = await p.evaluate(() => document.getElementById('musicSidebar').scrollTop);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await p.waitForTimeout(400);
        const maxScroll = await p.evaluate(() => { const sb = document.getElementById('musicSidebar'); return sb.scrollHeight - sb.clientHeight; });
        check('R4 holding a song near the bottom scrolls the list', sbMid > sbTop + 40 || sbMid >= maxScroll - 2, { sbTop, sbMid, maxScroll });
        await p.tap('#mPlDone'); await p.waitForTimeout(600);
        s = await look(p);
        check('R5 Done leaves reorder mode (a back step)', !s.cls.includes('m-reordering') && s.layer === 'playlist', s);
        check('R errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- empty playlist
    {
        const { ctx, p } = await open('demo');
        const ui = { hero: await vis(p, '#musicSidebar .m-hero-actions'), find: await vis(p, '#mPlFind'), card: await vis(p, '#songList .song-list-empty'), add: await vis(p, '#songList .song-list-empty-add'), imp: await vis(p, '#songList .song-list-empty-import') };
        check('E1 empty: the card leads; Play/shuffle/find hidden', !ui.hero && !ui.find && ui.card && ui.add && ui.imp, ui);
        await p.tap('#songList .song-list-empty-import'); await p.waitForTimeout(600);
        const s = await look(p);
        const target = await p.evaluate(() => { setImportTarget('A playlist', true); return importTargetChoice(); });
        check('E2 Import from the empty card targets this playlist', s.modals.includes('spotifyImportModal') && target === 'current', { s, target });
        await back(p);
        await p.tap('#mPlMore'); await p.waitForTimeout(400);
        const rows = await p.evaluate(() => [...document.querySelectorAll('#mPlaylistSheet .m-sheet-row')].filter(r => !r.hidden).map(r => r.dataset.mPl));
        check('E3 menu hides Reorder for an empty playlist', !rows.includes('reorder'), rows);
        await ctx.close();
    }

    // ---- song sheet: Like (outside Favorites)
    {
        const { ctx, p } = await open('many');
        await p.evaluate(() => { activePlaylistId = 'pl-1'; });
        await p.evaluate(() => showSendMenu(document.querySelector('#songList .song-send-btn'), 0)); await p.waitForTimeout(400);
        const like = await p.evaluate(() => { const r = document.querySelector('.send-menu-sheet .send-menu-like'); return r && r.textContent.trim(); });
        await p.evaluate(() => document.querySelector('.send-menu-sheet .send-menu-like').click()); await p.waitForTimeout(600);
        const fav = p.__posts.filter(x => x.action === 'favorite').length;
        const toast = await p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);
        const sheet = await p.evaluate(() => !!document.querySelector('.send-menu-sheet'));
        check('L1 song sheet has Like; it saves, closes and says so', like && like.includes('Favorites') && fav === 1 && toast && toast.includes('Favorites') && !sheet, { like, fav, toast, sheet });
        await p.evaluate(() => { activePlaylistId = 'favorites'; });
        await ctx.close();
    }

    // ---- other shells unchanged
    {
        const { ctx, p } = await open('many', { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(700);
        const d = { bar: await vis(p, '#mPlBar'), back: await vis(p, '#backToCrate'), home: await vis(p, '#dvSideHome'), queue: await vis(p, '.queue-btn'), filter: await vis(p, '#mFilterInput'), handle: await vis(p, '#songList .song-drag-handle'), hero: await vis(p, '.m-hero-actions') };
        // Desktop step 3: the "← Crate" pill gives way to the sidebar's Home
        // (it used to be checked as shown here); the rest is as it was.
        check('O1 desktop playlist view unchanged (but "← Crate" gave way to the sidebar Home)', !d.bar && !d.back && d.home && d.queue && d.filter && d.handle && !d.hero, d);
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { viewport: { width: 844, height: 390 }, openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(700);
        const l = { bar: await vis(p, '#mPlBar'), back: await vis(p, '#backToCrate'), filter: await vis(p, '#mFilterInput') };
        check('O2 landscape playlist view unchanged', !l.bar && l.back && l.filter, l);
        await ctx.close();
    }
    {
        const { ctx, p } = await open('many', { query: '?app=1', openPlaylist: false });
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(700);
        const a = { bar: await vis(p, '#mPlBar'), back: await vis(p, '#backToCrate'), queue: await vis(p, '.queue-btn') };
        check('O3 app shell playlist view unchanged', !a.bar && a.back && a.queue, a);
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
