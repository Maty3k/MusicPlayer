// Desktop step 7: one Search page (the phone's #mSearchPage shown in the
// main area under html.dv2.dv-search) at 1440x900, 1024x768 and 800x600
// (beside the icon rail). Checks the ways in (the sidebar's Search, "/"
// and Ctrl+K, and showSearchModal, which never opens the old search window
// on the desktop) with focus in the field and Search current in the
// sidebar; the empty field (recent searches as chips, your playlists as
// tiles); typing (the library rows with their count, then the YouTube
// cards; the live status line); a library hit playing right there; its
// playlist chip opening that playlist's page and playing the hit there (the
// playlist becomes the playing one); a YouTube hit previewing, and its +
// adding it to a chosen playlist (the write names it); a pasted YouTube
// playlist link offering the import; the arrow keys through the results;
// the layout (inside the main area, nothing overflowing); switching pages
// (a playlist page closes Search, Search closes it, Now Playing opened from
// Search closes back to Search, Home closes it); axe; and that phones
// (390x844, 844x390) and the app shell (?app=1) keep what they had.
// Writes to /save-music are faked and recorded (reads go through);
// /search-youtube is faked.
const L = require('../lib');
const APP = L.APP;
const READS = ['getPlaylist', 'searchLibrary', 'stats', 'getAll'];
const AXE = require.resolve('axe-core/axe.min.js', { paths: [L.ROOT] });
const results = [];
const check = (name, ok, info) => results.push({ name, ok: !!ok, info });
const YT = [
    { videoId: 'aaaaaaaaaa1', title: 'Band One - Great Song (Official Video)', channel: 'Band One', thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaa1/hqdefault.jpg' },
    { videoId: 'bbbbbbbbbb2', title: 'Another Tune', channel: 'Someone', thumbnail: 'https://i.ytimg.com/vi/bbbbbbbbbb2/hqdefault.jpg' },
    { videoId: 'cccccccccc3', title: 'Third Thing - A Much Longer Title That Needs Two Lines', channel: 'Third', thumbnail: '' },
];
const RECENT = ['late night', 'gym'];
const QUERY = 'song 1'; // seeded titles are "Song N of <playlist>"

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
        p.__posts = []; p.__ytq = [];
        await p.route(/youtube\.com|ytimg\.com|sdk\.scdn|spotify\.com|lrclib\.net/, r => r.abort());
        await p.route('**/search-youtube', async (route) => {
            p.__ytq.push(JSON.parse(route.request().postData() || '{}').query);
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, results: YT }) });
        });
        await p.route('**/save-music', async (route) => {
            const body = JSON.parse(route.request().postData() || '{}');
            p.__posts.push(body);
            if (READS.includes(body.action)) return route.continue();
            if (body.action === 'addBatch') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, added: 1, skipped: 0 }) });
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true }) });
        });
        await p.addInitScript((recent) => {
            try {
                localStorage.setItem('mRecentSearches', JSON.stringify(recent));
                sessionStorage.removeItem('mSearchQuery');
            } catch (e) {}
        }, RECENT);
        await p.goto(APP + (opts.query || '')); await p.waitForTimeout(1200);
        if (opts.raw) return { ctx, p };
        await p.evaluate(() => {
            // A stub player; record what the engine asks of it
            window.__yt = [];
            const stub = { _s: 5, _t: 0, loadVideoById() { window.__yt.push('load'); this._s = 1; }, cueVideoById() { window.__yt.push('cue'); this._s = 5; },
                playVideo() { this._s = 1; }, pauseVideo() { this._s = 2; }, stopVideo() {}, seekTo() {}, setVolume() {}, getVolume() { return 100; },
                mute() {}, unMute() {}, isMuted() { return false; }, setPlaybackRate() {},
                getPlayerState() { return this._s; }, getCurrentTime() { return 0; }, getDuration() { return 200; }, getVideoData() { return {}; }, destroy() {} };
            ytPlayer = ytPlayerReal = stub; ytPlayerReady = true;
            window.__cued = []; window.__played = []; window.__radio = [];
            window.playSongSource = function (s, cue) { noteSongRequest(s, !cue); (cue ? window.__cued : window.__played).push(s && s.title); };
            // A YouTube preview plays as a radio song: record it instead
            window.playRadioSong = function (s) { window.__radio.push(s && s.title); };
            // No outside services: radio and lyrics lookups are no-ops here
            window.fetchRadioRecommendations = function () {};
            window.loadLyricsForSong = async function () {};
            window.__fetchYt = 0;
            window.fetchYoutubePlaylist = function () { window.__fetchYt++; };
            // What the live status line says, in order
            window.__status = [];
            const sl = document.getElementById('mSearchStatus');
            if (sl) new MutationObserver(() => { if (sl.textContent) window.__status.push(sl.textContent); }).observe(sl, { childList: true, characterData: true, subtree: true });
            // The old search window must never open on the desktop
            window.__oldModal = 0;
            const m = document.getElementById('searchModal');
            if (m) new MutationObserver(() => { if (m.classList.contains('active')) window.__oldModal++; }).observe(m, { attributes: true, attributeFilter: ['class'] });
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
    // The Search page as it stands
    const look = (p) => p.evaluate(() => {
        const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
        const rect = (el) => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
        const page = document.getElementById('mSearchPage');
        const view = document.getElementById('musicPlayerView');
        const a = document.activeElement;
        const side = document.getElementById('dvSide');
        const bar = document.getElementById('dvBar');
        return {
            dv2: document.documentElement.classList.contains('dv2'),
            on: document.documentElement.classList.contains('dv-search'),
            page: shown(page), rect: shown(page) ? rect(page) : null,
            sideR: side.getClientRects().length ? Math.round(side.getBoundingClientRect().right) : 0,
            barT: bar.getClientRects().length ? Math.round(bar.getBoundingClientRect().top) : innerHeight,
            vw: innerWidth,
            crate: shown(document.getElementById('vinylCrateView')),
            player: view.classList.contains('active'), deck: view.classList.contains('dv-deck'),
            oldModal: document.getElementById('searchModal').classList.contains('active'),
            focus: a ? (a.id || (a.dataset && Object.keys(a.dataset).map(k => k + '=' + a.dataset[k]).join(',')) || a.tagName) : null,
            searchCur: document.getElementById('dvSideSearch').getAttribute('aria-current'),
            homeCur: document.getElementById('dvSideHome').getAttribute('aria-current'),
            openRow: [...document.querySelectorAll('#dvSideList .dv-side-pl')].filter(x => x.getAttribute('aria-current')).map(x => x.dataset.playlist),
            value: document.getElementById('mSearchInput').value,
            status: document.getElementById('mSearchStatus').textContent,
            overflowX: document.documentElement.scrollWidth > innerWidth || (shown(page) && page.scrollWidth > page.clientWidth + 1),
            active: String(activePlaylistId), onScreen: String(listId()), viewedId,
            song: songsData[currentSongIndex] ? songsData[currentSongIndex].title : null,
        };
    });
    // What the results show
    const res = (p) => p.evaluate(() => {
        const box = document.getElementById('mSearchResults');
        const shown = (el) => !!el && el.getClientRects().length > 0;
        const field = document.querySelector('#mSearchPage .m-search-field');
        const fr = field.getBoundingClientRect();
        return {
            heads: [...box.querySelectorAll('.m-search-heading')].map(h => h.textContent.trim()),
            chips: [...box.querySelectorAll('.m-recent-row')].filter(shown).map(r => r.textContent.replace(/×/g, '').trim()),
            chipH: (() => { const r = box.querySelector('.m-recent-row'); return r ? Math.round(r.getBoundingClientRect().height) : 0; })(),
            tiles: [...box.querySelectorAll('.m-rp-tile')].filter(shown).map(t => t.dataset.playlist),
            lib: [...box.querySelectorAll('.m-sr-lib .m-sr-row')].filter(shown).map(r => ({
                i: r.querySelector('[data-lib]').dataset.lib,
                title: r.querySelector('.search-result-title').textContent.trim(),
                pl: r.querySelector('.search-result-pl').textContent.trim(),
            })),
            count: shown(box.querySelector('.m-search-count')) ? box.querySelector('.m-search-count').textContent.trim() : null,
            yt: [...box.querySelectorAll('.m-sr-yt .m-sr-row')].filter(shown).map(r => {
                const c = r.getBoundingClientRect();
                const add = r.querySelector('[data-add]').getBoundingClientRect();
                return { title: r.querySelector('.search-result-title').textContent.trim(), w: Math.round(c.width), t: Math.round(c.top), addIn: add.left >= c.left && add.right <= c.right && add.top >= c.top && add.bottom <= c.bottom };
            }),
            links: [...box.querySelectorAll('[data-link]')].map(x => x.dataset.link),
            field: { w: Math.round(fr.width), h: Math.round(fr.height), role: field.getAttribute('role') },
            label: document.getElementById('mSearchInput').getAttribute('aria-label'),
        };
    });
    const type = async (p, q) => { await p.fill('#mSearchInput', q); await p.waitForTimeout(1500); };
    const nameToId = (p, name) => p.evaluate((n) => Object.keys(playlistsMeta).find(k => playlistsMeta[k].name === n) || null, name);

    for (const vp of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 800, height: 600 }]) {
        const tag = `${vp.width}x${vp.height}`;

        // ---- A. The sidebar's Search: the page, focus, current; the empty field
        {
            const { ctx, p } = await open({ vp });
            await p.click('#dvSideSearch'); await p.waitForTimeout(500);
            const s = await look(p);
            const r = await res(p);
            const lists = await p.evaluate(() => Object.keys(playlistsMeta).slice(0, 12));
            check(`${tag} A the sidebar's Search shows the Search page (not the old window), focus in the field, Search current`,
                s.dv2 && s.on && s.page && !s.crate && !s.player && !s.oldModal && s.focus === 'mSearchInput' && s.searchCur === 'page' && s.homeCur === null, s);
            check(`${tag} A it fills the main area beside the sidebar and above the bar, nothing overflowing`,
                s.rect && s.rect.l >= s.sideR && s.rect.r <= s.vw && s.rect.b <= s.barT && s.rect.w >= s.vw - s.sideR - 24 && !s.overflowX, s);
            check(`${tag} A a big labelled field in a search landmark`, r.field.h >= 48 && r.field.w >= 300 && r.field.role === 'search' && !!r.label, r.field);
            check(`${tag} A empty field: recent searches as chips, then your playlists as tiles`,
                r.heads[0] === 'Recent searches' && r.heads.includes('Your playlists') && JSON.stringify(r.chips) === JSON.stringify(RECENT) && r.chipH > 0 && r.chipH <= 44
                && JSON.stringify(r.tiles) === JSON.stringify(lists), { r, lists });
            const ax = await axeScan(p);
            check(`${tag} A axe: the empty Search page has no violations`, ax.length === 0, ax);

            // ---- B. Typing: library rows (with a count), then YouTube cards
            await type(p, QUERY);
            const t = await res(p);
            const st = await look(p);
            check(`${tag} B typing: "In your library" rows with a count, then "From YouTube" cards (asked once)`,
                t.heads[0] === 'In your library' && t.heads.includes('From YouTube') && t.lib.length > 0 && t.count === (t.lib.length === 1 ? '1 song' : `${t.lib.length}${t.lib.length >= 40 ? '+' : ''} songs`)
                && t.yt.length === YT.length && t.yt[0].title === 'Great Song' && p.__ytq.length === 1 && p.__ytq[0] === QUERY, { t, ytq: p.__ytq });
            check(`${tag} B the YouTube cards sit in a grid (several across), each with its + on it`,
                t.yt.every(c => c.w >= 150 && c.addIn) && t.yt[1].t === t.yt[0].t, t.yt);
            // (it says the library count, then what YouTube added)
            const said = await p.evaluate(() => window.__status.slice());
            check(`${tag} B the live status line says what was found`, said.some(x => /in your library/.test(x)) && /YouTube/.test(st.status) && !st.overflowX, { said, now: st.status });
            const ax2 = await axeScan(p);
            check(`${tag} B axe: the results have no violations`, ax2.length === 0, ax2);

            // ---- C. A library hit in the playing list plays right here
            const activeName = await p.evaluate(() => playlistsMeta[String(activePlaylistId)].name);
            const now = (await look(p)).song;
            const here = t.lib.find(x => x.pl === activeName && x.title !== now);
            if (!here) check(`${tag} C a hit in the playing list to play`, false, { activeName, lib: t.lib });
            else {
                // (switchSong waits for the crackle and the record change first)
                await p.click(`#mSearchResults [data-lib="${here.i}"]`); await p.waitForTimeout(2500);
                const c = await look(p);
                const played = await p.evaluate(() => ({ played: window.__played.slice(), radio: window.__radio.slice() }));
                check(`${tag} C a library hit plays right here (still on Search, no playlist page)`,
                    c.on && c.page && !c.player && c.song === here.title && played.played[played.played.length - 1] === here.title && c.searchCur === 'page', { c, played, here });
            }

            // ---- D. Its playlist chip: that playlist's page, playing the hit (adopted)
            const other = t.lib.find(x => x.pl !== activeName);
            const otherId = other ? await nameToId(p, other.pl) : null;
            if (!other || !otherId) check(`${tag} D a hit in another playlist`, false, { lib: t.lib });
            else {
                await p.click(`#mSearchResults [data-open="${other.i}"]`); await p.waitForTimeout(1800);
                const d = await look(p);
                check(`${tag} D the chip opens its playlist's page and plays the hit there (now the playing list)`,
                    d.player && !d.deck && !d.on && !d.page && d.onScreen === otherId && d.active === otherId && d.viewedId === null && d.song === other.title, { d, other, otherId });
                check(`${tag} D the sidebar: that playlist current, Search not`, d.searchCur === null && JSON.stringify(d.openRow) === JSON.stringify([otherId]), d);
            }

            // ---- E. Back to Search: the results are still there; YouTube preview and +
            await p.click('#dvSideSearch'); await p.waitForTimeout(600);
            const e = await look(p);
            const e2 = await res(p);
            check(`${tag} E Search again: the playlist page put away, the query and results still there`,
                e.on && e.page && !e.player && e.value === QUERY && e2.lib.length === t.lib.length && e2.yt.length === YT.length && e.focus === 'mSearchInput' && e.searchCur === 'page', { e, n: e2.lib.length });
            await p.click('#mSearchResults [data-yt="1"]'); await p.waitForTimeout(500);
            const y = await look(p);
            const radio = await p.evaluate(() => window.__radio.slice());
            check(`${tag} E a YouTube card previews in place`, radio[radio.length - 1] === 'Another Tune' && y.on && y.page && !y.player, { radio, y });
            await p.click('#mSearchResults [data-add="0"]'); await p.waitForTimeout(500);
            const sheet = await p.evaluate(() => ({
                open: document.getElementById('mAddToSheet').classList.contains('active'),
                rows: [...document.querySelectorAll('#mAddToSheet [data-addto]')].map(r => r.dataset.addto),
                song: document.querySelector('#mAddToSheet .m-addto-song').textContent.trim(),
                focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.addto : null,
                ids: Object.keys(playlistsMeta),
            }));
            check(`${tag} E + opens "Add to playlist" with every playlist, focus on the first`,
                sheet.open && JSON.stringify(sheet.rows) === JSON.stringify(sheet.ids) && sheet.song.startsWith('Great Song') && sheet.focus === sheet.rows[0], sheet);
            // Esc closes it, back on its +
            await p.keyboard.press('Escape'); await p.waitForTimeout(300);
            const esc = await p.evaluate(() => ({ open: document.getElementById('mAddToSheet').classList.contains('active'), focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.add : null }));
            check(`${tag} E Esc closes it, focus back on its +`, !esc.open && esc.focus === '0', esc);
            await p.click('#mSearchResults [data-add="0"]'); await p.waitForTimeout(400);
            const target = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId)));
            const n0 = p.__posts.filter(x => x.action === 'addBatch').length;
            await p.click(`#mAddToSheet [data-addto="${target}"]`); await p.waitForTimeout(900);
            const adds = p.__posts.filter(x => x.action === 'addBatch').slice(n0);
            const after = await p.evaluate(() => ({ open: document.getElementById('mAddToSheet').classList.contains('active'), focus: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.add : null }));
            check(`${tag} E picking a playlist adds the song to it (the write names that playlist)`,
                adds.length === 1 && adds[0].playlist === target && adds[0].songs && adds[0].songs[0].youtube_id === 'aaaaaaaaaa1' && adds[0].songs[0].title === 'Great Song' && !after.open && after.focus === '0', { adds, target, after });

            // ---- F. The arrow keys through the results
            await p.focus('#mSearchInput');
            const keys = [];
            for (const k of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowUp']) {
                await p.keyboard.press(k);
                keys.push((await look(p)).focus);
            }
            check(`${tag} F arrows: down into the results, along a row to its chip, down keeping the chip, back, up to the field`,
                JSON.stringify(keys) === JSON.stringify(['lib=0', 'open=0', 'open=1', 'lib=1', 'lib=0', 'mSearchInput']), keys);
            await p.keyboard.press('ArrowDown');
            await p.keyboard.press('End');
            const end = (await look(p)).focus;
            await p.keyboard.press('Escape');
            const back = (await look(p)).focus;
            check(`${tag} F End goes to the last result's last button (its ⋯), Esc back to the field`, end === `ytMore=${YT.length - 1}` && back === 'mSearchInput', { end, back });

            // ---- G. A pasted YouTube playlist link offers the import
            const url = 'https://www.youtube.com/playlist?list=PLabcdefghij0123';
            await type(p, url);
            const g = await res(p);
            await p.click('#mSearchResults [data-link="import-yt"]'); await p.waitForTimeout(600);
            const imp = await p.evaluate(() => ({
                modal: document.getElementById('spotifyImportModal').classList.contains('active'),
                tab: (document.querySelector('#importTabs .import-tab.active') || {}).dataset,
                url: document.getElementById('youtubeImportUrl').value, fetched: window.__fetchYt,
            }));
            check(`${tag} G a pasted YouTube playlist link offers the import (the window filled in and fetching)`,
                JSON.stringify(g.links) === '["import-yt"]' && imp.modal && imp.tab && imp.tab.tab === 'youtube' && imp.url === url && imp.fetched === 1, { links: g.links, imp });
            await p.evaluate(() => hideSpotifyImportModal()); await p.waitForTimeout(300);
            const old = await p.evaluate(() => window.__oldModal);
            check(`${tag} A-G the old search window never opened`, old === 0, old);
            check(`${tag} A-G errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }

        // ---- H. "/", Ctrl+K and showSearchModal; switching pages
        {
            const { ctx, p } = await open({ vp });
            await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
            await p.keyboard.press('/'); await p.waitForTimeout(400);
            const h1 = await look(p);
            check(`${tag} H "/" opens Search with focus in the field (and types nothing)`, h1.on && h1.page && h1.focus === 'mSearchInput' && h1.value === '' && h1.searchCur === 'page', h1);
            await p.keyboard.type('a/b');
            const typed = (await look(p)).value;
            check(`${tag} H "/" in the field is just a character`, typed === 'a/b', typed);
            await p.click('#dvSideHome'); await p.waitForTimeout(400);
            const home = await look(p);
            check(`${tag} H Home closes Search: Home current`, !home.on && !home.page && home.crate && home.homeCur === 'page' && home.searchCur === null, home);
            await p.keyboard.press('Control+k'); await p.waitForTimeout(400);
            const h2 = await look(p);
            check(`${tag} H Ctrl+K opens Search (focus in the field)`, h2.on && h2.page && h2.focus === 'mSearchInput', h2);
            await p.click('#dvSideHome'); await p.waitForTimeout(300);
            await p.evaluate(() => window.showSearchModal()); await p.waitForTimeout(400);
            const h3 = await look(p);
            check(`${tag} H showSearchModal opens the Search page, never the old window`, h3.on && h3.page && !h3.oldModal && h3.focus === 'mSearchInput', h3);

            // A playlist from the sidebar closes Search; Search closes the playlist page
            const id = await p.evaluate(() => Object.keys(playlistsMeta).find(k => k !== String(activePlaylistId) && playlistsMeta[k].songCount > 0));
            await p.click(`#dvSideList .dv-side-pl[data-playlist="${id}"]`); await p.waitForTimeout(1500);
            const i1 = await look(p);
            check(`${tag} H a playlist from the sidebar replaces Search (Search not current)`, i1.player && !i1.on && !i1.page && i1.onScreen === id && i1.searchCur === null, i1);
            await p.click('#dvSideSearch'); await p.waitForTimeout(500);
            const i2 = await look(p);
            check(`${tag} H Search replaces the playlist page`, i2.on && i2.page && !i2.player && i2.searchCur === 'page' && i2.openRow.length === 0 && i2.focus === 'mSearchInput', i2);

            // Now Playing from Search closes back to Search (its button again, then Esc)
            await p.click('#dvBarDeck'); await p.waitForTimeout(700);
            const n1 = await look(p);
            check(`${tag} H Now Playing from Search: the turntable page, Search hidden and not current`, n1.player && n1.deck && !n1.page && n1.searchCur === null && n1.homeCur === null, n1);
            await p.click('#dvBarDeck'); await p.waitForTimeout(700);
            const n2 = await look(p);
            check(`${tag} H closing Now Playing goes back to Search`, !n2.player && n2.on && n2.page && n2.searchCur === 'page' && !n2.crate, n2);
            await p.click('#dvBarOpen'); await p.waitForTimeout(700);
            await p.keyboard.press('Escape'); await p.waitForTimeout(700);
            const n3 = await look(p);
            check(`${tag} H Esc on Now Playing goes back to Search too`, !n3.player && n3.on && n3.page && n3.searchCur === 'page', n3);
            // Now Playing, then a playlist: Search is left for good
            await p.click('#dvBarDeck'); await p.waitForTimeout(700);
            await p.click(`#dvSideList .dv-side-pl[data-playlist="${id}"]`); await p.waitForTimeout(1500);
            await p.evaluate(() => showPlaylistPicker()); await p.waitForTimeout(400);
            const n4 = await look(p);
            check(`${tag} H Now Playing then a playlist: closing it lands on Home, not Search`, !n4.player && !n4.on && !n4.page && n4.crate && n4.homeCur === 'page', n4);
            const old = await p.evaluate(() => window.__oldModal);
            check(`${tag} H the old search window never opened`, old === 0, old);
            check(`${tag} H errors`, p.__errs.length === 0, p.__errs);
            await ctx.close();
        }
    }

    // ---- I. Phones and the app keep what they had
    {
        const { ctx, p } = await open({ vp: { width: 390, height: 844 }, phone: true });
        await p.tap('#mTabs .m-tab[data-tab="search"]'); await p.waitForTimeout(500);
        await p.fill('#mSearchInput', QUERY); await p.waitForTimeout(1500);
        const s = await p.evaluate(() => {
            const shown = (el) => !!el && el.getClientRects().length > 0;
            return {
                dv2: document.documentElement.classList.contains('dv2'), on: document.documentElement.classList.contains('dv-search'),
                tab: document.documentElement.dataset.mTab, page: shown(document.getElementById('mSearchPage')),
                head: shown(document.querySelector('#mSearchPage .m-tab-title')),
                count: shown(document.querySelector('#mSearchResults .m-search-count')),
                lib: document.querySelectorAll('#mSearchResults [data-lib]').length,
                side: shown(document.getElementById('dvSide')),
            };
        });
        check('I phone 390x844: the Search tab as before (its heading, no desktop count, no sidebar)', !s.dv2 && !s.on && s.tab === 'search' && s.page && s.head && !s.count && s.lib > 0 && !s.side, s);
        await p.keyboard.press('Enter'); await p.waitForTimeout(300);
        const blurred = await p.evaluate(() => document.activeElement !== document.getElementById('mSearchInput'));
        check('I phone: Enter still drops the keyboard (the field lets go of focus)', blurred, blurred);
        check('I phone errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ vp: { width: 844, height: 390 }, phone: true });
        await p.evaluate(() => window.showSearchModal()); await p.waitForTimeout(500);
        const s = await p.evaluate(() => ({
            dv2: document.documentElement.classList.contains('dv2'),
            modal: document.getElementById('searchModal').classList.contains('active'),
            page: document.getElementById('mSearchPage').getClientRects().length > 0,
        }));
        check('I phone 844x390: Search is still the old window there', !s.dv2 && s.modal && !s.page, s);
        check('I landscape errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }
    {
        const { ctx, p } = await open({ query: '?app=1' });
        await p.evaluate(() => window.showSearchModal()); await p.waitForTimeout(500);
        await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
        const s = await p.evaluate(() => ({
            dv2: document.documentElement.classList.contains('dv2'), on: document.documentElement.classList.contains('dv-search'),
            modal: document.getElementById('searchModal').classList.contains('active'),
            page: document.getElementById('mSearchPage').getClientRects().length > 0,
        }));
        check('I app shell (?app=1) at 1440: the old search window, no Search page (Ctrl+K does nothing)', !s.dv2 && !s.on && s.modal && !s.page, s);
        check('I app errors', p.__errs.length === 0, p.__errs);
        await ctx.close();
    }

    await b.close();
    const passed = results.filter(r => r.ok).length;
    for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  ' + JSON.stringify(r.info).slice(0, 900)));
    console.log(`${passed}/${results.length} passed`);
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
