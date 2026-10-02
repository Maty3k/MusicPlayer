// Step 10: the phone's Add songs sheet (To picker, tap-to-add, rows), the
// import sheet without Spotify, and the desktop path left as it was.
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
        const ctx = await b.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, isMobile: opts.isMobile !== false, hasTouch: opts.hasTouch !== false, storageState: L.state(opts.acct || 'many') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = []; p.__opts = opts;
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/search-youtube', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) }));
        await p.route('**/youtube-playlist', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, title: 'A List', videos: [] }) }));
        let upN = 0;
        await p.route('**/upload-song', async (r) => {
            if (p.__opts.uploadDelay) await new Promise(res => setTimeout(res, p.__opts.uploadDelay));
            upN++;
            return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, mp3_url: `/media/test-up${upN}.mp3`, cover: '' }) });
        });
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: p.__opts.already ? 0 : 1, skipped: p.__opts.already ? 1 : 0 }) });
            if (body.action === 'add') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, index: 99 }) });
            if (['recordPlay', 'stats'].includes(body.action)) return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        await p.addInitScript(() => {
            window.__fileClicks = [];
            const orig = HTMLInputElement.prototype.click;
            HTMLInputElement.prototype.click = function () {
                if (this.type === 'file') { window.__fileClicks.push(this.id); return; }
                return orig.apply(this, arguments);
            };
        });
        await p.goto(APP); await p.waitForTimeout(1300);
        await p.evaluate(() => { window.__played = []; window.playSongSource = function (s, cue) { window.__played.push((cue ? 'cue:' : '') + (s && s.title)); }; });
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({
        layer: history.state && history.state.mLayer || null,
        depth: history.state && history.state.mDepth || 0,
        modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id),
        to: (document.getElementById('mAddToName') || {}).textContent,
        rows: (() => { const r = document.getElementById('mAddRows'); return r ? getComputedStyle(r).display !== 'none' : null; })(),
        active: document.activeElement && document.activeElement.id,
    }));
    const vis = (p, sel) => p.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; }, sel);
    const typeAdd = async (p, q, wait = 900) => { await p.fill('#addSongSearch', q); await p.dispatchEvent('#addSongSearch', 'input'); await p.waitForTimeout(wait); };

    {
        const { ctx, p } = await open();
        await p.tap('#mTabs .m-tab[data-tab="library"]'); await p.waitForTimeout(500);
        await p.tap('#mLibraryNew'); await p.waitForTimeout(400);
        await p.tap('#mAddSheet [data-m-add="songs"]'); await p.waitForTimeout(800);
        let s = await look(p);
        const active = await p.evaluate(() => playlistsMeta[String(activePlaylistId)].name);
        const sheet = await p.evaluate(() => ({ title: document.getElementById('addSongModalTitle').textContent, rows: [...document.querySelectorAll('#mAddRows [data-m-addsong]')].map(r => r.dataset.mAddsong), summary: document.querySelector('#addSongManualDetails summary').textContent, open: document.getElementById('addSongManualDetails').open }));
        check('A1 Library + → Add songs opens the sheet: To the open playlist, rows, details collapsed', s.modals.includes('addSongModal') && s.layer === 'modal:addSong' && s.to === active && s.rows && sheet.title === 'Add songs' && JSON.stringify(sheet.rows) === '["import","files"]' && sheet.summary === 'Enter details manually' && !sheet.open, { s, sheet, active });
        const dup = { bulk: await vis(p, '#addSongModal .bulk-import-btn'), up: await vis(p, '#mUploadBtn') };
        check('A2 no duplicate Import button or Upload button on the phone', dup.bulk === false && dup.up === false, dup);
        // the To picker
        await p.tap('#mAddToBtn'); await p.waitForTimeout(500);
        s = await look(p);
        const pick = await p.evaluate(() => ({ title: document.getElementById('mAddToTitle').textContent, current: (document.querySelector('#mAddToSheet .m-addto-row.is-current') || {}).dataset?.addto, songLine: document.querySelector('#mAddToSheet .m-addto-song').hidden, focus: document.activeElement.dataset && document.activeElement.dataset.addto }));
        const other = await p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)));
        check('A3 the To picker lists playlists over the sheet, the current one marked and focused', s.layer === 'modal:addTo' && s.modals.includes('addSongModal') && pick.title === 'Add songs to' && pick.current === pick.focus && pick.songLine, { s, pick });
        await p.tap(`#mAddToSheet [data-addto="${other}"]`); await p.waitForTimeout(600);
        s = await look(p);
        const otherName = await p.evaluate((id) => playlistsMeta[id].name, other);
        check('A4 picking one: back on the sheet, To shows it, focus on the To button', s.layer === 'modal:addSong' && s.to === otherName && s.active === 'mAddToBtn' && !s.modals.includes('mAddToSheet'), { s, otherName });
        // search and tap-to-add to the chosen (not open) playlist
        const n0 = await p.evaluate(() => songsData.length);
        await typeAdd(p, 'first find');
        const searching = await look(p);
        await p.tap('#addSongSearchResults [data-add-i="0"]'); await p.waitForTimeout(700);
        const posts = p.__posts.filter(x => x.action === 'addBatch');
        s = await look(p);
        const row = await p.evaluate(() => { const r = document.querySelector('#addSongSearchResults [data-add-i="0"]'); return { added: r.classList.contains('is-added'), disabled: r.getAttribute('aria-disabled') === 'true', label: r.getAttribute('aria-label') }; });
        const n1 = await p.evaluate(() => songsData.length);
        const played0 = await p.evaluate(() => window.__played);
        check('A5 a result adds to the chosen playlist and the sheet stays (the open list untouched)', !searching.rows && posts.length === 1 && posts[0].playlist === other && posts[0].songs[0].youtube_id === 'aaaaaaaaaa1' && row.added && row.disabled && s.modals.includes('addSongModal') && n1 === n0 && played0.length === 0, { posts, row, s, n0, n1, played0 });
        await p.tap('#addSongSearchResults [data-add-i="0"]', { force: true }).catch(() => {}); await p.waitForTimeout(400);
        check('A5 tapping it again adds nothing more', p.__posts.filter(x => x.action === 'addBatch').length === 1, p.__posts.length);
        // a playlist link offers its import
        await typeAdd(p, 'https://www.youtube.com/playlist?list=PLabc123', 800);
        const offer = await p.evaluate(() => document.querySelector('#addSongSearchResults .search-result-import') && document.querySelector('#addSongSearchResults').textContent.replace(/\s+/g, ' ').trim());
        await p.evaluate(() => { window.__ytFetch = 0; window.fetchYoutubePlaylist = () => { window.__ytFetch++; }; });
        await p.tap('#addSongSearchResults .search-result-import'); await p.waitForTimeout(800);
        s = await look(p);
        const imp = await p.evaluate(() => ({ tab: document.querySelector('#importTabs .import-tab.active').dataset.tab, url: document.getElementById('youtubeImportUrl').value, fetched: window.__ytFetch }));
        check('A6 a pasted playlist link offers Import, which opens it fetching', /Import this YouTube playlist/.test(offer || '') && s.modals.includes('spotifyImportModal') && !s.modals.includes('addSongModal') && imp.tab === 'youtube' && imp.url.includes('PLabc123') && imp.fetched === 1, { offer, s, imp });
        check('A errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        // tap-to-add into the open playlist; "Already in"; files; import row; Spotify off
        const { ctx, p } = await open();
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(600);
        const n0 = await p.evaluate(() => songsData.length);
        await typeAdd(p, 'first find');
        await p.tap('#addSongSearchResults [data-add-i="1"]'); await p.waitForTimeout(700);
        const n1 = await p.evaluate(() => songsData.length);
        const post = p.__posts.filter(x => x.action === 'addBatch').pop();
        check('B1 To the open playlist: it joins the list on screen', n1 === n0 + 1 && post && post.playlist === await p.evaluate(() => String(activePlaylistId)), { n0, n1, post });
        p.__opts.already = true;
        await p.tap('#addSongSearchResults [data-add-i="0"]'); await p.waitForTimeout(700);
        const already = await p.evaluate(() => ({ label: document.querySelector('#addSongSearchResults [data-add-i="0"]').getAttribute('aria-label'), toast: (document.querySelector('.m-toast') || {}).textContent }));
        check('B2 a song already there says so', /already there/.test(already.label) && /^Already in/.test(already.toast || ''), already);
        p.__opts.already = false;
        // Spotify playlist link without Spotify on this server
        await typeAdd(p, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 800);
        const sp = await p.evaluate(() => document.getElementById('addSongSearchResults').textContent);
        check('B3 a Spotify playlist link (no Spotify here) says to paste the songs instead', /can’t be imported here/.test(sp), sp);
        // files: the picker opens inside the tap, then the picked files go to the batch path
        await typeAdd(p, '', 200);
        await p.tap('#mAddRows [data-m-addsong="files"]'); await p.waitForTimeout(300);
        const clicks = await p.evaluate(() => window.__fileClicks.slice());
        const before = p.__posts.length;
        await p.setInputFiles('#addSongFile', { name: 'My Track.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3fake') });
        await p.waitForTimeout(2200);
        const adds = p.__posts.slice(before).filter(x => x.action === 'add');
        const s = await look(p);
        const toast = await p.evaluate(() => (document.querySelector('.import-toast, #importToast') || {}).textContent || '');
        check('B4 From files: one file goes through the batch path to the To playlist (sheet closed, progress shown)', clicks.includes('addSongFile') && adds.length === 1 && adds[0].link === true && adds[0].playlist === await p.evaluate(() => String(activePlaylistId)) && !s.modals.includes('addSongModal'), { clicks, adds, s, toast });
        // the import row opens the import sheet into the open playlist
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(600);
        await p.tap('#mAddRows [data-m-addsong="import"]'); await p.waitForTimeout(800);
        const imp = await p.evaluate(() => ({ open: document.getElementById('spotifyImportModal').classList.contains('active'), into: importIntoCurrent, spTab: !!document.querySelector('#importTabs [data-tab="spotify"]'), spField: !!document.getElementById('spotifyImportUrl'), add: document.getElementById('addSongModal').classList.contains('active') }));
        check('B5 Import a playlist: the import sheet, into the open playlist; no Spotify tab without Spotify', imp.open && imp.into === true && !imp.spTab && !imp.spField && !imp.add, imp);
        check('B errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        // Search tab, playlist ⋯ menu, scanner on phones
        const { ctx, p } = await open();
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        await p.fill('#mSearchInput', 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(300);
        const sr = await p.evaluate(() => ({ rows: document.querySelectorAll('.m-search-link').length, text: document.getElementById('mSearchResults').textContent }));
        check('C1 Search: a Spotify playlist link without Spotify gets a hint, no Import row', sr.rows === 0 && /can’t be imported here/.test(sr.text), sr);
        const menu = await p.evaluate(() => [...document.querySelectorAll('#mPlaylistSheet [data-m-pl]')].map(r => r.dataset.mPl));
        check('C2 the playlist ⋯ menu has no Scan row (Add songs has the files and the cover)', !menu.includes('scan') && menu.includes('add') && menu.includes('import'), menu);
        await p.evaluate(() => window.showScanModal()); await p.waitForTimeout(500);
        const scan = { folder: await vis(p, '#scanModal .scan-folder-btn'), drop: await vis(p, '#scanFolderInput + .scan-or-divider'), files: await vis(p, '#scanModal .scan-files-btn') };
        check('C3 the Song Scanner on a phone: no folder or drop options', scan.folder === false && scan.drop === false && scan.files === true, scan);
        await ctx.close();
    }
    {
        // the setup wizard keeps search-tap-play
        const { ctx, p } = await open();
        await p.evaluate(() => window.showAddSongModal({ wizard: true })); await p.waitForTimeout(600);
        await typeAdd(p, 'first find');
        await p.tap('#addSongSearchResults [data-add-i="0"]'); await p.waitForTimeout(900);
        const w = { title: await p.evaluate(() => document.getElementById('addSongModalTitle').textContent), adds: p.__posts.filter(x => x.action === 'add'), batches: p.__posts.filter(x => x.action === 'addBatch') };
        check('D1 the wizard\'s first song still saves and cues straight away', w.title === 'Add your first song' && w.adds.length === 1 && !w.adds[0].playlist && w.batches.length === 0, w);
        await ctx.close();
    }
    {
        // desktop unchanged
        const { ctx, p } = await open({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(600);
        const d = { bulk: await vis(p, '#addSongModal .bulk-import-btn'), rows: await vis(p, '#mAddRows'), to: await vis(p, '#mAddTo'), plus: await vis(p, '#addSongModal .search-result-plus') };
        await typeAdd(p, 'first find');
        await p.click('#addSongSearchResults [data-add-i="0"]'); await p.waitForTimeout(900);
        const adds = p.__posts.filter(x => x.action === 'add');
        check('E1 desktop: the Import button stays, no To line or rows, a result saves as before', d.bulk === true && d.rows === false && d.to === false && adds.length === 1 && !adds[0].playlist, { d, adds });
        await ctx.close();
    }
    // review fixes
    {
        const { ctx, p } = await open();
        await p.evaluate(() => { window.__toasts = []; const t = window.mToast; window.mToast = (x) => { window.__toasts.push(x); return t(x); }; });
        const other = await p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)));
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        await p.tap('#mAddToBtn'); await p.waitForTimeout(400);
        await p.tap(`#mAddToSheet [data-addto="${other}"]`); await p.waitForTimeout(500);
        // a pasted song link → the manual form → it goes To the chosen playlist
        const n0 = await p.evaluate(() => songsData.length);
        await typeAdd(p, 'https://youtu.be/dQw4w9WgXcQ', 900);
        await p.evaluate(() => { document.getElementById('addSongTitle').value = 'Pasted Song'; });
        await p.tap('#addSongForm .add-song-btn-save'); await p.waitForTimeout(800);
        const post = p.__posts.filter(x => x.action === 'addBatch').pop();
        const g1 = await p.evaluate(() => ({ n: songsData.length, open: document.getElementById('addSongModal').classList.contains('active'), formOpen: document.getElementById('addSongManualDetails').open, title: document.getElementById('addSongTitle').value, toasts: window.__toasts.slice() }));
        check('G1 a pasted song link / the manual form goes To the chosen playlist; the sheet stays, reset', post && post.playlist === other && post.songs[0].youtube_id === 'dQw4w9WgXcQ' && g1.n === n0 && g1.open && !g1.formOpen && g1.title === '' && g1.toasts.some(t => /^Added to/.test(t)), { post, g1, n0 });
        // tap-to-add: the row says it, no toast over the next results
        await p.evaluate(() => { window.__toasts = []; });
        await typeAdd(p, 'first find');
        await p.tap('#addSongSearchResults [data-add-i="1"]'); await p.waitForTimeout(700);
        const t2 = await p.evaluate(() => window.__toasts.slice());
        check('G2 tap-to-add shows no "Added to" toast (the row ticks)', !t2.some(t => /^Added to/.test(t)), t2);
        // the import row adds into the playlist To names. Step 12: it used to
        // start a new playlist when To wasn't the open one (an import could
        // only target the active playlist); now it names its target.
        await typeAdd(p, '', 200);
        await p.tap('#mAddRows [data-m-addsong="import"]'); await p.waitForTimeout(800);
        const g3 = await p.evaluate(() => { setImportTarget('Some list', false); return { choice: importTargetChoice(), intoNew: importIntoNew, id: importPlaylistId, label: document.getElementById('importTargetCurrent').textContent }; });
        const g3name = await p.evaluate((id) => playlistsMeta[id].name, other);
        check('G3 Import a playlist with To elsewhere adds into that playlist (named in the label)', g3.choice === 'current' && g3.intoNew === false && g3.id === other && g3.label.includes(g3name), { g3, g3name });
        await ctx.close();
    }
    {
        // files into the open playlist: counts once; a playlist switch mid-run keeps them off the new list
        const { ctx, p } = await open();
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        const open0 = await p.evaluate(() => ({ id: String(activePlaylistId), n: songsData.length }));
        await p.tap('#mAddRows [data-m-addsong="files"]'); await p.waitForTimeout(300);
        await p.setInputFiles('#addSongFile', [{ name: 'A.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3a') }, { name: 'B.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3b') }]);
        await p.waitForTimeout(2500);
        const g4 = await p.evaluate((id) => ({ n: songsData.length, meta: playlistsMeta[id].songCount }), open0.id);
        check('G4 two files into the open playlist: in the list and counted once', g4.n === open0.n + 2 && g4.meta === g4.n, { open0, g4 });
        p.__opts.uploadDelay = 900;
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        await p.tap('#mAddRows [data-m-addsong="files"]'); await p.waitForTimeout(300);
        const metaBefore = await p.evaluate((id) => playlistsMeta[id].songCount, open0.id);
        await p.setInputFiles('#addSongFile', [{ name: 'C.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3c') }, { name: 'D.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3d') }]);
        await p.waitForTimeout(300);
        const nAtSwitch = await p.evaluate(() => { const other = Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId)); activePlaylistId = other; return songsData.length; }); // as if another playlist opened
        await p.waitForTimeout(3500);
        const g5 = await p.evaluate((id) => ({ n: songsData.length, meta: playlistsMeta[id].songCount }), open0.id);
        const posts = p.__posts.filter(x => x.action === 'add').slice(-2);
        check('G5 opening another playlist mid-import: the files still go To the chosen one, none join the new list', g5.n === nAtSwitch && g5.meta === metaBefore + 2 && posts.every(x => x.playlist === open0.id), { nAtSwitch, g5, metaBefore, posts });
        await ctx.close();
    }
    {
        // the Search tab hands a link to Add songs: the rows make way; the import offer's icon on desktop
        const { ctx, p } = await open();
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        await p.fill('#mSearchInput', 'https://youtu.be/dQw4w9WgXcQ'); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(400);
        await p.tap('.m-search-link[data-link="add-song"]'); await p.waitForTimeout(900);
        const rowsShown = await vis(p, '#mAddRows');
        check('G6 a link handed over from Search: the rows make way for the form', rowsShown === false, rowsShown);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        await typeAdd(p, 'https://www.youtube.com/playlist?list=PLabc123', 900);
        const ic = await p.evaluate(() => { const el = document.querySelector('#addSongSearchResults .search-result-import-ic'); return el ? { color: getComputedStyle(el).color, display: getComputedStyle(el).display } : null; });
        check('G7 desktop: the import offer\'s icon is styled (amber, centred)', ic && ic.display === 'flex' && ic.color !== 'rgb(0, 0, 0)', ic);
        await ctx.close();
    }
    {
        // opening the target playlist mid-import: its count matches its list
        const { ctx, p } = await open({ uploadDelay: 700 });
        p.__opts.uploadDelay = 700;
        const other = await p.evaluate(() => Object.keys(playlistsMeta).find(id => id !== String(activePlaylistId) && playlistsMeta[id].songCount > 0));
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        await p.tap('#mAddToBtn'); await p.waitForTimeout(400);
        await p.tap(`#mAddToSheet [data-addto="${other}"]`); await p.waitForTimeout(500);
        await p.tap('#mAddRows [data-m-addsong="files"]'); await p.waitForTimeout(300);
        await p.setInputFiles('#addSongFile', [1, 2, 3].map(n => ({ name: `T${n}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.from('ID3' + n) })));
        await p.waitForTimeout(1000); // the first is in, counted elsewhere
        await p.evaluate((id) => selectPlaylistFromCrate(id), other);
        await p.waitForTimeout(3500);
        // Step 12: the phone shows the opened playlist without making it the
        // playing one, so the list on screen is listId()/listSongs(), not
        // activePlaylistId/songsData.
        const g8 = await p.evaluate((id) => ({ open: String(listId()) === id && !listLoading(), n: listSongs().length, meta: playlistsMeta[id].songCount }), other);
        check('G8 opening the target playlist mid-import: its count matches its list', g8.open && g8.meta === g8.n, g8);
        await ctx.close();
    }
    {
        // the same link again after an add: the form fills again; the wizard's single file shows progress
        const { ctx, p } = await open();
        await p.evaluate(() => window.showAddSongModal()); await p.waitForTimeout(500);
        await typeAdd(p, 'https://youtu.be/dQw4w9WgXcQ', 900);
        await p.evaluate(() => { document.getElementById('addSongTitle').value = 'Pasted Song'; lastFetchedYtId = 'dQw4w9WgXcQ'; });
        await p.tap('#addSongForm .add-song-btn-save'); await p.waitForTimeout(800);
        const last = await p.evaluate(() => lastFetchedYtId);
        check('G9 after an add from the form, the same link pasted again is fetched again', last === '', last);
        await p.evaluate(() => history.back()); await p.waitForTimeout(600);
        await p.evaluate(() => window.showAddSongModal({ wizard: true })); await p.waitForTimeout(500);
        await p.tap('#mAddRows [data-m-addsong="files"]'); await p.waitForTimeout(300);
        const before = p.__posts.length;
        await p.setInputFiles('#addSongFile', { name: 'One.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('ID3one') });
        await p.waitForTimeout(2000);
        const adds = p.__posts.slice(before).filter(x => x.action === 'add');
        const sheetOpen = await p.evaluate(() => document.getElementById('addSongModal').classList.contains('active'));
        check('G10 the wizard\'s single file goes through the visible batch path (untargeted)', adds.length === 1 && adds[0].link === true && !('playlist' in adds[0]) && !sheetOpen, { adds, sheetOpen });
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
