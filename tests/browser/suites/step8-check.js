// Step 8: the Search tab (play in place, open in playlist, YouTube + add,
// recent searches, your playlists, links).
// (Copied from the session scratchpad. Only the plumbing changed: base URL,
// saved logins and screenshot paths come from ../lib.js.)
const L = require('../lib');
const APP = L.APP;
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - Great Song (Official Video)', channel: 'Band One', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaa1/hqdefault.jpg' },
    { videoId: 'bbbbbbbbbb2', title: 'Another Tune', channel: 'Someone', thumbnail: 'https://i.ytimg.com/vi/bbbbbbbbbb2/hqdefault.jpg' },
];

(async () => {
    const b = await L.launch();
    async function open(opts = {}) {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: L.state('many') });
        const p = await ctx.newPage();
        p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
        p.__posts = []; p.__yt = [];
        await p.route(/youtube\.com|sdk\.scdn|spotify\.com/, r => r.abort());
        await p.route('**/search-youtube', async (route) => {
            p.__yt.push(JSON.parse(route.request().postData() || '{}').query);
            if (opts.ytLimited) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: false, rateLimited: true }) });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) });
        });
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: 1, skipped: 0 }) });
            if (['recordPlay', 'switch', 'switchPlaylist'].includes(body.action) && body.action !== 'switchPlaylist') return route.fulfill({ contentType: 'application/json', body: '{"success":true}' });
            return route.continue();
        });
        await p.addInitScript(() => { try { localStorage.removeItem('mRecentSearches'); sessionStorage.removeItem('mSearchQuery'); } catch (e) {} });
        await p.goto(APP); await p.waitForTimeout(1200);
        await p.evaluate(() => {
            window.__radio = []; const r = window.playRadioSong; window.playRadioSong = function (s) { window.__radio.push(s && s.title); };
            window.__played = []; window.playSongSource = function (s, cue) { if (!cue) window.__played.push(s && s.title); };
        });
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(400);
        return { ctx, p };
    }
    const look = (p) => p.evaluate(() => ({ tab: document.documentElement.dataset.mTab, layer: history.state && history.state.mLayer, player: document.getElementById('musicPlayerView').classList.contains('active'), modals: [...document.querySelectorAll('.add-song-modal.active')].map(m => m.id) }));
    const toast = (p) => p.evaluate(() => (document.querySelector('.m-toast') || {}).textContent || null);
    const type = async (p, q) => { await p.fill('#mSearchInput', q); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(1200); };

    {
        const { ctx, p } = await open();
        const home = await p.evaluate(() => ({ recent: !!document.querySelector('.m-recent-list'), tiles: document.querySelectorAll('#mSearchResults .m-rp-tile').length, heads: [...document.querySelectorAll('#mSearchResults .m-search-heading')].map(h => h.textContent) }));
        check('H1 empty field: your playlists (no recents yet)', !home.recent && home.tiles > 0 && home.heads.includes('Your playlists'), home);
        // library + YouTube sections
        await type(p, 'Song 1');
        const secs = await p.evaluate(() => ({ heads: [...document.querySelectorAll('#mSearchResults .m-search-heading')].map(h => h.textContent), lib: document.querySelectorAll('#mSearchResults [data-lib]').length, yt: document.querySelectorAll('#mSearchResults [data-yt]').length, crop: getComputedStyle(document.querySelector('#mSearchResults [data-yt] img')).transform !== 'none' }));
        check('S1 library first, then From YouTube (cropped thumbs)', secs.heads[0] === 'In your library' && secs.heads.includes('From YouTube') && secs.lib > 0 && secs.yt === 2 && secs.crop && p.__yt.length === 1, { secs, yt: p.__yt });
        // play in place
        const target = await p.evaluate(() => { const i = [...document.querySelectorAll('#mSearchResults [data-open] .search-result-pl')].findIndex(e => e.textContent === playlistsMeta[activePlaylistId].name); return i; });
        await p.tap(`#mSearchResults [data-lib="${target}"]`); await p.waitForTimeout(700);
        let s = await look(p);
        const played = await p.evaluate(() => ({ played: window.__played, radio: window.__radio }));
        check('P1 a library hit plays right here (no playlist opened)', s.tab === 'search' && !s.player && s.layer === 'tab' && (played.played.length + played.radio.length) === 1, { s, played });
        // chip opens the playlist
        await p.tap(`#mSearchResults [data-open="${target}"]`); await p.waitForTimeout(1200);
        s = await look(p);
        check('P2 the playlist chip opens its playlist', s.player && s.layer === 'playlist', s);
        await p.evaluate(() => history.back()); await p.waitForTimeout(700);
        // YouTube preview and add
        await p.tap('#mSearchResults [data-yt="0"]'); await p.waitForTimeout(500);
        const radio = await p.evaluate(() => window.__radio.slice());
        check('Y1 a YouTube hit previews in place', radio.includes('Great Song'), radio);
        await p.tap('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
        s = await look(p);
        const rows = await p.evaluate(() => [...document.querySelectorAll('#mAddToSheet [data-addto]')].map(r => r.dataset.addto));
        check('Y2 + opens "Add to playlist" (a back step) with every playlist', s.modals.includes('mAddToSheet') && s.layer === 'modal:addTo' && rows.length > 3, { s, rows });
        const n0 = await p.evaluate(() => songsData.length);
        await p.tap(`#mAddToSheet [data-addto="${await p.evaluate(() => String(activePlaylistId))}"]`); await p.waitForTimeout(900);
        const add = p.__posts.filter(x => x.action === 'addBatch');
        const n1 = await p.evaluate(() => songsData.length);
        const t = await toast(p);
        s = await look(p);
        check('Y3 picking a playlist adds the song there (and to the list on screen)', add.length === 1 && add[0].songs[0].youtube_id === 'aaaaaaaaaa1' && add[0].songs[0].title === 'Great Song' && add[0].playlist && n1 === n0 + 1 && t && t.startsWith('Added to') && !s.modals.length, { add, n0, n1, t });
        // recent searches
        await p.focus('#mSearchInput'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
        await type(p, '');
        const rec = await p.evaluate(() => [...document.querySelectorAll('.m-recent-q span')].map(e => e.textContent));
        check('R1 the search is remembered', rec[0] === 'Song 1', rec);
        await p.tap('.m-recent-q'); await p.waitForTimeout(1200);
        const v = await p.evaluate(() => document.getElementById('mSearchInput').value);
        check('R2 tapping a recent search runs it', v === 'Song 1', v);
        await type(p, '');
        await p.tap('.m-recent-x'); await p.waitForTimeout(300);
        const rec2 = await p.evaluate(() => document.querySelectorAll('.m-recent-q').length);
        check('R3 × removes a recent search', rec2 === 0, rec2);
        // tiles
        await p.tap('#mSearchResults .m-rp-tile[data-playlist="favorites"]').catch(() => {}); await p.waitForTimeout(1200);
        s = await look(p);
        check('T1 a playlist tile opens it over Search', s.player && s.layer === 'playlist' && s.tab === 'search', s);
        await p.evaluate(() => history.back()); await p.waitForTimeout(700);
        check('S errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    // links
    {
        const { ctx, p } = await open();
        await p.evaluate(() => { window.__fetchYt = 0; window.fetchYoutubePlaylist = () => { window.__fetchYt++; }; window.__fetchSp = 0; window.fetchSpotifyPlaylistUrl = () => { window.__fetchSp++; }; });
        const url = 'https://www.youtube.com/playlist?list=PLabc123';
        await type(p, url);
        const lrows = await p.evaluate(() => [...document.querySelectorAll('.m-search-link')].map(r => r.dataset.link));
        await p.tap('.m-search-link[data-link="import-yt"]'); await p.waitForTimeout(600);
        const imp = await p.evaluate(() => ({ modal: document.getElementById('spotifyImportModal').classList.contains('active'), tab: document.querySelector('#importTabs .import-tab.active').dataset.tab, url: document.getElementById('youtubeImportUrl').value, fetched: window.__fetchYt }));
        check('K1 a YouTube playlist link imports (sheet filled and fetching)', JSON.stringify(lrows) === '["import-yt"]' && imp.modal && imp.tab === 'youtube' && imp.url === url && imp.fetched === 1 && p.__yt.length === 0, { lrows, imp });
        await p.evaluate(() => history.back()); await p.waitForTimeout(600);
        const vid = 'https://youtu.be/aaaaaaaaaa1';
        await type(p, vid);
        await p.tap('.m-search-link[data-link="add-song"]'); await p.waitForTimeout(700);
        const addv = await p.evaluate(() => ({ modal: document.getElementById('addSongModal').classList.contains('active'), v: document.getElementById('addSongSearch').value }));
        check('K2 a YouTube video link opens Add song with it filled in', addv.modal && addv.v === vid, addv);
        await p.evaluate(() => history.back()); await p.waitForTimeout(600);
        await type(p, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
        if (await p.evaluate(() => spotifyOn)) {
            await p.tap('.m-search-link[data-link="import-sp"]'); await p.waitForTimeout(600);
            const sp = await p.evaluate(() => ({ tab: document.querySelector('#importTabs .import-tab.active').dataset.tab, fetched: window.__fetchSp }));
            check('K3 a Spotify playlist link imports via the Spotify tab', sp.tab === 'spotify' && sp.fetched === 1, sp);
            await p.evaluate(() => history.back()); await p.waitForTimeout(600);
        } else {
            const sp = await p.evaluate(() => ({ rows: document.querySelectorAll('.m-search-link').length, text: document.getElementById('mSearchResults').textContent }));
            check('K3 a Spotify playlist link (no Spotify on this server) says to paste the songs', sp.rows === 0 && /can’t be imported here/.test(sp.text), sp);
        }
        const kinds = {};
        for (const [name, u] of Object.entries({
            spTrack: 'https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=xyz',
            spAlbum: 'https://open.spotify.com/intl-de/album/4aawyAB9vmqN3uQ7FjRGTy?si=abc',
            spArtist: 'https://open.spotify.com/artist/0OdUWJ0sBjDrqHygGUXeCF',
            live: 'https://www.youtube.com/live/jfKfPfyJRdk?si=abc',
            mixVideo: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ&start_radio=1',
            mixOnly: 'https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ',
            both: 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123',
            short: 'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share',
        })) {
            await p.fill('#mSearchInput', u); await p.dispatchEvent('#mSearchInput', 'input'); await p.waitForTimeout(150);
            kinds[name] = await p.evaluate(() => ({ rows: [...document.querySelectorAll('.m-search-link')].map(r => r.dataset.link).join(','), hint: (document.querySelector('#mSearchResults .m-search-hint') || {}).textContent || '' }));
        }
        check('K4 a Spotify song link offers Add this song', kinds.spTrack.rows === 'add-song', kinds.spTrack);
        check('K5 a Spotify album link says albums can’t be imported (no import row)', kinds.spAlbum.rows === '' && /albums can.t be imported/.test(kinds.spAlbum.hint), kinds.spAlbum);
        check('K6 other Spotify links explain what works', kinds.spArtist.rows === '' && /playlist or song link/.test(kinds.spArtist.hint), kinds.spArtist);
        check('K7 YouTube live and shorts links add the song', kinds.live.rows === 'add-song' && kinds.short.rows === 'add-song', { live: kinds.live, short: kinds.short });
        check('K8 a Mix link only offers the song; a bare Mix explains', kinds.mixVideo.rows === 'add-song' && kinds.mixOnly.rows === '' && /Mixes can.t be imported/.test(kinds.mixOnly.hint), { a: kinds.mixVideo, b: kinds.mixOnly });
        check('K9 a video in a playlist offers both', kinds.both.rows === 'import-yt,add-song', kinds.both);
        const ids = await p.evaluate(() => ({ live: extractYoutubeId('https://www.youtube.com/live/jfKfPfyJRdk?si=abc'), sp: extractSpotifyId('https://open.spotify.com/intl-de/track/4uLU6hMCjMI75M1A2tKUQC?si=xyz') }));
        check('K10 Add song reads live and intl links', ids.live === 'jfKfPfyJRdk' && ids.sp === '4uLU6hMCjMI75M1A2tKUQC', ids);
        await ctx.close();
    }
    // YouTube rate-limited
    {
        const { ctx, p } = await open({ ytLimited: true });
        await type(p, 'Song 2');
        await p.waitForFunction(() => !/Searching YouTube/.test(document.getElementById('mSearchResults').textContent), null, { timeout: 8000 }).catch(() => {});
        const txt = await p.evaluate(() => document.getElementById('mSearchResults').textContent);
        check('Y4 a rate-limited YouTube search says so', /too fast/.test(txt), txt.slice(-80));
        await ctx.close();
    }
    await b.close();
    const failed = results.filter(r => !r.ok);
    results.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info))));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
})().catch(e => { console.error(e); process.exit(1); });
