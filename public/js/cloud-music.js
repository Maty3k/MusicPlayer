// ============================================================
// CLOUDFLARE SOURCE — your own MP3/M4A files from the R2 bucket, through
// the Worker. The page never sees the Worker's address or token: it only
// knows whether the source is set up (CLOUD_MUSIC, player.blade.php) and
// talks to /cloud-music/* (CloudMusicController), which adds the token on
// the server. A song's mp3_url is a path on this site.
//
// Settings → Source picks where the Search tab looks: your playlists (as
// before) or the Cloudflare list. Cloudflare songs play through the one
// shared <audio> element of the MP3 engine (mp3PlayerProxy): a song change
// only swaps its src, and the next song starts inside the 'ended' event
// (playNextByLoop → step), which is what keeps a locked iPhone playing.
// No crackle or record animation is awaited on that path.
//
// Loaded after script.js and uses its globals (ytPlayer, currentRadioSong,
// playSongSource, …).
// ============================================================

window.cloudMusic = (() => {
    const cfg = typeof CLOUD_MUSIC !== 'undefined' && CLOUD_MUSIC === true; // set up on the server
    const SOURCE_KEY = 'songSource';
    const MAX_ROWS = 200;
    const NOTE = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';

    let source = 'library';
    try { if (localStorage.getItem(SOURCE_KEY) === 'cloud' && cfg) source = 'cloud'; } catch (e) {}

    let songs = [];          // every playable file, as song objects, sorted
    let listState = 'idle';  // idle | loading | done | error
    let listError = '';
    let loadedAt = 0;
    let loading = null;

    let order = [];          // the list the playing song came from
    let pos = -1;            // its index in there
    let history = [];        // indexes played before (Back while shuffled)
    let shown = [];          // the rows on screen in Search
    let audioHooked = false;

    // ---- URLs ----
    // A song's address: the same for the same file, and no token in it, so
    // a favourite or a recent play can keep it. Strictly encoded, because
    // encodeURIComponent leaves ! ' ( ) * alone and an mp3_url with ' in it
    // is refused when it is saved (MusicController::sanitizeUrl).
    const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    const fileUrl = (key) => '/cloud-music/file?key=' + enc(key);

    // ---- Display titles (only for showing; playback always uses the key) ----
    const NOISE = /\b(official|oficial|video|audio|lyrics?|letra|visuali[sz]er|hd|hq|4k|1080p|720p|vevo|m\/v|mv|videoclip|clip officiel|explicit|color coded)\b/i;
    // The bucket's files are named "Title - Uploader.mp3" (the YouTube
    // channel last, e.g. "ABBA - The Winner Takes It All - AbbaVEVO.mp3"):
    // that last part is dropped from "Artist - Title", or names the artist
    // when it's the only other part. Set false for plain "Artist - Title" files.
    const UPLOADER_LAST = true;
    const SEP = /\s+[-–—]\s+/;
    function cleanName(key) {
        let s = String(key).split('/').pop();
        s = s.replace(/\.(mp3|m4a|mp4|aac|wav|flac|ogg|opus)$/i, '');
        s = s.replace(/_/g, ' ');
        s = s.replace(/^\d{1,3}\.\s+/, '');                       // "22. " track number
        s = s.replace(/\s*\[[A-Za-z0-9_-]{11}\]/g, '');          // yt-dlp video id
        s = s.replace(/[(\[{【]([^)\]}】]*)[)\]}】]/g, (m, inner) => (NOISE.test(inner) ? ' ' : m));
        s = s.replace(/\bVEVO\b/gi, ' ').replace(/VEVO\b/g, '');   // "BeyonceVEVO" too
        // Unbracketed: "Nicky Jam  Video Oficial", "Official Music Video"
        s = s.replace(/\s+((official|oficial)\s+)?(music\s+|lyric\s+)?(video|audio)(\s+(official|oficial))?(?=\s+[-–—]\s+|\s*$)/gi, '');
        s = s.replace(/\s+(HD|HQ)(?=\s+[-–—]\s+|\s*$)/g, '');
        s = s.replace(/\s{2,}/g, ' ');
        s = s.replace(/(\s+(?:ft|feat)\.?\s+[^\-–—()]+?)\1(?=\s+[-–—]\s+|\s*$)/i, '$1'); // "ft. X ft. X"
        s = s.replace(/^[\s\-–—:|]+|[\s\-–—:|]+$/g, '').trim();
        return s || String(key);
    }
    function splitName(name) {
        const parts = name.split(SEP).map((p) => p.trim()).filter(Boolean);
        if (UPLOADER_LAST && parts.length >= 3) parts.pop();
        else if (UPLOADER_LAST && parts.length === 2) {
            const uploader = parts[1].replace(/(TV|Official|Music)$/, '').replace(/\s+-\s+Topic$/i, '').trim();
            return { title: parts[0], artist: uploader || parts[1] };
        }
        if (parts.length < 2) return { title: name, artist: '' };
        return { artist: parts[0], title: parts.slice(1).join(' - ') };
    }
    function toSong(item) {
        const { title, artist } = splitName(cleanName(item.key));
        return {
            title,
            artist,
            album: '',
            cover: '',
            youtube_id: '',
            spotify_id: '',
            mp3_url: fileUrl(item.key),
            cloud_key: item.key,
            _search: String(item.key).toLowerCase(),
        };
    }

    // ---- The list ----
    function load(force) {
        if (!cfg) return Promise.resolve(songs);
        if (loading) return loading;
        if (!force && listState === 'done') return Promise.resolve(songs);
        listState = 'loading';
        syncStatus();
        loading = fetch('/cloud-music/list', { cache: 'no-store', headers: { Accept: 'application/json' } })
            .then((res) => res.json().catch(() => null).then((data) => {
                // The server words every error itself; the Worker's never reach the page.
                if (!res.ok || !data || !Array.isArray(data.songs)) {
                    throw new Error((data && (data.error || data.message)) || 'The server answered ' + res.status + '.');
                }
                return data.songs;
            }))
            .then((list) => {
                songs = list
                    .filter((it) => it && typeof it.key === 'string' && Number(it.size) > 0) // size 0 = failed upload
                    .map(toSong)
                    .sort((a, b) => (a.artist + ' ' + a.title).localeCompare(b.artist + ' ' + b.title, undefined, { sensitivity: 'base' }));
                listState = 'done';
                listError = '';
                loadedAt = Date.now();
            })
            .catch((e) => {
                // A TypeError is fetch itself failing: no connection
                listError = e instanceof TypeError ? 'No connection to the server.' : ((e && e.message) || 'Something went wrong.');
                // A failed refresh keeps the list it had; only the status line says so
                listState = songs.length ? 'done' : 'error';
            })
            .finally(() => {
                loading = null;
                syncStatus();
                if (searchActive()) rerunSearch();
            })
            .then(() => songs);
        return loading;
    }

    function filter(q) {
        q = String(q || '').trim().toLowerCase();
        if (!q) return songs.slice();
        return songs.filter((s) => s._search.includes(q) || (s.artist + ' ' + s.title).toLowerCase().includes(q));
    }

    // ---- Settings UI ----
    function syncStatus() {
        document.querySelectorAll('#cloudSourceOptions [data-song-source]').forEach((b) =>
            b.classList.toggle('active', b.dataset.songSource === source));
        const sub = document.getElementById('mYouSourceSub');
        if (sub) sub.textContent = source === 'cloud' ? 'Cloudflare' : 'Your playlists';
        const el = document.getElementById('cloudListStatus');
        if (el) {
            el.classList.remove('ok', 'err');
            if (listState === 'loading') el.textContent = 'Loading the list…';
            else if (listState === 'error') { el.textContent = "Couldn't load the list. " + listError; el.classList.add('err'); }
            else if (listState === 'done') {
                el.textContent = (songs.length === 1 ? '1 song' : songs.length + ' songs') + (listError ? ". Couldn't refresh the list. " + listError : '');
                el.classList.add(listError ? 'err' : 'ok');
            }
            else el.textContent = '';
        }
        const input = document.getElementById('mSearchInput');
        if (input) {
            input.placeholder = source === 'cloud' ? 'Search your Cloudflare songs' : 'Songs, artists or a link';
            input.setAttribute('aria-label', source === 'cloud' ? 'Search your Cloudflare songs' : 'Search your library and YouTube');
        }
    }

    function setSource(next) {
        if (next === 'cloud' && !cfg) return;
        source = next === 'cloud' ? 'cloud' : 'library';
        try { localStorage.setItem(SOURCE_KEY, source); } catch (e) {}
        syncStatus();
        if (source === 'cloud') load(false);
        rerunSearch();
    }

    // ---- Search tab ----
    function rerunSearch() {
        const input = document.getElementById('mSearchInput');
        if (input) input.dispatchEvent(new Event('input'));
    }

    function hint(text) {
        return '<div class="m-search-hint">' + escapeHtml(text) + '</div>';
    }

    function renderSearch(q, el, announce) {
        if (!el) return;
        shown = [];
        // A refresh of a list already here keeps showing it meanwhile
        if (!songs.length && (listState === 'idle' || listState === 'loading')) {
            el.innerHTML = hint('Loading your Cloudflare songs…');
            load(false);
            return;
        }
        if (listState === 'error') {
            el.innerHTML = hint("Couldn't load your Cloudflare songs. " + listError + ' Try Settings → Source → Reload list.');
            if (announce) announce('Loading failed');
            return;
        }
        const hits = filter(q);
        shown = hits;
        if (!hits.length) {
            el.innerHTML = hint(q ? 'No Cloudflare song matches “' + q + '”.' : 'No songs in the bucket yet.');
            if (announce) announce('No songs found');
            return;
        }
        const n = hits.length;
        const playing = currentRadioSong && currentRadioSong.cloud_key;
        let html = '<div class="m-search-section"><h2 class="m-search-heading">' + (q ? 'From Cloudflare' : 'Your Cloudflare songs') + '</h2>'
            + '<span class="m-search-count" aria-hidden="true">' + (n === 1 ? '1 song' : n + ' songs') + '</span>'
            + '<button type="button" class="m-search-clear-all" data-cloud-all>Play all</button></div>';
        html += hits.slice(0, MAX_ROWS).map((s, i) => {
            const artist = s.artist ? '<span class="search-result-artist">' + escapeHtml(s.artist) + '</span>' : '';
            const active = playing === s.cloud_key ? ' is-playing' : '';
            return '<div class="m-sr-row' + active + '">'
                + '<button type="button" class="search-result" data-cloud="' + i + '" aria-label="Play ' + escapeHtml(s.title) + (s.artist ? ' by ' + escapeHtml(s.artist) : '') + '">'
                + '<div class="search-result-cover search-result-cover-empty">' + NOTE + '</div>'
                + '<span class="search-result-info"><span class="search-result-title">' + escapeHtml(s.title) + '</span>' + artist + '</span>'
                + '</button></div>';
        }).join('');
        if (n > MAX_ROWS) html += '<div class="m-search-hint m-search-hint-sm">Showing ' + MAX_ROWS + ' of ' + n + '. Type to narrow it down; Play all plays every one.</div>';
        // The library results' wrapper: the desktop Search page styles its rows by it
        el.innerHTML = '<div class="m-sr-lib">' + html + '</div>';
        if (announce) announce(n === 1 ? '1 song' : n + ' songs');
    }

    function onResultsClick(e) {
        if (!searchActive()) return;
        const t = e.target.closest('[data-cloud], [data-cloud-all]');
        if (!t) return;
        const list = shown.slice();
        if (!list.length) return;
        // A song change already under way would play over this one (the app
        // ignores taps meanwhile everywhere else, too). Before anything changes.
        if (typeof isChangingSong !== 'undefined' && isChangingSong) return;
        let idx = 0;
        if (t.dataset.cloud !== undefined) idx = parseInt(t.dataset.cloud, 10) || 0;
        else if (typeof shuffleMode !== 'undefined' && shuffleMode !== 'off') idx = Math.floor(Math.random() * list.length);
        history = [];
        start(list, idx, true); // synchronous: this tap is what unlocks audio on iOS
        // The phone keyboard would stay up (and keep the player dock hidden)
        const input = document.getElementById('mSearchInput');
        if (input && document.activeElement === input) input.blur();
    }

    // ---- Playback ----
    function isPlaying() {
        return !!(cfg && currentRadioSong && currentRadioSong.cloud_key);
    }

    function start(list, idx, byUser) {
        const song = list[idx];
        if (!song) return;
        order = list;
        pos = idx;
        if (byUser && typeof noteUserSongAsk === 'function') noteUserSongAsk();

        currentRadioSong = song;
        currentRadioSongSaved = false;
        if (listIsPlaying()) {
            document.querySelectorAll('.song-list-item:not(.radio-song-item)').forEach((item) => item.classList.remove('active'));
        }
        removeRadioSidebarItem();
        addRadioSidebarItem(song); // no "save to playlist" for a Cloudflare song (script.js)

        resetSleeveProgress();
        // Swaps the src of the one shared <audio> and calls play() right away
        playSongSource(song, false);
        hookAudio();
        updateMediaSession(song);
        animateRecordChange(song).catch(() => {});
        updateAmpDisplay();
        loadLyricsForSong(song);
        markShownRow();
    }

    // Next (dir 1) or back (dir -1) through the list the song came from.
    function step(dir, byUser) {
        if (!order.length) order = songs.slice();
        const cur = currentRadioSong && currentRadioSong.cloud_key;
        if (!order[pos] || order[pos].cloud_key !== cur) {
            pos = order.findIndex((s) => s.cloud_key === cur);
            if (pos < 0) { order = songs.slice(); pos = order.findIndex((s) => s.cloud_key === cur); }
        }
        const n = order.length;
        if (!n) return;
        const shuffled = typeof shuffleMode !== 'undefined' && shuffleMode !== 'off';
        let next;
        if (dir < 0) {
            // A few seconds in, Back restarts the song (like every player)
            if (ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getCurrentTime() > 3) { restartSong(); return; }
            if (shuffled && history.length) next = history.pop();
            else next = pos <= 0 ? n - 1 : pos - 1;
        } else {
            if (shuffled && n > 1) {
                do { next = Math.floor(Math.random() * n); } while (next === pos);
            } else if (pos + 1 >= n) {
                // Loop off: the list played through, stop (a tap on Next still wraps)
                if (!byUser && typeof loopMode !== 'undefined' && loopMode === 'off') return;
                next = 0;
            } else {
                next = pos + 1;
            }
            if (pos >= 0) history.push(pos);
            if (history.length > 100) history.shift();
        }
        start(order, next, byUser);
    }

    function markShownRow() {
        const el = document.getElementById('mSearchResults');
        if (!el || !searchActive()) return;
        const cur = currentRadioSong && currentRadioSong.cloud_key;
        el.querySelectorAll('[data-cloud]').forEach((b) => {
            const s = shown[parseInt(b.dataset.cloud, 10)];
            const row = b.closest('.m-sr-row');
            if (row) row.classList.toggle('is-playing', !!s && s.cloud_key === cur);
        });
    }

    // Lock-screen scrubber: report the position on every jump, not only on
    // the page's 1 s tick (timers are throttled in the background).
    function positionState() {
        const a = mp3PlayerProxy && mp3PlayerProxy._audio;
        if (!a || !isPlaying() || !('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
        const d = a.duration;
        if (!d || !isFinite(d)) return;
        try {
            navigator.mediaSession.setPositionState({ duration: d, position: Math.min(a.currentTime || 0, d), playbackRate: a.playbackRate || 1 });
        } catch (e) {}
    }
    function hookAudio() {
        if (audioHooked || !mp3PlayerProxy || !mp3PlayerProxy._audio) return;
        audioHooked = true;
        const a = mp3PlayerProxy._audio;
        ['loadedmetadata', 'durationchange', 'seeked', 'play', 'pause', 'ratechange'].forEach((ev) => a.addEventListener(ev, positionState));
    }

    // ---- Upload (optional extra) ----
    function upload(input) {
        const files = Array.from((input && input.files) || []);
        if (input) input.value = '';
        const status = document.getElementById('cloudUploadStatus');
        const say = (text, cls) => {
            if (!status) return;
            status.textContent = text;
            status.classList.remove('ok', 'err');
            if (cls) status.classList.add(cls);
        };
        if (!cfg || !files.length) return;
        const MAX_BYTES = 40 * 1024 * 1024; // the server's limit, as for your own uploads
        const ok = files.filter((f) => /\.(mp3|m4a)$/i.test(f.name));
        if (!ok.length) { say('Pick MP3 or M4A files.', 'err'); return; }
        const tooBig = ok.filter((f) => f.size > MAX_BYTES).length;

        say('Checking what is already there…');
        load(true).then(() => {
            if (listState !== 'done') { say("Couldn't load the list, so nothing was uploaded.", 'err'); return; }
            const have = new Set(songs.map((s) => s.cloud_key));
            const todo = ok.filter((f) => f.size <= MAX_BYTES && !have.has(f.name));
            let skipped = ok.length - tooBig - todo.length;
            let done = 0, failed = 0, lastError = '';
            const finish = (extra) => {
                const parts = [done + ' uploaded'];
                if (skipped) parts.push(skipped + ' already there');
                if (tooBig) parts.push(tooBig + ' over 40 MB');
                if (failed) parts.push(failed + ' failed');
                say(parts.join(', ') + '.' + (extra ? ' ' + extra : ''), failed || tooBig || extra ? 'err' : 'ok');
                load(true);
            };
            // One after another, through this site (CloudMusicController): it
            // checks the file, adds the Worker's token and never writes over a
            // file that is already in the bucket.
            const next = (i) => {
                if (i >= todo.length) { finish(lastError); return; }
                const f = todo[i];
                const label = (i + 1) + ' of ' + todo.length + ': ' + f.name;
                const form = new FormData();
                form.append('file', f);
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/cloud-music/upload');
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.setRequestHeader('X-CSRF-TOKEN', window.getCsrfToken ? window.getCsrfToken() : '');
                xhr.upload.onprogress = (e) => {
                    if (e.lengthComputable) say('Uploading ' + label + ' (' + Math.round((e.loaded / e.total) * 100) + '%)');
                };
                xhr.onload = () => {
                    let data = null;
                    try { data = JSON.parse(xhr.responseText); } catch (e) {}
                    const message = (data && (data.error || data.message)) || '';
                    if (xhr.status === 429) {
                        // The per-minute limit: wait it out and send this file again.
                        // The daily one (hours away) ends the batch: the rest would be refused too.
                        const wait = parseInt(xhr.getResponseHeader('Retry-After'), 10);
                        if (wait > 0 && wait <= 90) {
                            say('Waiting ' + wait + ' s before the next upload…');
                            setTimeout(() => next(i), wait * 1000 + 250);
                        } else {
                            failed += todo.length - i;
                            finish(message);
                        }
                        return;
                    }
                    if (xhr.status >= 200 && xhr.status < 300) done++;
                    else if (xhr.status === 409) skipped++;
                    else { failed++; lastError = message; }
                    next(i + 1);
                };
                xhr.onerror = () => { failed++; lastError = 'No connection to the server.'; next(i + 1); };
                say('Uploading ' + label);
                xhr.send(form);
            };
            if (!todo.length && !tooBig) { say('All ' + ok.length + ' already in the bucket.', 'ok'); return; }
            if (!todo.length) { finish(''); return; }
            next(0);
        });
    }

    // ---- Back from the background ----
    // A list older than a few minutes is fetched again, so songs added
    // meanwhile show up; a page restored from the back/forward cache, too.
    function refreshIfStale() {
        if (cfg && source === 'cloud' && listState !== 'loading' && Date.now() - loadedAt > 5 * 60 * 1000) load(true);
        // iOS sometimes drops the lock-screen title while away
        if (!document.hidden && isPlaying()) { updateMediaSession(currentRadioSong); positionState(); }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshIfStale(); });
    window.addEventListener('pageshow', (e) => { if (e.persisted) refreshIfStale(); });

    // ---- Start ----
    const results = document.getElementById('mSearchResults');
    if (results) results.addEventListener('click', onResultsClick);
    syncStatus();
    if (cfg && source === 'cloud') load(false);
    else if (source === 'cloud') setSource('library');
    // A query restored after a reload was searched by script.js before this
    // file existed (library and YouTube): search it again here, once
    // window.cloudMusic is set, which also cancels those pending searches.
    Promise.resolve().then(() => { if (searchActive()) rerunSearch(); });

    function searchActive() { return !!cfg && source === 'cloud'; }

    return {
        setSource,
        reload: () => load(true),
        upload,
        isPlaying,
        size: () => order.length || songs.length, // the list the playing song came from
        step,
        searchActive,
        renderSearch,
        displayName: (key) => splitName(cleanName(key)),
    };
})();
