// Desktop step 9: the avatar menu (#dvAcct: the user's initial at the top
// right of the page) at 1440x900, 1024x768 and 800x600 (beside the icon
// rail). Checks the avatar on Home, a playlist page, the Search page and
// Now Playing (the account's initial, the same as the phone's; "Account:
// <name>"; a menu button; at the top right of the page, clear of the page's
// header and of the side panel, which it moves left for); the menu opening
// and closing (click, Enter, the arrow keys on the avatar; Esc, Tab, a click
// outside, a second click), its keys (arrows, Home, End; focus back on the
// avatar), its header (the name and email, as on the phone You page) and
// items (Your listening, Bring your music over, Settings: Playback /
// Appearance / Account, Keyboard shortcuts (desktop step 10), Install the
// app only while the browser offers it,
// Log out), each opening the right window or tab with focus coming back to
// the avatar when it closes; Log out posting the logout form (intercepted:
// the shared test session stays logged in); a new name reaching it; Home
// without its old Stats and Settings buttons; the menu fitting above the
// bar; axe; and that phones (390x844, 844x390), narrowing to a phone and
// the app shell (?app=1) have no avatar menu (the phone's avatar still
// opens its You page). Writes to /save-music are faked and recorded (reads
// go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const AXE = require.resolve('axe-core/axe.min.js', { paths: [L.ROOT] });
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();

    async function open(opts = {}) {
        const vp = opts.vp || { width: 1440, height: 900 };
        const phone = !!opts.phone;
        const ctx = await b.newContext({
            viewport: vp, isMobile: phone, hasTouch: phone,
            storageState: L.state(opts.acct || 'mid'),
        });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|lrclib\.net/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.raw) return { ctx, p };
        await p.evaluate(() => {
            // A stub player; record what plays
            const stub = { _s: 5, _t: 0, loadVideoById() { this._s = 1; }, cueVideoById() { this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__played = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); if (!cue) window.__played.push(s && s.title); };
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            playQueue = []; afterQueueChange();
        });
        return { ctx, p };
    }
    // ---- end open

    async function axeScan(p) {
        await p.addScriptTag({ path: AXE });
        return p.evaluate(async () => {
            const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
            return res.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        });
    }
    // The avatar, its menu and the page around them
    const acctState = (p) => p.evaluate(() => {
        const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        const $ = (id) => document.getElementById(id);
        const btn = $('dvAcctBtn');
        const pop = $('dvAcctPop');
        const a = document.activeElement;
        const html = document.documentElement;
        const view = $('musicPlayerView');
        const np = view.classList.contains('active') && view.classList.contains('dv-deck');
        const search = html.classList.contains('dv-search');
        const pl = !np && !search && view.classList.contains('active');
        const page = np ? 'np' : (search ? 'search' : (pl ? 'playlist' : 'home'));
        const pageEl = { np: view.querySelector('.music-main'), search: $('mSearchPage'), playlist: $('musicSidebar'), home: document.querySelector('#vinylCrateView .room-content') }[page];
        // What the page shows at its top (the avatar must stay clear of it)
        const heads = {
            home: ['#mGreeting'],
            // (the column labels, not their row: scrolled, it sticks to the top under the avatar)
            playlist: ['#dvPlHead .dv-pl-kicker', '#dvPlHead .dv-pl-name', '#dvPlHead .dv-pl-meta', '#dvPlHead .dv-pl-cover', '#dvPlCols > *'],
            search: ['#mSearchPage .m-search-field'],
            np: ['#dvNpHead .dv-np-back', '#dvNpHead .dv-np-heading'],
        }[page].flatMap((sel) => [...document.querySelectorAll(sel)]).filter(shown).map((el) => {
            // the text's own extent for a heading (its box spans the row)
            const r = document.createRange(); r.selectNodeContents(el);
            const box = ['H1', 'H2', 'P', 'SPAN'].includes(el.tagName) && el.textContent.trim() ? r.getBoundingClientRect() : el.getBoundingClientRect();
            return { sel: el.id || el.className, l: box.left, t: box.top, r: box.right, b: box.bottom };
        });
        const b0 = btn.getBoundingClientRect();
        const hit = shown(btn) ? document.elementFromPoint(b0.left + b0.width / 2, b0.top + b0.height / 2) : null;
        const panel = $('dvPanel');
        const bar = $('dvBar');
        const name = $('dvAcctName');
        const sub = $('dvAcctSub');
        const menu = $('dvAcctMenu');
        const phoneName = $('mAccountName');
        const phoneSub = $('mYouSub');
        return {
            dv2: html.classList.contains('dv2'),
            page,
            shown: shown(btn), box: shown(btn) ? rect(btn) : null, onTop: !!hit && btn.contains(hit),
            initial: (btn.querySelector('.m-avatar') || {}).textContent ? btn.querySelector('.m-avatar').textContent.trim() : null,
            phoneInitial: ($('mAvatar') || {}).textContent ? $('mAvatar').textContent.trim() : null,
            label: btn.getAttribute('aria-label'), haspopup: btn.getAttribute('aria-haspopup'), expanded: btn.getAttribute('aria-expanded'), controls: btn.getAttribute('aria-controls'),
            open: shown(pop), pop: shown(pop) ? rect(pop) : null,
            name: name.textContent.trim(), sub: sub.hidden ? '' : sub.textContent.trim(),
            phoneName: phoneName ? phoneName.textContent.trim() : null, phoneSub: phoneSub && !phoneSub.hidden ? phoneSub.textContent.trim() : '',
            menuRole: menu.getAttribute('role'), menuLabel: menu.getAttribute('aria-label'),
            items: [...menu.querySelectorAll('[role="menuitem"]')].filter(shown).map((x) => x.textContent.trim()),
            groups: [...menu.querySelectorAll('[role="group"]')].map((g) => g.getAttribute('aria-label') + ':' + [...g.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent.trim()).join('/')),
            seps: menu.querySelectorAll('[role="separator"]').length,
            focus: a ? (a.id || a.textContent.trim().slice(0, 40) || a.tagName) : null,
            focusInMenu: !!a && menu.contains(a),
            pageBox: rect(pageEl),
            heads,
            panel: shown(panel) ? rect(panel) : null,
            bar: shown(bar) ? rect(bar) : null,
            pills: shown(document.querySelector('#vinylCrateView .crate-stats-btn')) || shown(document.querySelector('#vinylCrateView .crate-settings-btn')),
            modals: [...document.querySelectorAll('.add-song-modal.active')].map((m) => m.id),
            tab: (document.querySelector('#settingsTabs .settings-tab.active') || {}).dataset ? document.querySelector('#settingsTabs .settings-tab.active').dataset.tab : null,
            vw: innerWidth, vh: innerHeight,
            overflowX: html.scrollWidth > innerWidth,
        };
    });
    const overlap = (a, z) => a.l < z.r - 0.5 && z.l < a.r - 0.5 && a.t < z.b - 0.5 && z.t < a.b - 0.5;
    // Top right of the page, on it, clear of its header and the side panel
    function placedOk(s) {
        return s.shown && s.onTop && !!s.box && !!s.pageBox
            && s.box.r <= s.pageBox.r - 4 && s.box.r >= s.pageBox.r - 64 && s.box.t >= s.pageBox.t && s.box.t <= s.pageBox.t + 40
            && s.heads.length > 0 && s.heads.every((h) => !overlap(s.box, h))
            && (!s.panel || s.box.r <= s.panel.l) && !s.overflowX;
    }
    const placed = (s) => ({ page: s.page, box: s.box, onTop: s.onTop, pageBox: s.pageBox, heads: s.heads, panel: s.panel, overflowX: s.overflowX });
    const otherWithSongs = (p) => p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount >= 1) || String(activePlaylistId));
    const longest = (p) => p.evaluate(() => Object.keys(playlistsMeta).sort((a, z) => (playlistsMeta[z].songCount || 0) - (playlistsMeta[a].songCount || 0))[0]);
    const openList = async (p, id) => { await p.evaluate((i) => selectPlaylistFromCrate(i), id); await p.waitForTimeout(1500); };
    const home = async (p) => { await p.evaluate(() => { if (window.dvNowPlaying) window.dvNowPlaying.close(); if (window.dvSearch) window.dvSearch.close(); if (document.getElementById('musicPlayerView').classList.contains('active')) showPlaylistPicker(); }); await p.waitForTimeout(500); };
    const openSearch = async (p) => { await p.click('#dvSideSearch'); await p.waitForTimeout(500); };
    const openNp = async (p) => { await p.click('#dvBarDeck'); await p.waitForTimeout(900); };
    const openMenu = async (p) => { await p.click('#dvAcctBtn'); await p.waitForTimeout(200); };
    // The initial the account should have: its name's, else its email's
    const wantInitial = (s) => {
        const from = s.phoneName && s.phoneName !== 'Your account' ? s.phoneName : s.phoneSub;
        return from ? Array.from(from)[0].toUpperCase() : null;
    };
    const ITEMS = 'Your listening|Bring your music over|Playback|Appearance|Account|Keyboard shortcuts|Log out';

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. The avatar on every page, clear of the headers and the side panel
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            const h = await acctState(p);
            const want = wantInitial(h);
            const who = h.phoneName && h.phoneName !== 'Your account' ? h.phoneName : (h.phoneSub || 'your account');
            check(`${tag} A the avatar shows the account's initial (as on the phone), labelled "Account: <name>", a menu button (collapsed)`,
                h.dv2 && h.shown && !!want && h.initial === want && h.initial === h.phoneInitial && h.label === 'Account: ' + who && h.haspopup === 'menu' && h.expanded === 'false' && h.controls === 'dvAcctMenu',
                { initial: h.initial, want, phone: h.phoneInitial, label: h.label, who, haspopup: h.haspopup, expanded: h.expanded });
            check(`${tag} A Home: no Stats or Settings buttons (they're in the menu)`, !h.pills, h.pills);
            check(`${tag} A Home: the avatar sits at the top right, clear of the greeting`, h.page === 'home' && placedOk(h), placed(h));
            await openList(p, await otherWithSongs(p));
            const pl = await acctState(p);
            check(`${tag} A a playlist page: the avatar at the top right, clear of its header`, pl.page === 'playlist' && placedOk(pl) && pl.initial === want, placed(pl));
            // Scrolled to the end: the column labels stick near the top (when
            // the list is long enough), under the avatar's row; it stays clear
            // of them. (Desktop step 11: they stick below a band of their own,
            // their sticky top, with the avatar in the band.)
            await openList(p, await longest(p));
            await p.evaluate(() => { const sb = document.getElementById('musicSidebar'); sb.scrollTop = sb.scrollHeight; }); await p.waitForTimeout(300);
            const pl2 = await acctState(p);
            const stick = await p.evaluate(() => {
                const sb = document.getElementById('musicSidebar'), c = document.getElementById('dvPlCols');
                const top = parseFloat(getComputedStyle(c).top) || 0;
                return { stuck: c.getBoundingClientRect().top - sb.getBoundingClientRect().top < top + 4, canScroll: sb.scrollHeight - sb.clientHeight >= c.offsetTop };
            });
            check(`${tag} A a scrolled playlist page: the avatar stays put, clear of the column labels stuck at the top`, pl2.page === 'playlist' && (stick.stuck || !stick.canScroll) && placedOk(pl2) && Math.abs(pl2.box.t - pl.box.t) < 1, { stick, p: placed(pl2) });
            await openSearch(p);
            const se = await acctState(p);
            check(`${tag} A the Search page: the avatar at the top right, clear of the field`, se.page === 'search' && placedOk(se), placed(se));
            await home(p);
            await openNp(p);
            const np = await acctState(p);
            check(`${tag} A Now Playing: the avatar at the top right, clear of its header`, np.page === 'np' && placedOk(np), placed(np));
            // The side panel open: the avatar moves left with the page
            await p.click('#dvBarQueue'); await p.waitForTimeout(500);
            const npP = await acctState(p);
            await home(p);
            const hP = await acctState(p);
            await openList(p, await otherWithSongs(p));
            const plP = await acctState(p);
            await openSearch(p);
            const seP = await acctState(p);
            check(`${tag} A with the side panel open, the avatar stays on the page, left of the panel, on every page`,
                [npP, hP, plP, seP].every((s) => !!s.panel && placedOk(s)) && hP.page === 'home' && plP.page === 'playlist' && seP.page === 'search' && npP.page === 'np',
                [npP, hP, plP, seP].map(placed));
            check(`${tag} A errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- B. Opening and closing, keys, the header and items
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await openMenu(p);
            const o = await acctState(p);
            check(`${tag} B a click opens the menu (expanded), focus on its first item`, o.open && o.expanded === 'true' && o.focus === 'Your listening' && o.focusInMenu, { open: o.open, expanded: o.expanded, focus: o.focus });
            check(`${tag} B its header: the name and email (as on the phone You page)`, o.name === o.phoneName && o.sub === o.phoneSub && !!o.name, { name: o.name, sub: o.sub, phone: [o.phoneName, o.phoneSub] });
            check(`${tag} B a labelled menu: Your listening, Bring your music over, Settings (Playback, Appearance, Account), Keyboard shortcuts, Log out; no Install without the browser's offer`,
                o.menuRole === 'menu' && o.menuLabel === 'Account' && o.items.join('|') === ITEMS && o.groups.join(',') === 'Settings:Playback/Appearance/Account' && o.seps === 2,
                { role: o.menuRole, label: o.menuLabel, items: o.items, groups: o.groups, seps: o.seps });
            check(`${tag} B it fits: under the avatar, on the page, above the bar`, !!o.pop && o.pop.t >= o.box.b && o.pop.r <= o.pageBox.r && o.pop.l >= o.pageBox.l && (!o.bar || o.pop.b <= o.bar.t) && o.pop.b <= o.vh,
                { pop: o.pop, box: o.box, page: o.pageBox, bar: o.bar && o.bar.t });
            const keys = [];
            for (const k of ['ArrowDown', 'End', 'Home', 'ArrowUp', 'ArrowDown']) { await p.keyboard.press(k); keys.push((await acctState(p)).focus); }
            check(`${tag} B arrows, Home and End move through the items (wrapping)`, keys.join('|') === 'Bring your music over|Log out|Your listening|Log out|Your listening', keys);
            await p.keyboard.press('Escape'); await p.waitForTimeout(150);
            const e = await acctState(p);
            check(`${tag} B Esc closes it, focus back on the avatar`, !e.open && e.expanded === 'false' && e.focus === 'dvAcctBtn', { open: e.open, focus: e.focus });
            await p.keyboard.press('Enter'); await p.waitForTimeout(150);
            const en = await acctState(p);
            await p.keyboard.press('Tab'); await p.waitForTimeout(150);
            const tb = await acctState(p);
            check(`${tag} B Enter on the avatar opens it (focus on the first item); Tab closes it and goes on past the avatar`,
                en.open && en.focus === 'Your listening' && !tb.open && tb.expanded === 'false' && !tb.focusInMenu && tb.focus !== 'dvAcctBtn', { en: [en.open, en.focus], tb: [tb.open, tb.focus] });
            await p.focus('#dvAcctBtn');
            await p.keyboard.press('ArrowUp'); await p.waitForTimeout(150);
            const up = await acctState(p);
            await p.keyboard.press('Escape');
            await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
            const dn = await acctState(p);
            await p.keyboard.press('Escape');
            check(`${tag} B ↑ / ↓ on the avatar open it on the last / first item`, up.open && up.focus === 'Log out' && dn.open && dn.focus === 'Your listening', { up: up.focus, dn: dn.focus });
            await openMenu(p);
            await openMenu(p);
            const c2 = await acctState(p);
            await openMenu(p);
            // A click outside (on the page, away from the menu)
            const pg = (await acctState(p)).pageBox;
            await p.mouse.click(pg.l + 10, pg.b - 10); await p.waitForTimeout(200);
            const out = await acctState(p);
            check(`${tag} B a second click on the avatar closes it; so does a click outside`, !c2.open && c2.expanded === 'false' && !out.open && out.expanded === 'false', { c2: c2.open, out: out.open });
            check(`${tag} B errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- C. Each item opens its window or tab; focus comes back to the avatar
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            const got = {};
            const cases = [
                ['stats', 'statsModal', null, () => hideStatsModal()],
                ['bring', 'bringMusicModal', null, () => hideBringMusicModal()],
                ['playback', 'settingsModal', 'playback', () => hideSettingsModal()],
                ['appearance', 'settingsModal', 'appearance', () => hideSettingsModal()],
                ['account', 'settingsModal', 'account', () => hideSettingsModal()],
                ['keys', 'dvKeysModal', null, () => window.dvKeys.close()],
            ];
            for (const [item, modal, tab, hide] of cases) {
                await openMenu(p);
                await p.click(`#dvAcctMenu [data-dv-acct="${item}"]`); await p.waitForTimeout(500);
                const s = await acctState(p);
                await p.evaluate(hide); await p.waitForTimeout(400);
                const after = await acctState(p);
                got[item] = { modals: s.modals, tab: s.tab, menu: s.open, back: after.focus, left: after.modals };
                check(`${tag} C "${item}" opens ${modal}${tab ? ' on its ' + tab + ' tab' : ''} (the menu closed); closing it brings focus back to the avatar`,
                    s.modals.includes(modal) && (!tab || s.tab === tab) && !s.open && after.modals.length === 0 && after.focus === 'dvAcctBtn', got[item]);
            }
            // By keyboard: Enter on an item
            await p.focus('#dvAcctBtn');
            await p.keyboard.press('Enter'); await p.waitForTimeout(150);
            for (let k = 0; k < 3; k++) await p.keyboard.press('ArrowDown');
            await p.keyboard.press('Enter'); await p.waitForTimeout(500);
            const kb = await acctState(p);
            await p.keyboard.press('Escape'); await p.waitForTimeout(400);
            check(`${tag} C by keyboard: ↓↓↓ Enter opens Settings on Appearance`, kb.modals.includes('settingsModal') && kb.tab === 'appearance', { modals: kb.modals, tab: kb.tab });
            check(`${tag} C errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- D. Install (only while the browser offers it), Log out, a new name
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            await p.evaluate(() => {
                window.__prompted = 0;
                window.__installPrompt = { prompt() { window.__prompted++; return Promise.resolve(); }, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
            });
            await openMenu(p);
            const i1 = await acctState(p);
            await p.click('#dvAcctMenu [data-dv-acct="install"]'); await p.waitForTimeout(300);
            const prompted = await p.evaluate(() => window.__prompted);
            await openMenu(p);
            const i2 = await acctState(p);
            await p.keyboard.press('Escape');
            check(`${tag} D with the browser's offer, "Install the app" shows (before Log out) and asks the browser; once asked, it goes`,
                i1.items.join('|') === ITEMS.replace('|Log out', '|Install the app|Log out') && prompted === 1 && i2.items.join('|') === ITEMS, { i1: i1.items, prompted, i2: i2.items });

            // Log out: the You page's form, posted (the request is answered
            // here, so the shared test session stays logged in)
            const posts = [];
            await p.route(/\/logout(\?|$)/, async (route) => {
                const r = route.request();
                posts.push({ method: r.method(), body: r.postData() || '' });
                await route.fulfill({ status: 204, body: '' });
            });
            const token = await p.evaluate(() => { const i = document.querySelector('.m-you-logout-form input[name="_token"]'); return i ? i.value : null; });
            await openMenu(p);
            await p.click('#dvAcctMenu [data-dv-acct="logout"]'); await p.waitForTimeout(800);
            check(`${tag} D Log out posts the logout form (with its CSRF token when the page has one)`,
                posts.length === 1 && posts[0].method === 'POST' && (!token || posts[0].body.includes('_token=' + encodeURIComponent(token))), { posts, token: !!token });

            // A name saved in Settings reaches the avatar, the menu and the label
            await p.evaluate(() => window.mOnAccountName('Zed Tester'));
            await openMenu(p);
            const n = await acctState(p);
            await p.keyboard.press('Escape');
            check(`${tag} D a new name reaches the avatar, the menu's header and the label`, n.initial === 'Z' && n.name === 'Zed Tester' && n.label === 'Account: Zed Tester', { initial: n.initial, name: n.name, label: n.label });
            check(`${tag} D errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- E. axe: the menu open on Home, Search and Now Playing; closed on a playlist page
        {
            const { ctx, p } = await open({ vp });
            await home(p);
            const v0 = await axeScan(p);
            await openMenu(p);
            const v1 = await axeScan(p);
            await p.keyboard.press('Escape');
            await openSearch(p);
            await openMenu(p);
            const v2 = await axeScan(p);
            await p.keyboard.press('Escape');
            await home(p);
            await openNp(p);
            await openMenu(p);
            const v3 = await axeScan(p);
            await p.keyboard.press('Escape');
            await p.evaluate(() => window.dvNowPlaying.close()); await p.waitForTimeout(400);
            await openList(p, await otherWithSongs(p));
            const v4 = await axeScan(p);
            check(`${tag} E axe: no violations (Home, the menu open on Home, Search and Now Playing, a playlist page)`, [v0, v1, v2, v3, v4].every((v) => v.length === 0), { v0, v1, v2, v3, v4 });
            check(`${tag} E errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- F. Narrowing to a phone with the menu open: it closes, no avatar menu
    {
        const { ctx, p } = await open({});
        await home(p);
        await openMenu(p);
        await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(800);
        const s = await acctState(p);
        check('F narrowed to 390px with the menu open: no avatar, the menu closed', !s.dv2 && !s.shown && !s.open && s.expanded === 'false', { dv2: s.dv2, shown: s.shown, open: s.open });
        await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(800);
        const s2 = await acctState(p);
        check('F widened again: the avatar is back, closed', s2.dv2 && s2.shown && !s2.open, { dv2: s2.dv2, shown: s2.shown, open: s2.open });
        check('F errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- G. Phones and the app: no avatar menu; the phone's avatar opens its You page
    for (const c of [{ vp: { width: 390, height: 844 }, phone: true }, { vp: { width: 844, height: 390 }, phone: true }, { vp: { width: 1440, height: 900 }, query: '?app=1' }]) {
        const tag = c.query ? 'app (?app=1) 1440x900' : `phone ${c.vp.width}x${c.vp.height}`;
        const { ctx, p } = await open(c);
        const s = await acctState(p);
        check(`G ${tag}: no avatar menu`, !s.dv2 && !s.shown && !s.open, { dv2: s.dv2, shown: s.shown });
        if (c.vp.width === 390) {
            await p.click('#mAvatarBtn'); await p.waitForTimeout(700);
            const you = await p.evaluate(() => ({ cls: document.documentElement.classList.contains('m-you'), page: document.getElementById('mYouPage').getClientRects().length > 0, logout: !!document.querySelector('#mYouPage .m-you-logout-form button[type="submit"]') }));
            check(`G ${tag}: the phone avatar still opens the You page (with Log out)`, you.cls && you.page && you.logout, you);
        }
        check(`G ${tag}: errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
