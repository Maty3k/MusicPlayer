// Step 11 fixes: one screen at a time (inert + focus), dialogs, toasts,
// title parsing, Add songs announcements, keyboard cards, sheet layout.
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - First Find', channel: 'Band One', thumbnail: '' },
    { videoId: 'bbbbbbbbbb2', title: 'Second Find', channel: 'Someone', thumbnail: '' },
];

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state(opts.acct || 'mid') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|lrclib/, r => r.abort());
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) }));
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: '{"success":true,"added":1,"skipped":0}' });
            if (['add', 'recordPlay', 'stats'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true,"index":0}' });
            return route.continue();
        });
        await p.goto(APP); await p.waitForTimeout(1300);
        return { ctx, p };
    }
    const st = (p) => p.evaluate(() => ({
        inert: ['music-section', 'mTabs', 'mDock', 'vinylCrateView', 'musicSidebar'].filter(id => document.getElementById(id) && document.getElementById(id).inert),
        npInert: !!(document.querySelector('.music-main') || {}).inert,
        active: document.activeElement && (document.activeElement.id || document.activeElement.dataset.mAdd || document.activeElement.className || document.activeElement.tagName),
        layer: history.state && history.state.mLayer,
    }));
    const back = async (p, ms = 700) => { await p.evaluate(() => history.back()); await p.waitForTimeout(ms); return st(p); };

    {
        const { ctx, p } = await open();
        let s = await st(p);
        check('I0 at rest only the closed Now Playing (and hidden pages) are inert', !s.inert.includes('music-section') && !s.inert.includes('mTabs') && s.npInert, s);
        // a sheet: the rest is inert, focus inside, back to the opener after
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(500);
        await p.focus('#mLibraryNew'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
        s = await st(p);
        check('I1 Library + sheet: the screen, tab bar and mini player behind are inert; focus is in the sheet', ['music-section', 'mTabs', 'mDock'].every(id => s.inert.includes(id)) && s.active === 'playlist', s);
        s = await back(p);
        check('I1 closed: nothing extra inert, focus back on +', !s.inert.includes('music-section') && s.active === 'mLibraryNew', s);
        // a playlist from the keyboard (the card's cover is a button)
        const card = await p.evaluate(() => { const c = [...document.querySelectorAll('#roomCenter .record-card')].find(x => x.offsetParent && Number((x.querySelector('.card-caption-count') || {}).textContent?.split(' ')[0]) > 0); return c && c.dataset.playlist; });
        const role = await p.evaluate((id) => { const cv = document.querySelector(`.record-card[data-playlist="${id}"] .record-card-cover`); return { role: cv.getAttribute('role'), tab: cv.tabIndex, label: cv.getAttribute('aria-label') }; }, card);
        await p.focus(`.record-card[data-playlist="${card}"] .record-card-cover`); await p.keyboard.press('Enter'); await p.waitForTimeout(1800);
        s = await st(p);
        check('I2 a Library card opens from the keyboard (its cover is a named button); the playlist takes focus; Library goes inert', role.role === 'button' && role.tab === 0 && /songs?$/.test(role.label) && s.layer === 'playlist' && s.active === 'mPlBack' && s.inert.includes('vinylCrateView'), { role, s });
        // song sheet
        await p.evaluate(() => { const b = document.querySelector('#songList .song-send-btn'); if (b) b.click(); });
        await p.waitForTimeout(600);
        let sheet = await p.evaluate(() => { const m = document.querySelector('.send-menu-sheet'); return m ? { role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), label: m.getAttribute('aria-label'), focusIn: m.contains(document.activeElement), sectionInert: document.getElementById('music-section').inert } : null; });
        check('I3 the song sheet is a named dialog, takes focus, and inerts the playlist behind', sheet && sheet.role === 'dialog' && sheet.modal === 'true' && /song options/.test(sheet.label) && sheet.focusIn && sheet.sectionInert, sheet);
        await back(p);
        // Now Playing
        await p.evaluate(() => window.mOpenNowPlaying()); await p.waitForTimeout(900);
        const np = await p.evaluate(() => { const m = document.querySelector('.music-main'); return { role: m.getAttribute('role'), label: m.getAttribute('aria-label'), inert: m.inert, focus: document.activeElement.id, sidebarInert: document.getElementById('musicSidebar').inert }; });
        check('I4 Now Playing is a dialog with focus on its close chevron; the playlist behind is inert', np.role === 'dialog' && np.label === 'Now playing' && !np.inert && np.focus === 'mNpCollapse' && np.sidebarInert, np);
        const lyr0 = await p.evaluate(() => { const b = document.getElementById('mLyricsExpand'); return { exp: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label') }; });
        await p.evaluate(() => document.getElementById('mLyricsExpand').click()); await p.waitForTimeout(500);
        const lyr1 = await p.evaluate(() => { const b = document.getElementById('mLyricsExpand'); return { exp: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label') }; });
        check('I5 the lyrics toggle says Expand / Collapse with its state', lyr1.exp === 'true' && lyr1.label === 'Collapse lyrics' && (lyr0.exp === null || lyr0.exp === 'false'), { lyr0, lyr1 });
        await back(p); await back(p);
        const npClosed = await p.evaluate(() => ({ role: document.querySelector('.music-main').getAttribute('role'), inert: document.querySelector('.music-main').inert, vis: getComputedStyle(document.getElementById('mLyricsExpand')).visibility }));
        check('I6 closed Now Playing: no dialog role, inert, its lyrics button hidden', npClosed.role === null && npClosed.inert && npClosed.vis === 'hidden', npClosed);
        // toasts on the phone go to the bottom
        await p.evaluate(() => showToast('Added to queue')); await p.waitForTimeout(200);
        const toast = await p.evaluate(() => ({ m: (document.querySelector('.m-toast') || {}).textContent, client: !!document.getElementById('clientToast') && getComputedStyle(document.getElementById('clientToast')).display !== 'none' }));
        check('I7 queue toasts use the phone toast (above the mini player), not the top banner', toast.m === 'Added to queue' && !toast.client, toast);
        check('I errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open();
        // Settings: a labelled dialog that keeps its height across tabs
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(600);
        await p.tap('#mYouPage [data-m-you="playback"]'); await p.waitForTimeout(700);
        const ys = [];
        for (const t of ['playback', 'appearance', 'account']) {
            await p.evaluate((tab) => setSettingsTab(tab), t); await p.waitForTimeout(150);
            ys.push(await p.evaluate(() => Math.round(document.getElementById('settingsTabs').getBoundingClientRect().top)));
        }
        const dlg = await p.evaluate(() => { const m = document.getElementById('settingsModal'); return { role: m.getAttribute('role'), by: m.getAttribute('aria-labelledby'), title: document.getElementById(m.getAttribute('aria-labelledby')).textContent }; });
        check('I8 Settings is a labelled dialog and its tab row stays put across tabs', dlg.role === 'dialog' && dlg.title === 'Settings' && ys.every(y => y === ys[0]), { dlg, ys });
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ viewport: { width: 360, height: 800 } });
        await p.evaluate(() => { window.showSettingsModal(); setSettingsTab('account'); }); await p.waitForTimeout(500);
        const tabs = await p.evaluate(() => { const t = document.getElementById('settingsTabs'); return { sw: t.scrollWidth, cw: t.clientWidth }; });
        check('I9 at 360px the Settings tabs fit their track', tabs.sw <= tabs.cw + 1, tabs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open();
        // Add songs: announcements, focus kept on the tapped row
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        await p.fill('#addSongSearch', 'first find'); await p.dispatchEvent('#addSongSearch', 'input'); await p.waitForTimeout(1100);
        const said0 = await p.evaluate(() => document.getElementById('mAddStatus').textContent);
        await p.focus('#addSongSearchResults [data-add-i="0"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(800);
        const after = await p.evaluate(() => ({ said: document.getElementById('mAddStatus').textContent, focusI: document.activeElement.dataset && document.activeElement.dataset.addI, ariaDis: document.activeElement.getAttribute && document.activeElement.getAttribute('aria-disabled') }));
        check('I10 Add songs announces results and the add; focus stays on the row', said0 === '2 results' && /^Added to /.test(after.said) && after.focusI === '0' && after.ariaDis === 'true', { said0, after });
        // title parsing
        const parsed = await p.evaluate(() => [
            parseYoutubeResultTitle('Here Comes the Sun - Remastered 2009', 'The Beatles - Topic'),
            parseYoutubeResultTitle('Dreams - 2004 Remaster', 'Fleetwood Mac'),
            parseYoutubeResultTitle('Hotel California - Live', 'Eagles'),
            parseYoutubeResultTitle('Rick Astley - Never Gonna Give You Up (Official Video)', 'Rick Astley'),
        ]);
        check('I11 "Song - Remastered / Live" keeps the song as the title and the channel as the artist', parsed[0].title === 'Here Comes the Sun - Remastered 2009' && parsed[0].artist === 'The Beatles' && parsed[1].artist === 'Fleetwood Mac' && parsed[2].title === 'Hotel California - Live' && parsed[3].artist === 'Rick Astley' && parsed[3].title === 'Never Gonna Give You Up', parsed);
        const q = await p.evaluate(() => document.querySelector('#queueModal .add-song-modal-close').getAttribute('aria-label'));
        check('I12 Up next\'s close button is named Close', q === 'Close', q);
        await ctx.close();
    }
    {
        // an empty playlist active and nothing playing: the hidden mini player is inert
        const { ctx, p } = await open({ acct: 'demo' });
        const d = await p.evaluate(() => ({ hidden: document.getElementById('mDock').classList.contains('m-dock-hidden'), inert: document.getElementById('mDock').inert }));
        check('I13 the hidden mini player is inert', !d.hidden || d.inert, d);
        // coverless Library card gets the note
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(500);
        const note = await p.evaluate(() => { const c = document.querySelector('#roomCenter .record-card .cover-art'); return c && !c.querySelector('.cover-main') ? getComputedStyle(c, '::after').content : 'has-cover'; });
        check('I14 a coverless Library card shows the note glyph', note === '""' || note === 'has-cover', note);
        // a chip with nothing: a message
        await p.evaluate(() => { document.querySelectorAll('#roomCenter .record-card').forEach(c => c.dataset.source = 'spotify'); setSourceFilter('user'); });
        await p.waitForTimeout(200);
        const msg = await p.evaluate(() => getComputedStyle(document.querySelector('#roomCenter .conveyor-rows'), '::before').content);
        check('I15 a Library chip with no playlists says so', /No local playlists yet/.test(msg), msg);
        await p.evaluate(() => setSourceFilter('all'));
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
