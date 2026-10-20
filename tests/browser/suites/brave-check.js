// Brave on iPhone: a WebKit browser like Safari, with opaque bars of its
// own. The page knows it before its first paint (html.m-brave and
// IS_BRAVE, from navigator.brave or the user agent's " Brave"), and
// Safari 26's edge strips stay out there. Chrome has no
// -webkit-touch-callout, so the iPhone rules (the @supports
// (-webkit-touch-callout: none) blocks of styles.css) are added to the page
// without that gate: what an iPhone applies.
//   A. Safari (no Brave): the strips show on Home, Search and Now Playing,
//      Now Playing's header and Search's field move down by the strip, and
//      the sheets' backdrops start clear at the top.
//   B. Brave (navigator.brave, and the user agent's " Brave" alone):
//      html.m-brave and IS_BRAVE; no strips anywhere, the usual spacing
//      (header 6px, grab 4px, field 8px) and plain backdrops.
//   C. The Install sheet: Brave on iPhone first sends you to Safari (with
//      this site's address) for Safari's steps; Safari shows only those
//      steps, and Brave on Android keeps its own browser's steps.
//   D. Safari and Brave: the page itself can't be pulled down
//      (overscroll-behavior-y: none on the root, and only there); the
//      crate, Search, a playlist, You, Now Playing and a sheet keep their
//      own behaviour and still scroll by wheel.
// Writes to /save-music are faked (reads go through).
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1';
// Brave on Android sends Chrome's user agent (and has navigator.brave)
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();

    // opts: ua, brave (navigator.brave, as Brave puts it in every frame), vp, acct
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: opts.vp || { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: opts.ua || IPHONE, storageState: L.state(opts.acct || 'mid') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|lrclib\.net/, r => r.abort());
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (READS.includes(body.action)) return route.continue();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        if (opts.brave) {
            await p.addInitScript(() => {
                Object.defineProperty(navigator, 'brave', { configurable: true, value: { isBrave: () => Promise.resolve(true) } });
            });
        }
        await p.goto(APP); await p.waitForTimeout(1200);
        p.__rules = await iphoneRules(p);
        await p.waitForTimeout(200);
        return { ctx, p };
    }

    // The iPhone blocks of styles.css, as an iPhone reads them
    const iphoneRules = (p) => p.evaluate(async () => {
        const link = document.querySelector('link[rel="stylesheet"][href*="/css/styles.css"]');
        const css = (await (await fetch(link.href)).text()).replace(/\/\*[\s\S]*?\*\//g, '');
        const gate = '@supports (-webkit-touch-callout: none)';
        const blocks = [];
        for (let at = css.indexOf(gate); at >= 0; at = css.indexOf(gate, at + gate.length)) {
            const open = css.indexOf('{', at);
            let depth = 0;
            let end = open;
            for (; end < css.length; end++) {
                if (css[end] === '{') depth++;
                else if (css[end] === '}' && --depth === 0) break;
            }
            blocks.push(css.slice(open + 1, end));
        }
        const style = document.createElement('style');
        style.id = 'iphoneRules';
        style.textContent = blocks.join('\n');
        document.head.appendChild(style);
        return blocks.length;
    });

    // The edges and the spacing the strips change
    const edges = (p) => p.evaluate(() => {
        const cs = (el, pseudo) => getComputedStyle(el, pseudo || null);
        const top = document.getElementById('mEdgeTop');
        const bottom = document.getElementById('mEdgeBottom');
        const header = document.getElementById('mNpHeader');
        return {
            brave: document.documentElement.classList.contains('m-brave'),
            isBrave: window.IS_BRAVE === true,
            tab: document.documentElement.dataset.mTab,
            np: document.body.classList.contains('m-np-open'),
            top: { display: cs(top).display, height: cs(top).height, position: cs(top).position, bg: cs(top).backgroundColor, after: cs(top, '::after').content },
            bottom: { display: cs(bottom).display },
            headerPad: cs(header).paddingTop,
            grabTop: cs(header.querySelector('.m-grab')).top,
            fieldTop: cs(document.querySelector('#mSearchPage .m-search-field')).top,
            roomBefore: cs(document.querySelector('#vinylCrateView .room-bg'), '::before').content,
        };
    });
    const backdrop = (p, sel) => p.evaluate((sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundImage : null; }, sel);
    // A scroller wheeled from its top (made taller than its box first if
    // it isn't), then put back
    async function wheel(p, sel, filler) {
        const box = await p.evaluate(({ sel, filler }) => {
            const el = document.querySelector(sel);
            if (!el || !el.getClientRects().length) return null;
            if (el.scrollHeight <= el.clientHeight + 40) {
                const spacer = document.createElement('div');
                spacer.className = 'scroll-spacer';
                spacer.style.cssText = 'height: 2000px; flex: 0 0 auto;';
                (filler ? document.querySelector(filler) : el).appendChild(spacer);
            }
            el.scrollTop = 0;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 260)), overflow: cs.overflowY, own: cs.overscrollBehaviorY };
        }, { sel, filler });
        if (!box) return null;
        await p.mouse.move(box.x, box.y);
        await p.mouse.wheel(0, 400);
        await p.waitForTimeout(500);
        box.scrolled = await p.evaluate((sel) => {
            const el = document.querySelector(sel);
            const top = el.scrollTop;
            document.querySelectorAll('.scroll-spacer').forEach((x) => x.remove());
            el.scrollTop = 0;
            return top;
        }, sel);
        return box;
    }

    async function pulls(p, tag) {
        const root = await p.evaluate(() => ({ html: getComputedStyle(document.documentElement).overscrollBehaviorY, body: getComputedStyle(document.body).overscrollBehaviorY }));
        check(`D ${tag}: the page can't be pulled down (the root only)`, root.html === 'none' && root.body === 'auto', root);
        const lists = {};
        lists.crate = await wheel(p, '#roomCenter');
        await p.evaluate(() => document.querySelector('#mTabs .m-tab[data-tab="search"]').click()); await p.waitForTimeout(600);
        lists.search = await wheel(p, '#mSearchPage', '#mSearchResults');
        await p.evaluate(() => document.querySelector('#mTabs .m-tab[data-tab="home"]').click()); await p.waitForTimeout(600);
        await p.evaluate(() => openPlayerView()); await p.waitForTimeout(800);
        lists.playlist = await wheel(p, '#musicSidebar');
        await p.evaluate(() => history.back()); await p.waitForTimeout(800);
        await p.evaluate(() => document.getElementById('mAvatarBtn').click()); await p.waitForTimeout(800);
        lists.you = await wheel(p, '#mYouPage');
        await p.evaluate(() => history.back()); await p.waitForTimeout(800);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(900);
        lists.np = await wheel(p, '#musicPlayerView .music-main');
        await p.evaluate(() => history.back()); await p.waitForTimeout(900);
        await p.evaluate(() => showSettingsModal()); await p.waitForTimeout(700);
        lists.sheet = await wheel(p, '#settingsModal .add-song-modal-panel');
        await p.evaluate(() => hideSettingsModal()); await p.waitForTimeout(500);
        for (const [name, l] of Object.entries(lists)) {
            check(`D ${tag}: ${name} still scrolls, with its own overscroll (${l ? l.own : '?'})`, !!l && /auto|scroll/.test(l.overflow) && l.own !== 'none' && l.scrolled > 0, l);
        }
    }

    // The Install sheet as it opens when the browser offers no prompt
    async function installSheet(p) {
        await p.evaluate(() => window.mShowInstallSheet()); await p.waitForTimeout(500);
        const out = await p.evaluate(() => {
            const shown = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
            return { brave: shown('mInstallBrave'), ios: shown('mInstallStepsIos'), android: shown('mInstallSteps'), text: document.getElementById('mInstallBrave').textContent.trim(), host: location.host };
        });
        await p.evaluate(() => window.mHideInstallSheet()); await p.waitForTimeout(500);
        return out;
    }

    // Home, Search, Now Playing, a sheet and a song menu, each as the page shows it
    async function tour(p) {
        const out = { home: await edges(p) };
        await p.evaluate(() => document.querySelector('#mTabs .m-tab[data-tab="search"]').click()); await p.waitForTimeout(600);
        out.search = await edges(p);
        await p.evaluate(() => document.querySelector('#mTabs .m-tab[data-tab="home"]').click()); await p.waitForTimeout(600);
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(900);
        out.np = await edges(p);
        await p.evaluate(() => history.back()); await p.waitForTimeout(900);
        await p.evaluate(() => openQueueModal()); await p.waitForTimeout(500);
        out.sheet = await backdrop(p, '#queueModal .add-song-modal-backdrop');
        await p.evaluate(() => hideQueueModal()); await p.waitForTimeout(500);
        await p.evaluate(() => showSendMenu(document.getElementById('mNpKebab'), currentSongIndex)); await p.waitForTimeout(500);
        out.menu = await backdrop(p, '.send-menu-backdrop');
        await p.evaluate(() => closeSendMenu()); await p.waitForTimeout(300);
        out.install = await installSheet(p);
        return out;
    }

    // ---- A: Safari ----
    {
        const { ctx, p } = await open();
        const t = await tour(p);
        check('A Safari: the iPhone rules are on the page', p.__rules >= 4, p.__rules);
        check('A Safari: no Brave class, IS_BRAVE false', !t.home.brave && !t.home.isBrave, t.home);
        check('A Safari: Home has its 12px top strip (fixed, on the edge) and the room starts in its colour', t.home.top.display === 'block' && t.home.top.height === '12px' && t.home.top.position === 'fixed' && t.home.bottom.display === 'none' && t.home.roomBefore !== 'none', t.home);
        check('A Safari: Search\'s strip takes its colour, and the field sits below it (20px)', t.search.tab === 'search' && t.search.top.display === 'block' && t.search.top.bg !== t.home.top.bg && t.search.fieldTop === '20px', { search: t.search, homeBg: t.home.top.bg });
        check('A Safari: Now Playing has both strips and the fade, and its header moves down (18px, grab 16px)', t.np.np && t.np.top.display === 'block' && t.np.top.bg === 'rgb(10, 8, 8)' && t.np.top.after !== 'none' && t.np.bottom.display === 'block' && t.np.headerPad === '18px' && t.np.grabTop === '16px', t.np);
        check('A Safari: sheet and menu backdrops start clear at the top', /^linear-gradient/.test(t.sheet || '') && /^linear-gradient/.test(t.menu || ''), { sheet: t.sheet, menu: t.menu });
        check('C Safari: the Install sheet shows Safari\'s steps, without the Brave line', t.install.ios && !t.install.brave && !t.install.android, t.install);
        await pulls(p, 'Safari');
        check('A Safari: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- B: Brave ----
    for (const [how, opts] of [['navigator.brave', { brave: true }], ['the user agent', { ua: IPHONE + ' Brave' }]]) {
        const { ctx, p } = await open(opts);
        const t = await tour(p);
        check(`B Brave (${how}): html.m-brave and IS_BRAVE`, t.home.brave && t.home.isBrave, t.home);
        check(`B Brave (${how}): no strips on Home or Search, the room's top untouched, the field at its usual 8px`, t.home.top.display === 'none' && t.home.bottom.display === 'none' && t.home.roomBefore === 'none' && t.search.tab === 'search' && t.search.top.display === 'none' && t.search.fieldTop === '8px', { home: t.home, search: t.search });
        check(`B Brave (${how}): no strips or fade on Now Playing, its header at the usual 6px (grab 4px)`, t.np.np && t.np.top.display === 'none' && t.np.top.after === 'none' && t.np.bottom.display === 'none' && t.np.headerPad === '6px' && t.np.grabTop === '4px', t.np);
        check(`B Brave (${how}): sheet and menu backdrops dim all the way up`, t.sheet === 'none' && t.menu === 'none', { sheet: t.sheet, menu: t.menu });
        check(`C Brave (${how}): the Install sheet first says to open this site in Safari, then Safari's steps`, t.install.brave && t.install.ios && !t.install.android
            && t.install.text === `Brave can't add apps to the Home Screen. Open ${t.install.host} in Safari, then:`, t.install);
        if (opts.brave) await pulls(p, 'Brave');
        check(`B Brave (${how}): errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- C: Brave on Android installs apps itself ----
    {
        const { ctx, p } = await open({ brave: true, ua: ANDROID });
        const install = await installSheet(p);
        check('C Brave on Android: its own browser\'s steps, no Safari', install.android && !install.ios && !install.brave, install);
        check('C Brave on Android: errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 1500)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
