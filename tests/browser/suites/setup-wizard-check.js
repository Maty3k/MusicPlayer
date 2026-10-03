// The first-run setup wizard (#setupWizard): a brand-new account (no
// playlists) opens on it, on phones and the desktop. Welcome → your name →
// "Where's your music now?" (the chooser's own rows, borrowed) → Start
// fresh: your first playlist → (the page reloads) your first song → You're
// all set. Checks: each step forward and back (the phone's back gesture
// too), the name save's payload, every way out of "where" routing as the
// chooser does, the playlist create and the first song, Done, the keyboard
// (focus on each step's heading, Tab kept inside, Enter, Esc), axe on every
// step, reduced motion, the member card's hand-over, the app (?app=1)
// keeping its old playlist wizard, and accounts with music never seeing it.
// Accounts (BrowserTestSeeder): empty = no playlists, mid = songs. Writes
// (/save-music, /settings/name, uploads, the YouTube search) are faked.
const L = require('../lib');
const APP = L.APP;
const AXE = require.resolve('axe-core/axe.min.js', { paths: [L.ROOT] });
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - First Find', channel: 'Band One', thumbnail: '' },
    { videoId: 'bbbbbbbbbb2', title: 'Second Find', channel: 'Someone', thumbnail: '' },
];
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });

(async () => {
    const b = await L.launch();

    async function open(opts = {}) {
        const phone = !opts.desktop;
        const vp = opts.vp || (phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
        const ctx = await b.newContext({
            viewport: vp, isMobile: phone, hasTouch: phone,
            reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
            storageState: L.state(opts.acct || 'empty'),
        });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com|ytimg\.com|lrclib/, r => r.abort());
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1400);
        if (opts.raw) return { ctx, p };
        // Fakes (after the load, so they hold through the playlist's reload)
        p.__posts = []; p.__names = []; p.__uploads = 0;
        await p.route('**/settings/name', (route) => {
            p.__names.push(JSON.parse(route.request().postData() || '{}'));
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) }));
        await p.route('**/youtube-playlist', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, title: 'A List', videos: [] }) }));
        await p.route('**/upload-song', (r) => { p.__uploads++; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, mp3_url: `/media/setup-${p.__uploads}.mp3`, cover: '' }) }); });
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            if (body.action === 'add') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, index: 0 }) });
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: 1, skipped: 0 }) });
            // The playlist isn't really made: the reload finds the library as it was
            if (body.action === 'createPlaylist') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, playlistId: 'favorites', playlist: { name: body.name, color: body.color } }) });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, stats: { totalPlays: 0, distinctSongs: 0, distinctArtists: 0, topSongs: [], topArtists: [] } }) });
        });
        await stubPage(p);
        return { ctx, p };
    }
    // ---- end open

    // Nothing plays; a file input's click() is recorded instead of opening a picker
    async function stubPage(p) {
        await p.evaluate(() => {
            window.__played = [];
            window.playSongSource = function (s) { window.__played.push(s && s.title); };
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            window.__fileClicks = [];
            const orig = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () {
                if (this.type === 'file') { window.__fileClicks.push(this.id); return; }
                return orig.apply(this, arguments);
            };
        });
    }

    async function axeScan(p) {
        await p.addScriptTag({ path: AXE });
        return p.evaluate(async () => {
            const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], resultTypes: ['violations'] });
            return res.violations.map(v => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.map(n => n.target.join(' ')).slice(0, 3).join(' | ')}`);
        });
    }

    const look = (p) => p.evaluate(() => {
        const w = document.getElementById('setupWizard');
        const open = !!w && w.classList.contains('active');
        const sec = w && w.querySelector('.setup-step:not([hidden])');
        const back = document.getElementById('setupBack');
        const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && el.getClientRects().length > 0; };
        const a = document.activeElement;
        const st = history.state || {};
        return {
            open,
            step: open && sec ? sec.dataset.step : null,
            count: open ? (document.getElementById('setupCount') || {}).textContent : '',
            back: !!back && !back.hidden && back.getClientRects().length > 0,
            labelledBy: w ? w.getAttribute('aria-labelledby') : null,
            active: a ? (a.id || (a.dataset && a.dataset.bring) || (typeof a.className === 'string' ? a.className : '') || a.tagName) : null,
            layer: st.mLayer || null,
            depth: st.mDepth || 0,
            stack: Array.isArray(st.mStack) ? st.mStack.map(x => x.n) : [],
            modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
            chooser: !!document.getElementById('bringMusicModal') && document.getElementById('bringMusicModal').classList.contains('active'),
            listInWizard: !!w && !!w.querySelector('#bringMusicList'),
            list: vis('bringMusicList'),
            stepSpotify: vis('bringStepSpotify'),
            stepApple: vis('bringStepApple'),
            tab: (document.querySelector('#importTabs .import-tab.active') || {}).dataset?.tab || null,
            intoNew: typeof importIntoNew !== 'undefined' ? importIntoNew : null,
            sectionInert: !!(document.getElementById('music-section') || {}).inert,
        };
    });
    const wait = (p, ms) => p.waitForTimeout(ms);
    const back = async (p, ms = 750) => { await p.evaluate(() => history.back()); await wait(p, ms); return look(p); };
    const click = async (p, sel, ms = 600) => { await p.click(sel); await wait(p, ms); return look(p); };
    const next = (p, step, ms) => click(p, `#setupWizard .setup-step[data-step="${step}"] [data-setup-next], #setupWizard .setup-step[data-step="${step}"] .setup-primary`, ms);
    const pick = (p, kind, ms) => click(p, `#setupWizard .bring-pane:not([hidden]) [data-bring="${kind}"]`, ms);
    const noSetupLayers = (s) => !s.stack.some(n => n === 'modal:setup' || n === 'setupStep');
    const spotifyOn = (p) => p.evaluate(() => typeof spotifyOn !== 'undefined' && !!spotifyOn);
    const accountName = (p) => p.evaluate(() => { const el = document.getElementById('mAccountName') || document.getElementById('dvAcctName'); const t = el ? el.textContent.trim() : ''; return t === 'Your account' ? '' : t; });

    // ---- 1. Phone: the whole Start fresh path, forward and back
    {
        const { ctx, p } = await open({ acct: 'empty' });
        let s = await look(p);
        const dlg = await p.evaluate(() => { const w = document.getElementById('setupWizard'); return { role: w.getAttribute('role'), modal: w.getAttribute('aria-modal'), title: document.getElementById(w.getAttribute('aria-labelledby')).textContent.trim() }; });
        check('S1 phone: a new account opens on the setup\'s Welcome (a back layer; focus on its heading; the page behind inert; the chooser not on its own)',
            s.open && s.step === 'welcome' && s.layer === 'modal:setup' && s.depth === 1 && s.active === 'setupTitleWelcome' && s.sectionInert && !s.chooser && !s.back && s.count === 'Step 1 of 6', s);
        check('S2 it is a labelled modal dialog, named by the step\'s heading', dlg.role === 'dialog' && dlg.modal === 'true' && dlg.title === 'Welcome to Music Player', dlg);
        let v = await axeScan(p);
        check('S3 axe: Welcome, no violations', v.length === 0, v);

        const name0 = await accountName(p);
        s = await next(p, 'welcome');
        const prefill = await p.evaluate(() => document.getElementById('setupName').value);
        check('S4 Get started → your name: prefilled from the account, focus on its heading, Back shown, a step layer',
            s.step === 'name' && s.active === 'setupTitleName' && s.labelledBy === 'setupTitleName' && s.back && s.count === 'Step 2 of 6' && s.layer === 'setupStep' && s.depth === 2 && prefill === name0, { s, prefill, name0 });
        v = await axeScan(p);
        check('S5 axe: your name, no violations', v.length === 0, v);
        s = await back(p);
        check('S6 the back gesture goes back to Welcome (focus on its heading)', s.open && s.step === 'welcome' && s.depth === 1 && s.active === 'setupTitleWelcome' && !s.back, s);

        await next(p, 'welcome');
        await p.fill('#setupName', 'Wizard Tester');
        const avatar = await p.evaluate(() => document.getElementById('setupAvatar').textContent);
        s = await click(p, '#setupNameSave', 900);
        const shownName = await accountName(p);
        check('S7 Continue saves the name (POST /settings/name {name}) and the account shows it; on to "where"',
            p.__names.length === 1 && JSON.stringify(p.__names[0]) === JSON.stringify({ name: 'Wizard Tester' }) && avatar === 'W' && shownName === 'Wizard Tester'
            && s.step === 'where' && s.active === 'setupTitleWhere' && s.count === 'Step 3 of 6' && s.depth === 3, { names: p.__names, avatar, shownName, s });
        const rows = await p.evaluate(() => [...document.querySelectorAll('#setupWizard #bringMusicList [data-bring]')].map(r => r.dataset.bring));
        check('S8 "where" shows the chooser\'s own five ways inside the setup', s.listInWizard && s.list && !s.chooser && JSON.stringify(rows) === JSON.stringify(['spotify', 'apple', 'youtube', 'files', 'fresh']), { s, rows });
        v = await axeScan(p);
        check('S9 axe: where, no violations', v.length === 0, v);

        s = await click(p, '#setupBack');
        const kept = await p.evaluate(() => document.getElementById('setupName').value);
        check('S10 Back (the button) goes to your name, the typed name kept; one layer fewer', s.step === 'name' && kept === 'Wizard Tester' && s.depth === 2 && s.active === 'setupTitleName', { s, kept });
        s = await click(p, '#setupNameSave', 900);
        check('S11 Continue with the saved name unchanged: no second save', p.__names.length === 1 && s.step === 'where' && s.depth === 3, { names: p.__names, s });

        s = await pick(p, 'apple', 500);
        check('S12 Apple Music shows its steps in the setup', s.step === 'where' && s.stepApple && !s.list && s.active === 'bring-step-title', s);
        v = await axeScan(p);
        check('S13 axe: where (Apple Music\'s steps), no violations', v.length === 0, v);
        s = await click(p, '#setupBack', 400);
        check('S14 Back from a way\'s steps goes to the list of ways, focus on that way; still "where"', s.step === 'where' && s.list && !s.stepApple && s.active === 'apple' && s.depth === 3, s);

        s = await pick(p, 'fresh');
        const pl = await p.evaluate(() => ({ name: document.getElementById('setupPlName').value, radios: [...document.querySelectorAll('#setupColors [role="radio"]')].map(r => r.getAttribute('aria-checked')), sleeve: document.getElementById('setupSleeveName').textContent }));
        check('S15 Start fresh → your first playlist: "Favorites" prefilled, a colour picked of ten, the sleeve shows the name',
            s.step === 'playlist' && s.active === 'setupTitlePlaylist' && s.count === 'Step 4 of 6' && s.depth === 4 && pl.name === 'Favorites' && pl.radios.length === 10 && pl.radios.filter(x => x === 'true').length === 1 && pl.sleeve === 'Favorites', { s, pl });
        await p.focus('#setupColors [aria-checked="true"]');
        await p.keyboard.press('ArrowRight'); await wait(p, 200);
        const picked = await p.evaluate(() => { const c = document.querySelector('#setupColors [aria-checked="true"]'); return { color: c.dataset.color, focused: document.activeElement === c, label: c.getAttribute('aria-label') }; });
        check('S16 the arrow keys move the colour (radio group: the picked one focused, named)', picked.color === '#e85d75' && picked.focused && picked.label === 'Rose', picked);
        v = await axeScan(p);
        check('S17 axe: your first playlist, no violations', v.length === 0, v);
        s = await back(p);
        check('S18 the back gesture from the playlist goes back to "where" (its rows there again)', s.step === 'where' && s.list && s.listInWizard && s.depth === 3, s);
        s = await pick(p, 'fresh');

        // Create: the page reloads onto the song step
        await p.fill('#setupPlName', 'My Mix');
        await Promise.all([p.waitForNavigation({ timeout: 15000 }).catch(() => null), p.click('#setupPlSave')]);
        await wait(p, 1600);
        await stubPage(p);
        const create = p.__posts.filter(x => x.action === 'createPlaylist');
        s = await look(p);
        check('S19 Create posts createPlaylist {name, color} and, after the reload, the setup is on "Add your first song"',
            create.length === 1 && create[0].name === 'My Mix' && create[0].color === '#e85d75' && s.open && s.step === 'song' && s.count === 'Step 5 of 6' && s.active === 'setupTitleSong', { create, s });
        v = await axeScan(p);
        check('S20 axe: your first song, no violations', v.length === 0, v);

        await p.fill('#setupSongQuery', 'first find');
        s = await click(p, '#setupSongGo', 1200);
        const add = await p.evaluate(() => ({ title: document.getElementById('addSongModalTitle').textContent, q: document.getElementById('addSongSearch').value, rows: document.querySelectorAll('#addSongSearchResults .search-result-row').length }));
        check('S21 Search opens Add songs over the setup as "Add your first song", the words already searched', s.modals.includes('addSongModal') && s.open && add.title === 'Add your first song' && add.q === 'first find' && add.rows === 2 && s.layer === 'modal:addSong', { s, add });
        s = await back(p);
        check('S22 back closes Add songs onto the song step (nothing added)', s.open && s.step === 'song' && !s.modals.includes('addSongModal'), s);
        await click(p, '#setupSongGo', 1200);
        s = await click(p, '#addSongSearchResults .search-result-row', 1500);
        const added = p.__posts.filter(x => x.action === 'add');
        check('S23 a picked song is added (and plays); the setup moves on to "You\'re all set"', added.length === 1 && added[0].song && added[0].song.youtube_id === 'aaaaaaaaaa1' && s.open && s.step === 'done' && s.count === 'Step 6 of 6' && s.active === 'setupTitleDone' && !s.modals.includes('addSongModal'), { added, s });
        const tips = await p.evaluate(() => [...document.querySelectorAll('#setupWizard .setup-tips')].filter(u => u.getClientRects().length).map(u => [...u.querySelectorAll('b')].map(x => x.textContent).join(',')));
        check('S24 Done says what\'s where on a phone: the Home, Search and Library tabs', JSON.stringify(tips) === JSON.stringify(['Home,Search,Library']), tips);
        v = await axeScan(p);
        check('S25 axe: you\'re all set, no violations', v.length === 0, v);
        s = await click(p, '#setupWizard [data-setup-finish]', 1200);
        check('S26 Start listening closes the setup, every step\'s layer with it', !s.open && noSetupLayers(s) && !s.modals.includes('setupWizard'), s);
        check('S errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 2. Phone: Skip, closing, and every way out of "where"
    {
        const { ctx, p } = await open({ acct: 'empty' });
        let s = await back(p);
        check('R1 back on Welcome closes the setup cleanly (no layer left, nothing else opens)', !s.open && s.depth === 0 && s.modals.length === 0 && !s.chooser, s);
        await p.evaluate(() => window.showSetupWizard({ flow: 'full' })); await wait(p, 600);
        await next(p, 'welcome');
        s = await click(p, '#setupWizard .setup-step[data-step="name"] [data-setup-skip]');
        check('R2 Skip on your name: on to "where" without saving', s.step === 'where' && p.__names.length === 0 && s.depth === 3, { s, names: p.__names });

        s = await pick(p, 'youtube', 900);
        check('R3 YouTube → the import sheet on its YouTube tab, into a new playlist; the setup and its layers gone',
            !s.open && s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && s.intoNew === true && s.layer === 'modal:import' && s.depth === 1 && noSetupLayers(s), s);
        const home = await p.evaluate(() => document.getElementById('bringMusicModal').contains(document.getElementById('bringMusicList')));
        check('R4 the chooser\'s rows are back in the chooser', home, home);
        await back(p);

        // Spotify: with this server's Spotify app the Spotify tab, else its steps
        await p.evaluate(() => window.showSetupWizard({ flow: 'full', at: 'where' })); await wait(p, 600);
        const sp = await spotifyOn(p);
        s = await pick(p, 'spotify', 900);
        if (sp) {
            const spTab = await p.evaluate(() => !!document.querySelector('#importTabs [data-tab="spotify"]'));
            check('R5 Spotify (configured) → the import sheet on its Spotify tab; the setup gone', !s.open && s.modals.includes('spotifyImportModal') && (s.tab === 'spotify' || !spTab) && s.intoNew === true && noSetupLayers(s), { s, spTab });
            await back(p);
        } else {
            check('R5 Spotify (not configured) → its steps inside the setup', s.open && s.stepSpotify && !s.list, s);
            s = await pick(p, 'youtube', 900);
            check('R5b its "Paste the YouTube Music link" → the YouTube tab; the setup gone', !s.open && s.modals.includes('spotifyImportModal') && s.tab === 'youtube' && noSetupLayers(s), s);
            await back(p);
        }

        // Apple Music → Paste a list
        await p.evaluate(() => window.showSetupWizard({ flow: 'full', at: 'where' })); await wait(p, 600);
        await pick(p, 'apple', 500);
        s = await pick(p, 'paste', 900);
        check('R6 Apple Music\'s Paste a list → the import sheet on Paste a list; the setup gone', !s.open && s.modals.includes('spotifyImportModal') && s.tab === 'paste' && noSetupLayers(s), s);
        await back(p);

        // Files: the picker opens from the tap; the setup waits for the pick, then closes
        await p.evaluate(() => window.showSetupWizard({ flow: 'full', at: 'where' })); await wait(p, 600);
        s = await pick(p, 'files', 400);
        const clicks = await p.evaluate(() => window.__fileClicks.slice());
        check('R7 Files → the multi-file picker opens from the tap; the setup waits', clicks.includes('bringFilesInput') && s.open && s.step === 'where', { clicks, s });
        await p.setInputFiles('#bringFilesInput', [1, 2].map(n => ({ name: `Setup ${n}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.from('ID3setup' + n) })));
        await wait(p, 500);
        s = await look(p);
        await wait(p, 3500);
        check('R8 picked files close the setup and upload through the batch path', p.__uploads === 2 && !s.open && noSetupLayers(s), { uploads: p.__uploads, s });

        // The × closes from a later step, all its layers in one go. (A new
        // account's first files reload the page: the setup may be back on
        // Welcome by now, the fakes still in place.)
        await p.waitForLoadState('load');
        await stubPage(p);
        if (!(await look(p)).open) { await p.evaluate(() => window.showSetupWizard({ flow: 'full' })); await wait(p, 600); }
        await next(p, 'welcome');
        await click(p, '#setupWizard .setup-step[data-step="name"] [data-setup-skip]');
        s = await click(p, '#setupClose', 900);
        check('R9 the × on step 3 closes the setup and pops its three layers', !s.open && noSetupLayers(s) && s.depth === 0, s);
        check('R errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 3. Desktop: on load, keyboard all the way, Esc, the desktop's Done
    {
        const { ctx, p } = await open({ acct: 'empty', desktop: true });
        let s = await look(p);
        check('D1 desktop: a new account opens on Welcome, focus on its heading; no history layer', s.open && s.step === 'welcome' && s.active === 'setupTitleWelcome' && s.depth === 0 && !s.chooser, s);
        let v = await axeScan(p);
        check('D2 axe (desktop): Welcome, no violations', v.length === 0, v);
        await p.keyboard.press('Tab');
        const t1 = await p.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
        await p.keyboard.press('Enter'); await wait(p, 600);
        s = await look(p);
        check('D3 Tab from the heading reaches Get started; Enter → your name, focus on its heading', t1 === 'Get started' && s.step === 'name' && s.active === 'setupTitleName', { t1, s });
        await p.keyboard.press('Tab');
        const t2 = await p.evaluate(() => document.activeElement && document.activeElement.id);
        await p.keyboard.press('Control+A');
        await p.keyboard.type('Desk Person');
        await p.keyboard.press('Enter'); await wait(p, 900);
        s = await look(p);
        check('D4 Tab → the name field; typing and Enter saves it and goes on to "where"', t2 === 'setupName' && p.__names.length === 1 && p.__names[0].name === 'Desk Person' && s.step === 'where' && s.active === 'setupTitleWhere', { t2, names: p.__names, s });
        // Tab stays inside the dialog
        const trapped = await p.evaluate(async () => {
            const w = document.getElementById('setupWizard');
            return w.contains(document.activeElement);
        });
        let inside = true;
        for (let i = 0; i < 12; i++) {
            await p.keyboard.press('Tab');
            const ok = await p.evaluate(() => document.getElementById('setupWizard').contains(document.activeElement));
            if (!ok) inside = false;
        }
        for (let i = 0; i < 12; i++) {
            await p.keyboard.press('Shift+Tab');
            const ok = await p.evaluate(() => document.getElementById('setupWizard').contains(document.activeElement));
            if (!ok) inside = false;
        }
        check('D5 Tab and Shift+Tab stay inside the setup', trapped && inside, { trapped, inside });
        await p.focus('#setupWizard [data-bring="fresh"]');
        await p.keyboard.press('Enter'); await wait(p, 600);
        s = await look(p);
        check('D6 Enter on Start fresh → your first playlist', s.step === 'playlist' && s.active === 'setupTitlePlaylist', s);
        v = await axeScan(p);
        check('D7 axe (desktop): your first playlist, no violations', v.length === 0, v);
        await p.evaluate(() => setupNext('done')); await wait(p, 500);
        const tips = await p.evaluate(() => [...document.querySelectorAll('#setupWizard .setup-tips')].filter(u => u.getClientRects().length).map(u => [...u.querySelectorAll('b')].map(x => x.textContent).join(',')));
        check('D8 Done on the desktop points at the sidebar and the avatar', JSON.stringify(tips) === JSON.stringify(['Home,Search,Your Library,Your avatar']), tips);
        v = await axeScan(p);
        check('D9 axe (desktop): you\'re all set, no violations', v.length === 0, v);
        await p.keyboard.press('Escape'); await wait(p, 400);
        s = await look(p);
        check('D10 Esc closes the setup', !s.open && s.modals.length === 0, s);
        check('D errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 4. Desktop: the member card hands over at "where" (step 2 of 5)
    {
        const { ctx, p } = await open({ acct: 'empty', desktop: true });
        await p.evaluate(() => window.hideSetupWizard()); await wait(p, 300);
        // The card (a one-time session flash on the server), as it renders
        await p.evaluate(() => {
            const card = document.createElement('div');
            card.className = 'add-song-modal active';
            card.id = 'memberWelcomeModal';
            card.innerHTML = '<div class="add-song-modal-panel"><input id="memberWelcomeName"><button id="memberWelcomeContinue">Continue</button></div>';
            document.body.appendChild(card);
        });
        await p.fill('#memberWelcomeName', 'Card Holder');
        await p.evaluate(() => window.finishMemberWelcome()); await wait(p, 900);
        const s = await look(p);
        check('M1 the member card\'s Continue saves its name and opens the setup at "where" as step 2 of 5 (no Back: the card was step 1)',
            p.__names.length === 1 && p.__names[0].name === 'Card Holder' && s.open && s.step === 'where' && s.count === 'Step 2 of 5' && !s.back && !s.modals.includes('memberWelcomeModal'), { names: p.__names, s });
        check('M errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    // ---- 5. Reduced motion: the steps don't slide
    {
        const { ctx, p } = await open({ acct: 'empty', desktop: true, reduced: true });
        await next(p, 'welcome', 100);
        const anim = await p.evaluate(() => { const s = document.querySelector('#setupWizard .setup-step:not([hidden])'); return { name: getComputedStyle(s).animationName, disc: getComputedStyle(document.querySelector('.setup-disc')).animationName }; });
        check('X1 reduced motion: no slide between steps, no spinning record', anim.name === 'none' && anim.disc === 'none', anim);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'empty', desktop: true });
        await next(p, 'welcome', 60);
        const anim = await p.evaluate(() => getComputedStyle(document.querySelector('#setupWizard .setup-step:not([hidden])')).animationName);
        check('X2 with motion: the next step slides in', anim === 'setupInFwd', anim);
        await ctx.close();
    }

    // ---- 6. Accounts with music never see it; the app keeps its old wizard
    for (const desktop of [false, true]) {
        const { ctx, p } = await open({ acct: 'mid', desktop });
        const s = await look(p);
        check(`A${desktop ? 2 : 1} ${desktop ? 'desktop' : 'phone'}, an account with songs: no setup, no chooser on load`, !s.open && !s.chooser && s.modals.length === 0 && noSetupLayers(s), s);
        check(`A${desktop ? 2 : 1} errors`, p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ acct: 'empty', query: '?app=1' });
        const s = await look(p);
        const title = await p.evaluate(() => (document.getElementById('playlistEditModalTitle') || {}).textContent);
        check('A3 the app (?app=1), a new account: its old first-run playlist wizard, not the setup or the chooser', !s.open && !s.chooser && s.modals.includes('playlistEditModal') && title === 'Welcome to your record room', { s, title });
        check('A3 errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
