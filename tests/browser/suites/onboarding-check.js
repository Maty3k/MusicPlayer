// "Where's your music now?": the chooser that helps a new user bring their
// music over from another app. An empty library gets it from Home's empty
// card; anyone gets it from the You page, Library + and (desktop) the
// crate's sleeve tile. Each way opens the right import tab, the file picker,
// or Add songs; back closes it.
// A brand-new account (no playlists) used to get the chooser itself on load;
// since the setup wizard it gets the wizard instead (its "where" step shows
// these same rows, see setup-wizard-check), and the chooser's Start fresh on
// such an account opens the wizard's playlist step. N1, N3–N5, D6 and D7
// changed with it.
// Accounts (BrowserTestSeeder): empty = no playlists, demo = one empty
// Favorites, mid = songs. Writes to /save-music are faked.
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const desktop = !!opts.desktop;
        const ctx = await b.newContext({
            viewport: opts.viewport || (desktop ? { width: 1280, height: 800 } : { width: 390, height: 844 }),
            isMobile: !desktop, hasTouch: !desktop,
            storageState: L.state(opts.acct || 'demo'),
        });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|ytimg\.com|lrclib/, r => r.abort());
        await p.goto(APP); await p.waitForTimeout(1400);
        if (opts.raw) return { ctx, p };
        // Fakes and stubs after the load (the mock harness keeps this part)
        p.__posts = []; p.__uploads = 0;
        await p.route('**/youtube-playlist', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, title: 'A List', videos: [] }) }));
        await p.route('**/upload-song', (r) => { p.__uploads++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, mp3_url: `/media/bring-${p.__uploads}.mp3`, cover: '' }) }); });
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (body.action === 'add') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, index: 0 }) });
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: 1, skipped: 0 }) });
            if (body.action === 'createPlaylist') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, error: 'faked' }) });
            if (['recordPlay', 'stats', 'switch', 'favorite'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, stats: { totalPlays: 0, distinctSongs: 0, distinctArtists: 0, topSongs: [], topArtists: [] } }) });
            return route.continue();
        });
        // A file input's click() is recorded instead of opening a picker;
        // nothing plays in these checks
        await p.evaluate(() => {
            window.__fileClicks = [];
            const orig = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () {
                if (this.type === 'file') { window.__fileClicks.push(this.id); return; }
                return orig.apply(this, arguments);
            };
            window.playSongSource = function () {};
        });
        return { ctx, p };
    }
    // ---- end open
    const look = (p) => p.evaluate(() => {
        const chooser = document.getElementById('bringMusicModal');
        const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
        const a = document.activeElement;
        return {
            layer: history.state && history.state.mLayer || null,
            depth: history.state && history.state.mDepth || 0,
            modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
            chooser: !!chooser && chooser.classList.contains('active'),
            list: vis('bringMusicList'),
            stepSpotify: vis('bringStepSpotify'),
            stepApple: vis('bringStepApple'),
            tab: (document.querySelector('#importTabs .import-tab.active') || {}).dataset?.tab || null,
            panes: ['importPastePane', 'importYoutubePane', 'importSpotifyPane'].filter(vis),
            intoNew: typeof importIntoNew !== 'undefined' ? importIntoNew : null,
            wizardTitle: (document.getElementById('playlistEditModalTitle') || {}).textContent || '',
            setup: (() => { const w = document.getElementById('setupWizard'); const sec = w && w.classList.contains('active') && w.querySelector('.setup-step:not([hidden])'); return sec ? sec.dataset.step : null; })(),
            you: document.documentElement.classList.contains('m-you'),
            active: a ? (a.id || (a.dataset && (a.dataset.bring || a.dataset.mAdd)) || a.className || a.tagName) : null,
            sectionInert: !!(document.getElementById('music-section') || {}).inert,
        };
    });
    const back = async (p, ms = 750) => { await p.evaluate(() => history.back()); await p.waitForTimeout(ms); return look(p); };
    // Back until no layer is left (Home, nothing open)
    const toRoot = async (p) => {
        for (let i = 0; i < 4; i++) {
            const s = await look(p);
            if (s.depth === 0 && s.modals.length === 0) return s;
            await back(p);
        }
        return look(p);
    };
    const pick = async (p, kind, ms = 800) => { await p.tap(`#bringMusicModal .bring-pane:not([hidden]) [data-bring="${kind}"]`); await p.waitForTimeout(ms); return look(p); };
    const spotifyOn = (p) => p.evaluate(() => typeof spotifyOn !== 'undefined' && !!spotifyOn);

    // 1. A brand-new account (no playlists): the setup wizard on load (was:
    // the chooser itself); the chooser opened by hand still works
    {
        const { ctx, p } = await open({ acct: 'empty' });
        let s = await look(p);
        // Changed with the setup wizard: N1 used to expect the chooser here
        check('N1 a new account opens on the setup wizard\'s Welcome, not the chooser on its own (a back layer; the page behind inert)',
            s.setup === 'welcome' && !s.chooser && !s.modals.includes('playlistEditModal') && s.layer === 'modal:setup' && s.depth === 1 && s.sectionInert, s);
        const dlg = await p.evaluate(() => { const m = document.getElementById('bringMusicModal'); return { role: m.getAttribute('role'), modal: m.getAttribute('aria-modal'), title: document.getElementById(m.getAttribute('aria-labelledby')).textContent, rows: [...m.querySelectorAll('#bringMusicList [data-bring]')].map(r => r.dataset.bring) }; });
        check('N2 the chooser is a labelled dialog with the five ways', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.title === 'Where’s your music now?' && JSON.stringify(dlg.rows) === JSON.stringify(['spotify', 'apple', 'youtube', 'files', 'fresh']), dlg);
        s = await back(p);
        check('N5 back closes the on-load setup, and nothing follows it', !s.chooser && s.setup === null && s.modals.length === 0 && s.depth === 0, s);
        // Changed with the setup wizard: Start fresh on a playlist-less
        // account was the old playlist wizard; now the setup's playlist step
        await p.evaluate(() => window.showBringMusicModal()); await p.waitForTimeout(600);
        s = await pick(p, 'fresh');
        check('N3 the chooser\'s Start fresh (no playlists yet) reaches the setup\'s first playlist (the chooser\'s layer replaced by the setup\'s)',
            !s.chooser && s.setup === 'playlist' && !s.modals.includes('playlistEditModal') && s.layer === 'modal:setup' && s.depth === 1, s);
        s = await back(p);
        check('N4 back closes it onto Home', s.modals.length === 0 && s.depth === 0, s);
        check('N errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'empty' });
        let s = await back(p); // the on-load setup
        // a way in from the chooser on a playlist-less account: the import makes its own playlist
        await p.evaluate(() => window.showBringMusicModal()); await p.waitForTimeout(600);
        s = await pick(p, 'youtube');
        check('N6 a new account\'s YouTube import goes into a new playlist', s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && s.intoNew === true, s);
        check('N errors (2)', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // 2. An empty library (demo: one empty Favorites): Home's card, and every way
    {
        const { ctx, p } = await open({ acct: 'demo' });
        let s = await look(p);
        const card = await p.evaluate(() => { const c = document.getElementById('crateEmptyBring'); return c ? { text: c.textContent.trim(), shown: c.getClientRects().length > 0 } : null; });
        check('E1 an account with playlists but no songs: no chooser on load; Home\'s empty card offers it', !s.chooser && s.depth === 0 && card && card.shown && card.text === 'Bring your music over', { s, card });
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        s = await look(p);
        check('E2 the card opens the chooser as a back layer, focus inside', s.chooser && s.layer === 'modal:bringMusic' && s.depth === 1 && s.active === 'spotify', s);

        // YouTube: straight to the YouTube link tab
        s = await pick(p, 'youtube');
        check('E3 YouTube → the import sheet on its YouTube link tab (the chooser\'s layer replaced)', !s.chooser && s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && JSON.stringify(s.panes) === '["importYoutubePane"]' && s.layer === 'modal:import' && s.depth === 1, s);
        s = await back(p);
        check('E4 back closes the import onto Home', s.modals.length === 0 && s.depth === 0, s);

        // Spotify: with this server's Spotify app the Spotify tab, else the steps via YouTube Music
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        const sp = await spotifyOn(p);
        s = await pick(p, 'spotify');
        if (sp) {
            check('E5 Spotify (configured) → the import sheet on its Spotify tab', s.modals.includes('spotifyImportModal') && s.tab === 'spotify' && !s.chooser, s);
        } else {
            const steps = await p.evaluate(() => [...document.querySelectorAll('#bringStepSpotify li')].map(li => li.textContent.trim()));
            check('E5 Spotify (not configured) → its steps in the sheet: a converter, Public or Unlisted, paste the link; focus on the steps', s.chooser && !s.list && s.stepSpotify && s.active === 'bring-step-title' && steps.length === 3 && /TuneMyMusic/.test(steps[0]) && /Soundiiz/.test(steps[0]) && /Public/.test(steps[1]) && /Unlisted/.test(steps[1]) && s.layer === 'modal:bringMusic', { s, steps });
            s = await pick(p, 'youtube');
            check('E6 Spotify\'s "Paste the YouTube Music link" → the YouTube link tab', s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && !s.chooser && s.depth === 1, s);
        }
        await toRoot(p);

        // Apple Music: its steps; back to the list; Paste a list; the YouTube route
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        s = await pick(p, 'apple', 500);
        const apple = await p.evaluate(() => [...document.querySelectorAll('#bringStepApple [data-bring]')].map(x => x.dataset.bring));
        check('E7 Apple Music → its steps: the converter route and a Mac\'s Paste a list', s.chooser && s.stepApple && !s.list && JSON.stringify(apple) === '["youtube","paste"]', { s, apple });
        await p.tap('#bringStepApple [data-bring-back]'); await p.waitForTimeout(400);
        s = await look(p);
        check('E8 "All the ways" goes back to the list, focus on Apple Music; still one layer', s.chooser && s.list && !s.stepApple && s.active === 'apple' && s.depth === 1, s);
        await pick(p, 'apple', 500);
        s = await pick(p, 'paste');
        check('E9 Apple\'s Paste a list → the import sheet on Paste a list', s.modals.includes('spotifyImportModal') && s.tab === 'paste' && JSON.stringify(s.panes) === '["importPastePane"]' && !s.chooser, s);
        await toRoot(p);
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        await pick(p, 'apple', 500);
        s = await pick(p, 'youtube');
        check('E10 Apple\'s converter route → the YouTube link tab', s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && !s.chooser, s);
        await toRoot(p);

        // a step open, then back: the whole chooser closes (one layer)
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        await pick(p, 'apple', 500);
        s = await back(p);
        check('E11 back from a way\'s steps closes the chooser', !s.chooser && s.depth === 0 && s.modals.length === 0, s);

        // Start fresh with a playlist already there: Add songs
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        s = await pick(p, 'fresh');
        check('E12 Start fresh (a playlist exists) → Add songs', s.modals.includes('addSongModal') && !s.chooser && s.layer === 'modal:addSong' && s.depth === 1, s);
        await toRoot(p);

        // Files: the picker opens inside the tap; the picked files go to the batch importer
        await p.tap('#crateEmptyBring'); await p.waitForTimeout(700);
        await pick(p, 'files', 300);
        const clicks = await p.evaluate(() => window.__fileClicks.slice());
        s = await look(p);
        check('E13 Files → the multi-file picker opens from the tap; the chooser waits for the pick', clicks.includes('bringFilesInput') && s.chooser, { clicks, s });
        const multiple = await p.evaluate(() => document.getElementById('bringFilesInput').multiple);
        const before = p.__posts.length;
        await p.setInputFiles('#bringFilesInput', [1, 2].map(n => ({ name: `Moved ${n}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.from('ID3moved' + n) })));
        await p.waitForTimeout(3500);
        const adds = p.__posts.slice(before).filter(x => x.action === 'add');
        s = await look(p);
        check('E14 the picked files upload through the batch path (several at once) and the chooser closes', multiple && p.__uploads === 2 && adds.length === 2 && adds.every(x => x.link === true) && !s.chooser && s.depth === 0, { multiple, uploads: p.__uploads, adds, s });
        await ctx.close();
    }

    // 3. The permanent entries: the You page row and Library +
    {
        const { ctx, p } = await open({ acct: 'mid' });
        let s = await look(p);
        const card = await p.evaluate(() => !!document.getElementById('crateEmptyHint'));
        check('P1 an account with songs: no chooser on load, no empty card', !s.chooser && s.depth === 0 && !card && s.layer === null, { s, card });
        await p.tap('#mAvatarBtn'); await p.waitForTimeout(700);
        const row = await p.evaluate(() => { const r = document.getElementById('mYouBring'); return r ? { text: r.querySelector('b').textContent, shown: r.getClientRects().length > 0 } : null; });
        // from the keyboard, so the row is the focused opener
        await p.focus('#mYouBring'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
        s = await look(p);
        check('P2 the You page has "Bring your music over"; it opens the chooser over the page', row && row.shown && row.text === 'Bring your music over' && s.chooser && s.you && s.layer === 'modal:bringMusic' && s.depth === 2, { row, s });
        s = await back(p);
        check('P3 back closes the chooser onto the You page, focus back on its row', !s.chooser && s.you && s.layer === 'you' && s.active === 'mYouBring', s);
        s = await back(p);
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(600);
        await p.tap('#mLibraryNew'); await p.waitForTimeout(600);
        const rows = await p.evaluate(() => [...document.querySelectorAll('#mAddSheet [data-m-add]')].map(r => r.dataset.mAdd));
        await p.tap('#mAddSheet [data-m-add="bring"]'); await p.waitForTimeout(800);
        s = await look(p);
        check('P4 Library + offers "Bring your music over" (last); it replaces the + menu with the chooser', rows[rows.length - 1] === 'bring' && s.chooser && !s.modals.includes('mAddSheet') && s.layer === 'modal:bringMusic' && s.depth === 2, { rows, s });
        s = await back(p);
        check('P5 back closes it onto Library', !s.chooser && s.modals.length === 0 && s.layer === 'tab' && s.depth === 1, s);
        check('P errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // 4. Desktop: the crate's sleeve tile (any account), the empty card, the new-account load
    {
        const { ctx, p } = await open({ acct: 'mid', desktop: true });
        let s = await look(p);
        const tile = await p.evaluate(() => { const t = document.getElementById('crateBringTile'); return t ? { shown: getComputedStyle(t).display !== 'none' && t.getClientRects().length > 0, text: t.textContent.trim() } : null; });
        check('D1 desktop, songs: no chooser on load; the crate has a "Bring your music over" sleeve next to New playlist', !s.chooser && tile && tile.shown && tile.text === 'Bring your music over', { s, tile });
        await p.focus('#crateBringTile'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
        s = await look(p);
        check('D2 the tile opens the chooser (keyboard), focus inside; no history layer on desktop', s.chooser && s.active === 'spotify' && s.depth === 0, s);
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        s = await look(p);
        check('D3 Escape closes it, focus back on the tile', !s.chooser && s.active === 'crateBringTile', s);
        await p.focus('#crateBringTile'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
        await p.click('#bringMusicModal [data-bring="youtube"]'); await p.waitForTimeout(500);
        s = await look(p);
        const focusField = await p.evaluate(() => document.activeElement && document.activeElement.id);
        check('D4 desktop YouTube → the YouTube link tab with its field focused', s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && !s.chooser && focusField === 'youtubeImportUrl', { s, focusField });
        check('D errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'demo', desktop: true });
        const card = await p.evaluate(() => { const c = document.getElementById('crateEmptyBring'); return c ? c.getClientRects().length > 0 : false; });
        await p.click('#crateEmptyBring'); await p.waitForTimeout(500);
        const s = await look(p);
        check('D5 desktop empty library: the empty-collection card opens the chooser', card && s.chooser, { card, s });
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'empty', desktop: true });
        let s = await look(p);
        // Changed with the setup wizard: D6 and D7 used to expect the chooser
        // on load and the old playlist wizard after its Start fresh
        check('D6 desktop new account: the setup wizard on load, not the chooser on its own', s.setup === 'welcome' && !s.chooser && !s.modals.includes('playlistEditModal'), s);
        await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        await p.evaluate(() => window.showBringMusicModal()); await p.waitForTimeout(400);
        await p.click('#bringMusicModal [data-bring="fresh"]'); await p.waitForTimeout(500);
        s = await look(p);
        check('D7 desktop: the chooser\'s Start fresh (no playlists) → the setup\'s first playlist', !s.chooser && s.setup === 'playlist' && !s.modals.includes('playlistEditModal'), s);
        check('D errors (2)', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
