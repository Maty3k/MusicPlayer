// Debug hooks come from player-debug.js; no-ops if it didn't load.
if (typeof window.pdbg !== 'function') window.pdbg = function () {};
if (typeof window.__pdbgAttach !== 'function') window.__pdbgAttach = function () {};

// YT.PlayerState is read on every state change, uploaded songs included, so
// it must exist even before (or without) YouTube's IFrame API — a page
// opened offline still plays its uploaded songs. The API merges into this
// object when it loads; "is the API ready" checks look for YT.Player.
if (!window.YT) window.YT = { PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } };

// Laravel session auth: the page carries a CSRF token in a <meta> tag. This
// shim attaches it as X-CSRF-TOKEN on every POST-like request to our own
// backend endpoints so the VerifyCsrfToken middleware accepts them. GET
// requests need no token.
(function () {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    let csrfToken = null;
    function getCsrfToken() {
        if (csrfToken === null && typeof document !== 'undefined') {
            const meta = document.querySelector('meta[name=csrf-token]');
            csrfToken = meta ? meta.content : '';
        }
        return csrfToken || '';
    }
    const ORIGIN_ENDPOINTS = /^\/(save-music|spotify|spotify-resolve|spotify-library|search-youtube|youtube-playlist|scan-cover|settings|upload-song|recommendations)(\/|\?|$)/;
    window.getCsrfToken = getCsrfToken; // for the upload XHR, which bypasses fetch
    const origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = String(
            (init && init.method) ||
            (typeof input !== 'string' && input && input.method) ||
            'GET'
        ).toUpperCase();
        if (method !== 'GET' && method !== 'HEAD' && ORIGIN_ENDPOINTS.test(url)) {
            const token = getCsrfToken();
            if (token) {
                init = init || {};
                const headers = new Headers(
                    init.headers || (typeof input !== 'string' && input ? input.headers : undefined) || {}
                );
                headers.set('X-CSRF-TOKEN', token);
                init.headers = headers;
            }
        }
        return origFetch(input, init);
    };
})();

// Lazy-load YouTube IFrame API
let ytApiLoaded = false;
function loadYouTubeAPI() {
    if (ytApiLoaded) return;
    ytApiLoaded = true;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
}

// HTML-escape any string that ends up in innerHTML / attribute interpolation.
// Song fields and Spotify metadata are user-controlled and reach DOM sinks
// via template literals throughout this file.
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Only allow http(s) URLs in <img src> / <audio src>. Empty string for
// anything else (javascript:, data:, file:, etc.) so the attribute renders
// as empty rather than executing.
function safeUrl(s) {
    if (s === null || s === undefined || s === '') return '';
    const str = String(s).trim();
    if (/^https?:\/\//i.test(str)) return str;
    if (/^\//.test(str) && !str.startsWith('//')) return str;
    return '';
}

// Music player controls
// Move the YouTube audio iframe out to <body> so it renders full-viewport
// behind the opaque #music-section instead of as a suspended 1px overlay —
// mobile browsers keep a visible video alive but throttle a hidden one,
// which was pausing + reloading playback every few seconds. Runs before the
// player iframe is created (script.js is last in <body>), so nothing reloads.
(function keepPlayerAlive() {
    try {
        const c = document.getElementById('youtubeContainer');
        if (c && c.parentElement !== document.body) document.body.appendChild(c);
    } catch (e) { /* container rendered later or missing — harmless */ }
})();

// Song and playlist data from PHP
// activePlaylistId is injected by PHP in player.blade.php
// songsData is injected by PHP in player.blade.php
// currentSongIndex is injected by PHP in player.blade.php
let isChangingSong = false;
let isChangingPlaylist = false;

// Animate record change
async function animateRecordChange(newSong) {
    const vinyl = document.getElementById('vinyl');
    const songInfo = document.querySelector('.song-info');
    const tonearm = document.getElementById('tonearm');
    const miniTonearm = document.getElementById('miniTonearm');
    const platterVinyl = document.getElementById('platterVinyl');

    const isApp = !!window.ReactNativeWebView;
    // Phones skip the ~1.25s lift/drop ceremony: track changes should feel
    // instant. Evaluated call-time (never cached) so rotation/resize behaves.
    const fastSwitch = isApp || window.matchMedia('(max-width: 600px)').matches;

    // Stop vinyl spinning during change
    vinyl.classList.remove('playing');
    tonearm.classList.remove('playing');
    if (miniTonearm) miniTonearm.classList.remove('playing');
    if (platterVinyl) platterVinyl.classList.remove('spinning');

    if (!fastSwitch) {
        // Move tonearm away
        tonearm.style.transition = 'transform 0.4s ease';
        tonearm.style.transform = 'rotate(-30deg)';

        // Lift off old record
        vinyl.classList.add('lifting');
        songInfo.classList.add('changing');

        // Wait for lift animation
        await new Promise(resolve => setTimeout(resolve, 600));
    }

    // Update the cover while hidden
    const label = document.querySelector('.record-label');
    const newCoverUrl = safeUrl(newSong.cover);
    if (newCoverUrl) {
        label.innerHTML = `<img src="${escapeHtml(newCoverUrl)}" alt="Album Cover">`;
    } else {
        label.innerHTML = '<div class="record-label-placeholder">&#9834;</div>';
    }

    // Update song info while hidden
    setNowPlayingText(newSong.title, newSong.artist, newSong.album || '');

    // Update sleeve cover art
    const sleeveImg = document.getElementById('sleeveArtImg');
    const sleevePlaceholder = document.getElementById('sleeveArtPlaceholder');
    if (sleeveImg) {
        if (newSong.cover) {
            sleeveImg.src = newSong.cover;
            sleeveImg.style.display = '';
            if (sleevePlaceholder) sleevePlaceholder.style.display = 'none';
        } else {
            sleeveImg.style.display = 'none';
            if (sleevePlaceholder) sleevePlaceholder.style.display = '';
        }
        // Replay album art fade-in animation in app mode
        if (isApp) {
            sleeveImg.style.animation = 'none';
            void sleeveImg.offsetHeight;
            sleeveImg.style.animation = '';
        }
    }
    // Update backdrop
    const backdropImg = document.getElementById('backdropImg');
    if (backdropImg) {
        if (newSong.cover) {
            backdropImg.src = newSong.cover;
            backdropImg.style.display = '';
        } else {
            backdropImg.style.display = 'none';
        }
    }
    // Update track number
    const trackNum = document.getElementById('sleeveTrackNum');
    if (trackNum) trackNum.textContent = 'TRACK ' + String(currentSongIndex + 1).padStart(2, '0');

    if (fastSwitch && !isApp) {
        // 250ms record-swap flourish in place of the full ceremony
        vinyl.classList.remove('m-swap');
        void vinyl.offsetWidth;
        vinyl.classList.add('m-swap');
        vinyl.addEventListener('animationend', () => vinyl.classList.remove('m-swap'), { once: true });
    }

    if (!fastSwitch) {
        // Prepare for drop-in
        vinyl.classList.remove('lifting');
        vinyl.classList.add('dropping');

        // Force reflow
        void vinyl.offsetWidth;

        // Drop in new record
        await new Promise(resolve => setTimeout(resolve, 50));
        vinyl.classList.remove('dropping');
        vinyl.classList.add('dropping-in');
        songInfo.classList.remove('changing');

        // Reset tonearm
        await new Promise(resolve => setTimeout(resolve, 600));
        tonearm.style.transform = '';
        vinyl.classList.remove('dropping-in');
        tonearm.style.transition = '';
    }

    // Reset mini turntable elements (they'll be set to playing by onPlayerStateChange when video plays)

    // Every track-change path funnels through here, but updateMediaSession's
    // only other call site is updateSongDisplay — without this the lock
    // screen keeps showing the previous song after next/prev/switchSong.
    updateMediaSession(newSong);
}

let songHistory = [];
let playQueue = []; // Up-next queue: song objects the user explicitly queued.

// ---- The list on screen vs the list that plays (phone browsing) ----
// activePlaylistId, songsData and currentSongIndex always describe the
// PLAYING list. The phone shell can show another playlist without playing
// it (like Spotify): viewedId names it and viewedSongs holds its songs (null
// while they load). Only the phone shell sets viewedId, and only while that
// playlist's screen is up (closing it collapses the view), so on desktop,
// tablets and ?app=1 the list on screen always is the playing one.
// Declared up here: the phone shell's reload restore runs while this file loads.
let viewedId = null;
let viewedSongs = null;
let viewedResume = 0;     // its saved current song: where Play starts it
let viewGen = 0;          // bumps on every view change: late answers check it
let viewDirty = false;    // a write reached the viewed playlist while it loaded
let viewFailed = false;   // its songs didn't load: the list offers Retry
function listId() { return viewedId !== null ? viewedId : activePlaylistId; }
function listSongs() { return viewedId !== null ? (viewedSongs || []) : songsData; }
function listIsPlaying() { return viewedId === null; }
function listLoading() { return viewedId !== null && viewedSongs === null; }

// Writes that change a playlist's songs, counted per playlist while in
// flight. A view waits for them before it loads that playlist: an answer
// read before a write committed would miss its song, or keep a removed one.
const listWrites = new Map();
let listWriteWaiters = [];
function writeBegin(id) {
    id = String(id);
    listWrites.set(id, (listWrites.get(id) || 0) + 1);
    if (listLoading() && id === String(viewedId)) viewDirty = true;
}
function writeEnd(id) {
    id = String(id);
    const n = (listWrites.get(id) || 1) - 1;
    if (n > 0) listWrites.set(id, n); else listWrites.delete(id);
    const settled = listWriteWaiters.filter((w) => !listWrites.has(w.id));
    listWriteWaiters = listWriteWaiters.filter((w) => listWrites.has(w.id));
    settled.forEach((w) => w.done());
}
function writesSettled(id, maxMs = 15000) {
    id = String(id);
    if (!listWrites.has(id)) return Promise.resolve();
    return new Promise((resolve) => {
        const w = { id, done: () => { clearTimeout(timer); resolve(); } };
        const timer = setTimeout(() => {
            listWriteWaiters = listWriteWaiters.filter((x) => x !== w);
            resolve();
        }, maxMs);
        listWriteWaiters.push(w);
    });
}

// The phone shell's part of a view change (the screen's colour and classes,
// the playlist its history entry records): it installs this.
let viewChangedHook = null;
function viewChanged(opts) {
    if (viewChangedHook) viewChangedHook(opts || {});
}

// Paint the playing list on the playlist screen: title, rows, count.
function showPlayingList() {
    const title = document.getElementById('playlistTitle');
    const meta = playlistsMeta[activePlaylistId];
    if (title) title.textContent = meta ? meta.name : 'My Records';
    rebuildSongList();
    updateTrackCount();
    const scroller = songListScroller();
    if (scroller) scroller.scrollTop = 0;
    viewChanged();
}

// Back to "the list on screen is the playing list": the playlist screen
// closed, the page left the phone layout, or Show in playlist. A no-op when
// nothing is being viewed (always, on desktop).
function collapseView() {
    if (viewedId === null) return false;
    viewGen++;
    viewedId = null;
    viewedSongs = null;
    viewedResume = 0;
    viewDirty = false;
    viewFailed = false;
    showPlayingList();
    return true;
}

// Make the viewed playlist the playing one, at `index`; the caller starts
// that row with switchSong in the same tick. Like copy, move and remove it
// addresses a song by position, so it never runs while a song edit is
// saving, nor mid track change (that change would then write its old index
// into the new list). Returns false, having changed nothing, then.
function adoptViewedList(index) {
    if (viewedId === null || !viewedSongs || !viewedSongs[index]) return false;
    if (isChangingSong || songOpInFlight || reordersPending > 0) return false;
    const id = String(viewedId);
    activePlaylistId = id;
    songsData = viewedSongs;
    currentSongIndex = index;
    viewGen++;
    viewedId = null;
    viewedSongs = null;
    viewedResume = 0;
    viewDirty = false;
    viewFailed = false;
    // The old track's leftovers: a resolve still pending, a late error.
    playRequested = false;
    songRequestSeq++;
    resetRadio();
    songHistory = []; // indexes into the old list
    // The player still holds the old track: this row hasn't started, so
    // switchSong's same-index guard lets it through.
    currentRowUnloaded = true;
    if (shuffleMode !== 'off') buildShuffleQueue();
    if (shuffleMode === 'smart' && songsData[index].youtube_id) {
        try { fetchRadioRecommendations(songsData[index].youtube_id); } catch (e) { /* no YouTube API */ }
    }
    updateLoopSongLabel();
    updateAmpDisplay();
    // The 'now playing' markers: the Library card, the Home and Search tiles.
    document.querySelectorAll('.record-card.now-playing').forEach((c) => c.classList.remove('now-playing'));
    const card = document.querySelector(`.record-card[data-playlist="${id}"]`);
    if (card) card.classList.add('now-playing');
    recentlyPlayed = [id].concat((Array.isArray(recentlyPlayed) ? recentlyPlayed : [])
        .filter((x) => String(x) !== id)).slice(0, 4);
    updateCrateRecords();
    viewChanged();
    fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', index, playlist: id, activate: true })
    }).catch(() => { /* the next track change saves the position again */ });
    return true;
}

// The one way a tap starts a playlist that's only being viewed (a row, Play,
// the Search "Open in" chip). The latest tap wins; one made during a track
// change waits for it (up to 5 s), and is dropped if the view moved on.
let pendingStart = null;
function startInViewedList(index) {
    if (viewedId === null || !viewedSongs || !viewedSongs[index]) return Promise.resolve(false);
    if (songOpBusy()) return Promise.resolve(false);
    const req = { gen: viewGen, id: viewedId, song: viewedSongs[index] };
    pendingStart = req;
    return new Promise((resolve) => {
        let waited = 0;
        (function attempt() {
            if (pendingStart !== req) { resolve(false); return; }
            if (isChangingSong && waited < 5000) {
                waited += 100;
                setTimeout(attempt, 100);
                return;
            }
            pendingStart = null;
            const i = viewGen === req.gen && viewedId === req.id && viewedSongs ? viewedSongs.indexOf(req.song) : -1;
            if (i === -1 || !adoptViewedList(i)) { resolve(false); return; }
            switchSong(i);
            resolve(true);
        })();
    });
}

// A row tap: a row of the playing list plays; a viewed list becomes the
// playing one first.
function playListRow(index) {
    if (listIsPlaying()) {
        switchSong(index);
        return;
    }
    if (!listLoading()) startInViewedList(index);
}

// The server appended `song` to playlist `id`: each loaded copy of that list
// takes it too. Returns false when none did (the caller counts the song
// itself). opts.genAt: viewGen when the add was asked for (a view opened
// since then may or may not have fetched it).
function joinList(id, song, opts = {}) {
    id = String(id);
    const copy = Object.assign({}, song);
    if (viewedId !== null && id === String(viewedId)) {
        if (!viewedSongs) { // still loading: load it again once this lands
            viewDirty = true;
            return false;
        }
        // Opened again since the add was asked for: its load may or may not
        // have the song, so reload it quietly (a push could double it)
        if (opts.genAt !== undefined && opts.genAt !== viewGen) {
            resyncList(id, viewedSongs);
            return true;
        }
        viewedSongs.push(copy);
        rebuildSongList();
        updateTrackCount(id, viewedSongs);
        return true;
    }
    if (id !== String(activePlaylistId)) return false;
    const wasEmpty = songsData.length === 0;
    songsData.push(copy);
    // A preview of the same song now counts as saved (its + would store it twice).
    if (currentRadioSong && songPlayKey(currentRadioSong) === songPlayKey(song)) currentRadioSongSaved = true;
    // A playing list that was empty gets the song cued, so the player isn't
    // left on "Nothing playing". Not while something is audible: the song
    // then waits as a current row that hasn't started (unless it is the
    // very track playing).
    const vinyl = document.getElementById('vinyl');
    const audible = isChangingSong || (!!vinyl && vinyl.classList.contains('playing'));
    const cue = wasEmpty && !currentRadioSong && !audible;
    if (wasEmpty && !currentRadioSong) {
        currentSongIndex = 0;
        currentRowUnloaded = audible && currentRowStillUnloaded();
    }
    if (shuffleMode !== 'off') buildShuffleQueue();
    if (listIsPlaying()) rebuildSongList();
    updateTrackCount(id, songsData);
    if (cue) {
        updateSongDisplay(songsData[0]);
        playSongSource(songsData[0], true);
    }
    return true;
}

// A song landed in a playlist that no loaded list holds: its count follows.
function bumpSongCount(id) {
    const meta = playlistsMeta[id];
    if (!meta) return;
    meta.songCount = (meta.songCount || 0) + 1;
    setCrateCardCount(id, meta.songCount);
}

// The song sheet acts on one of two lists: the one on screen (a row's ⋯), or
// the playing one ('np': Now Playing's ⋯). Now Playing's song must never be
// looked up in a list that's only being viewed: Remove would hit another song.
function songCtx(key) {
    return key === 'np'
        ? { id: String(activePlaylistId), songs: songsData }
        : { id: String(listId()), songs: listSongs() };
}

// The server took `key` out of Favorites (its FIRST match): the loaded
// Favorites list follows, and its saved position moves the server's way.
// The song playing plays on, and Next carries on from where it was.
// Returns false when no loaded list is Favorites.
function dropFavorite(key) {
    let arr = null;
    if (viewedId === 'favorites') {
        if (!viewedSongs) return false; // loading: its answer brings the new list
        arr = viewedSongs;
    } else if (String(activePlaylistId) === 'favorites') {
        arr = songsData;
    }
    if (!arr) return false;
    const r = arr.findIndex((s) => songPlayKey(s) === key);
    if (r !== -1) {
        const playing = arr === songsData;
        const oldCur = playing ? currentSongIndex : viewedResume;
        const waiting = playing && currentRowUnloaded;
        arr.splice(r, 1);
        const total = arr.length;
        const cur = total === 0 ? 0 : ((r < oldCur || oldCur >= total) ? Math.max(0, oldCur - 1) : oldCur);
        if (playing) {
            const wasCurrent = r === oldCur && !waiting && !currentRadioSong;
            currentSongIndex = cur;
            if (total === 0) currentRowUnloaded = false;
            else if (waiting || wasCurrent) currentRowUnloaded = currentRowStillUnloaded();
            if (shuffleMode !== 'off') buildShuffleQueue();
        } else {
            viewedResume = cur;
        }
        if (arr === listSongs()) rebuildSongList();
    }
    updateTrackCount('favorites', arr);
    return true;
}

// The server refused an index-addressed write (or a reorder), so this list
// in memory no longer matches it: reload the playlist into the same array,
// keeping its song objects (the playing one is found again by identity).
// opts.snap: the order before an unconfirmed reorder, put back if even the
// reload fails. opts.message: what to say.
async function resyncList(id, arr, opts = {}) {
    let res = null;
    try { res = await saveMusicRequest({ action: 'getPlaylist', playlist: id }); } catch (e) { /* below */ }
    const fresh = res && res.success && res.playlist && Array.isArray(res.playlist.songs) ? res.playlist.songs : null;
    const gone = !!res && res.error === 'Invalid playlist'; // deleted elsewhere
    const playing = arr === songsData;
    const anchor = playing
        ? ((currentRadioSong || currentRowUnloaded) ? arr[currentSongIndex] : (lastRequestedSong || arr[currentSongIndex]))
        : null;
    let changed = false;
    if (fresh) {
        const spare = new Map();
        arr.forEach((s) => {
            const k = songPlayKey(s);
            if (!spare.has(k)) spare.set(k, []);
            spare.get(k).push(s);
        });
        const next = fresh.map((f) => {
            const same = spare.get(songPlayKey(f));
            return same && same.length ? same.shift() : f;
        });
        arr.splice(0, arr.length, ...next);
        changed = true;
    } else if (opts.snap && !gone) {
        // The server most likely never took the change: undo it here.
        const added = arr.filter((s) => !opts.snap.includes(s));
        arr.splice(0, arr.length, ...opts.snap, ...added);
        changed = true;
    }
    if (changed && playing) {
        const i = anchor ? arr.indexOf(anchor) : -1;
        if (i !== -1) {
            currentSongIndex = i;
        } else {
            const want = fresh ? (parseInt(res.playlist.currentIndex, 10) || 0) : currentSongIndex;
            currentSongIndex = Math.max(0, Math.min(want, arr.length - 1));
            currentRowUnloaded = !currentRadioSong && currentRowStillUnloaded();
        }
        songHistory = [];
        if (shuffleMode !== 'off') buildShuffleQueue();
    } else if (fresh && arr === viewedSongs) {
        viewedResume = parseInt(res.playlist.currentIndex, 10) || 0;
    }
    if (changed) {
        if (arr === listSongs()) rebuildSongList();
        updateTrackCount(id, arr);
    }
    if (opts.message) songToast(opts.message);
}

function nextSong() {
    if (isChangingSong) return;
    // The queue always wins over the normal playlist/shuffle progression.
    if (playQueue.length > 0) { advanceFromQueue(); return; }
    if (songsData.length === 0) return;

    // Smart shuffle: alternate between playlist and radio
    if (shuffleMode === 'smart' && smartShuffleNextIsRadio && radioPool.length > 0) {
        // Push current state to history
        songHistory.push(currentRadioSong ? {type: 'radio', song: currentRadioSong} : currentSongIndex);
        const radioSong = radioPool.shift();
        smartShuffleNextIsRadio = false;
        playRadioSong(radioSong);
        return;
    }

    // Push current state to history
    songHistory.push(currentRadioSong ? {type: 'radio', song: currentRadioSong} : currentSongIndex);
    const nextIndex = shuffleMode !== 'off'
        ? getRandomSongIndex()
        : (currentRowStarted() ? (currentSongIndex + 1) % songsData.length : currentSongIndex);

    // In smart shuffle, next auto-play after a playlist song should be radio
    if (shuffleMode === 'smart') {
        smartShuffleNextIsRadio = true;
    }

    switchSong(nextIndex);
}

function prevSong() {
    if (isChangingSong || songsData.length === 0) return;
    if (shuffleMode !== 'off' && songHistory.length > 0) {
        // Go back to the actual previous song that played
        const prev = songHistory.pop();
        if (typeof prev === 'object' && prev.type === 'radio') {
            playRadioSong(prev.song);
        } else {
            const prevIndex = typeof prev === 'object' ? prev.index : prev;
            switchSong(prevIndex);
        }
    } else {
        const prevIndex = currentRowStarted()
            ? (currentSongIndex - 1 + songsData.length) % songsData.length
            : currentSongIndex;
        switchSong(prevIndex);
    }
}

// Mark exactly one playlist row active, by its real songsData index —
// never a Discover or radio row, and never by fragile DOM position. Only in
// the playing list: a viewed one's row at that index is another song.
function setActiveSongRow(index) {
    if (!listIsPlaying()) return;
    document.querySelectorAll('#songList .song-list-item').forEach(item => {
        const isSong = !item.classList.contains('discover-item')
            && !item.classList.contains('radio-song-item');
        const rowIndex = parseInt(item.getAttribute('data-index'), 10);
        item.classList.toggle('active', isSong && rowIndex === index);
    });
}

// Switch song from sidebar
async function switchSong(index) {
    pdbg('tap song #' + (index + 1), songsData[index] ? songsData[index].title : '');
    if (index === currentSongIndex && !currentRadioSong && !currentRowUnloaded) return;
    if (!songsData[index]) return;
    if (isChangingSong) return;

    isChangingSong = true;
    // try/finally so a rejected await (crackle, animation, the save fetch)
    // can never leave isChangingSong stuck true — that would make every
    // later tap early-return and the previously-playing row stay selected.
    try {
        const song = songsData[index];

        // Shuffle pass bookkeeping. The outgoing song, if it was only cued
        // (page load, playlist open) and never played, still gets its turn;
        // the song picked by hand has had its turn and leaves the queue.
        if (shuffleMode !== 'off') {
            const outgoingState = ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : null;
            if (!currentRadioSong && songsData[currentSongIndex]
                && !songsData[currentSongIndex]._unplayable  // a failed song has had its turn
                && (outgoingState === -1 || outgoingState === 5)
                && !shuffleQueue.includes(currentSongIndex)) {
                shuffleQueue.splice(Math.floor(Math.random() * (shuffleQueue.length + 1)), 0, currentSongIndex);
            }
            const queued = shuffleQueue.indexOf(index);
            if (queued !== -1) shuffleQueue.splice(queued, 1);
        }

        // Clear radio state — we're playing a playlist song now
        currentRadioSong = null;
        removeRadioSidebarItem();

        // Highlight the tapped song by its real index (data-index), not DOM
        // position — the list also holds Discover rows, so a positional loop
        // could land the highlight on the wrong row.
        setActiveSongRow(index);

        // Animate the record change
        // Play vinyl crackle before song change. On phones the crackle still
        // plays, but delays the track start by at most 300ms.
        if (window.matchMedia('(max-width: 600px)').matches) {
            await Promise.race([playCrackleSound(), new Promise(r => setTimeout(r, 300))]);
        } else {
            await playCrackleSound();
        }
        await animateRecordChange(song);

        // Reset progress bar for new song
        resetSleeveProgress();

        // Update player with new song (YouTube or MP3)
        playSongSource(song, false);

        // Save to server, naming the playing list as it is now (the phone may
        // show another one; the server's active playlist can lag behind)
        try {
            await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'switch', index: index, playlist: activePlaylistId })
            });
        } catch (e) { /* playback already started; the server sync is best-effort */ }

        currentSongIndex = index;
        updateLoopSongLabel();
        updateAmpDisplay();
        loadLyricsForSong(song);

        // In smart shuffle, refresh radio recommendations if pool is low
        if (shuffleMode === 'smart' && radioPool.length < 3 && song.youtube_id) {
            fetchRadioRecommendations(song.youtube_id);
        }
    } finally {
        isChangingSong = false;
    }
}

// Select playlist from crate view
async function selectPlaylistFromCrate(playlistId) {
    if (isChangingPlaylist) return;
    isChangingPlaylist = true;

    const vinylCrate = document.getElementById('vinylCrateView');
    const playerView = document.getElementById('musicPlayerView');
    const clickedRecord = document.querySelector(`.record-card[data-playlist="${playlistId}"]`);

    // If clicking the already-active playlist, just open the player without reloading
    if (playlistId === activePlaylistId) {
        if (!window.ReactNativeWebView) {
            if (clickedRecord) clickedRecord.classList.add('pulling');
            const pullMs = window.matchMedia('(max-width: 600px)').matches ? 250 : 500;
            await new Promise(resolve => setTimeout(resolve, pullMs));
        }
        vinylCrate.classList.add('hidden');
        playerView.classList.add('active');
        if (clickedRecord) clickedRecord.classList.remove('pulling');
        isChangingPlaylist = false;
        return;
    }

    // Animate the record being pulled out
    if (clickedRecord) {
        clickedRecord.classList.add('pulling');
    }

    // try/finally: a failed request must not leave isChangingPlaylist stuck
    // (every later playlist tap would be ignored until a reload).
    try {
        // Fetch playlist from server
        const response = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'switchPlaylist', playlist: playlistId })
        });
        const result = await response.json();

        if (!result.success) {
            showToast('Couldn\'t open that playlist. Try again.');
            return;
        }

        // Update now-playing indicator on crate
        document.querySelectorAll('.record-card.now-playing').forEach(c => c.classList.remove('now-playing'));
        const newActive = document.querySelector(`.record-card[data-playlist="${playlistId}"]`);
        if (newActive) newActive.classList.add('now-playing');

        // Update local data
        activePlaylistId = playlistId;
        songsData = result.playlist.songs;
        setCrateCardCount(playlistId, songsData.length);
        currentSongIndex = result.playlist.currentIndex || 0;
        if (shuffleMode !== 'off') buildShuffleQueue();
        // Clear smart shuffle state on playlist switch (a probe still running
        // for the old list too), and the history: it holds old-list indexes.
        resetRadio();
        songHistory = [];
        if (shuffleMode === 'smart' && songsData[currentSongIndex]?.youtube_id) {
            fetchRadioRecommendations(songsData[currentSongIndex].youtube_id);
        }
        updateLoopSongLabel();
        updateAmpDisplay();

        // Update recentlyPlayed and crate records
        if (result.recentlyPlayed) {
            recentlyPlayed = result.recentlyPlayed;
            updateCrateRecords();
        }

        // Update playlist title
        document.getElementById('playlistTitle').textContent = result.playlist.name;

        // Rebuild song list (shows the empty state when the playlist has no songs)
        rebuildSongList();
        // A NEW playlist starts at the top — the scroll preservation in
        // rebuildSongList is for in-place edits (delete/move), not switches.
        const songScroller = songListScroller();
        if (songScroller) songScroller.scrollTop = 0;
        updateOfflineButton();

        // Update track count
        const trackCountEl = document.querySelector('.sidebar-track-count');
        if (trackCountEl) trackCountEl.textContent = songsData.length + (songsData.length === 1 ? ' song' : ' songs');

        // Update the record player with first song
        const currentSong = songsData[currentSongIndex] || {};
        const label = document.querySelector('.record-label');
        const cs_cover = safeUrl(currentSong.cover);
        if (cs_cover) {
            label.innerHTML = `<img src="${escapeHtml(cs_cover)}" alt="Album Cover">`;
        } else {
            label.innerHTML = '<div class="record-label-placeholder">&#9834;</div>';
        }
        setNowPlayingText(currentSong.title || 'No song', currentSong.artist || '', currentSong.album || '');

        // Update sleeve cover art
        const sleeveImg2 = document.getElementById('sleeveArtImg');
        const sleevePlaceholder2 = document.getElementById('sleeveArtPlaceholder');
        if (sleeveImg2) {
            if (currentSong.cover) {
                sleeveImg2.src = currentSong.cover;
                sleeveImg2.style.display = '';
                if (sleevePlaceholder2) sleevePlaceholder2.style.display = 'none';
            } else {
                sleeveImg2.style.display = 'none';
                if (sleevePlaceholder2) sleevePlaceholder2.style.display = '';
            }
        }
        const trackNum2 = document.getElementById('sleeveTrackNum');
        if (trackNum2) trackNum2.textContent = 'TRACK ' + String(currentSongIndex + 1).padStart(2, '0');

        // Cue the song without auto-playing - let the user choose
        playSongSource(currentSong, true);

        // Load lyrics for the new playlist's first song
        loadLyricsForSong(currentSong);

        if (!window.ReactNativeWebView) {
            // Wait for pull animation
            const pullMs = window.matchMedia('(max-width: 600px)').matches ? 250 : 500;
            await new Promise(resolve => setTimeout(resolve, pullMs));
        }

        // Transition to player view
        vinylCrate.classList.add('hidden');
        playerView.classList.add('active');
    } catch (e) {
        showToast('Couldn\'t open that playlist. Check your connection.');
    } finally {
        if (clickedRecord) clickedRecord.classList.remove('pulling');
        isChangingPlaylist = false;
    }
}

// Show playlist picker (go back to crate)
function showPlaylistPicker() {
    const vinylCrate = document.getElementById('vinylCrateView');
    const playerView = document.getElementById('musicPlayerView');

    playerView.classList.remove('active');
    vinylCrate.classList.remove('hidden');
}

// Switch playlist (for direct switching within player view if needed)
async function switchPlaylist(playlistId) {
    if (playlistId === activePlaylistId || isChangingPlaylist) return;
    await selectPlaylistFromCrate(playlistId);
}

// Sidebar resize functionality
const sidebar = document.getElementById('musicSidebar');
const resizeHandle = document.getElementById('sidebarResizeHandle');
const collapseBtn = document.getElementById('sidebarCollapseBtn');
let isResizing = false;
let savedSidebarWidth = 280; // Default width

if (resizeHandle && sidebar) {
    resizeHandle.addEventListener('mousedown', (e) => {
        if (sidebar.classList.contains('collapsed')) return;
        isResizing = true;
        resizeHandle.classList.add('dragging');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const sidebarRect = sidebar.getBoundingClientRect();
        const newWidth = e.clientX - sidebarRect.left;
        if (newWidth >= 150 && newWidth <= 500) {
            sidebar.style.width = newWidth + 'px';
            savedSidebarWidth = newWidth;
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizeHandle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Sidebar collapse functionality
if (collapseBtn && sidebar) {
    collapseBtn.addEventListener('click', () => {
        const isCollapsed = sidebar.classList.contains('collapsed');

        if (isCollapsed) {
            // Expanding
            sidebar.classList.remove('collapsed');
            sidebar.style.width = savedSidebarWidth + 'px';
            collapseBtn.innerHTML = '&#8249;';
            collapseBtn.title = 'Collapse sidebar';
        } else {
            // Collapsing - save current width first
            const currentWidth = sidebar.offsetWidth;
            if (currentWidth > 70) {
                savedSidebarWidth = currentWidth;
            }
            sidebar.classList.add('collapsed');
            sidebar.style.width = '';
            collapseBtn.innerHTML = '&#8250;';
            collapseBtn.title = 'Expand sidebar';
        }
    });
}


// Loop mode: 'off', 'playlist', 'single'
let loopMode = 'playlist';

// Transport icons as inline SVG — Android renders bare glyph characters
// (▶ ⏸ ⏭) with emoji presentation, so never write those into the DOM.
const PLAY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg>';
const PAUSE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6.6" y="5" width="3.6" height="14" rx="1.5"/><rect x="13.8" y="5" width="3.6" height="14" rx="1.5"/></svg>';

const loopSvgs = {
    off: `<svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
        <path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
    playlist: `<svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
        <path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>`,
    single: `<svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
        <path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
        <text x="12" y="15.5" text-anchor="middle" fill="currentColor" stroke="none" font-size="8" font-weight="700">1</text></svg>`
};

function toggleLoopMode() {
    const btn = document.getElementById('loopCoaster');
    const icon = document.getElementById('loopIcon');
    const label = document.getElementById('loopLabel');

    if (loopMode === 'off') {
        loopMode = 'playlist';
        btn.dataset.loop = 'playlist';
        icon.innerHTML = loopSvgs.playlist;
        label.textContent = 'loop all';
    } else if (loopMode === 'playlist') {
        loopMode = 'single';
        btn.dataset.loop = 'single';
        icon.innerHTML = loopSvgs.single;
        updateLoopSongLabel();
    } else {
        loopMode = 'off';
        btn.dataset.loop = 'off';
        icon.innerHTML = loopSvgs.off;
        label.textContent = 'no loop';
    }
}

function updateLoopSongLabel() {
    if (loopMode !== 'single') return;
    const label = document.getElementById('loopLabel');
    const song = songsData[currentSongIndex];
    if (song) {
        label.textContent = song.title;
    } else {
        label.textContent = 'repeat 1';
    }
}

// Shuffle mode - uses a queue to play all songs before repeating any
// States: 'off' | 'shuffle' | 'smart'
let shuffleMode = 'shuffle';
let shuffleQueue = [];

// Smart shuffle (radio) state
let radioPool = [];         // Array of {title, artist, cover, youtube_id}
let smartShuffleNextIsRadio = false;
let currentRadioSong = null; // null = playlist song playing, object = radio song playing
let currentRadioSongSaved = false; // has the playing radio song been added to the library?
let radioProbePlayer = null;
let isFetchingRadio = false;
// Bumps whenever the playing context's radio is reset: a probe still
// running for the old context then cleans up only after itself.
let radioGen = 0;

function resetRadio() {
    radioGen++;
    radioPool = [];
    smartShuffleNextIsRadio = false;
    currentRadioSong = null;
    removeRadioSidebarItem();
    try { if (radioProbePlayer) radioProbePlayer.destroy(); } catch (e) {}
    radioProbePlayer = null;
    isFetchingRadio = false;
    showRadioLoading(false);
}

function toggleShuffle() {
    const btn = document.getElementById('shuffleBtn');
    const label = document.getElementById('shuffleLabel');

    if (shuffleMode === 'off') {
        shuffleMode = 'shuffle';
        btn.dataset.shuffle = 'shuffle';
        label.textContent = 'shuffle on';
        buildShuffleQueue();
    } else if (shuffleMode === 'shuffle') {
        shuffleMode = 'smart';
        btn.dataset.shuffle = 'smart';
        label.textContent = 'smart shuffle';
        buildShuffleQueue();
        // Kick off radio recommendations from current song
        const song = songsData[currentSongIndex];
        if (song && song.youtube_id) {
            fetchRadioRecommendations(song.youtube_id);
        }
        smartShuffleNextIsRadio = false;
    } else {
        shuffleMode = 'off';
        btn.dataset.shuffle = 'off';
        label.textContent = 'shuffle';
        shuffleQueue = [];
        // Clear smart shuffle state (and a probe still running)
        resetRadio();
    }
}

function buildShuffleQueue() {
    // Create array of all indices except the current song (unless it
    // hasn't started: see currentRowStarted)
    shuffleQueue = [];
    const skip = currentRowStarted() ? currentSongIndex : -1;
    for (let i = 0; i < songsData.length; i++) {
        if (i !== skip) shuffleQueue.push(i);
    }
    // Fisher-Yates shuffle
    for (let i = shuffleQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]];
    }
}

function getRandomSongIndex() {
    if (songsData.length <= 1) return 0;
    pruneShuffleQueue();
    // If queue is empty, rebuild it
    if (shuffleQueue.length === 0) {
        buildShuffleQueue();
    }
    return shuffleQueue.shift();
}

// Drop queue entries that can't be the next song: the one already playing
// (switchSong would treat it as a no-op tap and playback would just stop)
// and indexes past the end of the playlist.
function pruneShuffleQueue() {
    const skip = currentRowStarted() ? currentSongIndex : -1;
    shuffleQueue = shuffleQueue.filter(i => i !== skip && i < songsData.length);
}

// ============================================================
// SMART SHUFFLE — RADIO PROBE & PLAYBACK
// ============================================================

function fetchRadioRecommendations(videoId) {
    if (isFetchingRadio || !videoId) return;
    pdbg('radio probe player created (smart shuffle)', videoId);
    isFetchingRadio = true;
    showRadioLoading(true);
    // A reset since (another playlist started, shuffle went off) makes this
    // probe stale: it then only clears its own timer and player.
    const gen = radioGen;

    // Create a fresh div for the probe (YT.Player replaces it with an iframe)
    let probeDiv = document.getElementById('radioProbe');
    if (probeDiv) probeDiv.remove();
    probeDiv = document.createElement('div');
    probeDiv.id = 'radioProbe';
    probeDiv.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;top:-9999px';
    document.body.appendChild(probeDiv);

    radioProbePlayer = new YT.Player('radioProbe', {
        height: '1',
        width: '1',
        playerVars: {
            listType: 'playlist',
            list: 'RD' + videoId,
            autoplay: 0,
            mute: 1
        },
        events: {
            onReady: function(event) {
                let attempts = 0;
                const poll = setInterval(() => {
                    if (gen !== radioGen) {
                        clearInterval(poll);
                        try { event.target.destroy(); } catch (x) {}
                        return;
                    }
                    attempts++;
                    try {
                        const playlist = event.target.getPlaylist();
                        if (playlist && playlist.length > 1) {
                            clearInterval(poll);
                            processRadioPlaylist(playlist, videoId, gen);
                            event.target.destroy();
                            radioProbePlayer = null;
                        } else if (attempts > 20) {
                            clearInterval(poll);
                            event.target.destroy();
                            radioProbePlayer = null;
                            isFetchingRadio = false;
                            showRadioLoading(false);
                        }
                    } catch(e) {
                        clearInterval(poll);
                        try { event.target.destroy(); } catch(x) {}
                        if (gen === radioGen) {
                            radioProbePlayer = null;
                            isFetchingRadio = false;
                            showRadioLoading(false);
                        }
                    }
                }, 500);
            },
            onError: function(event) {
                if (gen !== radioGen) {
                    try { event.target.destroy(); } catch (e) {}
                    return;
                }
                isFetchingRadio = false;
                showRadioLoading(false);
                try { if (radioProbePlayer) { radioProbePlayer.destroy(); } } catch(e) {}
                radioProbePlayer = null;
            }
        }
    });
}

function processRadioPlaylist(videoIds, sourceVideoId, gen = radioGen) {
    if (gen !== radioGen) return;
    // Filter out songs already in playlist and already in pool
    const existingIds = new Set(songsData.map(s => s.youtube_id));
    const poolIds = new Set(radioPool.map(s => s.youtube_id));
    const newIds = videoIds.filter(id => !existingIds.has(id) && !poolIds.has(id) && id !== sourceVideoId);

    // Take up to 8 new songs
    const toFetch = newIds.slice(0, 8);
    if (toFetch.length === 0) {
        isFetchingRadio = false;
        showRadioLoading(false);
        return;
    }

    fetchRadioMetadata(toFetch, gen);
}

// Fetch one video's oEmbed metadata and shape it as a song object
// (shared by the radio pool and the Discover shelf).
async function fetchOembedSong(videoId) {
    try {
        const resp = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (!resp.ok) return null;
        const data = await resp.json();
        // Parse "Artist - Title" format, fallback to full title
        let title = data.title || 'Unknown';
        let artist = data.author_name || 'Unknown';
        const dashIdx = title.indexOf(' - ');
        if (dashIdx > 0) {
            artist = title.substring(0, dashIdx).trim();
            title = title.substring(dashIdx + 3).trim();
        }
        // Clean common junk suffixes from YouTube titles. Only strip
        // qualified tokens ('official video', 'lyric video', 'audio') — a
        // BARE '(Video)'/'(Lyrics)' may be part of the real release name, so
        // it's preserved (matches the pre-refactor behavior; a saved title
        // must not silently lose part of its name).
        title = title
            .replace(/\s*[([]\s*official\s*(music\s*)?(video|audio|lyric\s*video)?\s*[)\]]/gi, '')
            .replace(/\s*[([]\s*(lyrics?|music)\s*video\s*[)\]]/gi, '')
            .replace(/\s*[([]\s*audio\s*[)\]]/gi, '')
            .trim();
        return { title, artist, cover: data.thumbnail_url || '', youtube_id: videoId };
    } catch (e) {
        return null;
    }
}

async function fetchRadioMetadata(videoIds, gen = radioGen) {
    for (const videoId of videoIds) {
        const song = await fetchOembedSong(videoId);
        if (gen !== radioGen) return; // picks for a context that's gone
        if (song) radioPool.push(song);
    }
    isFetchingRadio = false;
    showRadioLoading(false);
}

// The "finding songs…" row above the list follows the state (callers set
// isFetchingRadio first), and shows only above the playing list: the
// fetch belongs to what plays, not to a playlist that's only being viewed.
function syncRadioLoading() {
    const want = isFetchingRadio && listIsPlaying();
    let indicator = document.getElementById('radioLoadingIndicator');
    if (!indicator) {
        if (!want) return;
        indicator = document.createElement('div');
        indicator.id = 'radioLoadingIndicator';
        indicator.className = 'radio-loading';
        indicator.innerHTML = '<span class="radio-loading-dot"></span><span class="radio-loading-dot"></span><span class="radio-loading-dot"></span> finding songs...';
        const songList = document.getElementById('songList');
        if (!songList) return;
        songList.parentElement.insertBefore(indicator, songList);
    }
    indicator.style.display = want ? '' : 'none';
}
function showRadioLoading() {
    syncRadioLoading();
}

async function playRadioSong(song) {
    if (isChangingSong) return;
    isChangingSong = true;

    try {
        currentRadioSong = song;
        // Already in the list on screen: its row shows ✓, not a + that
        // would save it twice.
        currentRadioSongSaved = Array.isArray(songsData) && songsData.some((s) => songPlayKey(s) === songPlayKey(song));

        // Remove previous radio item, add new one
        removeRadioSidebarItem();
        addRadioSidebarItem(song);

        // Deactivate all playlist items in sidebar (a list that's only being
        // viewed has no playing row to begin with)
        if (listIsPlaying()) {
            document.querySelectorAll('.song-list-item:not(.radio-song-item)').forEach(item => item.classList.remove('active'));
        }

        // Animate the record change
        // Play vinyl crackle before song change. On phones the crackle still
        // plays, but delays the track start by at most 300ms.
        if (window.matchMedia('(max-width: 600px)').matches) {
            await Promise.race([playCrackleSound(), new Promise(r => setTimeout(r, 300))]);
        } else {
            await playCrackleSound();
        }
        await animateRecordChange(song);

        // Reset progress bar
        resetSleeveProgress();

        // Load in player
        playSongSource(song, false);

        updateAmpDisplay();
        loadLyricsForSong(song);
    } finally {
        isChangingSong = false;
    }
}

// The playing radio/preview/queue song, as the top row of the playing list
// (never of a playlist that's only being viewed).
function addRadioSidebarItem(song) {
    const songList = document.getElementById('songList');
    if (!songList || !listIsPlaying()) return;
    const li = document.createElement('li');
    li.className = 'song-list-item radio-song-item active';
    const radioCover = safeUrl(song.cover);
    const saveBtn = currentRadioSongSaved
        ? '<button class="song-save-btn" disabled title="Added to playlist">&#10003;</button>'
        : '<button class="song-save-btn" onclick="event.stopPropagation(); saveRadioSong()" title="Add to playlist">+</button>';
    li.innerHTML = `
        <div class="song-list-vinyl">
            <div class="song-list-vinyl-groove"></div>
            ${radioCover
                ? `<img class="song-list-cover" src="${escapeHtml(radioCover)}" alt="">`
                : `<div class="song-list-cover song-list-cover-empty">&#9834;</div>`
            }
            <div class="song-list-vinyl-hole"></div>
        </div>
        <div class="song-list-info">
            <div class="song-list-title">${escapeHtml(song.title)}</div>
            <div class="song-list-artist">${escapeHtml(song.artist)}</div>
            <div class="song-list-playing-indicator">
                <span></span><span></span><span></span><span></span>
            </div>
        </div>
        <span class="radio-badge" title="Recommended song">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
                <circle cx="4" cy="18" r="2"/>
            </svg>
        </span>
        <div class="song-actions">
            ${saveBtn}
        </div>
    `;
    songList.insertBefore(li, songList.firstChild);
}

function removeRadioSidebarItem() {
    const existing = document.querySelector('.radio-song-item');
    if (existing) existing.remove();
}

async function saveRadioSong() {
    if (!currentRadioSong) return;
    const song = {
        title: currentRadioSong.title,
        artist: currentRadioSong.artist,
        album: '',
        cover: currentRadioSong.cover,
        youtube_id: currentRadioSong.youtube_id
    };
    // The radio row only shows in the playing list: that's where it goes,
    // named now (another playlist may start playing before the answer).
    const id = String(activePlaylistId);

    let result;
    writeBegin(id);
    try {
        const response = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', song, playlist: id })
        });
        result = await response.json();
    } finally {
        writeEnd(id);
    }

    // joinList marks the radio row saved and re-adds it (✓) in a rebuild
    if (result.success && !joinList(id, song)) bumpSongCount(id);
}

// ============================================================
// DISCOVER — recommendations shelf at the end of the song list.
// Two sources: 'mix' harvests YouTube Mixes seeded from library songs
// (works with zero config, same engine as smart shuffle) and 'ai' asks
// the server's Gemini-backed /recommendations endpoint (enabled only
// when GEMINI_API_KEY is set). Rows preview via playRadioSong and save
// via the same add path as radio songs.
// ============================================================
let discoverMix = [];        // {title, artist, cover, youtube_id}
let discoverAI = [];         // {title, artist, reason, youtube_id?, cover?}
let discoverSource = 'mix';
let discoverLoading = false;
let discoverStarted = false;
let aiRecsEnabled = false;
let aiRecsLoaded = false;    // an AI fetch has reached a terminal state
let discoverMixUnavailable = false; // YT IFrame API never came up (e.g. RN app)
let discoverProbePlayer = null;

// Resolve once the YouTube IFrame API is usable. The api script loads
// asynchronously, so an early Discover trigger must wait for it; in the
// React Native app shell the native proxy is used and YT never loads, so
// this resolves false quickly rather than hanging.
function whenYouTubeReady(timeoutMs = 8000) {
    return new Promise((resolve) => {
        if (typeof YT !== 'undefined' && YT.Player) { resolve(true); return; }
        if (window.ReactNativeWebView) { resolve(false); return; }
        loadYouTubeAPI();
        const start = Date.now();
        const iv = setInterval(() => {
            if (typeof YT !== 'undefined' && YT.Player) { clearInterval(iv); resolve(true); }
            else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(false); }
        }, 200);
    });
}

// Harvest one YouTube Mix ('RD' + videoId) via an invisible probe player;
// resolves with the mix's video ids (or [] on any failure).
function discoverProbeMix(videoId) {
    return new Promise((resolve) => {
        if (typeof YT === 'undefined' || !YT.Player) { resolve([]); return; }
        pdbg('discover probe player created', videoId);
        let probeDiv = document.getElementById('discoverProbe');
        if (probeDiv) probeDiv.remove();
        probeDiv = document.createElement('div');
        probeDiv.id = 'discoverProbe';
        probeDiv.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;top:-9999px';
        document.body.appendChild(probeDiv);

        const finish = (ids) => {
            pdbg('discover probe finished', ids.length + ' songs');
            try { if (discoverProbePlayer) discoverProbePlayer.destroy(); } catch (e) {}
            discoverProbePlayer = null;
            resolve(ids);
        };

        try {
            discoverProbePlayer = new YT.Player('discoverProbe', {
                height: '1',
                width: '1',
                playerVars: { listType: 'playlist', list: 'RD' + videoId, autoplay: 0, mute: 1 },
                events: {
                    onReady: function (event) {
                        let attempts = 0;
                        const poll = setInterval(() => {
                            attempts++;
                            try {
                                const playlist = event.target.getPlaylist();
                                if (playlist && playlist.length > 1) {
                                    clearInterval(poll);
                                    finish(playlist);
                                } else if (attempts > 20) {
                                    clearInterval(poll);
                                    finish([]);
                                }
                            } catch (e) {
                                clearInterval(poll);
                                finish([]);
                            }
                        }, 500);
                    },
                    onError: function () { finish([]); }
                }
            });
        } catch (e) {
            finish([]);
        }
    });
}

async function fetchDiscoverSongs() {
    if (discoverLoading) return;
    // Seeded from (and deduped against) the list on screen
    const seeds = listSongs()
        .filter(s => s.youtube_id)
        .sort(() => Math.random() - 0.5)
        .slice(0, 2);

    discoverLoading = true;
    rebuildSongList();

    // No YouTube-sourced seeds, or the IFrame API isn't available here —
    // mark Mix unavailable so the shelf shows a truthful note, not a spinner.
    const ytReady = seeds.length > 0 && await whenYouTubeReady();
    if (!ytReady) {
        discoverMixUnavailable = true;
        discoverLoading = false;
        rebuildSongList();
        return;
    }
    discoverMixUnavailable = false;

    const harvested = [];
    for (const seed of seeds) {
        const ids = await discoverProbeMix(seed.youtube_id);
        harvested.push(...ids);
    }

    const libraryIds = new Set(listSongs().map(s => s.youtube_id));
    const seen = new Set();
    const fresh = harvested.filter(id => {
        if (!id || libraryIds.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    }).slice(0, 10);

    const pool = [];
    for (const id of fresh) {
        const song = await fetchOembedSong(id);
        if (song) pool.push(song);
    }

    discoverMix = pool;
    discoverLoading = false;
    rebuildSongList();
}

async function fetchAiRecommendations() {
    try {
        const resp = await fetch('/recommendations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await resp.json();
        if (data.enabled) {
            aiRecsEnabled = true;
            discoverAI = Array.isArray(data.suggestions) ? data.suggestions : [];
            aiRecsLoaded = true; // terminal: show real results or a truthful empty note
            rebuildSongList();
        }
    } catch (e) { /* endpoint unavailable — mix source still works */ }
}

function startDiscover() {
    if (discoverStarted) return;
    discoverStarted = true;
    fetchDiscoverSongs();
    fetchAiRecommendations();
}

window.refreshDiscover = function () {
    if (discoverSource === 'ai') {
        discoverAI = [];
        aiRecsLoaded = false;
        rebuildSongList();
        fetchAiRecommendations();
    } else {
        discoverMix = [];
        rebuildSongList(); // fetchDiscoverSongs may early-out; clear the stale rows now
        fetchDiscoverSongs();
    }
};

window.setDiscoverSource = function (src) {
    discoverSource = src === 'ai' ? 'ai' : 'mix';
    rebuildSongList();
};

// POST JSON to one of our own endpoints. The YouTube-backed ones are rate
// limited per user; on a 429 wait as long as the server says (Retry-After)
// and try again, up to `retries` times, so a long import slows down instead
// of reading as "no match". `onWait(seconds)` lets the caller say why it
// paused. A 429 that outlasts the retries comes back as { rateLimited: true }.
async function postJsonRetrying(url, body, { retries = 3, onWait, cancelled } = {}) {
    for (let attempt = 0; ; attempt++) {
        if (cancelled && cancelled()) return { success: false, cancelled: true };
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(body),
        });
        if (resp.status !== 429) return resp.json();
        if (attempt >= retries) {
            return { success: false, rateLimited: true, error: 'Too many searches right now: try again in a minute' };
        }
        const wait = Math.min(90, Math.max(1, parseInt(resp.headers.get('Retry-After'), 10) || 10));
        if (onWait) onWait(wait);
        await new Promise(resolve => setTimeout(resolve, wait * 1000));
    }
}

// AI suggestions arrive as title/artist only — resolve to a playable
// video on demand through the server's YouTube search.
async function resolveDiscoverItem(item) {
    if (item.youtube_id) return true;
    if (item._resolving) return false;
    item._resolving = true;
    try {
        const data = await postJsonRetrying('/search-youtube', { query: `${item.artist} ${item.title}` }, { retries: 1 });
        const hit = data.success && Array.isArray(data.results) ? data.results[0] : null;
        if (hit && hit.videoId) {
            item.youtube_id = hit.videoId;
            if (!item.cover) item.cover = hit.thumbnail || '';
            return true;
        }
    } catch (e) { /* fall through */ }
    finally { item._resolving = false; }
    return false;
}

function currentDiscoverList() {
    return discoverSource === 'ai' ? discoverAI : discoverMix;
}

window.discoverPlay = async function (i) {
    const item = currentDiscoverList()[i];
    if (!item) return;
    if (!(await resolveDiscoverItem(item))) return;
    playRadioSong({ title: item.title, artist: item.artist, cover: item.cover || '', youtube_id: item.youtube_id });
};

window.discoverAdd = async function (i, btn) {
    // The list the + was tapped in, named before the (possibly slow) lookup:
    // the user may have moved to another playlist by the time it's saved.
    const id = String(listId());
    const genAt = viewGen;
    const item = currentDiscoverList()[i];
    if (!item || item._saved || item._saving) return;
    // Guard the whole resolve+POST window: a resolved Mix item would
    // otherwise let a double-tap fire two adds before _saved is set.
    item._saving = true;
    try {
        if (!(await resolveDiscoverItem(item))) return;
        const song = { title: item.title, artist: item.artist, album: '', cover: item.cover || '', youtube_id: item.youtube_id };
        let result;
        writeBegin(id);
        try {
            const response = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', song, playlist: id }),
            });
            result = await response.json();
        } finally {
            writeEnd(id);
        }
        if (result.success) {
            item._saved = true;
            if (!joinList(id, song, { genAt })) bumpSongCount(id);
            // The shelf is shared by every list: show its ✓ wherever we are now.
            if (String(listId()) !== id && !listLoading()) rebuildSongList();
        }
    } finally {
        item._saving = false;
    }
};

function renderDiscoverSection() {
    const list = currentDiscoverList();
    const srcChips = aiRecsEnabled
        ? `<span class="discover-src">
             <button type="button" class="discover-src-btn${discoverSource === 'mix' ? ' active' : ''}" onclick="setDiscoverSource('mix')">Mix</button>
             <button type="button" class="discover-src-btn${discoverSource === 'ai' ? ' active' : ''}" onclick="setDiscoverSource('ai')">AI</button>
           </span>`
        : '';
    let html = `
        <li class="discover-header" id="discoverHeader">
            <span class="discover-label">Discover</span>
            ${srcChips}
            <button type="button" class="discover-refresh-btn" onclick="refreshDiscover()" title="New suggestions" aria-label="New suggestions">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
        </li>`;

    if (list.length === 0) {
        let note;
        if (discoverSource === 'ai') {
            // 'Thinking' only until a fetch has actually settled; after that
            // an empty list is a real "nothing" state, not a pending one.
            note = aiRecsLoaded ? 'No suggestions right now — try refresh' : 'Thinking&hellip;';
        } else if (discoverLoading) {
            note = 'finding songs&hellip;';
        } else if (discoverMixUnavailable) {
            note = 'Add a YouTube song to get mix suggestions';
        } else {
            note = 'Nothing found — try refresh';
        }
        html += `<li class="discover-note">${note}</li>`;
        return html;
    }

    html += list.map((item, i) => {
        const cover = item.cover
            ? `<img class="song-list-cover" src="${escapeHtml(safeUrl(item.cover))}" alt="" loading="lazy">`
            : `<div class="song-list-cover song-list-cover-empty">&#9834;</div>`;
        const sub = discoverSource === 'ai' && item.reason
            ? `<div class="discover-reason">${escapeHtml(item.reason)}</div>`
            : `<div class="song-list-artist">${escapeHtml(item.artist)}</div>`;
        return `
        <li class="song-list-item discover-item" onclick="discoverPlay(${i})">
            <div class="song-list-vinyl">
                <div class="song-list-vinyl-groove"></div>
                ${cover}
                <div class="song-list-vinyl-hole"></div>
            </div>
            <div class="song-list-info">
                <div class="song-list-title">${escapeHtml(item.title)}</div>
                ${sub}
            </div>
            <button type="button" class="discover-add-btn${item._saved ? ' saved' : ''}" onclick="event.stopPropagation(); discoverAdd(${i}, this)" title="Add to playlist" aria-label="Add to playlist">${item._saved ? '&#10003;' : '+'}</button>
        </li>`;
    }).join('');
    return html;
}

function playNextByLoop() {
    // Sleep timer set to "end of track" — stop here instead of auto-advancing.
    if (sleepEndOfTrack) { fireSleep(true); return; }
    // The queue plays before returning to the playlist/loop progression.
    if (playQueue.length > 0) { advanceFromQueue(); return; }
    if (loopMode === 'single') {
        // Replay current song (even if it's a radio song)
        if (ytPlayer && ytPlayer.seekTo) {
            ytPlayer.seekTo(0);
            ytPlayer.playVideo();
        }
        return;
    }
    if (songsData.length === 0) return;

    // 'playlist' and 'off' both keep going; 'off' plays the playlist through
    // once and stops instead of wrapping around to the start.
    if (loopMode === 'off' && playlistPlayedThrough()) {
        // Deal the next shuffled pass now (the song that just ended included),
        // so a row tapped or play pressed from here plays on again instead of
        // stopping after that one song.
        if (shuffleMode !== 'off') {
            buildShuffleQueue();
            shuffleQueue.push(currentSongIndex);
        }
        return;
    }

    // Smart shuffle: alternate playlist ↔ radio
    if (shuffleMode === 'smart' && smartShuffleNextIsRadio && radioPool.length > 0) {
        songHistory.push(currentRadioSong ? {type: 'radio', song: currentRadioSong} : currentSongIndex);
        const radioSong = radioPool.shift();
        smartShuffleNextIsRadio = false;
        playRadioSong(radioSong);
        return;
    }

    // Play next playlist song (shuffle-aware). A current row that hasn't
    // started (a leftover track just ended) is next itself.
    const nextIndex = shuffleMode !== 'off'
        ? getRandomSongIndex()
        : (currentRowStarted() ? (currentSongIndex + 1) % songsData.length : currentSongIndex);

    // A one-song playlist comes back to the song that just ended, which
    // switchSong ignores as "already playing" — start it over instead.
    if (nextIndex === currentSongIndex && !currentRadioSong && !currentRowUnloaded) {
        // Smart shuffle still mixes radio in: the only playlist song just
        // played, so radio is up. switchSong's pool refill never runs on a
        // one-song playlist, so top the pool up from here.
        if (shuffleMode === 'smart' && radioPool.length > 0) {
            songHistory.push(currentSongIndex);
            playRadioSong(radioPool.shift());
            return;
        }
        const only = songsData[currentSongIndex];
        if (shuffleMode === 'smart' && only && only.youtube_id) fetchRadioRecommendations(only.youtube_id);
        restartSong();
        return;
    }

    songHistory.push(currentRadioSong ? {type: 'radio', song: currentRadioSong} : currentSongIndex);
    if (shuffleMode === 'smart') {
        smartShuffleNextIsRadio = true;
    }

    switchSong(nextIndex);
}

// Loop 'off': has every playlist song had its turn? In order, that's the
// last row having played; shuffled, the shuffle queue being used up.
function playlistPlayedThrough() {
    if (!currentRowStarted()) return false; // a leftover track ended: this playlist hasn't begun
    if (shuffleMode === 'off') return currentSongIndex >= songsData.length - 1;
    pruneShuffleQueue();
    return shuffleQueue.length === 0;
}


// ============================================================
// SLEEP TIMER — fade out + pause after N minutes or end of track
// ============================================================

let sleepIntervalId = null;   // 1s countdown tick
let sleepDeadline = 0;        // epoch ms when the timer fires (0 = inactive)
let sleepEndOfTrack = false;  // true = stop when the current song ends

function toggleSleepMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('sleepMenu');
    if (menu) menu.hidden = !menu.hidden;
}

function setSleepTimer(mins) {
    const menu = document.getElementById('sleepMenu');
    if (menu) menu.hidden = true;
    clearSleepTimer(false);

    if (mins === 0) { updateSleepLabel(); return; } // Off

    if (mins === 'end') {
        sleepEndOfTrack = true;
        setSleepActive(true);
        updateSleepLabel();
        return;
    }

    sleepDeadline = Date.now() + mins * 60 * 1000;
    setSleepActive(true);
    sleepIntervalId = setInterval(() => {
        if (Date.now() >= sleepDeadline) { fireSleep(false); return; }
        updateSleepLabel();
    }, 1000);
    updateSleepLabel();
}

function clearSleepTimer(updateUi = true) {
    if (sleepIntervalId) { clearInterval(sleepIntervalId); sleepIntervalId = null; }
    sleepDeadline = 0;
    sleepEndOfTrack = false;
    setSleepActive(false);
    if (updateUi) updateSleepLabel();
}

function setSleepActive(on) {
    const btn = document.getElementById('sleepBtn');
    if (btn) btn.setAttribute('data-sleep', on ? 'on' : 'off');
}

function updateSleepLabel() {
    let countdown = '';
    if (sleepDeadline) {
        const totalSec = Math.max(0, Math.round((sleepDeadline - Date.now()) / 1000));
        countdown = Math.floor(totalSec / 60) + ':' + String(totalSec % 60).padStart(2, '0');
    }
    // Desktop coaster label.
    const label = document.getElementById('sleepLabel');
    if (label) label.textContent = sleepEndOfTrack ? 'end of track' : (countdown || 'sleep');
    // Now Playing's sleep button on phones: minutes left, or "End".
    const npSleep = document.getElementById('mNpSleep');
    if (npSleep) {
        const on = !!(sleepEndOfTrack || sleepDeadline);
        const mins = sleepDeadline ? Math.max(1, Math.ceil((sleepDeadline - Date.now()) / 60000)) : 0;
        npSleep.classList.toggle('is-on', on);
        npSleep.setAttribute('aria-label', sleepEndOfTrack ? 'Sleep timer: end of this song'
            : (mins ? `Sleep timer: ${mins} min left` : 'Sleep timer'));
        const npLabel = document.getElementById('mNpSleepLabel');
        if (npLabel) npLabel.textContent = sleepEndOfTrack ? 'End' : (mins ? mins + 'm' : '');
    }
    // The phone's sleep sheet, while it's open.
    if (typeof window.mSyncSleepSheet === 'function') window.mSyncSleepSheet();
    // Settings-modal status line (the mobile entry point's feedback).
    const hint = document.getElementById('sleepStatusHint');
    if (hint) {
        hint.textContent = sleepEndOfTrack
            ? 'Playback will pause when this track ends.'
            : (countdown ? 'Fading out and pausing in ' + countdown + '.'
                         : 'Fades the volume out and pauses when the timer ends.');
    }
}

// Stop playback. Timed fire fades the volume out first; an end-of-track fire
// just pauses (the song already finished). Volume is restored for next time.
function fireSleep(alreadyEnded) {
    const restore = (typeof currentVolume !== 'undefined') ? currentVolume : 100;
    clearSleepTimer(false);
    updateSleepLabel();

    if (alreadyEnded) {
        try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch (e) { /* no player */ }
        return;
    }

    let step = 0;
    const steps = 20;
    const fade = setInterval(() => {
        step++;
        setVolume(Math.max(0, Math.round(restore * (1 - step / steps))));
        if (step >= steps) {
            clearInterval(fade);
            try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch (e) { /* no player */ }
            setVolume(restore);
        }
    }, 200);
}

// Close the sleep menu when clicking anywhere outside it.
document.addEventListener('click', (e) => {
    const btn = document.getElementById('sleepBtn');
    const menu = document.getElementById('sleepMenu');
    if (menu && !menu.hidden && btn && !btn.contains(e.target)) menu.hidden = true;
});


// ============================================================
// CROSSFADE — smooth fade-out/fade-in between songs (single player)
// ============================================================

let crossfadeSeconds = parseInt(localStorage.getItem('crossfadeSeconds') || '0', 10) || 0;
let crossfadeInTimer = null;
let crossfadeFadingOut = false;

// Set the player's actual output volume WITHOUT touching the user's stored
// currentVolume, so a fade can ramp freely and restore to their setting.
function setPlayerVolumeRaw(v) {
    v = Math.min(100, Math.max(0, Math.round(v)));
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(v);
}

function setCrossfade(sec) {
    crossfadeSeconds = parseInt(sec, 10) || 0;
    try { localStorage.setItem('crossfadeSeconds', String(crossfadeSeconds)); } catch (e) { /* private mode */ }
    document.querySelectorAll('#crossfadeOptions .settings-source-btn').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.xf, 10) === crossfadeSeconds));
    // Cancel any in-flight fade and restore the user's volume immediately.
    if (crossfadeInTimer) { clearInterval(crossfadeInTimer); crossfadeInTimer = null; }
    crossfadeFadingOut = false;
    setPlayerVolumeRaw(currentVolume);
}

// Fade the newly-started track up from silence — called on every real start.
function crossfadeInStart() {
    if (!crossfadeSeconds) return;
    if (crossfadeInTimer) clearInterval(crossfadeInTimer);
    crossfadeFadingOut = false;
    const target = currentVolume;
    const stepMs = 80;
    const steps = Math.max(1, Math.round((crossfadeSeconds * 1000) / stepMs));
    let step = 0;
    setPlayerVolumeRaw(0);
    crossfadeInTimer = setInterval(() => {
        step++;
        setPlayerVolumeRaw(target * (step / steps));
        if (step >= steps) { clearInterval(crossfadeInTimer); crossfadeInTimer = null; setPlayerVolumeRaw(target); }
    }, stepMs);
}

// Fade the current track down as it nears its end. Driven by the 100ms
// sleeve-progress tick so the ramp tracks real playback time. Skipped for
// loop-single (the same song just restarts — a fade would leave it silent).
function crossfadeOutTick(current, duration) {
    if (!crossfadeSeconds || loopMode === 'single' || !duration) {
        if (crossfadeFadingOut) { crossfadeFadingOut = false; setPlayerVolumeRaw(currentVolume); }
        return;
    }
    const remaining = duration - current;
    if (remaining >= 0 && remaining <= crossfadeSeconds) {
        crossfadeFadingOut = true;
        setPlayerVolumeRaw(currentVolume * (remaining / crossfadeSeconds));
    } else if (crossfadeFadingOut) {
        crossfadeFadingOut = false;
        setPlayerVolumeRaw(currentVolume);
    }
}

// Switch the Settings modal's visible tab/panel.
function setSettingsTab(tab) {
    document.querySelectorAll('#settingsTabs .settings-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('#settingsModal .settings-panel').forEach(p =>
        p.classList.toggle('active', p.dataset.panel === tab));
}


// ============================================================
// UP-NEXT QUEUE — songs the user queues jump ahead of the playlist
// ============================================================

function songToQueueItem(song) {
    return {
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        cover: song.cover || '',
        youtube_id: song.youtube_id || '',
        mp3_url: song.mp3_url || '',
        spotify_id: song.spotify_id || '',
    };
}

// Add the playlist song at `index` to the end of the queue. ctx: which list
// the index is into (see songCtx).
function queueAdd(index, ctx) {
    const song = songCtx(ctx).songs[index];
    if (!song) return;
    playQueue.push(songToQueueItem(song));
    afterQueueChange();
    showToast('Added to queue');
    closeSendMenu();
}

// Insert the playlist song at `index` at the front of the queue.
function queuePlayNext(index, ctx) {
    const song = songCtx(ctx).songs[index];
    if (!song) return;
    playQueue.unshift(songToQueueItem(song));
    afterQueueChange();
    showToast('Playing next');
    closeSendMenu();
}

// Shared advance: log history, pop the head, play it (from nextSong /
// playNextByLoop when the queue is non-empty).
function advanceFromQueue() {
    songHistory.push(currentRadioSong ? { type: 'radio', song: currentRadioSong } : currentSongIndex);
    const q = playQueue.shift();
    afterQueueChange();
    playFromQueue(q);
}

// Play a queued song now. Reuses the one-off radio path, which leaves the
// playlist's currentSongIndex untouched so it resumes once the queue drains.
function playFromQueue(song) {
    if (song) playRadioSong(song);
}

function afterQueueChange() {
    updateQueueBadge();
    renderQueue();
    saveQueue();
}

const QUEUE_STORAGE_KEY = 'playQueue';

function saveQueue() {
    try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(playQueue)); } catch (e) { /* private mode / quota */ }
}

// Restore the queue from a previous session (device-local). Normalizes each
// entry to the queue-item shape and caps the length defensively.
function restoreQueue() {
    try {
        const parsed = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || '[]');
        if (Array.isArray(parsed)) {
            playQueue = parsed
                .filter(s => s && typeof s === 'object' && s.title)
                .slice(0, 200)
                .map(songToQueueItem);
        }
    } catch (e) { playQueue = []; }
    updateQueueBadge();
}

function updateQueueBadge() {
    const npCount = document.getElementById('mNpQueueCount');
    if (npCount) {
        npCount.textContent = playQueue.length;
        npCount.hidden = playQueue.length === 0;
        const btn = document.getElementById('mNpQueue');
        if (btn) btn.setAttribute('aria-label', playQueue.length ? `Up next: ${playQueue.length} queued` : 'Up next');
    }
    const badge = document.getElementById('queueCountBadge');
    if (!badge) return;
    badge.textContent = playQueue.length;
    badge.style.display = playQueue.length > 0 ? '' : 'none';
}

function openQueueModal() {
    const modal = document.getElementById('queueModal');
    if (!modal) return;
    renderQueue();
    modal.classList.add('active');
}

function hideQueueModal() {
    const modal = document.getElementById('queueModal');
    if (modal) modal.classList.remove('active');
}

function clearQueue() {
    playQueue = [];
    afterQueueChange();
}

function removeFromQueue(i) {
    if (i >= 0 && i < playQueue.length) {
        playQueue.splice(i, 1);
        afterQueueChange();
    }
}

// Tap a queued song to jump to it now — drops the ones before it.
function playQueueItem(i) {
    if (i < 0 || i >= playQueue.length) return;
    const item = playQueue[i];
    playQueue.splice(0, i + 1);
    afterQueueChange();
    playFromQueue(item);
}

// Drag-to-reorder within the queue (pointer-based, mouse + touch). Reorders the
// DOM live via insertBefore; on release rebuilds playQueue to match.
function startQueueDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    const list = document.querySelector('#queueBody .queue-list');
    const li = e.currentTarget.closest('.queue-item');
    if (!list || !li) return;
    li.classList.add('dragging');

    const move = (ev) => {
        const y = ev.clientY;
        const others = [...list.querySelectorAll('.queue-item')].filter(r => r !== li);
        let placed = false;
        for (const r of others) {
            const rect = r.getBoundingClientRect();
            if (y < rect.top + rect.height / 2) { list.insertBefore(li, r); placed = true; break; }
        }
        if (!placed && others.length) others[others.length - 1].after(li);
    };
    const end = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        li.classList.remove('dragging');
        finishQueueDrag();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
}

function finishQueueDrag() {
    const list = document.querySelector('#queueBody .queue-list');
    if (!list) return;
    const order = [...list.querySelectorAll('.queue-item')].map(el => parseInt(el.getAttribute('data-qindex'), 10));
    if (order.length !== playQueue.length || order.some(isNaN)) { renderQueue(); return; }
    if (order.every((v, i) => v === i)) return; // no change
    playQueue = order.map(qi => playQueue[qi]);
    afterQueueChange(); // re-renders (fresh indices), updates badge, persists
}

function queueCoverHtml(song, cls) {
    const cover = safeUrl(song.cover);
    return cover
        ? `<img class="${cls}" src="${escapeHtml(cover)}" alt="" loading="lazy">`
        : `<div class="${cls} queue-cover-empty"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></div>`;
}

function renderQueue() {
    const body = document.getElementById('queueBody');
    if (!body) return;
    const nowSong = currentRadioSong || (Array.isArray(songsData) ? songsData[currentSongIndex] : null);
    const nowHtml = nowSong ? `
        <div class="queue-section-label">Now playing</div>
        <div class="queue-now">
            ${queueCoverHtml(nowSong, 'queue-now-cover')}
            <div class="queue-item-info">
                <div class="queue-item-title">${escapeHtml(nowSong.title || '')}</div>
                <div class="queue-item-artist">${escapeHtml(nowSong.artist || '')}</div>
            </div>
        </div>` : '';

    let listHtml;
    if (playQueue.length === 0) {
        listHtml = `<div class="queue-empty">Nothing queued yet. Open any song's menu and choose “Play next” or “Add to queue.”</div>`;
    } else {
        listHtml = `
            <div class="queue-section-head">
                <span class="queue-section-label">Up next · ${playQueue.length}</span>
                <button type="button" class="queue-clear-btn" onclick="clearQueue()">Clear</button>
            </div>
            <ol class="queue-list">
                ${playQueue.map((s, i) => `
                    <li class="queue-item" data-qindex="${i}">
                        <span class="queue-drag-handle" title="Drag to reorder" onpointerdown="startQueueDrag(event)" onclick="event.stopPropagation()">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
                        </span>
                        <button type="button" class="queue-item-play" onclick="playQueueItem(${i})" title="Play now">
                            ${queueCoverHtml(s, 'queue-item-cover')}
                            <span class="queue-item-playicon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></span>
                        </button>
                        <div class="queue-item-info" onclick="playQueueItem(${i})">
                            <div class="queue-item-title">${escapeHtml(s.title || '')}</div>
                            <div class="queue-item-artist">${escapeHtml(s.artist || '')}</div>
                        </div>
                        <button type="button" class="queue-item-remove" onclick="removeFromQueue(${i})" title="Remove" aria-label="Remove">&times;</button>
                    </li>`).join('')}
            </ol>`;
    }
    body.innerHTML = nowHtml + listHtml;
}

// Lightweight client toast (reuses the .app-flash styling).
let toastTimer = null;
function showToast(msg) {
    // The phone shell's toasts sit above the mini player (not over its top
    // bars or a camera cutout)
    if (window.mToast && document.documentElement.dataset.mTab && window.matchMedia('(max-width: 600px)').matches) {
        window.mToast(msg);
        return;
    }
    let t = document.getElementById('clientToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'clientToast';
        t.className = 'app-flash app-flash-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = '';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (t) t.style.display = 'none'; }, 2200);
}

// The browser refused to start a song nobody tapped for. That mostly happens
// with the phone locked or the browser in the background, where a toast
// would come and go unseen — so hold it until the page is back in view, and
// drop it if playback got going in the meantime.
let playBlockedHintPending = false;
function showPlayBlockedHint() {
    if (!document.hidden) { showToast('Tap play to continue'); return; }
    if (playBlockedHintPending) return;
    playBlockedHintPending = true;
    document.addEventListener('visibilitychange', function onVisible() {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', onVisible);
        playBlockedHintPending = false;
        if (!ytPlayer || !ytPlayer.getPlayerState || ytPlayer.getPlayerState() !== 1) {
            showToast('Tap play to continue');
        }
    });
}

// YouTube IFrame API
let ytPlayer;
let ytPlayerReady = false;
let pendingPlay = false;

function onYouTubeIframeAPIReady() {
    const player = new YT.Player('youtubePlayer', {
        height: '225',
        width: '400',
        playerVars: {
            'playsinline': 1,
            'rel': 0,
            'modestbranding': 1,
            'origin': window.location.origin
        },
        events: {
            'onReady': function(event) {
                // The API only installs the player methods once ready, so
                // the debug wrappers go on here, before the initial cue.
                window.__pdbgAttach(event.target);
                ytPlayerReady = true;
                // Set volume
                if (typeof currentVolume !== 'undefined') {
                    event.target.setVolume(currentVolume);
                }
                // If user already clicked play before player was ready, start now
                if (pendingPlay) {
                    pendingPlay = false;
                    const song = currentRadioSong || songsData[currentSongIndex];
                    const source = getPlaybackSource(song);
                    if (song && source) {
                        if (songUsesMp3(song)) {
                            playSongSource(song, false);
                        } else {
                            noteSongRequest(song, true);
                            event.target.loadVideoById(source);
                        }
                    }
                } else {
                    // Cue initial song (no autoplay)
                    const currentSong = songsData[currentSongIndex];
                    const source = getPlaybackSource(currentSong);
                    if (currentSong && source) {
                        if (songUsesMp3(currentSong)) {
                            playSongSource(currentSong, true);
                        } else {
                            noteSongRequest(currentSong, false);
                            event.target.cueVideoById(source);
                        }
                    }
                }
            },
            'onStateChange': onPlayerStateChange,
            // The browser refused to start a song nobody tapped for (e.g. an
            // auto-advance on a phone). It's loaded and waiting — say so
            // rather than looking like the player just stopped.
            'onAutoplayBlocked': showPlayBlockedHint,
            'onError': function(event) {
                console.warn('YouTube player error:', event.data);
                if (ytPlayer === ytPlayerReal) handleUnplayableSong(lastRequestedSong, youtubeErrorReason(event.data));
            }
        }
    });
    ytPlayer = player;
    ytPlayerReal = player;
}

function onPlayerStateChange(event) {
    const vinyl = document.getElementById('vinyl');
    const tonearm = document.getElementById('tonearm');
    const playBtn = document.getElementById('playBtn');
    const platterVinyl = document.getElementById('platterVinyl');
    const miniTonearm = document.getElementById('miniTonearm');
    const led = document.getElementById('turntableLed');
    const eqVis = document.getElementById('playerEqVis');

    // Keep the lock-screen play/pause button in sync (buffering between
    // songs still counts as playing, so the controls don't flicker)
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState =
            (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.BUFFERING) ? 'playing' : 'paused';
    }
    // …and keep the headset/notification controls on this page (see mediaSessionKeeper).
    mediaSessionKeeper.sync(event.data);

    var isApp = !!window.ReactNativeWebView;

    if (event.data === YT.PlayerState.PLAYING) {
        // It plays after all: clear the failure run and any "can't play" flag.
        unplayableStreak = 0;
        if (lastRequestedSong && lastRequestedSong._unplayable) {
            delete lastRequestedSong._unplayable;
            const idx = listIsPlaying() ? songsData.indexOf(lastRequestedSong) : -1;
            const row = idx >= 0 ? document.querySelector(`#songList .song-list-item[data-index="${idx}"]`) : null;
            if (row) { row.classList.remove('song-unplayable'); row.removeAttribute('title'); }
        }
        if (vinyl) vinyl.classList.add('playing');
        if (tonearm) tonearm.classList.add('playing');
        if (platterVinyl) platterVinyl.classList.add('spinning');
        if (miniTonearm) miniTonearm.classList.add('playing');
        if (led) led.classList.add('on');
        if (eqVis) eqVis.classList.add('active');
        if (playBtn) {
            if (isApp) { playBtn.textContent = '||'; } else { playBtn.innerHTML = PAUSE_SVG; }
            playBtn.classList.add('playing');
        }
        startSleeveProgress();
        maybeRefineLyricsWithDuration();
    } else if (event.data === YT.PlayerState.ENDED) {
        if (vinyl) vinyl.classList.remove('playing');
        if (tonearm) tonearm.classList.remove('playing');
        if (platterVinyl) platterVinyl.classList.remove('spinning');
        if (miniTonearm) miniTonearm.classList.remove('playing');
        if (led) led.classList.remove('on');
        if (eqVis) eqVis.classList.remove('active');
        if (playBtn) {
            if (isApp) { playBtn.textContent = '\u25B6'; } else { playBtn.innerHTML = PLAY_SVG; }
            playBtn.classList.remove('playing');
        }
        stopSleeveProgress();
        playNextByLoop();
    } else {
        if (vinyl) vinyl.classList.remove('playing');
        if (tonearm) tonearm.classList.remove('playing');
        if (platterVinyl) platterVinyl.classList.remove('spinning');
        if (miniTonearm) miniTonearm.classList.remove('playing');
        if (led) led.classList.remove('on');
        if (eqVis) eqVis.classList.remove('active');
        if (playBtn) {
            if (isApp) { playBtn.textContent = '\u25B6'; } else { playBtn.innerHTML = PLAY_SVG; }
            playBtn.classList.remove('playing');
        }
        stopSleeveProgress();
        updateSleeveProgress();
    }
}

// ============================================================
// SLEEVE TIMELINE / PROGRESS BAR
// ============================================================

let sleeveProgressInterval = null;

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m + ':' + String(s).padStart(2, '0');
}

let mPositionStateTick = 0;

function updateSleeveProgress() {
    // While a finger is scrubbing the bar, the mobile module owns the fill
    // preview — the 100ms tick must not fight it.
    if (window.__mScrubbing) return;
    if (!ytPlayer || !ytPlayer.getCurrentTime || !ytPlayer.getDuration) return;
    const current = ytPlayer.getCurrentTime();
    const duration = ytPlayer.getDuration();
    if (!duration) return;

    // Lock-screen scrubber position, ~once per second
    if (++mPositionStateTick >= 10) {
        mPositionStateTick = 0;
        if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
            try {
                navigator.mediaSession.setPositionState({
                    duration: duration,
                    position: Math.min(current, duration),
                    playbackRate: 1,
                });
            } catch (e) {}
        }
    }

    const pct = Math.min((current / duration) * 100, 100);
    const fill = document.getElementById('sleeveProgressFill');
    const knob = document.getElementById('sleeveProgressKnob');
    const elapsedEl = document.getElementById('sleeveTimeElapsed');
    const totalEl = document.getElementById('sleeveTimeTotal');

    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    if (elapsedEl) elapsedEl.textContent = formatTime(current);
    if (totalEl) totalEl.textContent = formatTime(duration);

    // Mobile dock groove (display:none on desktop; the write is harmless)
    const dockProgress = document.getElementById('mDockProgress');
    if (dockProgress) dockProgress.style.transform = 'scaleX(' + (pct / 100) + ')';

    crossfadeOutTick(current, duration);
    updateActiveLyric();
}

function startSleeveProgress() {
    stopSleeveProgress();
    updateSleeveProgress();
    sleeveProgressInterval = setInterval(updateSleeveProgress, 100);
}

function stopSleeveProgress() {
    if (sleeveProgressInterval) {
        clearInterval(sleeveProgressInterval);
        sleeveProgressInterval = null;
    }
}

function resetSleeveProgress() {
    const fill = document.getElementById('sleeveProgressFill');
    const knob = document.getElementById('sleeveProgressKnob');
    const elapsedEl = document.getElementById('sleeveTimeElapsed');
    const totalEl = document.getElementById('sleeveTimeTotal');
    if (fill) fill.style.width = '0%';
    if (knob) knob.style.left = '0%';
    if (elapsedEl) elapsedEl.textContent = '0:00';
    if (totalEl) totalEl.textContent = '0:00';
}

// Click-to-seek on progress bar
document.getElementById('sleeveProgressBar')?.addEventListener('click', function(e) {
    if (!ytPlayer || !ytPlayer.getDuration) return;
    const rect = this.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTo = pct * ytPlayer.getDuration();
    ytPlayer.seekTo(seekTo, true);
    updateSleeveProgress();
});

// ============================================================
// SYNCED LYRICS (LRCLIB)
// ============================================================

const lyricsCache = {};
let currentLyrics = null; // array of {time, text} or null
let activeLyricIndex = -1;
let lyricsRequestId = 0; // guards against stale lyrics from previous songs

// User settings: global on/off plus a per-song sync offset (seconds added to
// playback time — positive shows lyrics sooner). Both survive reloads.
let lyricsEnabled = localStorage.getItem('lyricsEnabled') !== '0';
let lyricsOffsets = {};
try { lyricsOffsets = JSON.parse(localStorage.getItem('lyricsOffsets') || '{}') || {}; } catch (e) {}
let currentLyricsOffset = 0;

function lyricsOffsetKey(song) {
    return `${song.artist}|||${song.title}`;
}

function parseLRC(lrcString) {
    const lines = lrcString.split('\n');
    const result = [];
    for (const line of lines) {
        const match = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)/);
        if (match) {
            const mins = parseInt(match[1]);
            const secs = parseInt(match[2]);
            const ms = match[3].length === 2 ? parseInt(match[3]) * 10 : parseInt(match[3]);
            const time = mins * 60 + secs + ms / 1000;
            const text = match[4].trim();
            if (text) result.push({ time, text });
        }
    }
    return result.sort((a, b) => a.time - b.time);
}

// Strip YouTube-title junk that hurts LRCLIB search recall.
// Version descriptors like (Live) or (Acoustic) are kept on purpose —
// they identify which lyrics/timings we actually want.
function cleanTrackTitle(title) {
    return (title || '')
        .replace(/\s*[\(\[][^\)\]]*official[^\)\]]*[\)\]]/gi, '')
        .replace(/\s*[\(\[][^\)\]]*(music\s*video|lyric(s)?(\s*video)?|visuali[sz]er|video\s*clip|videoclip|audio|hd|4k|hq)[^\)\]]*[\)\]]/gi, '')
        .replace(/\s*[\(\[]\s*(feat|ft)\.?[^\)\]]*[\)\]]/gi, '')
        .replace(/\s+(feat|ft)\.?\s+.+$/i, '')
        .replace(/\s*\|.*$/, '')
        .replace(/["“”]/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim() || title;
}

function cleanArtistName(artist) {
    return (artist || '')
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/VEVO$/i, '')
        .replace(/\s*[\(\[]\s*(feat|ft)\.?[^\)\]]*[\)\]]/gi, '')
        .replace(/\s+(feat|ft)\.?\s+.+$/i, '')
        .trim() || artist;
}

async function lrclibSearch(params) {
    const resp = await fetch(`https://lrclib.net/api/search?${new URLSearchParams(params)}`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
}

// LRCLIB reports each entry's duration; the YouTube video's duration tells us
// which version (album/live/sped-up) we're actually playing.
const LYRICS_DURATION_TOLERANCE = 7; // seconds

function pickBestLyricsResult(results, duration) {
    if (!results.length) return null;
    const byCloseness = (a, b) => Math.abs(a.duration - duration) - Math.abs(b.duration - duration);
    const synced = results.filter(r => r.syncedLyrics);
    const plain = results.filter(r => !r.syncedLyrics && r.plainLyrics);

    if (duration > 0) {
        const syncedSorted = synced.filter(r => typeof r.duration === 'number').sort(byCloseness);
        const closest = syncedSorted[0];
        // Right version with timings — ideal.
        if (closest && Math.abs(closest.duration - duration) <= LYRICS_DURATION_TOLERANCE) return closest;
        // Slightly-off synced still beats plain text; badly-off would desync
        // the karaoke view, so fall back to a plain match of the right version.
        if (closest && Math.abs(closest.duration - duration) <= 20) return closest;
        const plainMatch = plain.find(r =>
            typeof r.duration === 'number' && Math.abs(r.duration - duration) <= LYRICS_DURATION_TOLERANCE);
        if (plainMatch) return plainMatch;
        if (closest) return closest;
    }
    return synced[0] || results[0];
}

async function fetchLyrics(title, artist, duration = 0) {
    const cacheKey = `${artist}|||${title}`;
    const cached = lyricsCache[cacheKey];
    if (cached !== undefined) {
        // Re-run the search once we know the real duration and it disagrees
        // with what a duration-less fetch picked (likely wrong version).
        const needsRecheck = cached && !cached.matchedWithDuration && duration > 0
            && typeof cached.sourceDuration === 'number'
            && Math.abs(cached.sourceDuration - duration) > LYRICS_DURATION_TOLERANCE;
        if (!needsRecheck) return cached;
    }

    const cleanTitle = cleanTrackTitle(title);
    const cleanArtist = cleanArtistName(artist);

    try {
        let results = await lrclibSearch({ track_name: cleanTitle, artist_name: cleanArtist });
        if (!results.length && (cleanTitle !== title || cleanArtist !== artist)) {
            results = await lrclibSearch({ track_name: title, artist_name: artist });
        }
        if (!results.length) {
            // Loosest pass: full-text query, catches swapped/joined fields.
            results = await lrclibSearch({ q: `${cleanArtist} ${cleanTitle}` });
        }

        const best = pickBestLyricsResult(results, duration);
        let result = null;
        if (best && best.syncedLyrics) {
            const parsed = parseLRC(best.syncedLyrics);
            if (parsed.length > 0) result = { type: 'synced', lines: parsed };
        }
        if (!result && best && best.plainLyrics) {
            result = { type: 'plain', text: best.plainLyrics };
        }
        if (result) {
            result.sourceDuration = typeof best.duration === 'number' ? best.duration : null;
            result.matchedWithDuration = duration > 0;
        }
        lyricsCache[cacheKey] = result;
        return result;
    } catch (e) {
        // Network hiccup: leave the cache empty so a later attempt can retry.
        return cached !== undefined ? cached : null;
    }
}

// DOM refs and word weights are cached at render time so the 100ms playback
// tick never has to query or measure the DOM — repeated querySelectorAll over
// every line/word caused an audible hitch on each line change once most songs
// started getting synced lyrics.
let lyricsLineEls = [];

function renderLyrics(lyrics, placeholderText = 'No lyrics available') {
    const container = document.getElementById('sleeveLyrics');
    if (!container) return;
    container.innerHTML = '';
    activeLyricIndex = -1;
    lyricsLineEls = [];

    if (!lyrics) {
        currentLyrics = null;
        const placeholder = document.createElement('div');
        placeholder.className = 'lyrics-placeholder';
        placeholder.textContent = placeholderText;
        container.appendChild(placeholder);
        updateLyricsControls();
        return;
    }

    if (lyrics.type === 'plain') {
        // Render plain lyrics as individual lines so they get the same styling
        currentLyrics = null;
        const plainLines = lyrics.text.split('\n').filter(l => l.trim());
        plainLines.forEach(text => {
            const div = document.createElement('div');
            div.className = 'lyrics-line lyrics-line-plain';
            div.textContent = text;
            container.appendChild(div);
        });
        updateLyricsControls();
        return;
    }

    // Synced lyrics — whole-line highlighting driven by LRCLIB's real
    // per-line timestamps (word-level sweep was estimated and often wrong).
    currentLyrics = lyrics.lines;
    lyrics.lines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'lyrics-line';
        div.dataset.index = i;
        div.textContent = line.text;

        div.addEventListener('click', () => {
            if (ytPlayer && ytPlayer.seekTo) {
                ytPlayer.seekTo(Math.max(0, line.time - currentLyricsOffset), true);
                updateSleeveProgress();
            }
        });
        container.appendChild(div);
        lyricsLineEls.push(div);
    });
    updateLyricsControls();
}

function updateActiveLyric() {
    if (!currentLyrics || !ytPlayer || !ytPlayer.getCurrentTime) return;
    const time = ytPlayer.getCurrentTime() + currentLyricsOffset;
    let newIndex = -1;
    for (let i = currentLyrics.length - 1; i >= 0; i--) {
        if (time >= currentLyrics[i].time) {
            newIndex = i;
            break;
        }
    }

    const lines = lyricsLineEls;
    if (!lines.length) return;

    if (newIndex !== activeLyricIndex) {
        const prevIndex = activeLyricIndex;
        activeLyricIndex = newIndex;

        // Only touch the two lines that changed — never the whole list
        if (prevIndex >= 0 && lines[prevIndex]) {
            lines[prevIndex].classList.remove('active');
        }
        if (newIndex >= 0 && lines[newIndex]) {
            lines[newIndex].classList.add('active');
            const container = document.getElementById('sleeveLyrics');
            if (container) {
                const scrollTarget = lines[newIndex].offsetTop - container.offsetTop - container.clientHeight / 2 + lines[newIndex].offsetHeight / 2;
                container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
            }
        }
    }
}

// Un-highlight the current line and forget the position. Needed anywhere
// that resets activeLyricIndex directly: updateActiveLyric only touches
// the lines that changed, so it won't clean up after a hard reset.
function clearActiveLyricHighlight() {
    if (activeLyricIndex >= 0 && lyricsLineEls[activeLyricIndex]) {
        lyricsLineEls[activeLyricIndex].classList.remove('active');
    }
    activeLyricIndex = -1;
}

function showLyricsLoading() {
    const container = document.getElementById('sleeveLyrics');
    if (!container) return;
    container.innerHTML = '<div class="lyrics-placeholder">Loading lyrics...</div>';
    currentLyrics = null;
    activeLyricIndex = -1;
    lyricsLineEls = [];
}

let currentLyricsResult = null; // last fetch result for the song on the platter

async function loadLyricsForSong(song, duration = 0, isRefine = false) {
    if (!song || !song.title || !song.artist) {
        currentLyricsResult = null;
        renderLyrics(null);
        return;
    }
    currentLyricsOffset = lyricsOffsets[lyricsOffsetKey(song)] || 0;
    if (!lyricsEnabled) {
        lyricsRequestId++; // cancel any in-flight fetch's render
        currentLyricsResult = null;
        renderLyrics(null, 'Lyrics are off');
        return;
    }
    const requestId = ++lyricsRequestId;
    // Refines happen mid-song over already-visible lyrics — no loading flash
    if (!isRefine) showLyricsLoading();
    const lyrics = await fetchLyrics(song.title, song.artist, duration);
    // Only render if this is still the active request (prevents stale lyrics)
    if (requestId === lyricsRequestId) {
        // A refine that lands on the same pick has nothing new to show;
        // skipping the render avoids a visible blink and scroll reset.
        const unchanged = isRefine && lyrics === currentLyricsResult;
        currentLyricsResult = lyrics;
        if (!unchanged) renderLyrics(lyrics);
    }
}

function updateLyricsControls() {
    const controls = document.getElementById('lyricsControls');
    if (!controls) return;
    controls.classList.toggle('no-sync', !currentLyrics);
    const toggle = document.getElementById('lyricsToggleBtn');
    if (toggle) toggle.classList.toggle('off', !lyricsEnabled);
    const val = document.getElementById('lyricsOffsetValue');
    if (val) val.textContent = (currentLyricsOffset > 0 ? '+' : '') + currentLyricsOffset + 's';
}

function adjustLyricsOffset(delta) {
    const song = currentRadioSong || songsData[currentSongIndex];
    if (!song || !currentLyrics) return;
    // 0.5s steps, clamped — enough to counter intros/edits without hunting
    currentLyricsOffset = Math.max(-10, Math.min(10, Math.round((currentLyricsOffset + delta) * 2) / 2));
    const key = lyricsOffsetKey(song);
    if (currentLyricsOffset === 0) {
        delete lyricsOffsets[key];
    } else {
        lyricsOffsets[key] = currentLyricsOffset;
    }
    try { localStorage.setItem('lyricsOffsets', JSON.stringify(lyricsOffsets)); } catch (e) {}
    updateLyricsControls();
    updateActiveLyric();
}

function toggleLyrics() {
    lyricsEnabled = !lyricsEnabled;
    localStorage.setItem('lyricsEnabled', lyricsEnabled ? '1' : '0');
    const song = currentRadioSong || songsData[currentSongIndex];
    if (song) {
        const dur = lyricsEnabled && ytPlayer && ytPlayer.getDuration ? (ytPlayer.getDuration() || 0) : 0;
        loadLyricsForSong(song, dur);
    } else {
        renderLyrics(null, lyricsEnabled ? 'Play a song to see lyrics' : 'Lyrics are off');
    }
    updateLyricsControls();
}

// Wire up the lyric controls (script loads at end of body, DOM is ready)
(function initLyricsControls() {
    const minus = document.getElementById('lyricsOffsetMinus');
    const plus = document.getElementById('lyricsOffsetPlus');
    const val = document.getElementById('lyricsOffsetValue');
    const toggle = document.getElementById('lyricsToggleBtn');
    if (minus) minus.addEventListener('click', () => adjustLyricsOffset(-0.5));
    if (plus) plus.addEventListener('click', () => adjustLyricsOffset(0.5));
    if (val) val.addEventListener('click', () => adjustLyricsOffset(-currentLyricsOffset));
    if (toggle) toggle.addEventListener('click', toggleLyrics);
    updateLyricsControls();
})();

// Once playback starts we finally know the video's real duration; if the
// duration-less fetch picked a different version, redo the search with it.
function maybeRefineLyricsWithDuration() {
    const song = currentRadioSong || songsData[currentSongIndex];
    if (!song || !currentLyricsResult || currentLyricsResult.matchedWithDuration) return;
    const duration = ytPlayer && ytPlayer.getDuration ? ytPlayer.getDuration() : 0;
    if (!duration) return;
    if (typeof currentLyricsResult.sourceDuration !== 'number'
        || Math.abs(currentLyricsResult.sourceDuration - duration) <= LYRICS_DURATION_TOLERANCE) {
        // The guess already agrees with reality (or can't be compared) —
        // lock it in so this doesn't re-run on every play/resume.
        currentLyricsResult.matchedWithDuration = true;
        return;
    }
    loadLyricsForSong(song, duration, true);
}

function updateAmpDisplay() {
    const song = currentRadioSong || songsData[currentSongIndex];
    const el = document.getElementById('ampDisplayText');
    if (!song || !el) return;
    const text = (currentRadioSong ? 'RADIO · ' : '') + [song.artist, song.title].filter(Boolean).join(' - ');
    el.textContent = text;
    el.classList.remove('scrolling');
    // Check if text overflows the display
    requestAnimationFrame(() => {
        const parent = el.parentElement;
        if (el.scrollWidth > parent.clientWidth) {
            el.style.setProperty('--scroll-distance', -(el.scrollWidth - parent.clientWidth + 8) + 'px');
            el.classList.add('scrolling');
        }
    });

    // Update small turntable cover
    const platterLabel = document.getElementById('platterLabel');
    if (platterLabel) {
        const platterCover = safeUrl(song.cover);
        if (platterCover) {
            platterLabel.innerHTML = `<img src="${escapeHtml(platterCover)}" alt="">`;
        } else {
            platterLabel.innerHTML = '';
        }
    }
}

// The now-playing text appears in two places (control bay on desktop, sleeve
// bar on phones) — update every instance, not just the first.
function setNowPlayingText(title, artist, album) {
    document.querySelectorAll('.song-title').forEach(el => el.textContent = title);
    document.querySelectorAll('.song-artist').forEach(el => el.textContent = artist);
    document.querySelectorAll('.song-album').forEach(el => el.textContent = album);
}

// Init amp display scroll on load
document.addEventListener('DOMContentLoaded', () => {
    updateAmpDisplay();
    if (shuffleMode !== 'off') buildShuffleQueue();
    // Returning from Spotify OAuth: refresh the connection state, and after a
    // fresh "Continue with Spotify" sign-in go straight to the library import.
    const spotifyReturn = new URLSearchParams(window.location.search).get('spotify');
    if (spotifyReturn === 'connected') {
        checkSpotifyStatus();
    } else if (spotifyReturn === 'signed-in') {
        checkSpotifyStatus().then(() => { showSpotifyImportModal(); setImportTab('spotify'); });
    } else if (spotifyReturn === 'error') {
        showBulkToast('Spotify didn’t connect. Please try again.');
    }
    // Handled once: drop the flag so a reload doesn't reopen the import.
    if (spotifyReturn) {
        const url = new URL(window.location.href);
        url.searchParams.delete('spotify');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
    }
});

// A new "Continue with Spotify" account arrives to import its library: the
// import window opens for it, so the first-run wizard stays out of the way.
const arrivedFromSpotifySignIn = new URLSearchParams(window.location.search).get('spotify') === 'signed-in';

function restartSong() {
    if (!ytPlayer || !ytPlayer.seekTo) return;
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
    resetSleeveProgress();
    clearActiveLyricHighlight();
}

function toggleMusic() {
    const song = currentRadioSong || songsData[currentSongIndex];
    pdbg('play/pause pressed', { ready: isPlayerReady(), state: ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : null });

    // Activate the right player for this song. Not for a current row that
    // hasn't started: the player stays on the engine of the track from
    // before, so Pause pauses that one (switchSong activates the row's).
    if (song && currentRowStarted()) activatePlayerForSong(song);

    // If player isn't ready yet, queue the play
    if (!ytPlayer || !isPlayerReady()) {
        pendingPlay = true;
        // Load lyrics immediately even if player isn't ready
        if (song && !currentLyrics && activeLyricIndex === -1) {
            loadLyricsForSong(song);
        }
        return;
    }

    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
    } else if (!currentRowStarted() && songsData[currentSongIndex]) {
        // The player holds a track from before (see currentRowUnloaded):
        // start this playlist's song properly (screen, row, lock screen).
        switchSong(currentSongIndex);
    } else if (state === YT.PlayerState.PAUSED) {
        // Resume from pause
        ytPlayer.playVideo();
    } else {
        // Unstarted (-1), cued (5), ended (0), or buffering (3)
        const source = getPlaybackSource(song);
        if (song && source) {
            noteSongRequest(song, true);
            ytPlayer.loadVideoById(source);
            // Cold-start of a cued song bypasses playSongSource, so log the
            // play here too — otherwise the first play of a session (pressing
            // play without tapping a row) never reaches the shelf.
            recordPlay(song);
        } else if (song && song.title) {
            // Nothing stored to play yet (a title-only import): resolve a
            // match, or say why it can't play.
            playSongSource(song, false);
        }
        // Load lyrics on first play if not yet loaded
        if (!currentLyrics && activeLyricIndex === -1) {
            if (song) loadLyricsForSong(song);
        }
    }
}


// Volume control - rotary knob
let lastVolume = 100;
let currentVolume = 100;
const volumeSlider = document.getElementById('volumeSlider');
const volumeKnob = document.getElementById('volumeKnob');
const volumeKnobWrapper = document.getElementById('volumeKnobWrapper');
const volumeLabel = document.getElementById('volumeLabel');

// Knob rotation: 0% = -130deg, 100% = 130deg (260deg total range)
const KNOB_MIN = -130, KNOB_MAX = 130;
function volToAngle(vol) { return KNOB_MIN + (vol / 100) * (KNOB_MAX - KNOB_MIN); }
function angleToVol(angle) { return ((angle - KNOB_MIN) / (KNOB_MAX - KNOB_MIN)) * 100; }

function setVolume(vol) {
    vol = Math.min(100, Math.max(0, Math.round(vol)));
    currentVolume = vol;
    if (volumeSlider) volumeSlider.value = vol;
    if (volumeKnob) volumeKnob.style.transform = `rotate(${volToAngle(vol)}deg)`;
    if (volumeLabel) volumeLabel.textContent = vol;
    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(vol);
    if (vol > 0) lastVolume = vol;
}

// Init knob position
setVolume(100);

if (volumeKnobWrapper) {
    let isDragging = false;
    let lastAngle = null;

    function getAngleFromEvent(e, rect) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        return Math.atan2(e.clientX - cx, cy - e.clientY) * (180 / Math.PI);
    }

    // Pointer events cover mouse identically and add touch (tablets):
    // touch-action:none on the wrapper (coarse-pointer CSS) stops the
    // browser claiming the drag for scrolling.
    volumeKnobWrapper.addEventListener('pointerdown', (e) => {
        isDragging = true;
        const rect = volumeKnobWrapper.getBoundingClientRect();
        lastAngle = getAngleFromEvent(e, rect);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const rect = volumeKnobWrapper.getBoundingClientRect();
        const angle = getAngleFromEvent(e, rect);
        let delta = angle - lastAngle;
        // Handle wrap-around
        if (delta > 180) delta -= 360;
        if (delta < -180) delta += 360;
        lastAngle = angle;
        const volDelta = (delta / (KNOB_MAX - KNOB_MIN)) * 100;
        setVolume(currentVolume + volDelta);
    });

    const endKnobDrag = () => {
        if (isDragging) {
            isDragging = false;
            lastAngle = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    };
    document.addEventListener('pointerup', endKnobDrag);
    document.addEventListener('pointercancel', endKnobDrag);

    // Scroll wheel
    volumeKnobWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        setVolume(currentVolume + (e.deltaY < 0 ? 5 : -5));
    }, { passive: false });

    // Double click to mute/unmute
    volumeKnobWrapper.addEventListener('dblclick', () => {
        if (currentVolume > 0) {
            lastVolume = currentVolume;
            setVolume(0);
        } else {
            setVolume(lastVolume);
        }
    });
}

function adjustVolume(delta) {
    setVolume(currentVolume + delta);
}

// Pitch slider - controls playback rate (±25%)
const pitchTrack = document.getElementById('pitchTrack');
const pitchThumb = document.getElementById('pitchThumb');
const pitchValue = document.getElementById('pitchValue');
const miniPitchTrack = document.getElementById('miniPitchTrack');
const miniPitchThumb = document.getElementById('miniPitchThumb');
const miniPitchValue = document.getElementById('miniPitchValue');
let currentPitch = 0; // -25 to +25 percent

function setPitch(pct) {
    pct = Math.min(25, Math.max(-25, pct));
    currentPitch = pct;
    const label = (pct > 0 ? '+' : '') + pct.toFixed(0) + '%';
    const rate = 1 + (pct / 100);

    // Update big pitch slider (track 80px, thumb 12px per CSS)
    const trackH = 80, thumbH = 12;
    const range = trackH - thumbH;
    const center = range / 2;
    const offset = center + (pct / 25) * center;
    if (pitchThumb) pitchThumb.style.top = (offset + thumbH / 2) + 'px';
    if (pitchValue) pitchValue.textContent = label;

    // Update mini pitch slider (track 55px, thumb 7px per CSS)
    const miniTrackH = 55, miniThumbH = 7;
    const miniRange = miniTrackH - miniThumbH;
    const miniCenter = miniRange / 2;
    const miniOffset = miniCenter + (pct / 25) * miniCenter;
    if (miniPitchThumb) miniPitchThumb.style.top = (miniOffset + miniThumbH / 2) + 'px';
    if (miniPitchValue) miniPitchValue.textContent = label;

    if (ytPlayer && ytPlayer.setPlaybackRate) ytPlayer.setPlaybackRate(rate);
    const vinyl = document.getElementById('vinyl');
    if (vinyl) vinyl.style.animationDuration = (2 / rate) + 's';
    const platterVinyl = document.getElementById('platterVinyl');
    if (platterVinyl) platterVinyl.style.animationDuration = (3 / rate) + 's';
}

// Setup drag for a pitch track element
function setupPitchDrag(trackEl, thumbH) {
    if (!trackEl) return;
    let dragging = false;

    function pctFromY(e) {
        const rect = trackEl.getBoundingClientRect();
        // Clamp to effective range where thumb center can go
        const y = Math.min(Math.max(e.clientY - rect.top, thumbH / 2), rect.height - thumbH / 2);
        return ((y - thumbH / 2) / (rect.height - thumbH) - 0.5) * 50;
    }

    trackEl.addEventListener('mousedown', (e) => {
        dragging = true;
        setPitch(pctFromY(e));
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        setPitch(pctFromY(e));
    });

    document.addEventListener('mouseup', () => {
        if (dragging) {
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

    trackEl.addEventListener('dblclick', () => setPitch(0));
}

setupPitchDrag(pitchTrack, 12);
setupPitchDrag(miniPitchTrack, 7);

// Init pitch at center
setPitch(0);

// ============================================================
// SONG ADD / DELETE
// ============================================================

// opts.wizard: opened as the setup wizard's last step (first song);
// opts.chip shows the "Step 3 of 3" indicator (member signup flow only).
function showAddSongModal(opts = {}) {
    updateAddSongFormForSource();
    const title = document.getElementById('addSongModalTitle');
    if (title) title.textContent = opts.wizard ? 'Add your first song' : 'Add songs';
    const chip = document.getElementById('addSongWizardStep');
    if (chip) chip.style.display = opts.wizard && opts.chip ? '' : 'none';
    const hint = document.getElementById('addSongWizardHint');
    if (hint) hint.style.display = opts.wizard ? '' : 'none';
    document.getElementById('addSongModal').classList.add('active');
    const search = document.getElementById('addSongSearch');
    if (search) search.focus();
    else document.getElementById('addSongYoutube').focus();
}

function hideAddSongModal() {
    document.getElementById('addSongModal').classList.remove('active');
    document.getElementById('addSongForm').reset();
    const search = document.getElementById('addSongSearch');
    if (search) search.value = '';
    renderAddSearchResults(null);
    const manual = document.getElementById('addSongManualDetails');
    if (manual) manual.open = false;
    lastFetchedYtId = '';
}

// ---- Search-first add: type a song, tap a result, needle drops. ----
let addSearchTimer = null;
let addSearchSeq = 0;       // stale-response guard
let addSearchResults = [];  // last rendered results, indexed by row

// "Artist - Title (Official Video)" → { artist, title }. YouTube titles are
// messy; strip the usual noise and fall back to the channel as the artist.
function parseYoutubeResultTitle(videoTitle, channel) {
    const noise = /[(\[](official\s*)?(music\s*)?(video|audio|visuali[sz]er|lyrics?(\s*video)?|hd|4k|hq)[)\]]/gi;
    const clean = String(videoTitle || '').replace(noise, '').replace(/\s{2,}/g, ' ').trim();
    const cleanChannel = String(channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
    const parts = clean.split(/\s+[-–—]\s+/);
    // "Song - Remastered 2011", "Song - Live": a version, not "Artist - Title".
    // A "- Topic" channel's titles never carry the artist.
    const version = /^((\d{4}\s+)?(re-?master(ed)?|remix|mono|stereo)|live\b|radio edit|(single|album|extended|acoustic|demo|instrumental)\b.*version|acoustic|instrumental|demo|bonus track)/i;
    const topic = /\s-\s*Topic$/i.test(String(channel || ''));
    if (parts.length >= 2 && !topic && !version.test(parts[1].trim())) {
        return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: cleanChannel, title: clean };
}

function onAddSearchKeydown(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        // Bypass the debounce; if results are already up, take the top one.
        if (addSearchResults.length > 0) pickAddSearchResult(0);
        else runAddSongSearch();
    }
}

function onAddSearchInput() {
    clearTimeout(addSearchTimer);
    const q = document.getElementById('addSongSearch').value.trim();
    if (q.length < 2) { renderAddSearchResults(null); return; }
    addSearchTimer = setTimeout(runAddSongSearch, 400);
}

async function runAddSongSearch() {
    clearTimeout(addSearchTimer);
    const input = document.getElementById('addSongSearch');
    const q = input ? input.value.trim() : '';
    if (q.length < 2) { renderAddSearchResults(null); return; }

    // A playlist link: offer its import (a whole list doesn't fit the
    // one-song form). A song in a playlist gets both.
    const listKind = playlistLinkKind(q);
    const songLink = /[?&]v=|youtu\.be\/|youtube\.com\/(shorts|live)\/|open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\//i.test(q);
    if (listKind && !songLink) {
        renderAddImportOffer(listKind, '');
        return;
    }

    // A pasted link (or bare video ID) isn't a search — hand it to the
    // manual form, prefilled.
    const looksLikeLink = /^https?:\/\//i.test(q)
        || /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be|open\.spotify\.com)\//i.test(q)
        || /^[a-zA-Z0-9_-]{11}$/.test(q);
    if (looksLikeLink) {
        const manual = document.getElementById('addSongManualDetails');
        if (manual) manual.open = true;
        const urlInput = document.getElementById('addSongYoutube');
        if (urlInput) {
            urlInput.value = q;
            urlInput.dispatchEvent(new Event('input'));  // triggers title autofill
        }
        if (listKind === 'youtube') renderAddImportOffer('youtube', 'Or add just this song below.');
        else renderAddSearchResults([], 'Link detected — finish it below.');
        return;
    }

    const seq = ++addSearchSeq;
    renderAddSearchResults([], 'Searching…');
    try {
        // No retries while typing: a newer keystroke will search again anyway.
        const data = await postJsonRetrying('/search-youtube', { query: q }, { retries: 0 });
        if (seq !== addSearchSeq) return;  // a newer search superseded this one
        if (data.rateLimited) {
            renderAddSearchResults([], 'Searching too fast: wait a few seconds and try again.');
            return;
        }
        if (!data.success || !Array.isArray(data.results) || data.results.length === 0) {
            renderAddSearchResults([], 'No matches — try different words, or use "More options" below.');
            return;
        }
        renderAddSearchResults(data.results.slice(0, 8));
    } catch (e) {
        if (seq === addSearchSeq) renderAddSearchResults([], 'Search failed — check your connection and try again.');
    }
}

// results: null clears; [] with status shows only the status line.
function renderAddSearchResults(results, status = '') {
    const box = document.getElementById('addSongSearchResults');
    if (!box) return;
    addSearchResults = results || [];
    const said = document.getElementById('mAddStatus');
    if (said && status !== 'Searching…') {
        said.textContent = results === null ? ''
            : (addSearchResults.length ? `${addSearchResults.length} ${addSearchResults.length === 1 ? 'result' : 'results'}` : status);
    }
    if (results === null) { box.innerHTML = ''; return; }
    let html = status ? `<div class="search-result-status">${escapeHtml(status)}</div>` : '';
    addSearchResults.forEach((r, i) => {
        const parsed = parseYoutubeResultTitle(r.title, r.channel);
        const thumb = safeUrl(r.thumbnail);
        html += `<button type="button" class="search-result-row" data-add-i="${i}" onclick="pickAddSearchResult(${i})">
            ${thumb ? `<img class="search-result-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '<span class="search-result-thumb"></span>'}
            <span class="search-result-meta">
                <span class="search-result-title">${escapeHtml(parsed.title)}</span>
                <span class="search-result-artist">${escapeHtml(parsed.artist)}</span>
            </span>
            <span class="search-result-play">${PLAY_SVG}</span>
            <span class="search-result-plus" aria-hidden="true">${ADD_PLUS_SVG}</span>
        </button>`;
    });
    box.innerHTML = html;
}

const ADD_PLUS_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

// Which playlist a pasted link is: 'youtube', 'spotify' ('spotify-off'
// when this server can't import from Spotify), or null. A YouTube Mix
// (list=RD…) is made up on the fly, so there's nothing to import; YouTube
// Music's curated RDCLAK… lists are real playlists.
function playlistLinkKind(q) {
    if (/open\.spotify\.com\/(?:intl-[a-z-]+\/)?playlist\//i.test(q)) {
        return typeof spotifyOn !== 'undefined' && !spotifyOn ? 'spotify-off' : 'spotify';
    }
    const list = String(q).match(/[?&]list=([\w-]+)/);
    if (list && /(youtube\.com|youtu\.be)\//i.test(q) && !/^RD(?!CLAK)/.test(list[1])) return 'youtube';
    return null;
}

function renderAddImportOffer(kind, note) {
    const box = document.getElementById('addSongSearchResults');
    if (!box) return;
    addSearchResults = [];
    if (kind === 'spotify-off') {
        box.innerHTML = '<div class="search-result-status">Spotify playlists can’t be imported here. Copy the songs as a list and use Import a playlist → Paste a list.</div>';
        return;
    }
    const name = kind === 'spotify' ? 'Spotify' : 'YouTube';
    box.innerHTML = `<button type="button" class="search-result-row search-result-import" onclick="importFromAddSearch('${kind}')">
            <span class="search-result-thumb search-result-import-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg></span>
            <span class="search-result-meta">
                <span class="search-result-title">Import this ${name} playlist</span>
                <span class="search-result-artist">All its songs, into a new playlist</span>
            </span>
        </button>` + (note ? `<div class="search-result-status">${escapeHtml(note)}</div>` : '');
}

// The import sheet, already fetching the pasted playlist
function importFromAddSearch(kind) {
    const input = document.getElementById('addSongSearch');
    const url = input ? input.value.trim() : ''; // read before the sheet resets it
    // The phone sheet's "To" (a pasted playlist still defaults to a new one)
    const to = typeof window.mCurrentAddTarget === 'function' ? window.mCurrentAddTarget() : undefined;
    hideAddSongModal();
    showSpotifyImportModal(to !== undefined ? { playlist: to } : undefined);
    setImportTab(kind);
    const field = document.getElementById(kind === 'spotify' ? 'spotifyImportUrl' : 'youtubeImportUrl');
    if (field) field.value = url;
    if (kind === 'spotify') fetchSpotifyPlaylistUrl();
    else fetchYoutubePlaylist();
}

async function pickAddSearchResult(index) {
    const r = addSearchResults[index];
    if (!r || !r.videoId) return;
    const rows = document.querySelectorAll('#addSongSearchResults .search-result-row');
    rows.forEach(row => { row.disabled = true; });
    if (rows[index]) rows[index].classList.add('adding');
    const parsed = parseYoutubeResultTitle(r.title, r.channel);
    const ok = await saveAndPlaySong({
        title: parsed.title || r.title,
        artist: parsed.artist,
        album: '',
        cover: safeUrl(r.thumbnail),
        youtube_id: r.videoId,
        mp3_url: '',
    });
    if (!ok) rows.forEach(row => { row.disabled = false; });
}

function extractYoutubeId(input) {
    if (!input) return '';
    input = input.trim();
    // youtube.com/watch?v=ID
    let match = input.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    // youtu.be/ID
    match = input.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    // youtube.com/embed/ID, /shorts/ID, /v/ID
    match = input.match(/(?:embed|shorts|\/v)\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    // youtube.com/live/ID (a stream or premiere); only on YouTube's host, as
    // plenty of audio links have /live/ in their path
    match = input.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/i);
    if (match) return match[1];
    // raw 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    // Anything else is not a YouTube video. Returning the raw text here used
    // to let a pasted Spotify/MP3 link be saved as a bogus youtube_id.
    return '';
}

// What did the user paste into the Add Song box? Links are recognised by
// their shape whatever the add-song source setting says; the setting only
// decides how a bare URL is treated and what the empty field asks for.
const DIRECT_AUDIO_URL = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?[^\s]*)?$/i;
function classifyAddSongInput(value) {
    const text = (value || '').trim();
    if (!text) return { kind: '', error: 'Paste a link first.' };

    // A file just uploaded to this app comes back as /media/<name>.
    if (/^\/media\/[A-Za-z0-9.-]+$/.test(text)) return { kind: 'mp3', mp3Url: text };

    const spotifyId = extractSpotifyId(text);
    if (spotifyId) return { kind: 'spotify', spotifyId };

    const youtubeId = extractYoutubeId(text);
    if (youtubeId) return { kind: 'youtube', youtubeId };

    if (/open\.spotify\.com\/(playlist|album)\//i.test(text)) {
        return { kind: '', error: 'That is a Spotify playlist or album. Playlists come in through "Import a playlist"; albums can\u2019t be imported yet.' };
    }
    if (/^https?:\/\/[^\s]+$/i.test(text)) {
        if (musicSource === 'mp3' || DIRECT_AUDIO_URL.test(text)) return { kind: 'mp3', mp3Url: text };
        return { kind: '', error: 'That link is not a YouTube video or Spotify track. For a direct audio file, set Settings → Playback → Advanced → Add-song source to MP3 URL.' };
    }

    const hints = {
        youtube: 'Paste a YouTube link or an 11-character video ID.',
        spotify: 'Paste a Spotify track link (open.spotify.com/track/\u2026).',
        mp3: 'Paste a direct link to an audio file (https://\u2026/song.mp3), or upload one below.',
    };
    return { kind: '', error: hints[musicSource] || hints.youtube };
}

let lastFetchedYtId = '';
async function fetchYoutubeInfo(input) {
    const ytId = extractYoutubeId(input);
    if (!ytId || ytId === lastFetchedYtId) return;
    lastFetchedYtId = ytId;

    // Set cover immediately from thumbnail
    const coverInput = document.getElementById('addSongCover');
    coverInput.value = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;

    try {
        const resp = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`);
        if (!resp.ok) return;
        const data = await resp.json();

        const titleInput = document.getElementById('addSongTitle');
        const artistInput = document.getElementById('addSongArtist');

        // Many music videos use "Artist - Title" format
        const parts = data.title.split(' - ');
        if (parts.length >= 2) {
            artistInput.value = artistInput.value || parts[0].trim();
            titleInput.value = titleInput.value || parts.slice(1).join(' - ').trim();
        } else {
            titleInput.value = titleInput.value || data.title;
            artistInput.value = artistInput.value || data.author_name || '';
        }
    } catch (e) {
        // oEmbed failed, no big deal - user can fill in manually
    }
}

// Auto-fetch info when a link is pasted or typed. Recognised by shape, so a
// Spotify link fills in from Spotify even while the setting says YouTube.
document.getElementById('addSongYoutube')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (extractSpotifyId(val)) {
        fetchSpotifyInfo(val);
    } else if (extractYoutubeId(val)) {
        fetchYoutubeInfo(val);
    }
    // Direct audio URLs carry no metadata: the user fills it in.
});

function updateSongDisplay(song) {
    // Record label
    const label = document.querySelector('.record-label');
    if (label) {
        const dispCover = safeUrl(song.cover);
        label.innerHTML = dispCover
            ? `<img src="${escapeHtml(dispCover)}" alt="Album Cover">`
            : '<div class="record-label-placeholder">&#9834;</div>';
    }
    // Sleeve art
    const sleeveImg = document.getElementById('sleeveArtImg');
    const sleevePlaceholder = document.getElementById('sleeveArtPlaceholder');
    if (sleeveImg) {
        if (song.cover) {
            sleeveImg.src = song.cover;
            sleeveImg.style.display = '';
            if (sleevePlaceholder) sleevePlaceholder.style.display = 'none';
        } else {
            sleeveImg.style.display = 'none';
            if (sleevePlaceholder) sleevePlaceholder.style.display = '';
        }
    }
    // Song info
    setNowPlayingText(song.title || 'No song', song.artist || '', song.album || '');
    // Track number
    const trackNum = document.getElementById('sleeveTrackNum');
    if (trackNum) trackNum.textContent = 'TRACK ' + String(currentSongIndex + 1).padStart(2, '0');
    // Backdrop
    const backdropImg = document.getElementById('backdropImg');
    if (backdropImg) {
        if (song.cover) {
            backdropImg.src = song.cover;
            backdropImg.style.display = '';
        } else {
            backdropImg.style.display = 'none';
        }
    }
    // Amp display
    updateAmpDisplay();
    // Lock-screen / notification metadata
    updateMediaSession(song);
}

// ============================================================
// MEDIA SESSION — lock-screen & notification controls
// ============================================================

function updateMediaSession(song) {
    if (!('mediaSession' in navigator)) return;
    if (!song || !song.title || song.title === 'No songs yet') {
        navigator.mediaSession.metadata = null;
        return;
    }
    const artwork = [];
    const cover = safeUrl(song.cover);
    if (cover) {
        // No `sizes`: covers come in many shapes (YouTube's are 480x360), and
        // a wrong size is worse than none.
        artwork.push({ src: new URL(cover, location.origin).href });
    }
    navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        artwork,
    });
}

(function initMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    const safe = (fn) => () => { try { fn(); } catch (e) {} };
    try {
        // Idempotent: the OS may send 'play' while already playing (or the
        // reverse) — blindly toggling would invert the intended state.
        const playerState = () => (ytPlayer && ytPlayer.getPlayerState ? ytPlayer.getPlayerState() : -1);
        navigator.mediaSession.setActionHandler('play', safe(() => {
            const state = playerState();
            pdbg('media key: play', { state });
            // Playing, or still starting (buffering): nothing to do — a
            // toggle would restart a loading song from the top.
            if (state !== 1 && state !== 3) toggleMusic();
        }));
        navigator.mediaSession.setActionHandler('pause', safe(() => {
            const state = playerState();
            pdbg('media key: pause', { state });
            // Playing or still loading: pause it. (mediaSessionKeeper stops
            // when the player reports the pause, not here: stopping it first
            // would hand the controls back to YouTube's frame.)
            if ((state === 1 || state === 3) && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        }));
        navigator.mediaSession.setActionHandler('previoustrack', safe(() => { pdbg('media key: previous'); prevSong(); }));
        navigator.mediaSession.setActionHandler('nexttrack', safe(() => { pdbg('media key: next'); nextSong(); }));
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            try {
                if (ytPlayer && ytPlayer.seekTo && details.seekTime != null) {
                    ytPlayer.seekTo(details.seekTime, true);
                }
            } catch (e) {}
        });
    } catch (e) { /* some handlers unsupported on some platforms */ }
})();

// Headset buttons (AirPods press / double press / triple press), the media
// notification and the lock screen go to one page's media session. Chromium
// picks the top-most frame that has its own playing or paused media player —
// and YouTube songs play inside YouTube's iframe, so the phone ends up
// talking to YouTube's embed: play/pause only, no skip, none of the
// handlers above. A silent looping <audio> in this page gives us a player
// of our own, so the controls come here and follow our playlist.
// Chromium browsers only (Brave, Chrome, Edge, Samsung Internet): on
// iPhones a second playing element can pause the YouTube video. Off in the
// React Native shell (native playback owns the controls there) and for the
// MP3 engine (its <audio> already lives in this page).
const mediaSessionKeeper = (() => {
    const ua = navigator.userAgent;
    const iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const chromium = /(Chrome|Chromium)\//.test(ua) && !iOS;
    if (!chromium || !('mediaSession' in navigator) || window.ReactNativeWebView) {
        return { sync() {}, stop() {} };
    }

    let audio = null;
    let idleTimer = null;

    // 10 s of 8 kHz, 8-bit mono silence (~80 KB), built in memory. Over
    // Chromium's 5 s floor for a "content" player; looped, it runs as long
    // as the music does.
    function silence() {
        const rate = 8000, frames = rate * 10;
        const buf = new ArrayBuffer(44 + frames), v = new DataView(buf);
        const tag = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
        tag(0, 'RIFF'); v.setUint32(4, 36 + frames, true); tag(8, 'WAVE');
        tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
        tag(36, 'data'); v.setUint32(40, frames, true);
        new Uint8Array(buf, 44).fill(128); // unsigned 8-bit: 128 is silence
        return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    }

    function stop() {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (audio && !audio.paused) {
            pdbg('media keeper: stop');
            audio.pause();
        }
    }

    return {
        // Mirror the real player: run while music plays and through the
        // short gap between songs; pause when the user pauses, and give up
        // if nothing is playing again within 15 s (end of the playlist, a
        // start the browser refused).
        sync(state) {
            if (ytPlayer !== ytPlayerReal) { stop(); return; }
            if (state === 1) {
                clearTimeout(idleTimer);
                idleTimer = null;
                if (!audio) {
                    audio = new Audio(silence());
                    audio.loop = true;
                }
                if (audio.paused) {
                    audio.play()
                        .then(() => pdbg('media keeper: start (headset controls → this page)'))
                        .catch((e) => pdbg('media keeper: refused', e && e.name)); // controls stay with YouTube
                }
            } else if (state === 2) {
                stop();
            } else if (audio && !audio.paused && !idleTimer) {
                idleTimer = setTimeout(stop, 15000);
            }
        },
        stop,
    };
})();

// Whichever element scrolls the song list: the list itself in some layouts,
// the whole sidebar in others (desktop, landscape phones, and the phone
// playlist screen, whose top bar stays put while the header scrolls away).
function songListScroller() {
    const list = document.getElementById('songList');
    if (list && /auto|scroll/.test(getComputedStyle(list).overflowY)) return list;
    return document.getElementById('musicSidebar') || list;
}

// The phone playlist screen (portrait web shell): its top bar covers the
// scroller's top edge and the mini player + tab bar its bottom.
function onPhonePlaylistScreen() {
    return !!document.documentElement.dataset.mTab && window.matchMedia('(max-width: 600px)').matches;
}

// A row of the list on screen (the playing list, or one that's only being
// viewed: then no row is the playing one, and a tap starts that list).
function buildSongListItem(song, index) {
    const itemCover = safeUrl(song.cover);
    const playingRow = listIsPlaying() && index === currentSongIndex;
    return `
        <li class="song-list-item ${playingRow ? 'active' : ''}${song._unplayable ? ' song-unplayable' : ''}"
            ${song._unplayable ? `title="Can't play: ${escapeHtml(song._unplayable)}"` : ''}
            data-index="${index}"
            data-src="${song.mp3_url ? 'mp3' : (song.youtube_id ? 'yt' : 'spotify')}"
            onclick="playListRow(${index})">
            <span class="song-drag-handle" title="Drag to reorder" onpointerdown="startSongDrag(event)" onclick="event.stopPropagation()">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></svg>
            </span>
            <div class="song-list-vinyl">
                <div class="song-list-vinyl-groove"></div>
                ${itemCover
                    ? `<img class="song-list-cover" src="${escapeHtml(itemCover)}" alt="">`
                    : `<div class="song-list-cover song-list-cover-empty">&#9834;</div>`
                }
                <div class="song-list-vinyl-hole"></div>
            </div>
            <div class="song-list-info">
                <div class="song-list-title">${escapeHtml(song.title)}</div>
                <div class="song-list-artist">${escapeHtml(song.artist)}</div>
                <div class="song-list-playing-indicator">
                    <span></span><span></span><span></span><span></span>
                </div>
            </div>
            ${String(listId()) === 'favorites' ? '' : `<button class="song-fav-btn ${favoriteKeys.has(songPlayKey(song)) ? 'is-fav' : ''}" data-index="${index}" onclick="event.stopPropagation(); toggleFavorite(${index})" title="Favorite" aria-label="Favorite">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.07a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.8-8.85a5.5 5.5 0 0 0 0-7.78z"/></svg>
            </button>`}
            <span class="song-list-num">${String(index + 1).padStart(2, '0')}</span>
            <div class="song-actions">
                <button class="song-send-btn" onclick="event.stopPropagation(); showSendMenu(this, ${index})" title="Send to playlist" aria-label="More options for ${escapeHtml(song.title)}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                        <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                    </svg>
                </button>
                <button class="song-delete-btn" onclick="event.stopPropagation(); deleteSong(${index})" title="Remove song">&times;</button>
            </div>
        </li>`;
}

// A rebuild while a song is being dragged would detach the dragged row: it
// waits for the drop (startSongDrag runs it).
let songListRebuildDeferred = false;

// The only renderer of #songList: the list on screen (see listSongs), so
// late redraws (Discover, a saved radio song) repaint the right one.
function rebuildSongList() {
    syncRadioLoading();
    if (document.body.classList.contains('song-dragging')) {
        songListRebuildDeferred = true;
        return;
    }
    songListRebuildDeferred = false;
    const songList = document.getElementById('songList');
    const busy = listLoading() && !viewFailed;
    if (busy) songList.setAttribute('aria-busy', 'true'); else songList.removeAttribute('aria-busy');
    if (listLoading()) {
        // One non-row item (no .song-list-item, no data-index): row code and
        // a find query left over from another list never touch it.
        songList.innerHTML = viewFailed
            ? `<li class="song-list-loading is-failed" role="alert">
                <span class="song-list-loading-text">Couldn't load this playlist</span>
                <button type="button" class="song-list-retry" onclick="mRetryView()">Retry</button>
            </li>`
            : `<li class="song-list-loading">
                <span class="song-list-skeleton" aria-hidden="true"><span></span><span></span><span></span></span>
                <span class="song-list-loading-text">Loading songs…</span>
            </li>`;
        return;
    }
    const list = listSongs();
    if (list.length === 0) {
        songList.innerHTML = `
            <li class="song-list-empty">
                <div class="song-list-empty-icon">&#9834;</div>
                <div class="song-list-empty-text">This playlist is empty</div>
                <div class="song-list-empty-sub">Search for songs to add, or bring some over from Spotify or YouTube.</div>
                <div class="song-list-empty-actions">
                    <button class="song-list-empty-add" onclick="showAddSongModal()">+ Add songs</button>
                    <button class="song-list-empty-import" onclick="showSpotifyImportModal({ into: 'current' })">Import</button>
                </div>
            </li>`;
        return;
    }
    // The innerHTML swap resets scroll — a delete halfway down a long list
    // must not fling the user back to the top.
    const scroller = songListScroller() || songList;
    const scrollTop = scroller.scrollTop;
    songList.innerHTML = list.map((song, index) => buildSongListItem(song, index)).join('')
        + renderDiscoverSection();
    // The innerHTML swap wipes the now-playing radio row — re-add it so a
    // discover fetch resolving mid-playback can't hide what's playing.
    if (currentRadioSong && listIsPlaying()) {
        document.querySelectorAll('#songList .song-list-item').forEach(item => item.classList.remove('active'));
        addRadioSidebarItem(currentRadioSong);
    }
    scroller.scrollTop = scrollTop;

    // Discover starts working only once the user actually scrolls it into
    // view — no probe players or API calls for a shelf nobody looked at.
    const header = document.getElementById('discoverHeader');
    if (header && !discoverStarted && 'IntersectionObserver' in window) {
        const obs = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting)) {
                obs.disconnect();
                startDiscover();
            }
        }, { root: null, threshold: 0.1 });
        obs.observe(header);
    } else if (header && !discoverStarted) {
        startDiscover();
    }
}

// ---- Drag-to-reorder songs (pointer-based, works on mouse + touch) ----
// Grabbing a row's handle reorders the DOM live via insertBefore; on release
// the list on screen is rewritten to match and the new order is persisted.
function startSongDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    const list = document.getElementById('songList');
    const li = e.currentTarget.closest('.song-list-item');
    if (!list || !li) return;
    // A remove/move/copy still saving splices this list when it answers:
    // reordering it meanwhile would make that splice hit another song.
    if (songOpInFlight) {
        songOpBusy();
        return;
    }

    li.classList.add('dragging');
    document.body.classList.add('song-dragging');

    const place = (y) => {
        const others = [...list.querySelectorAll('.song-list-item:not(.discover-item):not(.radio-song-item)')]
            .filter(r => r !== li);
        let placed = false;
        for (const r of others) {
            const rect = r.getBoundingClientRect();
            if (y < rect.top + rect.height / 2) { list.insertBefore(li, r); placed = true; break; }
        }
        if (!placed && others.length) others[others.length - 1].after(li);
    };

    // Near the scroller's top or bottom edge, keep scrolling so a song can
    // travel further than one screen: one animation-frame loop, stopped for
    // good on release.
    const scroller = songListScroller() || list;
    const phoneScreen = onPhonePlaylistScreen();
    let lastY = e.clientY;
    let edgeFrame = 0;
    let ended = false;
    const edgeScroll = () => {
        edgeFrame = 0;
        if (ended) return;
        const box = scroller.getBoundingClientRect();
        const zone = 64;
        const top = Math.max(box.top, 0) + (phoneScreen ? 52 : 0);
        const bottom = Math.min(box.bottom, window.innerHeight) - (phoneScreen ? 140 : 0);
        let dy = 0;
        if (lastY < top + zone) dy = -Math.ceil((top + zone - lastY) / 4);
        else if (lastY > bottom - zone) dy = Math.ceil((lastY - (bottom - zone)) / 4);
        if (!dy) return;
        const before = scroller.scrollTop;
        scroller.scrollTop += Math.max(-24, Math.min(24, dy));
        if (scroller.scrollTop !== before) {
            place(lastY);
            edgeFrame = requestAnimationFrame(edgeScroll);
        }
    };

    const move = (ev) => {
        if (ended) return;
        lastY = ev.clientY;
        place(lastY);
        if (!edgeFrame) edgeFrame = requestAnimationFrame(edgeScroll);
    };
    const end = () => {
        ended = true;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', end);
        document.removeEventListener('pointercancel', end);
        if (edgeFrame) cancelAnimationFrame(edgeFrame);
        edgeFrame = 0;
        li.classList.remove('dragging');
        document.body.classList.remove('song-dragging');
        finishSongDrag();
        // A rebuild asked for mid-drag (a Discover fetch landing) runs now.
        if (songListRebuildDeferred) rebuildSongList();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
}

function finishSongDrag() {
    const list = document.getElementById('songList');
    if (!list) return;
    const rows = [...list.querySelectorAll('.song-list-item:not(.discover-item):not(.radio-song-item)')];
    const order = rows.map(r => parseInt(r.getAttribute('data-index'), 10));

    // The list on screen, which may be one that's only being viewed
    const id = String(listId());
    const arr = listSongs();
    if (order.length !== arr.length || order.some(isNaN)) { rebuildSongList(); return; }
    if (order.every((v, i) => v === i)) return; // no change — DOM already correct

    // In place: the array stays the same object (the playing list's identity
    // matters, and a failed save puts it back through the same reference).
    const snap = arr.slice();
    arr.splice(0, arr.length, ...order.map(oldIndex => snap[oldIndex]));
    if (arr === songsData) {
        const newCur = order.indexOf(currentSongIndex);
        if (newCur !== -1) currentSongIndex = newCur;
        // The shuffle order holds indices, which just moved.
        if (shuffleMode !== 'off') buildShuffleQueue();
    } else if (arr === viewedSongs) {
        // Its saved position follows its song, as on the server.
        const r = order.indexOf(viewedResume);
        if (r !== -1) viewedResume = r;
    }
    rebuildSongList();
    saveReorder(id, arr, order, snap);
}

// Reorders are saved one after another (each order is relative to the one
// before). Until they're confirmed, index writes (remove, move, copy) wait:
// they'd reach the server ahead of the new order. A refused or failed one
// drops the rest and reloads the list from the server.
let reordersPending = 0;
let reorderChain = Promise.resolve();
let reorderEpoch = 0;
function saveReorder(id, arr, order, snap) {
    reordersPending++;
    writeBegin(id);
    const epoch = reorderEpoch;
    reorderChain = reorderChain.then(async () => {
        try {
            if (epoch !== reorderEpoch) return; // an earlier one failed: reloaded already
            let result = null;
            try {
                result = await saveMusicRequest({ action: 'reorder', playlist: id, order });
            } catch (e) { /* below */ }
            if (result && result.success) return;
            reorderEpoch++;
            await resyncList(id, arr, {
                snap,
                message: result ? 'This playlist changed somewhere else. The new order wasn\'t saved.'
                    : 'Couldn\'t save the new order. Check your connection.',
            });
        } finally {
            reordersPending--;
            writeEnd(id);
        }
    });
}

// The first paint is server-rendered without the Discover shelf — one
// client rebuild appends it (identical row markup, scroll preserved).
document.addEventListener('DOMContentLoaded', () => {
    if (typeof songsData !== 'undefined' && Array.isArray(songsData) && songsData.length > 0) {
        rebuildSongList();
    }
    if (typeof updateRecentSongs === 'function') updateRecentSongs();
    if (typeof restoreQueue === 'function') restoreQueue();
});

// A playlist's song count and covers, from its songs in memory (by default
// the list on screen). The screen's own count only for the list it shows.
function updateTrackCount(id = listId(), arr = listSongs()) {
    // A viewed list still loading has no songs to count yet: its count
    // stays as the meta has it until the answer lands.
    if (viewedId !== null && String(id) === String(viewedId) && listLoading()) return;
    // Update crate badge
    setCrateCardCount(id, arr.length);
    // The first song in: the "start your collection" nudge has done its job.
    if (arr.length > 0) {
        const hint = document.getElementById('crateEmptyHint');
        if (hint) hint.remove();
    }
    // Keep meta covers in sync
    refreshMetaCovers(id, arr);
    if (arr !== listSongs()) return;
    const trackCountEl = document.querySelector('.sidebar-track-count');
    if (trackCountEl) trackCountEl.textContent = arr.length + (arr.length === 1 ? ' song' : ' songs');
    // Offline toggle only shows for playlists with uploaded/MP3 songs
    if (typeof updateOfflineButton === 'function') updateOfflineButton();
}

// A crate card's song count: the badge, plus .is-empty (the desktop crate
// labels empty sleeves and doesn't mark an empty playlist as now playing).
function setCrateCardCount(playlistId, count) {
    const card = document.querySelector(`.record-card[data-playlist="${playlistId}"]`);
    if (!card) return;
    const badge = card.querySelector('.cover-badge');
    if (badge) badge.textContent = count;
    const caption = card.querySelector('.card-caption-count');
    if (caption) caption.textContent = count + (count === 1 ? ' song' : ' songs');
    card.classList.toggle('is-empty', count === 0);
}

function refreshMetaCovers(id = listId(), arr = listSongs()) {
    const meta = playlistsMeta[id];
    if (!meta) return;
    if (viewedId !== null && String(id) === String(viewedId) && listLoading()) return; // see updateTrackCount
    const seen = new Set();
    meta.covers = [];
    arr.forEach((s, idx) => {
        if (s.cover && !seen.has(s.cover)) {
            seen.add(s.cover);
            meta.covers.push({ index: idx, url: s.cover, title: s.title });
        }
    });
    meta.songCount = arr.length;
}

async function addSongToPlaylist(e) {
    e.preventDefault();
    const sourceValue = document.getElementById('addSongYoutube').value.trim();
    const title = document.getElementById('addSongTitle').value.trim();
    const artist = document.getElementById('addSongArtist').value.trim();
    const album = document.getElementById('addSongAlbum').value.trim();
    const cover = document.getElementById('addSongCover').value.trim();

    if (!title || !sourceValue) return;

    const input = classifyAddSongInput(sourceValue);
    if (!input.kind) {
        alert(input.error);
        return;
    }

    const song = { title, artist, album, cover, youtube_id: '', mp3_url: '', spotify_id: '' };
    if (input.kind === 'mp3') {
        song.mp3_url = input.mp3Url;
    } else if (input.kind === 'spotify') {
        // Plays through the Web Playback SDK on Premium, otherwise through a
        // YouTube match resolved on first play (keyed by this id).
        song.spotify_id = input.spotifyId;
    } else {
        song.youtube_id = input.youtubeId;
    }

    await saveAndPlaySong(song);
}

// Persist a new song, then start it — shared by the manual form and the
// search results. Returns false if the save failed (caller re-enables UI).
// A playlist that's only being viewed (a landscape phone's +) gets the song
// without it taking over the player.
async function saveAndPlaySong(song) {
    if (!listIsPlaying()) {
        const id = String(listId());
        const genAt = viewGen;
        let added;
        writeBegin(id);
        try {
            added = await saveMusicRequest({ action: 'add', song, playlist: id });
        } catch (e) {
            return false;
        } finally {
            writeEnd(id);
        }
        if (!added || !added.success) return false;
        if (!joinList(id, song, { genAt })) bumpSongCount(id);
        hideAddSongModal();
        const meta = playlistsMeta[id];
        const msg = `Added to ${meta ? meta.name : 'the playlist'}`;
        if (window.mToast) window.mToast(msg); else showToast(msg);
        return true;
    }
    let result;
    try {
        const response = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', song })
        });
        result = await response.json();
    } catch (e) {
        return false;
    }
    if (!result.success) return false;

    songsData.push(song);
    currentSongIndex = songsData.length - 1;
    if (shuffleMode !== 'off') buildShuffleQueue();
    rebuildSongList();
    updateTrackCount();
    hideAddSongModal();

    // Adding from the crate (e.g. the wizard's first-song step): pull the
    // active record onto the deck first, then drop the needle.
    const playerView = document.getElementById('musicPlayerView');
    if (playerView && !playerView.classList.contains('active')) {
        await selectPlaylistFromCrate(activePlaylistId);
    }
    updateSongDisplay(song);
    playSongSource(song, true);
    return true;
}

// opts.ctx: which list the index is into (see songCtx; a row's by default).
// The list and its playlist are held from the call on: the answer edits that
// list even if another one is on screen by then, and only the playing list's
// edit touches playback.
async function deleteSong(index, opts) {
    const { id, songs: arr } = songCtx(opts && opts.ctx);
    const victim = arr[index];
    if (!victim) return;
    const label = [victim.title, victim.artist].filter(Boolean).join(' — ');
    // skipConfirm: the mobile song sheet already two-tap confirmed
    if (!(opts && opts.skipConfirm) && !confirm(`Remove "${label}" from this playlist?`)) return;
    if (songOpBusy()) return;

    let result = null;
    songOpInFlight = true;
    writeBegin(id);
    try {
        result = await saveMusicRequest({ action: 'delete', index, playlist: id });
    } catch (e) { /* reported below */ }
    writeEnd(id);
    songOpInFlight = false;
    if (!result || !result.success) {
        songToast(result && result.error ? `Couldn't remove the song: ${result.error}` : 'Couldn\'t remove the song. Check your connection and try again.');
        // Refused by position: this list no longer matches the server's.
        if (result && result.error === 'Invalid song index') resyncList(id, arr);
        return;
    }

    const playing = arr === songsData;
    // A current row that hasn't started isn't what's playing (see
    // currentRowUnloaded): the track from before plays on.
    const waiting = playing && currentRowUnloaded;
    const wasPlaying = playing && index === currentSongIndex && !waiting;
    arr.splice(index, 1);
    if (playing) {
        currentSongIndex = result.newIndex;
        if (shuffleMode !== 'off') buildShuffleQueue();
    } else if (arr === viewedSongs) {
        viewedResume = result.newIndex;
    }
    if (arr === listSongs()) rebuildSongList();
    updateTrackCount(id, arr);
    if (!playing) return; // a viewed list emptied just shows its empty card
    if (songsData.length === 0) {
        if (waiting) currentRowUnloaded = false;
        else showEmptyPlaylistState();
    } else if (waiting) {
        currentRowUnloaded = currentRowStillUnloaded();
    } else if (wasPlaying) {
        const song = songsData[currentSongIndex];
        updateSongDisplay(song);
        playSongSource(song, true);
    }
}

// Called after the last song of a playlist is deleted: stop whatever is
// playing and reset the deck to a neutral "nothing loaded" look.
function showEmptyPlaylistState() {
    try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch (e) {}
    currentSongIndex = 0;
    updateSongDisplay({ title: 'No songs yet', artist: 'Add one with the + button', album: '', cover: '' });
    const ampEl = document.getElementById('ampDisplayText');
    if (ampEl) {
        ampEl.textContent = 'No songs';
        ampEl.classList.remove('scrolling');
    }
    const platterLabel = document.getElementById('platterLabel');
    if (platterLabel) platterLabel.innerHTML = '';
}

// ============================================================
// PLAYLIST EDIT (RENAME / RECOLOR)
// ============================================================

let editingPlaylistId = '';
let selectedEditColor = '';
let selectedCoverIndex = null; // null = auto, number = song index

let creatingPlaylist = false;

function showPlaylistEditModal(id) {
    creatingPlaylist = false;
    editingPlaylistId = id;
    const meta = playlistsMeta[id];
    if (!meta) return;
    document.getElementById('playlistEditModalTitle').textContent = 'Edit Playlist';
    document.getElementById('playlistEditSaveBtn').textContent = 'Save Changes';
    document.getElementById('coverArtGroup').style.display = '';
    document.getElementById('playlistDeleteBtn').style.display = '';
    document.getElementById('playlistEditId').value = id;
    document.getElementById('playlistEditName').value = meta.name;
    selectedEditColor = meta.color;
    selectedCoverIndex = meta.coverSongIndex ?? null;
    // Mark selected swatch
    document.querySelectorAll('#colorSwatchGrid .color-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === meta.color);
    });
    // Build cover picker
    buildCoverPicker(id);
    document.getElementById('shareGroup').style.display = '';
    syncShareUi(id);
    document.getElementById('playlistEditModal').classList.add('active');
    document.getElementById('playlistEditName').focus();
}

// Reflect the playlist's current share state in the edit modal.
function syncShareUi(id) {
    const url = (typeof shareTokens === 'object' && shareTokens) ? shareTokens[id] : null;
    if (url) showShareLink(url); else hideShareLink();
}

function sharePlaylist() {
    const id = document.getElementById('playlistEditId').value;
    if (!id) return;
    fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'share', playlist: id })
    }).then(r => r.json()).then(d => {
        if (d && d.success && d.url) {
            if (typeof shareTokens === 'object' && shareTokens) shareTokens[id] = d.url;
            showShareLink(d.url);
        }
    }).catch(() => { /* leave the button as-is on failure */ });
}

function showShareLink(url) {
    const input = document.getElementById('shareLinkInput');
    const row = document.getElementById('shareLinkRow');
    const btn = document.getElementById('shareCreateBtn');
    if (input) input.value = url;
    if (row) row.style.display = '';
    if (btn) btn.style.display = 'none';
}

function hideShareLink() {
    const row = document.getElementById('shareLinkRow');
    const btn = document.getElementById('shareCreateBtn');
    if (row) row.style.display = 'none';
    if (btn) btn.style.display = '';
}

function copyShareLink() {
    const input = document.getElementById('shareLinkInput');
    if (!input) return;
    input.select();
    const done = () => {
        const btn = document.querySelector('.share-copy-btn');
        if (!btn) return;
        const t = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = t; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done).catch(() => { try { document.execCommand('copy'); done(); } catch (e) {} });
    } else {
        try { document.execCommand('copy'); done(); } catch (e) {}
    }
}

function stopSharing() {
    const id = document.getElementById('playlistEditId').value;
    if (!id) return;
    fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unshare', playlist: id })
    }).then(r => r.json()).then(d => {
        if (d && d.success) {
            if (typeof shareTokens === 'object' && shareTokens) delete shareTokens[id];
            hideShareLink();
        }
    }).catch(() => {});
}

// Same modal, create mode: no cover picker (no songs yet), no delete button.
function showPlaylistCreateModal() {
    creatingPlaylist = true;
    editingPlaylistId = '';
    document.getElementById('playlistEditModalTitle').textContent = 'New Playlist';
    document.getElementById('playlistEditSaveBtn').textContent = 'Create';
    document.getElementById('coverArtGroup').style.display = 'none';
    document.getElementById('shareGroup').style.display = 'none';
    document.getElementById('playlistDeleteBtn').style.display = 'none';
    document.getElementById('playlistEditId').value = '';
    document.getElementById('playlistEditName').value = '';
    selectedEditColor = '#d4a574';
    selectedCoverIndex = null;
    document.querySelectorAll('#colorSwatchGrid .color-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === selectedEditColor);
    });
    document.getElementById('playlistEditModal').classList.add('active');
    document.getElementById('playlistEditName').focus();
}

// opts.confirmed: the caller already asked (the phone playlist menu's
// two-tap row), so skip the browser dialog.
async function deleteCurrentPlaylist(playlistId, opts = {}) {
    const id = typeof playlistId === 'string' && playlistId ? playlistId : editingPlaylistId;
    const meta = playlistsMeta[id];
    if (!id || !meta) return;
    const trackNote = meta.songCount > 0 ? ` and its ${meta.songCount} song${meta.songCount === 1 ? '' : 's'}` : '';
    if (!opts.confirmed && !confirm(`Delete "${meta.name}"${trackNote}? This cannot be undone.`)) return;

    let result;
    try {
        const response = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deletePlaylist', playlist: id })
        });
        result = await response.json();
    } catch (e) {
        const msg = 'Couldn\'t delete the playlist. Check your connection and try again.';
        if (typeof window.mToast === 'function' && window.matchMedia('(max-width: 600px)').matches) window.mToast(msg);
        else alert(msg);
        return;
    }
    if (result.success) {
        // Crate cards, conveyor rows, and recents all shift — let the server re-render.
        toastAfterReload(`Deleted “${meta.name}”`);
        location.reload();
    } else {
        alert(result.error || 'Could not delete playlist');
    }
}

function buildCoverPicker(playlistId) {
    const grid = document.getElementById('coverPickerGrid');
    if (!grid) return;

    const meta = playlistsMeta[playlistId];
    const covers = meta?.covers ?? [];

    if (covers.length === 0) {
        grid.innerHTML = '<span class="cover-picker-hint">No songs with cover art in this playlist</span>';
        return;
    }

    // Find the cover URL of the currently selected index to handle duplicate-cover matching
    const selectedCoverUrl = selectedCoverIndex !== null
        ? (covers.find(c => c.index === selectedCoverIndex)?.url ?? null)
        : null;

    let html = `<div class="cover-picker-item ${selectedCoverIndex === null ? 'selected' : ''}" data-cover-index="-1" onclick="selectCoverSong(this)" title="Auto"><div class="cover-picker-thumb cover-picker-auto">AUTO</div></div>`;
    covers.forEach(c => {
        const isSelected = selectedCoverIndex === c.index || (selectedCoverUrl && c.url === selectedCoverUrl);
        const safeTitle = escapeHtml(c.title);
        const cUrl = safeUrl(c.url);
        const cIdx = Number(c.index) || 0;
        html += `<div class="cover-picker-item ${isSelected ? 'selected' : ''}" data-cover-index="${cIdx}" onclick="selectCoverSong(this)" title="${safeTitle}">
            <img class="cover-picker-thumb" src="${escapeHtml(cUrl)}" alt="">
        </div>`;
    });
    grid.innerHTML = html;
}

function hidePlaylistEditModal() {
    document.getElementById('playlistEditModal').classList.remove('active');
    const hint = document.getElementById('playlistWizardHint');
    if (hint) hint.style.display = 'none';
    editingPlaylistId = '';
}

// First run: a brand-new account has no playlists — greet the user and walk
// them straight into naming their first one (prefilled so one tap works).
// asStepTwo: arriving from the member welcome card, so show the step chip.
function showFirstRunWizard(asStepTwo = false) {
    showPlaylistCreateModal();
    document.getElementById('playlistEditModalTitle').textContent = 'Welcome to your record room';
    document.getElementById('playlistEditSaveBtn').textContent = 'Create my first playlist';
    const step = document.getElementById('playlistWizardStep');
    if (step) step.style.display = asStepTwo ? '' : 'none';
    const hint = document.getElementById('playlistWizardHint');
    if (hint) hint.style.display = '';
    const name = document.getElementById('playlistEditName');
    name.value = 'Favorites';
    name.select();
}

document.addEventListener('DOMContentLoaded', () => {
    // Enter in the playlist-name field saves — one keystroke through the
    // wizard, and a nicety for regular renames too.
    const plName = document.getElementById('playlistEditName');
    if (plName) {
        plName.addEventListener('keydown', e => {
            if (e.key === 'Enter') savePlaylistEdit();
        });
    }

    // Fresh member signup: the welcome card (number + PIN, shown only once)
    // goes first; finishMemberWelcome() chains into the playlist wizard.
    const memberWelcome = document.getElementById('memberWelcomeModal');
    if (memberWelcome) {
        memberWelcome.classList.add('active');
        const nameInput = document.getElementById('memberWelcomeName');
        if (nameInput) {
            nameInput.focus();
            nameInput.addEventListener('keydown', e => {
                if (e.key === 'Enter') finishMemberWelcome();
            });
        }
        return;
    }
    if (typeof playlistsMeta !== 'undefined' && Object.keys(playlistsMeta).length === 0
        && document.getElementById('playlistEditModal') && !arrivedFromSpotifySignIn) {
        showFirstRunWizard();
        return;
    }

    // Wizard finale, straight after the first playlist's reload: open the
    // add-music search so the first session ends with music playing.
    let firstRunAddSong = null;
    try { firstRunAddSong = localStorage.getItem('firstRunAddSong'); } catch (e) {}
    if (firstRunAddSong) {
        try { localStorage.removeItem('firstRunAddSong'); } catch (e) {}
        if (typeof songsData !== 'undefined' && songsData.length === 0
            && document.getElementById('addSongModal')) {
            showAddSongModal({ wizard: true, chip: firstRunAddSong === 'chip' });
        }
    }
});

// The song menu's Like row: close the menu, toggle, say what happened (the
// save can fail and roll back).
async function likeFromSheet(index, ctx) {
    const song = songCtx(ctx).songs[index];
    if (!song) return;
    const key = songPlayKey(song);
    const wasFav = favoriteKeys.has(key);
    closeSendMenu();
    await toggleFavoriteSong(song);
    const nowFav = favoriteKeys.has(key);
    const msg = nowFav === wasFav ? 'Couldn\'t update Favorites. Try again.'
        : (nowFav ? 'Added to Favorites' : 'Removed from Favorites');
    if (typeof window.mToast === 'function') window.mToast(msg);
}

function copyMemberCard(btn) {
    const number = document.getElementById('memberCardNumber');
    const pin = document.getElementById('memberCardPin');
    if (!number || !pin) return;
    const text = 'Music Player member ' + number.textContent.trim() + ' — PIN ' + pin.textContent.trim();
    const flash = () => {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy card details'; }, 2000);
    };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(flash).catch(() => {});
        return;
    }
    // navigator.clipboard needs a secure context; plain-http local domains
    // (musicplayer.test) fall back to the legacy path.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { if (document.execCommand('copy')) flash(); } catch (e) {}
    ta.remove();
}

async function finishMemberWelcome() {
    const btn = document.getElementById('memberWelcomeContinue');
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    const modal = document.getElementById('memberWelcomeModal');
    const nameInput = document.getElementById('memberWelcomeName');
    const name = nameInput ? nameInput.value.trim() : '';
    if (name) {
        // Best-effort: a failed name save shouldn't strand the wizard —
        // the name can always be set again from Settings.
        try {
            await fetch('/settings/name', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const settingsName = document.getElementById('settingsNameInput');
            if (settingsName) settingsName.value = name;
            if (window.mOnAccountName) window.mOnAccountName(name);
        } catch (e) {}
    }
    if (modal) modal.classList.remove('active');
    if (typeof playlistsMeta !== 'undefined' && Object.keys(playlistsMeta).length === 0
        && document.getElementById('playlistEditModal')) {
        showFirstRunWizard(true);
    }
}

function selectPlaylistColor(el) {
    document.querySelectorAll('#colorSwatchGrid .color-swatch').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    selectedEditColor = el.dataset.color;
}

function selectCoverSong(el) {
    document.querySelectorAll('#coverPickerGrid .cover-picker-item').forEach(i => i.classList.remove('selected'));
    el.classList.add('selected');
    const idx = parseInt(el.dataset.coverIndex);
    selectedCoverIndex = idx === -1 ? null : idx;
}

async function savePlaylistEdit() {
    const name = document.getElementById('playlistEditName').value.trim();

    if (creatingPlaylist) {
        if (!name) return;
        // Guard against double-clicks: a second in-flight create makes a
        // real duplicate playlist. Stays disabled on success (page reloads).
        const saveBtn = document.getElementById('playlistEditSaveBtn');
        if (saveBtn && saveBtn.disabled) return;
        if (saveBtn) saveBtn.disabled = true;
        try {
            const response = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'createPlaylist', name, color: selectedEditColor })
            });
            const result = await response.json();
            if (result.success) {
                // First-run wizard: after the reload, chain into the final
                // "add your first song" step ('chip' keeps the step badges
                // from the member-signup flow; '1' = plain first run).
                const wizardHint = document.getElementById('playlistWizardHint');
                if (wizardHint && wizardHint.style.display !== 'none') {
                    const stepChip = document.getElementById('playlistWizardStep');
                    const chipShown = stepChip && stepChip.style.display !== 'none';
                    try { localStorage.setItem('firstRunAddSong', chipShown ? 'chip' : '1'); } catch (e) {}
                }
                // New card needs to appear in both conveyor rows' server-rendered
                // markup — a reload is the reliable path.
                location.reload();
            } else {
                alert(result.error || 'Could not create playlist');
                if (saveBtn) saveBtn.disabled = false;
            }
        } catch (e) {
            alert('Network error — try again.');
            if (saveBtn) saveBtn.disabled = false;
        }
        return;
    }

    const id = editingPlaylistId;
    if (!id || !name) return;

    const oldMeta = playlistsMeta[id];
    const nameChanged = name !== oldMeta.name;
    const colorChanged = selectedEditColor !== oldMeta.color;
    const coverChanged = selectedCoverIndex !== (oldMeta.coverSongIndex ?? null);

    // Send rename if changed
    if (nameChanged) {
        await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rename', playlist: id, name })
        });
        playlistsMeta[id].name = name;
    }

    // Send recolor if changed
    if (colorChanged) {
        await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'recolor', playlist: id, color: selectedEditColor })
        });
        playlistsMeta[id].color = selectedEditColor;
    }

    // Send cover change if changed
    if (coverChanged) {
        await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'setCover', playlist: id, songIndex: selectedCoverIndex ?? -1 })
        });
        playlistsMeta[id].coverSongIndex = selectedCoverIndex;
    }

    // Update DOM: record card
    const card = document.querySelector(`.record-card[data-playlist="${id}"]`);
    if (card) {
        if (nameChanged) {
            const titleEl = card.querySelector('.cover-title');
            if (titleEl) titleEl.textContent = name;
            const captionEl = card.querySelector('.card-caption-title');
            if (captionEl) captionEl.textContent = name;
            const moreBtn = card.querySelector('.card-more');
            if (moreBtn) moreBtn.setAttribute('aria-label', 'Edit ' + name);
        }
        if (colorChanged) {
            card.style.setProperty('--card-color', selectedEditColor);
            const badge = card.querySelector('.cover-badge');
            if (badge) badge.style.setProperty('--pl-color', selectedEditColor);
            const coverArt = card.querySelector('.cover-art');
            if (coverArt) coverArt.style.background = `linear-gradient(135deg, ${selectedEditColor} 0%, ${selectedEditColor}99 100%)`;
        }
        if (coverChanged) {
            // Update cover image on the record card using meta covers
            const covers = playlistsMeta[id]?.covers ?? [];
            let newCoverUrl = '';
            if (selectedCoverIndex !== null) {
                const match = covers.find(c => c.index === selectedCoverIndex);
                if (match) newCoverUrl = match.url;
            }
            if (!newCoverUrl && covers.length > 0) {
                newCoverUrl = covers[0].url;
            }
            const coverMain = card.querySelector('.cover-main');
            const vinylLabel = card.querySelector('.vinyl-label');
            if (newCoverUrl) {
                if (coverMain) {
                    coverMain.src = newCoverUrl;
                } else {
                    const coverArt = card.querySelector('.cover-art');
                    if (coverArt) {
                        const img = document.createElement('img');
                        img.src = newCoverUrl;
                        img.alt = '';
                        img.className = 'cover-main';
                        coverArt.prepend(img);
                    }
                }
                if (vinylLabel) {
                    vinylLabel.innerHTML = `<img src="${escapeHtml(safeUrl(newCoverUrl))}" alt="">`;
                }
            }
        }
    }

    // Update sidebar title if this is the playlist on screen
    if (String(id) === String(listId())) {
        if (nameChanged) {
            document.getElementById('playlistTitle').textContent = name;
        }
    }

    // Update crate records
    if (colorChanged || nameChanged || coverChanged) {
        updateCrateRecords();
    }

    // Update turntable platter label color if active
    if (colorChanged && id === activePlaylistId) {
        const platterLabel = document.getElementById('platterLabel');
        if (platterLabel) platterLabel.style.setProperty('--label-color', selectedEditColor);
    }

    hidePlaylistEditModal();
}

// ============================================================
// SEND MENU (COPY / MOVE SONGS)
// ============================================================

let activeSendMenu = null;

// A playlist's cover for small thumbnails: the Library card's (the server's
// pick), else the first cover in its songs.
function playlistThumbUrl(id) {
    let img = null;
    try { img = document.querySelector('.record-card[data-playlist="' + CSS.escape(String(id)) + '"] img.cover-main'); } catch (e) {}
    if (img && img.getAttribute('src')) return img.getAttribute('src');
    const meta = playlistsMeta[id] || {};
    const covers = Array.isArray(meta.covers) ? meta.covers : [];
    const pick = covers.find(c => c.index === meta.coverSongIndex) || covers[0];
    return pick ? pick.url : '';
}

// The song sheet's second page: pick a playlist (copy, or move).
function showSongPicker() {
    const menu = activeSendMenu;
    const main = menu && menu.querySelector('.send-menu-main');
    const picker = menu && menu.querySelector('.send-menu-picker');
    if (!main || !picker) return;
    main.hidden = true;
    picker.hidden = false;
    menu.scrollTop = 0;
    menu._pageSwitchedAt = performance.now();
    // Start at the page's top (back, title, the move switch), not a playlist.
    const back = picker.querySelector('.send-menu-picker-back');
    if (back) back.focus({ preventScroll: true });
}

// The sheet's pages have different heights: a double tap's second tap lands
// on whatever moved under the finger. Ignore taps just after a page switch.
function sendMenuJustSwitched() {
    const menu = activeSendMenu;
    return !!menu && performance.now() - (menu._pageSwitchedAt || 0) < 400;
}

function hideSongPicker() {
    const menu = activeSendMenu;
    const main = menu && menu.querySelector('.send-menu-main');
    const picker = menu && menu.querySelector('.send-menu-picker');
    if (!main || !picker || picker.hidden) return;
    picker.hidden = true;
    main.hidden = false;
    menu._pageSwitchedAt = performance.now();
    const opener = main.querySelector('.send-menu-open-picker');
    if (opener) opener.focus({ preventScroll: true });
}

function pickSongTarget(toPlaylist, songIndex, ctx) {
    const menu = activeSendMenu;
    if (!menu || menu.classList.contains('is-busy') || sendMenuJustSwitched()) return; // one pick per sheet
    if (songOpBusy()) return;
    menu.classList.add('is-busy');
    const move = !!menu.querySelector('.send-menu-move-input:checked');
    if (move) moveSongTo(toPlaylist, songIndex, ctx); else copySongTo(toPlaylist, songIndex, ctx);
}

function closeSendMenu() {
    if (activeSendMenu) {
        activeSendMenu.remove();
        activeSendMenu = null;
    }
    const smBackdrop = document.querySelector('.send-menu-backdrop');
    if (smBackdrop) smBackdrop.remove();
    document.removeEventListener('click', onSendMenuOutsideClick);
}

function onSendMenuOutsideClick(e) {
    if (activeSendMenu && !activeSendMenu.contains(e.target) && !sendMenuJustSwitched()) {
        closeSendMenu();
    }
}

function showSendMenu(btn, songIndex) {
    closeSendMenu();
    // Now Playing's ⋯ acts on the playing list; a row's on the list on screen
    // (they differ while the phone shows a playlist that isn't playing).
    const ctxKey = btn && btn.id === 'mNpKebab' ? 'np' : 'list';
    const ctx = songCtx(ctxKey);
    const ctxArg = `'${ctxKey}'`;
    if (!ctx.songs[songIndex]) return; // e.g. Now Playing after its playlist emptied
    const isApp = !!window.ReactNativeWebView || new URLSearchParams(window.location.search).has('app');
    // Phones get a bottom sheet (the widened app-mode branch); desktop
    // keeps the anchored popover.
    const useSheet = isApp || window.matchMedia('(max-width: 600px) and (pointer: coarse)').matches;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'send-menu';
    if (useSheet) menu.classList.add('send-menu-sheet');

    const song = ctx.songs[songIndex];
    if (useSheet) {
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('aria-label', song && song.title ? `${song.title}: song options` : 'Song options');
    }
    const icon = (paths, fill = 'none') => `<span class="send-menu-qicon"><svg viewBox="0 0 24 24" width="15" height="15" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg></span>`;
    const row = (cls, action, iconHtml, label, attrs = '') =>
        `<button type="button" class="send-menu-item${cls}" onclick="event.stopPropagation(); ${action}"${attrs}>${iconHtml}<span class="send-menu-name">${label}</span></button>`;

    let html = '';
    if (useSheet && song) {
        const sheetCover = safeUrl(song.cover);
        html += `<div class="send-menu-song">
            ${sheetCover
                ? `<img class="send-menu-song-cover" src="${escapeHtml(sheetCover)}" alt="">`
                : '<div class="send-menu-song-cover send-menu-song-cover-empty">&#9834;</div>'}
            <div class="send-menu-song-meta">
                <div class="send-menu-song-title">${escapeHtml(song.title || '')}</div>
                <div class="send-menu-song-artist">${escapeHtml(song.artist || '')}</div>
            </div>
        </div>`;
    }

    // The sheet's first page; its "Add to playlist…" page follows below.
    if (useSheet) html += '<div class="send-menu-main">';
    html += row('', `queuePlayNext(${songIndex}, ${ctxArg})`, icon('<path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15l4 3-4 3"/><path d="M21 18h-6"/>'), 'Play next');
    html += row('', `queueAdd(${songIndex}, ${ctxArg})`, icon('<path d="M4 6h12M4 12h12M4 18h8"/><path d="M18 15v6M15 18h6"/>'), 'Add to queue');
    // The phone playlist screen hides the row hearts (any pointer at that
    // width), so favoriting lives in this menu there.
    const heartsHidden = !!document.documentElement.dataset.mTab && window.matchMedia('(max-width: 600px)').matches;
    if ((useSheet || heartsHidden) && song && ctx.id !== 'favorites') {
        const liked = favoriteKeys.has(songPlayKey(song));
        html += row(` send-menu-like${liked ? ' is-fav' : ''}`, `likeFromSheet(${songIndex}, ${ctxArg})`,
            icon('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.07a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.8-8.85a5.5 5.5 0 0 0 0-7.78z"/>', liked ? 'currentColor' : 'none'),
            liked ? 'Remove from Favorites' : 'Add to Favorites', ` aria-pressed="${liked}"`);
    }

    const targets = Object.keys(playlistsMeta).filter(id => id !== ctx.id
        && !(id === 'favorites' && song && favoriteKeys.has(songPlayKey(song))));
    if (useSheet) {
        // One "Add to playlist…" instead of every playlist twice (send / keep a copy).
        if (targets.length) {
            html += row(' send-menu-open-picker', 'showSongPicker()',
                icon('<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><path d="M19 17v6M16 20h6"/>'), 'Add to playlist…');
        }
        // From Now Playing: jump to the song in its playlist.
        if (btn && btn.id === 'mNpKebab' && typeof window.mGoToSong === 'function') {
            html += row('', `mGoToSong(${songIndex})`, icon('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'), 'Show in playlist');
        }
        html += '<div class="send-menu-divider"></div>';
        html += `<button type="button" class="send-menu-item send-menu-delete" onclick="event.stopPropagation(); mArmDelete(this, ${songIndex}, ${ctxArg})">
            <span class="send-menu-delete-icon" aria-hidden="true">&#10005;</span>
            <span class="send-menu-name">Remove from this playlist</span>
        </button>`;
        html += `<button type="button" class="send-menu-cancel" onclick="event.stopPropagation(); closeSendMenu()">Cancel</button>`;
        html += '</div>';

        // Page two: which playlist, and copy or move.
        const fromName = playlistsMeta[ctx.id] ? playlistsMeta[ctx.id].name : 'this playlist';
        html += `<div class="send-menu-picker" hidden>
            <div class="send-menu-picker-head">
                <button type="button" class="send-menu-picker-back" onclick="event.stopPropagation(); hideSongPicker()" aria-label="Back">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>
                </button>
                <span class="send-menu-picker-title" role="heading" aria-level="2">Add to playlist</span>
            </div>
            <label class="send-menu-move" onclick="event.stopPropagation()">
                <span class="send-menu-move-text"><b>Move instead of copy</b><small>Takes it out of “${escapeHtml(fromName)}”</small></span>
                <input type="checkbox" class="send-menu-move-input" role="switch">
                <span class="send-menu-switch" aria-hidden="true"></span>
            </label>
            ${targets.map(id => {
                const meta = playlistsMeta[id];
                const thumb = safeUrl(playlistThumbUrl(id));
                const color = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#d4a574';
                const count = meta.songCount || 0;
                return `<button type="button" class="send-menu-item send-menu-pick" data-playlist="${escapeHtml(id)}" onclick="event.stopPropagation(); pickSongTarget(this.dataset.playlist, ${songIndex}, ${ctxArg})">
                    <span class="send-menu-pick-art" aria-hidden="true" style="--pl-color:${color}">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '&#9834;'}</span>
                    <span class="send-menu-pick-text"><span class="send-menu-name">${escapeHtml(meta.name)}</span><small>${count} ${count === 1 ? 'song' : 'songs'}</small></span>
                </button>`;
            }).join('')}
        </div>`;
    } else {
        // Desktop popover: send (move) straight to a playlist.
        html += '<div class="send-menu-divider"></div>';
        html += '<div class="send-menu-title">Send to...</div>';
        for (const id of targets) {
            const meta = playlistsMeta[id];
            const idJs = JSON.stringify(String(id));
            const colorAttr = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#888';
            html += `
                <div class="send-menu-item" onclick="event.stopPropagation(); moveSongTo(${escapeHtml(idJs)}, ${songIndex}, ${ctxArg})" style="cursor:pointer">
                    <span class="send-menu-dot" style="background:${colorAttr}"></span>
                    <span class="send-menu-name">${escapeHtml(meta.name)}</span>
                </div>`;
        }
    }

    menu.innerHTML = html;

    if (useSheet) {
        const smBackdrop = document.createElement('div');
        smBackdrop.className = 'send-menu-backdrop';
        smBackdrop.onclick = function() { if (!sendMenuJustSwitched()) closeSendMenu(); };
        document.body.appendChild(smBackdrop);
        document.body.appendChild(menu);
    } else {
        menu.style.position = 'fixed';
        menu.style.top = (rect.bottom + 4) + 'px';
        menu.style.left = (rect.left - 160) + 'px';
        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        if (menuRect.right > window.innerWidth - 8) {
            menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
        }
        if (menuRect.bottom > window.innerHeight - 8) {
            // Flip above the button, but never off the top: a long playlist
            // list scrolls inside the popover instead.
            menu.style.maxHeight = 'calc(100vh - 16px)';
            menu.style.overflowY = 'auto';
            const h = menu.getBoundingClientRect().height;
            menu.style.top = Math.max(8, Math.min(rect.top - h - 4, window.innerHeight - h - 8)) + 'px';
        }
        // Narrow windows: rect.left - 160 can land off-screen left
        if (menu.getBoundingClientRect().left < 8) {
            menu.style.left = '8px';
        }
    }

    activeSendMenu = menu;
    setTimeout(() => document.addEventListener('click', onSendMenuOutsideClick), 0);
}

function songToast(msg) {
    if (window.mToast && window.matchMedia('(max-width: 600px)').matches) mToast(msg);
    else showToast(msg);
}

// A failed copy/move: say why (no connection, or the server's reason).
function songTransferFailed(verb, result) {
    songToast(result && result.error
        ? `Couldn't ${verb} the song: ${result.error}`
        : `Couldn't ${verb} the song. Check your connection and try again.`);
}

// Copy, move and remove address a song by its position: while one is still
// saving, another would hit whatever song slid into that position.
// A reorder still saving counts too: an index sent now could reach the
// server ahead of the new order.
let songOpInFlight = false;
function songOpBusy() {
    if (!songOpInFlight && !(reordersPending > 0)) return false;
    songToast('Still saving your last change…');
    return true;
}

// POST to /save-music, giving up after a while (a hung request must end in
// the failure message, not keep the next change waiting forever).
async function saveMusicRequest(body, ms = 15000) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms) : 0;
    try {
        const response = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctl ? ctl.signal : undefined
        });
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

// ctx: which list songIndex is into (see songCtx). The list and its playlist
// are held from the call on, whatever is on screen when the answer lands.
async function copySongTo(toPlaylist, songIndex, ctx) {
    if (songOpBusy()) return;
    const menu = activeSendMenu;
    const { id: fromPlaylist, songs: arr } = songCtx(ctx);
    const song = arr[songIndex];
    const genAt = viewGen;
    let result = null;
    songOpInFlight = true;
    writeBegin(toPlaylist);
    try {
        result = await saveMusicRequest({ action: 'copySong', fromPlaylist, toPlaylist, songIndex });
    } catch (e) { /* reported below */ }
    writeEnd(toPlaylist);
    songOpInFlight = false;
    if (!result || !result.success) {
        songTransferFailed('copy', result);
        // Refused by position: this list no longer matches the server's.
        if (result && result.error === 'Invalid playlist or song index') resyncList(fromPlaylist, arr);
    } else {
        // A copy into Favorites is a like.
        if (toPlaylist === 'favorites' && song) {
            favoriteKeys.add(songPlayKey(song));
            updateFavoriteHearts();
        }
        playlistsMeta[toPlaylist].songCount = result.toCount;
        // Update target badge on crate
        setCrateCardCount(toPlaylist, result.toCount);
        // A loaded copy of the target list (playing, or on screen) takes it too
        if (song) joinList(toPlaylist, song, { genAt });
        // Flash the song item (only when its list is the one on screen)
        const songItem = arr === listSongs() ? document.querySelector(`#songList .song-list-item[data-index="${songIndex}"]`) : null;
        if (songItem) {
            songItem.classList.add('copied-flash');
            setTimeout(() => songItem.classList.remove('copied-flash'), 600);
        }
        if (window.mToast && window.matchMedia('(max-width: 600px)').matches) {
            const toMeta = playlistsMeta[toPlaylist];
            mToast('Copied to ' + (toMeta ? toMeta.name : 'playlist'));
        }
    }
    if (!menu || activeSendMenu === menu) closeSendMenu();
}

// ctx: as copySongTo. Only a move out of the playing list touches playback.
async function moveSongTo(toPlaylist, songIndex, ctx) {
    if (songOpBusy()) return;
    const menu = activeSendMenu;
    const { id: fromPlaylist, songs: arr } = songCtx(ctx);
    const moved = arr[songIndex];
    const movedKey = moved ? songPlayKey(moved) : '';
    const genAt = viewGen;
    let result = null;
    songOpInFlight = true;
    writeBegin(fromPlaylist);
    writeBegin(toPlaylist);
    try {
        result = await saveMusicRequest({ action: 'moveSong', fromPlaylist, toPlaylist, songIndex });
    } catch (e) { /* reported below */ }
    writeEnd(fromPlaylist);
    writeEnd(toPlaylist);
    songOpInFlight = false;
    if (!result || !result.success) {
        songTransferFailed('move', result);
        if (result && result.error === 'Invalid playlist or song index') resyncList(fromPlaylist, arr);
    } else {
        const playing = arr === songsData;
        const waiting = playing && currentRowUnloaded; // see deleteSong
        const wasPlaying = playing && songIndex === currentSongIndex && !waiting;
        arr.splice(songIndex, 1);
        // Into Favorites is a like; out of Favorites, an unlike (unless a
        // copy of it stays there).
        if (movedKey && toPlaylist === 'favorites') favoriteKeys.add(movedKey);
        if (movedKey && fromPlaylist === 'favorites' && !arr.some((s) => songPlayKey(s) === movedKey)) favoriteKeys.delete(movedKey);
        if (playing) {
            currentSongIndex = result.newIndex;
            if (shuffleMode !== 'off') buildShuffleQueue();
        } else if (arr === viewedSongs) {
            viewedResume = result.newIndex; // as the server moved it
        }
        if (playlistsMeta[fromPlaylist]) playlistsMeta[fromPlaylist].songCount = result.fromCount;
        playlistsMeta[toPlaylist].songCount = result.toCount;
        if (arr === listSongs()) rebuildSongList();
        updateTrackCount(fromPlaylist, arr);
        // Update target badge
        setCrateCardCount(toPlaylist, result.toCount);
        if (moved) joinList(toPlaylist, moved, { genAt });
        if (!playing) {
            // a viewed list emptied just shows its empty card
        } else if (songsData.length === 0) {
            if (waiting) currentRowUnloaded = false;
            else showEmptyPlaylistState(); // the last song left: nothing to show
        } else if (waiting) {
            currentRowUnloaded = currentRowStillUnloaded();
        } else if (wasPlaying) {
            const song = songsData[currentSongIndex];
            updateSongDisplay(song);
            playSongSource(song, true);
            loadLyricsForSong(song); // keep lyrics in sync with the shown song
        }
        if (window.mToast && window.matchMedia('(max-width: 600px)').matches) {
            const toMeta = playlistsMeta[toPlaylist];
            mToast('Moved to ' + (toMeta ? toMeta.name : 'playlist'));
        }
    }
    if (!menu || activeSendMenu === menu) closeSendMenu();
}

// ============================================================
// DYNAMIC VINYL CRATE
// ============================================================

function updateCrateRecords() {
    const container = document.getElementById('crateRecords');
    if (!container) return;
    container.innerHTML = recentlyPlayed
        .filter(id => playlistsMeta[id])
        .map(id => {
            const meta = playlistsMeta[id];
            const colorAttr = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#888';
            const idJs = JSON.stringify(String(id));
            return `<div class="crate-record" data-crate-playlist="${escapeHtml(id)}" style="--r-color: ${colorAttr};" onclick="selectPlaylistFromCrate(${escapeHtml(idJs)})" title="${escapeHtml(meta.name)}"></div>`;
        }).join('');
}


// ============================================================
// RECENTLY PLAYED SONGS — homescreen "Jump back in" shelf
// ============================================================

// Stable per-song identity, mirroring the server's playKey() so the client
// and server dedupe the same way.
function songPlayKey(song) {
    if (!song) return '';
    if (song.youtube_id) return 'yt:' + song.youtube_id;
    if (song.spotify_id) return 'sp:' + song.spotify_id;
    if (song.mp3_url) return 'mp3:' + String(song.mp3_url).trim();
    // Mirror the server's playKey normalization (trim + lowercase title|artist)
    // so client and server dedupe the same id-less songs.
    return 'tt:' + String(song.title || '').trim().toLowerCase() + '|' + String(song.artist || '').trim().toLowerCase();
}

// Log a play: bump this song to the front of the local shelf (so returning to
// the crate without a reload shows it) and persist server-side. Best-effort —
// a failed sync must never break playback. Called once per real track start.
function recordPlay(song) {
    if (!song || !song.title) return;
    const entry = {
        title: song.title || '',
        artist: song.artist || '',
        album: song.album || '',
        cover: song.cover || '',
        youtube_id: song.youtube_id || '',
        mp3_url: song.mp3_url || '',
        spotify_id: song.spotify_id || '',
    };
    const key = songPlayKey(entry);
    const prev = Array.isArray(recentSongs) ? recentSongs : [];
    recentSongs = [entry, ...prev.filter(s => songPlayKey(s) !== key)].slice(0, 12);
    updateRecentSongs();

    try {
        fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'recordPlay', song: entry })
        }).catch(() => { /* best-effort; server reorders on next load */ });
    } catch (e) { /* best-effort */ }
}

// Re-render the shelf from the `recentSongs` array; hide it entirely when empty.
function updateRecentSongs() {
    const shelf = document.getElementById('recentSongsShelf');
    const track = document.getElementById('recentSongsTrack');
    if (!shelf || !track) return;
    const list = Array.isArray(recentSongs) ? recentSongs : [];
    if (list.length === 0) {
        shelf.classList.add('hidden');
        track.innerHTML = '';
        return;
    }
    track.innerHTML = list.map((song, i) => {
        const cover = safeUrl(song.cover);
        const coverHtml = cover
            ? `<img class="recent-song-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">`
            : `<div class="recent-song-cover recent-song-cover-empty"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></div>`;
        const artist = song.artist
            ? `<div class="recent-song-artist">${escapeHtml(song.artist)}</div>`
            : '';
        const label = (song.artist ? song.artist + ' — ' : '') + song.title;
        return `
            <button type="button" class="recent-song" onclick="playRecentSong(${i})" title="${escapeHtml(label)}">
                <div class="recent-song-art">
                    ${coverHtml}
                    <span class="recent-song-play"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6.4 5.6a1.1 1.1 0 0 1 1.68-.94l9.6 6.4a1.1 1.1 0 0 1 0 1.88l-9.6 6.4a1.1 1.1 0 0 1-1.68-.94z"/></svg></span>
                </div>
                <div class="recent-song-title">${escapeHtml(song.title)}</div>
                ${artist}
            </button>`;
    }).join('');
    shelf.classList.remove('hidden');
    fitRecentSongsRow();
}

// The desktop crate lays "Jump back in" on the playlist grid's columns as a
// single row: hide the songs that would wrap to a second one (hidden, not
// clipped, so they leave the tab order too). Other layouts scroll the shelf
// and keep them all.
function fitRecentSongsRow() {
    const track = document.getElementById('recentSongsTrack');
    if (!track) return;
    const songs = track.querySelectorAll('.recent-song');
    songs.forEach(s => { s.hidden = false; });
    if (!window.matchMedia('(min-width: 901px) and (min-height: 501px)').matches) return;
    const columns = getComputedStyle(track).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (columns > 1) songs.forEach((s, i) => { s.hidden = i >= columns; });
}
let fitRecentSongsFrame = 0;
window.addEventListener('resize', () => {
    cancelAnimationFrame(fitRecentSongsFrame);
    fitRecentSongsFrame = requestAnimationFrame(fitRecentSongsRow);
});

// Reveal the player view (the crate<->player toggle), independent of
// selectPlaylistFromCrate's in-flight guard so a shelf tap always opens it.
function openPlayerView() {
    const crate = document.getElementById('vinylCrateView');
    const player = document.getElementById('musicPlayerView');
    if (crate) crate.classList.add('hidden');
    if (player) player.classList.add('active');
}

// Resume a recently-played song: open the player and play that exact song.
// Play it by index only when it's in the loaded playlist AND matched on a real
// streaming id (a title|artist key can collide with a different track);
// otherwise play it directly as a one-off. If it's already the current track,
// (re)start it rather than no-op'ing on switchSong's same-index guard.
// opts.stay: play without opening the player (the phone Home tab).
async function playRecentSong(i, opts = {}) {
    const song = Array.isArray(recentSongs) ? recentSongs[i] : null;
    if (!song) return;
    if (!opts.stay) openPlayerView();
    const key = songPlayKey(song);
    const hasId = !!(song.youtube_id || song.spotify_id || song.mp3_url);
    const idx = hasId && Array.isArray(songsData)
        ? songsData.findIndex(s => songPlayKey(s) === key)
        : -1;
    if (idx === -1) {
        playRadioSong(song);
    } else if (idx === currentSongIndex && !currentRadioSong && !currentRowUnloaded) {
        playSongSource(songsData[idx], false);
    } else {
        switchSong(idx);
    }
}


// ============================================================
// FAVORITES — heart toggle into the Favorites playlist
// ============================================================

// Refresh every visible heart from the favoriteKeys set (after a toggle or a
// list rebuild), keyed by each row's real index in the list on screen.
function updateFavoriteHearts() {
    const list = listSongs();
    document.querySelectorAll('#songList .song-fav-btn').forEach(btn => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        const song = list[idx];
        if (!song) return;
        btn.classList.toggle('is-fav', favoriteKeys.has(songPlayKey(song)));
    });
}

// Toggle a song in/out of the Favorites playlist. Optimistic — the heart flips
// immediately and reverts if the server rejects. `index`: a row of the list
// on screen.
async function toggleFavorite(index) {
    return toggleFavoriteSong(listSongs()[index]);
}

async function toggleFavoriteSong(song) {
    if (!song) return;
    const key = songPlayKey(song);
    const wasFav = favoriteKeys.has(key);
    if (wasFav) favoriteKeys.delete(key); else favoriteKeys.add(key);
    updateFavoriteHearts();

    writeBegin('favorites');
    try {
        const res = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'favorite', song })
        });
        const data = await res.json();
        if (data && data.success) {
            if (data.favorited) favoriteKeys.add(data.key); else favoriteKeys.delete(data.key);
            // A loaded Favorites list (playing, or on screen) follows what the
            // server did (it appends a like; an unlike drops its first match),
            // never what the heart assumed. Otherwise the card's count follows.
            const mirrored = data.favorited ? joinList('favorites', song) : dropFavorite(data.key);
            if (!mirrored && typeof playlistsMeta === 'object' && playlistsMeta.favorites) {
                playlistsMeta.favorites.songCount = (playlistsMeta.favorites.songCount || 0) + (data.favorited ? 1 : -1);
                setCrateCardCount('favorites', playlistsMeta.favorites.songCount);
            }
        } else {
            if (wasFav) favoriteKeys.add(key); else favoriteKeys.delete(key);
        }
    } catch (e) {
        if (wasFav) favoriteKeys.add(key); else favoriteKeys.delete(key);
    } finally {
        writeEnd('favorites');
    }
    updateFavoriteHearts();
}


// ============================================================
// GLOBAL LIBRARY SEARCH — find any song across all playlists
// ============================================================

let librarySearchTimer = null;
let librarySearchResults = [];

function showSearchModal() {
    const modal = document.getElementById('searchModal');
    if (!modal) return;
    modal.classList.add('active');
    const input = document.getElementById('librarySearchInput');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 60); }
    const results = document.getElementById('searchResults');
    if (results) results.innerHTML = '<div class="search-hint">Type to search across all your playlists.</div>';
    librarySearchResults = [];
}

function hideSearchModal() {
    const modal = document.getElementById('searchModal');
    if (modal) modal.classList.remove('active');
}

function runLibrarySearch() {
    const input = document.getElementById('librarySearchInput');
    const results = document.getElementById('searchResults');
    if (!input || !results) return;
    const q = input.value.trim();
    if (librarySearchTimer) clearTimeout(librarySearchTimer);
    if (q.length < 2) {
        results.innerHTML = '<div class="search-hint">Type to search across all your playlists.</div>';
        return;
    }
    librarySearchTimer = setTimeout(async () => {
        try {
            const list = await fetchLibrarySearch(q);
            // Ignore a stale response if the query moved on.
            if (input.value.trim() !== q) return;
            renderSearchResults(list, q);
        } catch (e) {
            results.innerHTML = '<div class="search-hint">Search failed. Try again.</div>';
        }
    }, 220);
}

// Songs matching q across every playlist (throws on a network error).
async function fetchLibrarySearch(q) {
    const res = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'searchLibrary', q })
    });
    const data = await res.json();
    return data && Array.isArray(data.results) ? data.results : [];
}

function renderSearchResults(list, q) {
    const results = document.getElementById('searchResults');
    if (!results) return;
    librarySearchResults = list;
    if (!list.length) {
        results.innerHTML = `<div class="search-hint">No songs match “${escapeHtml(q)}”.</div>`;
        return;
    }
    // Click by array index — never inline the slug into the onclick attribute.
    results.innerHTML = list.map((r, i) => {
        const cover = safeUrl(r.cover);
        const coverHtml = cover
            ? `<img class="search-result-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">`
            : `<div class="search-result-cover search-result-cover-empty">${STATS_EMPTY_COVER}</div>`;
        const artist = r.artist ? `<span class="search-result-artist">${escapeHtml(r.artist)}</span>` : '';
        const color = /^#[0-9a-fA-F]{6}$/.test(r.playlistColor || '') ? r.playlistColor : '#d4a574';
        return `<button type="button" class="search-result" onclick="playSearchResult(${i})">
            ${coverHtml}
            <span class="search-result-info">
                <span class="search-result-title">${escapeHtml(r.title)}</span>
                ${artist}
            </span>
            <span class="search-result-pl" style="--pl-color:${color}">${escapeHtml(r.playlistName)}</span>
        </button>`;
    }).join('');
}

// Jump to a search hit: load its playlist (opens the player), then play it.
async function playSearchResult(i) {
    const r = librarySearchResults[i];
    if (!r) return;
    hideSearchModal();
    await playSearchHit(r);
}

// Open a search hit's playlist and play the hit.
async function playSearchHit(r) {
    const slug = String(r.playlistSlug);
    // A song asked of the player while the playlist loads (Next, another
    // song) is newer than this tap: then the hit is only pointed out.
    const seqAt = songRequestSeq;
    // The phone opens the playlist without playing it (resolving false if it
    // didn't load or the user left it meanwhile); elsewhere it switches to it.
    const ok = await selectPlaylistFromCrate(slug);
    // The playlist didn't load (offline, or deleted meanwhile): don't play a
    // song from whichever playlist is still showing.
    if (ok === false || String(listId()) !== slug || listLoading()) return;
    // The hit's position can be stale (the phone Search tab keeps results
    // while songs are removed or moved): check it's still the same song.
    const list = listSongs();
    let position = parseInt(r.position, 10);
    const key = songPlayKey(r);
    if (songPlayKey(list[position]) !== key) {
        position = list.findIndex(s => songPlayKey(s) === key);
        if (position < 0) {
            showToast('That song is no longer in this playlist.');
            return;
        }
    }
    if (!listIsPlaying()) {
        // Shown, not playing yet: playing the hit makes it the playing list,
        // like a tap on its row
        if (songRequestSeq !== seqAt) {
            if (typeof window.mFlashRow === 'function') window.mFlashRow(position);
            return;
        }
        startInViewedList(position);
        return;
    }
    // selectPlaylistFromCrate only cues the song at the playlist's saved index;
    // if that's the hit, start it explicitly (switchSong would early-return on
    // its same-index guard and nothing would play).
    if (position === currentSongIndex && !currentRadioSong && !currentRowUnloaded) {
        if (songsData[position]) playSongSource(songsData[position], false);
    } else {
        switchSong(position);
    }
}


// ============================================================
// LISTENING STATS — "Your listening" panel
// ============================================================

const STATS_EMPTY_COVER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';

let statsRange = (function () { try { return localStorage.getItem('statsRange') || 'all'; } catch (e) { return 'all'; } })();

async function showStatsModal(range) {
    const modal = document.getElementById('statsModal');
    if (!modal) return;
    // A caller may open it on a range (the phone You card is all time)
    // without changing the one remembered for next time.
    if (['week', 'month', 'year', 'all'].includes(range)) statsRange = range;
    modal.classList.add('active');
    syncStatsRangeButtons();
    fetchStats();
}

function setStatsRange(range) {
    statsRange = range;
    try { localStorage.setItem('statsRange', range); } catch (e) { /* private mode */ }
    syncStatsRangeButtons();
    fetchStats();
}

function syncStatsRangeButtons() {
    document.querySelectorAll('#statsRange .settings-source-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.range === statsRange));
}

let statsReqSeq = 0;
async function fetchStats() {
    const body = document.getElementById('statsBody');
    if (!body) return;
    body.innerHTML = '<div class="stats-loading">Loading…</div>';
    const seq = ++statsReqSeq;
    try {
        const res = await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'stats', range: statsRange })
        });
        const data = await res.json();
        if (seq !== statsReqSeq) return; // superseded by a newer range switch
        renderStats(data && data.stats ? data.stats : null);
    } catch (e) {
        if (seq === statsReqSeq) body.innerHTML = '<div class="stats-empty">Couldn\'t load your stats. Try again.</div>';
    }
}

function hideStatsModal() {
    const modal = document.getElementById('statsModal');
    if (modal) modal.classList.remove('active');
    // Back to the remembered range (a caller may have opened it on another)
    try { statsRange = localStorage.getItem('statsRange') || 'all'; } catch (e) { statsRange = 'all'; }
}

function renderStats(stats) {
    const body = document.getElementById('statsBody');
    if (!body) return;
    if (!stats || (!stats.distinctSongs && !stats.totalPlays)) {
        const msg = statsRange === 'all'
            ? 'Play some songs and your top tracks and artists will show up here.'
            : 'No plays in this period yet — try a wider range.';
        body.innerHTML = `<div class="stats-empty">
            <div class="stats-empty-icon">${STATS_EMPTY_COVER}</div>
            <p>${msg}</p>
        </div>`;
        return;
    }
    const num = n => Number(n || 0).toLocaleString();

    const summary = `
        <div class="stats-summary">
            <div class="stats-stat"><span class="stats-stat-num">${num(stats.totalPlays)}</span><span class="stats-stat-label">plays</span></div>
            <div class="stats-stat"><span class="stats-stat-num">${num(stats.distinctSongs)}</span><span class="stats-stat-label">songs</span></div>
            <div class="stats-stat"><span class="stats-stat-num">${num(stats.distinctArtists)}</span><span class="stats-stat-label">artists</span></div>
        </div>`;

    const songs = Array.isArray(stats.topSongs) ? stats.topSongs : [];
    const songsHtml = songs.length ? `
        <div class="stats-section">
            <div class="stats-section-label">Top songs</div>
            <ol class="stats-song-list">
                ${songs.map((s, i) => {
                    const cover = safeUrl(s.cover);
                    const coverHtml = cover
                        ? `<img class="stats-song-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">`
                        : `<div class="stats-song-cover stats-song-cover-empty">${STATS_EMPTY_COVER}</div>`;
                    const artist = s.artist ? `<span class="stats-song-artist">${escapeHtml(s.artist)}</span>` : '';
                    return `<li class="stats-song">
                        <span class="stats-rank">${i + 1}</span>
                        ${coverHtml}
                        <span class="stats-song-info">
                            <span class="stats-song-title">${escapeHtml(s.title)}</span>
                            ${artist}
                        </span>
                        <span class="stats-song-plays">${num(s.plays)}<span class="stats-plays-unit"> ${s.plays === 1 ? 'play' : 'plays'}</span></span>
                    </li>`;
                }).join('')}
            </ol>
        </div>` : '';

    const artists = Array.isArray(stats.topArtists) ? stats.topArtists : [];
    const maxA = artists.length ? Math.max(...artists.map(a => a.plays || 0)) : 0;
    const artistsHtml = artists.length ? `
        <div class="stats-section">
            <div class="stats-section-label">Top artists</div>
            <div class="stats-artist-list">
                ${artists.map(a => {
                    const pct = maxA > 0 ? Math.max(6, Math.round((a.plays / maxA) * 100)) : 0;
                    return `<div class="stats-artist">
                        <span class="stats-artist-name">${escapeHtml(a.artist)}</span>
                        <span class="stats-artist-bar"><span class="stats-artist-bar-fill" style="width:${pct}%"></span></span>
                        <span class="stats-artist-plays">${num(a.plays)}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>` : '';

    body.innerHTML = summary + songsHtml + artistsHtml;
}


// ============================================================
// SETTINGS — MUSIC SOURCE MANAGEMENT
// ============================================================

let musicSource = localStorage.getItem('musicSource') || 'youtube';
let ytPlayerReal = null; // Stores reference to actual YT player
let mp3PlayerProxy = null; // HTML5 Audio player wrapper

function showSettingsModal() {
    document.getElementById('settingsModal').classList.add('active');
    // Sync active button
    document.querySelectorAll('#settingsSourceOptions .settings-source-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.source === musicSource);
    });
    // Sync playback toggles with their current state
    const lyricsToggle = document.getElementById('settingsLyricsToggle');
    if (lyricsToggle) lyricsToggle.checked = lyricsEnabled;
    const crackleToggle = document.getElementById('settingsCrackleToggle');
    if (crackleToggle) crackleToggle.checked = crackleEnabled;
    // Reflect any running sleep timer in its status line.
    updateSleepLabel();
    // Always open on the Playback tab, and sync the crossfade control.
    setSettingsTab('playback');
    document.querySelectorAll('#crossfadeOptions .settings-source-btn').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.xf, 10) === crossfadeSeconds));
    // Sync the room-theme swatches and the sleeve pose
    syncThemeSwatches();
    syncSleeveStyleButtons();
    // Clear any leftover form status from a previous visit
    const nameStatus = document.getElementById('settingsNameStatus');
    if (nameStatus) nameStatus.textContent = '';
    const pwStatus = document.getElementById('settingsPasswordStatus');
    if (pwStatus) pwStatus.textContent = '';
    // Check Spotify status
    checkSpotifyStatus();
}

// Room themes are color-only: the head inline script applies the saved one
// before first paint; this just switches at runtime. Keep the list in sync
// with the html[data-theme] token sets in styles.css and the blade head map.
const ROOM_THEMES = ['blue-hour', 'golden-hour', 'after-hours', 'velvet', 'greenroom'];

function currentRoomTheme() {
    return document.documentElement.getAttribute('data-theme') || 'blue-hour';
}

function syncThemeSwatches() {
    const active = currentRoomTheme();
    document.querySelectorAll('#themeSwatchRow .theme-swatch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === active);
    });
}

window.setRoomTheme = function (name) {
    if (!ROOM_THEMES.includes(name)) name = 'blue-hour';
    if (name === 'blue-hour') {
        document.documentElement.removeAttribute('data-theme');
    } else {
        document.documentElement.setAttribute('data-theme', name);
    }
    const colors = window.__roomThemeColors || {};
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && colors[name]) meta.setAttribute('content', colors[name]);
    try { localStorage.setItem('musicTheme', name); } catch (e) { /* private mode */ }
    syncThemeSwatches();
};

// Lyrics sleeve pose: 'stand' (default) or 'lean' against the deck. The
// head script applies the saved choice before first paint.
function syncSleeveStyleButtons() {
    const active = document.documentElement.getAttribute('data-sleeve') === 'lean' ? 'lean' : 'stand';
    document.querySelectorAll('#sleeveStyleOptions .settings-source-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sleeve === active);
    });
}

window.setSleeveStyle = function (style) {
    if (style === 'lean') {
        document.documentElement.setAttribute('data-sleeve', 'lean');
    } else {
        document.documentElement.removeAttribute('data-sleeve');
    }
    try { localStorage.setItem('sleeveStyle', style === 'lean' ? 'lean' : 'stand'); } catch (e) { /* private mode */ }
    syncSleeveStyleButtons();
};

function setLyricsEnabledFromSettings(on) {
    if (on !== lyricsEnabled) toggleLyrics();
}

function setCrackleEnabledFromSettings(on) {
    setCrackleEnabled(on);
}

function setSettingsStatus(id, message, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('err', !ok);
}

function firstValidationError(data, fallback) {
    if (data && data.errors) {
        const key = Object.keys(data.errors)[0];
        if (key && data.errors[key][0]) return data.errors[key][0];
    }
    return (data && data.message) || fallback;
}

async function saveAccountName() {
    const input = document.getElementById('settingsNameInput');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        setSettingsStatus('settingsNameStatus', 'Name cannot be empty.', false);
        return;
    }
    try {
        const resp = await fetch('/settings/name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
            setSettingsStatus('settingsNameStatus', 'Name saved.', true);
            if (window.mOnAccountName) window.mOnAccountName(name);
        } else {
            setSettingsStatus('settingsNameStatus', firstValidationError(data, 'Could not save the name.'), false);
        }
    } catch (e) {
        setSettingsStatus('settingsNameStatus', 'Network error — try again.', false);
    }
}

async function attachAccountEmail() {
    const email = document.getElementById('settingsAttachEmail');
    const pin = document.getElementById('settingsAttachEmailPin');
    if (!email || !pin) return;
    try {
        const resp = await fetch('/settings/email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ email: email.value.trim().toLowerCase(), current_password: pin.value }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
            pin.value = '';
            setSettingsStatus('settingsAttachEmailStatus', 'Email attached — you can log in with it now.', true);
            const label = document.getElementById('settingsAccountEmail');
            if (label) label.textContent = data.email + ' · ' + label.textContent.replace(' · no email attached', '');
            if (window.mOnAccountEmail) window.mOnAccountEmail(data.email);
        } else {
            setSettingsStatus('settingsAttachEmailStatus', firstValidationError(data, 'Could not attach the email.'), false);
        }
    } catch (e) {
        setSettingsStatus('settingsAttachEmailStatus', 'Network error — try again.', false);
    }
}

async function changeAccountPassword() {
    const current = document.getElementById('settingsCurrentPassword');
    const fresh = document.getElementById('settingsNewPassword');
    const confirm = document.getElementById('settingsNewPasswordConfirm');
    if (!current || !fresh || !confirm) return;
    if (fresh.value !== confirm.value) {
        setSettingsStatus('settingsPasswordStatus', 'New passwords do not match.', false);
        return;
    }
    try {
        const resp = await fetch('/settings/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                current_password: current.value,
                password: fresh.value,
                password_confirmation: confirm.value,
            }),
        });
        const data = await resp.json();
        if (resp.ok && data.success) {
            current.value = fresh.value = confirm.value = '';
            setSettingsStatus('settingsPasswordStatus', 'Password updated.', true);
        } else {
            setSettingsStatus('settingsPasswordStatus', firstValidationError(data, 'Could not update the password.'), false);
        }
    } catch (e) {
        setSettingsStatus('settingsPasswordStatus', 'Network error — try again.', false);
    }
}

function hideSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

function setMusicSource(source) {
    musicSource = source;
    localStorage.setItem('musicSource', source);
    // Update active button
    document.querySelectorAll('#settingsSourceOptions .settings-source-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.source === source);
    });
    // Update add song form hints
    updateAddSongFormForSource();
}

function updateAddSongFormForSource() {
    const label = document.getElementById('addSongSourceLabel');
    const input = document.getElementById('addSongYoutube');
    if (!label || !input) return;

    // File upload only makes sense for the MP3 source
    const uploadGroup = document.getElementById('addSongUploadGroup');
    if (uploadGroup) uploadGroup.style.display = musicSource === 'mp3' ? '' : 'none';

    if (musicSource === 'mp3') {
        label.textContent = 'MP3 URL';
        input.placeholder = 'https://example.com/song.mp3 — or upload below';
    } else if (musicSource === 'spotify') {
        label.textContent = 'Spotify URL';
        input.placeholder = 'https://open.spotify.com/track/...';
    } else {
        label.textContent = 'YouTube URL or ID';
        input.placeholder = 'https://youtube.com/watch?v=... or video ID';
    }
}

// ============================================================
// MP3 AUDIO PLAYER (HTML5 Audio wrapper mimicking YT API)
// ============================================================

function createMp3Player() {
    const audio = new Audio();
    audio.preload = 'auto';

    // The browser refused to start a song nobody tapped for (e.g. an
    // auto-advance on a phone): it's loaded but silent, so call it paused
    // and say so. Other rejections (a newer src interrupting) stay quiet.
    const onPlayRefused = (e) => {
        if (!e || e.name !== 'NotAllowedError') return;
        mp3PlayerProxy._state = 2;
        if (ytPlayer === mp3PlayerProxy) showPlayBlockedHint();
    };

    mp3PlayerProxy = {
        _audio: audio,
        _state: -1,
        loadVideoById: function(url) {
            this._state = 3;
            this._audio.src = url;
            this._audio.play().catch(onPlayRefused);
        },
        cueVideoById: function(url) {
            this._state = 5;
            this._audio.src = url;
            this._audio.load();
        },
        playVideo: function() {
            this._audio.play().catch(onPlayRefused);
        },
        pauseVideo: function() {
            this._audio.pause();
        },
        seekTo: function(seconds) {
            this._audio.currentTime = seconds;
        },
        setVolume: function(vol) {
            this._audio.volume = Math.min(1, Math.max(0, vol / 100));
        },
        getVolume: function() { return Math.round(this._audio.volume * 100); },
        isMuted: function() { return this._audio.muted; },
        mute: function() { this._audio.muted = true; },
        unMute: function() { this._audio.muted = false; },
        getPlayerState: function() { return this._state; },
        getCurrentTime: function() { return this._audio.currentTime || 0; },
        getDuration: function() { return this._audio.duration || 0; },
        setPlaybackRate: function(rate) { this._audio.playbackRate = rate; },
        getPlaybackRate: function() { return this._audio.playbackRate; }
    };

    audio.addEventListener('playing', () => {
        mp3PlayerProxy._state = 1;
        if (ytPlayer === mp3PlayerProxy) onPlayerStateChange({ data: 1 });
    });
    audio.addEventListener('pause', () => {
        if (!audio.ended) {
            mp3PlayerProxy._state = 2;
            if (ytPlayer === mp3PlayerProxy) onPlayerStateChange({ data: 2 });
        }
    });
    audio.addEventListener('ended', () => {
        mp3PlayerProxy._state = 0;
        if (ytPlayer === mp3PlayerProxy) onPlayerStateChange({ data: 0 });
    });
    audio.addEventListener('waiting', () => {
        mp3PlayerProxy._state = 3;
    });
    // A file that won't load (deleted upload, dead link, bad format).
    audio.addEventListener('error', () => {
        if (ytPlayer !== mp3PlayerProxy || !audio.error || !audio.currentSrc) return;
        // Unstarted, not paused: pressing play then reloads the file (and
        // explains or skips again) instead of calling play() on a dead element.
        mp3PlayerProxy._state = -1;
        handleUnplayableSong(lastRequestedSong, "its audio file couldn't be loaded");
    });

    return mp3PlayerProxy;
}

// Switch active player based on song source
// A song plays from its local/uploaded file when that's its only source, or
// when it has a linked offline copy and the network is gone.
//
// PREFER_LOCAL_ON_PHONE: phones suspend the YouTube iframe when the screen
// locks, so dual-source songs would keep playing from their local file if
// this were on. Ships OFF until tested on real devices — flipping it changes
// engine choice, pitch availability, and view counts for dual-source songs.
const PREFER_LOCAL_ON_PHONE = false;

function songUsesMp3(song) {
    if (!song || !song.mp3_url) return false;
    if (!song.youtube_id || !navigator.onLine) return true;
    return PREFER_LOCAL_ON_PHONE
        && window.matchMedia('(max-width: 600px) and (pointer: coarse)').matches;
}

function activatePlayerForSong(song) {
    if (song && song.spotify_id && !song.youtube_id && !song.mp3_url && spotifyPlayerProxy && spotifyDeviceId) {
        // Spotify source (Premium playback)
        if (ytPlayer !== spotifyPlayerProxy) {
            if (ytPlayer === ytPlayerReal && ytPlayerReal) { try { ytPlayerReal.pauseVideo(); } catch(e) {} }
            if (mp3PlayerProxy && mp3PlayerProxy._audio) { try { mp3PlayerProxy._audio.pause(); } catch(e) {} }
        }
        ytPlayer = spotifyPlayerProxy;
    } else if (songUsesMp3(song)) {
        // MP3 source
        if (!mp3PlayerProxy) createMp3Player();
        if (ytPlayer !== mp3PlayerProxy) {
            if (ytPlayer === ytPlayerReal && ytPlayerReal) { try { ytPlayerReal.pauseVideo(); } catch(e) {} }
            if (spotifyPlayerProxy) { try { spotifyPlayerProxy.pauseVideo(); } catch(e) {} }
        }
        ytPlayer = mp3PlayerProxy;
    } else {
        // YouTube source (default)
        if (mp3PlayerProxy && mp3PlayerProxy._audio) { try { mp3PlayerProxy._audio.pause(); } catch(e) {} }
        if (spotifyPlayerProxy) { try { spotifyPlayerProxy.pauseVideo(); } catch(e) {} }
        if (ytPlayerReal) ytPlayer = ytPlayerReal;
    }
}

// Get playback source URL/ID from a song
function getPlaybackSource(song) {
    if (!song) return '';
    // Spotify Premium playback
    if (song.spotify_id && !song.youtube_id && !song.mp3_url && spotifyPlayerProxy && spotifyDeviceId) {
        return song.spotify_id;
    }
    if (songUsesMp3(song)) return song.mp3_url;
    return song.youtube_id || song.mp3_url || '';
}

// Unified play/cue function
// The song the player was last asked to load, and whether that was a real
// start (a tap, a skip, an auto-advance) or a silent cue. A cued song that
// turns out to be broken is only flagged; a started one moves on.
let lastRequestedSong = null;
let playRequested = false;
let unplayableStreak = 0;
// Bumped on every load/cue request, so a slow lookup can tell it's stale.
let songRequestSeq = 0;

// Set only by joinOnScreenList: switching into an empty playlist leaves the
// old track playing, and a song added to it then is the current row without
// being loaded. Until something is loaded, that row hasn't started: tapping
// it, Play, Next or the old track ending start it (see currentRowStarted).
let currentRowUnloaded = false;

function noteSongRequest(song, isPlay) {
    currentRowUnloaded = false;
    // An empty playlist's placeholder ({}) loads nothing: the player still
    // holds (and may still be playing) the song from before.
    const placeholder = !!song && !song.title && !song.youtube_id && !song.mp3_url && !song.spotify_id;
    if (!placeholder) lastRequestedSong = song || null;
    playRequested = !!isPlay;
    songRequestSeq++;
}

function currentRowStarted() {
    return !!currentRadioSong || !currentRowUnloaded;
}

// While a row waits: is the (new) current row still not the track the
// player holds? The track itself counts as started.
function currentRowStillUnloaded() {
    const cur = songsData[currentSongIndex];
    return !!cur && !(lastRequestedSong && songPlayKey(lastRequestedSong) === songPlayKey(cur));
}

// A song that can't play (YouTube refused or removed the video, the audio
// file is broken, or no match was found) must never leave the player sitting
// silent: say so, flag its row, and move on as if it had ended. Several
// failures in a row stop playback instead of racing through the list.
function handleUnplayableSong(song, reason) {
    if (song) {
        song._unplayable = reason;
        // Its row, when the playing list is the one on screen
        const idx = listIsPlaying() ? songsData.indexOf(song) : -1;
        const row = idx >= 0 ? document.querySelector(`#songList .song-list-item[data-index="${idx}"]`) : null;
        if (row) {
            row.classList.add('song-unplayable');
            row.title = `Can't play: ${reason}`;
        }
    }
    if (!playRequested || !song || song !== lastRequestedSong) return;
    playRequested = false;
    const name = song.title ? `“${song.title}”` : 'This song';
    unplayableStreak++;
    const alone = loopMode === 'single' || (!currentRadioSong && songsData.length <= 1);
    if (alone || unplayableStreak >= Math.min(5, songsData.length || 1)) {
        unplayableStreak = 0;
        showBulkToast(`${name} can't play: ${reason}.`
            + (alone ? '' : ' Several songs in a row couldn’t play, so playback stopped.'));
        return;
    }
    showBulkToast(`${name} can't play: ${reason}. Skipping to the next song.`);
    // The failure can land mid-switch (switchSong holds isChangingSong until
    // it has saved), when a skip would be ignored: wait for the switch. A
    // song asked for meanwhile (a tap that started another playlist) wins.
    const seq = songRequestSeq;
    let waited = 0;
    (function advance() {
        if (isChangingSong && waited < 5000) { waited += 100; setTimeout(advance, 100); return; }
        if (songRequestSeq !== seq) return;
        playNextByLoop();
    })();
}

function youtubeErrorReason(code) {
    if (code === 100) return 'the video was removed or made private';
    if (code === 101 || code === 150) return "its owner doesn't allow playing it outside YouTube";
    if (code === 2) return 'the video link is invalid';
    if (code === 5) return "the video can't play in this browser";
    return 'YouTube error ' + code;
}

async function playSongSource(song, cueOnly) {
    noteSongRequest(song, !cueOnly);
    const request = songRequestSeq;
    let source = getPlaybackSource(song);
    // Nothing playable stored yet: a Spotify-only track, or a title-only
    // import. Resolve a matching YouTube video so it still plays.
    if (!source && song && !song.youtube_id && !song.mp3_url && song.title) {
        const spotifyCanPlay = !!song.spotify_id && spotifyPremium && spotifyConnected;
        if (spotifyCanPlay && !spotifyDeviceId && !spotifySdkGaveUp) {
            // Premium and connected, but the Web Playback SDK hasn't reported
            // a device yet (it connects asynchronously after load): give it a
            // moment instead of failing silently. If it never shows up, stop
            // waiting for the rest of this session.
            spotifySdkGaveUp = !(await waitForSpotifyDevice(4000));
            if (request !== songRequestSeq) return; // another song was asked for meanwhile
            source = getPlaybackSource(song);
        }
        if (!source) {
            // Only remember the match when Spotify playback isn't an option
            // at all, so a slow SDK start doesn't permanently demote a
            // Premium track.
            source = await resolveYoutubeIdForSong(song, !spotifyCanPlay);
            // Another song was tapped, skipped to or started meanwhile; the
            // match is still saved on this song for next time.
            if (request !== songRequestSeq) return;
        }
    }
    if (!source) {
        if (!cueOnly && song && song.title) handleUnplayableSong(song, 'no matching video was found on YouTube');
        return;
    }
    activatePlayerForSong(song);
    if (cueOnly) {
        if (ytPlayer && ytPlayer.cueVideoById) ytPlayer.cueVideoById(source);
    } else {
        // Real (non-cue) start — playlist taps, autoplay/next, radio previews.
        // Log the play only when the load actually fires, so a song that never
        // played (no ready player) isn't recorded to the shelf. (toggleMusic's
        // cold-start path logs separately, since it bypasses playSongSource.)
        if (ytPlayer && ytPlayer.loadVideoById) {
            ytPlayer.loadVideoById(source);
            recordPlay(song);
            crossfadeInStart();
        }
    }
}

// Resolve a Spotify-only track to a YouTube video id. The server scrapes YT
// search and caches the match by spotify_id. With `remember` (the default)
// it also writes youtube_id onto the stored song and the in-memory one so
// the next play is instant; without it the id is used for this play only.
async function resolveYoutubeIdForSong(song, remember = true) {
    try {
        const idx = (remember && typeof songsData !== 'undefined') ? songsData.indexOf(song) : -1;
        const data = await postJsonRetrying('/spotify-resolve', {
            spotify_id: song.spotify_id || '',
            title: song.title || '',
            artist: song.artist || '',
            playlist_key: (remember && typeof activePlaylistId !== 'undefined') ? activePlaylistId : '',
            song_index: idx
        }, { retries: 2 });
        if (data.success && data.youtube_id) {
            if (remember) song.youtube_id = data.youtube_id;
            return data.youtube_id;
        }
    } catch (e) {}
    return '';
}

// Resolves true as soon as the Spotify SDK reports a device, false on timeout.
let spotifySdkGaveUp = false;
function waitForSpotifyDevice(timeoutMs) {
    return new Promise(resolve => {
        const started = Date.now();
        (function poll() {
            if (spotifyDeviceId) return resolve(true);
            if (Date.now() - started >= timeoutMs) return resolve(false);
            setTimeout(poll, 250);
        })();
    });
}

function isPlayerReady() {
    if (ytPlayer === mp3PlayerProxy) return true;
    if (ytPlayer === spotifyPlayerProxy) return !!spotifyDeviceId;
    return ytPlayerReady;
}

// ============================================================
// SPOTIFY WEB PLAYBACK SDK + CONNECTION
// ============================================================

let spotifyPlayerProxy = null;
let spotifyDeviceId = null;
let spotifyConnected = false;
let spotifyPremium = false;
let spotifyImportData = null; // Holds fetched playlist data for import

// Called by the Spotify SDK script when it loads
window.onSpotifyWebPlaybackSDKReady = function() {
    // Only init if user is connected and premium
    if (spotifyConnected && spotifyPremium) {
        initSpotifyPlayer();
    }
};

async function initSpotifyPlayer() {
    const tokenResp = await fetch('/spotify?action=token');
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return;

    const player = new Spotify.Player({
        name: 'Music Player',
        getOAuthToken: cb => {
            fetch('/spotify?action=token')
                .then(r => r.json())
                .then(d => cb(d.access_token))
                .catch(() => cb(''));
        },
        volume: (typeof currentVolume !== 'undefined' ? currentVolume : 100) / 100
    });

    player.addListener('ready', ({ device_id }) => {
        spotifyDeviceId = device_id;
    });

    player.addListener('not_ready', () => {
        spotifyDeviceId = null;
    });

    player.addListener('player_state_changed', state => {
        if (!state || !spotifyPlayerProxy) return;
        spotifyPlayerProxy._currentTime = (state.position || 0) / 1000;
        spotifyPlayerProxy._duration = (state.duration || 0) / 1000;

        if (!state.paused) {
            spotifyPlayerProxy._state = 1;
            if (ytPlayer === spotifyPlayerProxy) onPlayerStateChange({ data: 1 });
        } else if (state.position === 0 && state.track_window?.current_track === null) {
            spotifyPlayerProxy._state = 0;
            if (ytPlayer === spotifyPlayerProxy) onPlayerStateChange({ data: 0 });
        } else {
            spotifyPlayerProxy._state = 2;
            if (ytPlayer === spotifyPlayerProxy) onPlayerStateChange({ data: 2 });
        }
    });

    player.connect();

    spotifyPlayerProxy = {
        _player: player,
        _state: -1,
        _currentTime: 0,
        _duration: 0,
        loadVideoById: async function(spotifyId) {
            const uri = spotifyId.startsWith('spotify:') ? spotifyId : 'spotify:track:' + spotifyId;
            const t = await getSpotifyToken();
            if (!t || !spotifyDeviceId) return;
            fetch('https://api.spotify.com/v1/me/player/play?device_id=' + spotifyDeviceId, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
                body: JSON.stringify({ uris: [uri] })
            });
        },
        cueVideoById: function() { this._state = 5; },
        playVideo: function() { this._player.resume(); },
        pauseVideo: function() { this._player.pause(); },
        seekTo: function(sec) { this._player.seek(sec * 1000); },
        setVolume: function(v) { this._player.setVolume(v / 100); },
        getVolume: function() { return typeof currentVolume !== 'undefined' ? currentVolume : 100; },
        getPlayerState: function() { return this._state; },
        getCurrentTime: function() { return this._currentTime; },
        getDuration: function() { return this._duration; },
        setPlaybackRate: function() {},
        getPlaybackRate: function() { return 1; }
    };

    // Start progress polling for Spotify (since it doesn't push time updates as frequently)
    setInterval(() => {
        if (ytPlayer === spotifyPlayerProxy && spotifyPlayerProxy._state === 1) {
            player.getCurrentState().then(state => {
                if (state) {
                    spotifyPlayerProxy._currentTime = state.position / 1000;
                    spotifyPlayerProxy._duration = state.duration / 1000;
                }
            });
        }
    }, 200);
}

async function getSpotifyToken() {
    try {
        const r = await fetch('/spotify?action=token');
        const d = await r.json();
        return d.access_token || null;
    } catch(e) { return null; }
}

// Check Spotify connection status on settings open
async function checkSpotifyStatus() {
    try {
        const resp = await fetch('/spotify?action=status');
        const data = await resp.json();

        const notConfigured = document.getElementById('spotifyNotConfigured');
        const notConnected = document.getElementById('spotifyNotConnected');
        const connected = document.getElementById('spotifyConnected');
        if (!notConfigured || !notConnected || !connected) return;

        if (!data.configured) {
            notConfigured.style.display = '';
            notConnected.style.display = 'none';
            connected.style.display = 'none';
        } else if (data.connected) {
            spotifyConnected = true;
            spotifyPremium = data.user?.premium || false;
            notConfigured.style.display = 'none';
            notConnected.style.display = 'none';
            connected.style.display = '';

            const info = document.getElementById('spotifyUserInfo');
            const avatarUrl = safeUrl(data.user?.image);
            const avatar = avatarUrl ? `<img class="spotify-user-avatar" src="${escapeHtml(avatarUrl)}" alt="">` : '<div class="spotify-user-avatar"></div>';
            const badge = spotifyPremium ? '<span class="spotify-user-badge">PREMIUM</span>' : '';
            info.innerHTML = `${avatar}<span class="spotify-user-name">${escapeHtml(data.user?.name || 'Connected')}</span>${badge}`;

            // Init Web Playback SDK if premium and SDK loaded
            if (spotifyPremium && window.Spotify && !spotifyPlayerProxy) {
                initSpotifyPlayer();
            }
        } else {
            notConfigured.style.display = 'none';
            notConnected.style.display = '';
            connected.style.display = 'none';
        }
    } catch(e) {}
}

function connectSpotify() {
    fetch('/spotify?action=login')
        .then(r => r.json())
        .then(data => {
            if (data.authUrl) {
                window.location.href = data.authUrl;
            } else if (data.error) {
                alert(data.error);
            }
        });
}

function disconnectSpotify() {
    fetch('/spotify?action=logout')
        .then(() => {
            spotifyConnected = false;
            spotifyPremium = false;
            spotifyDeviceId = null;
            if (spotifyPlayerProxy?._player) {
                try { spotifyPlayerProxy._player.disconnect(); } catch(e) {}
            }
            spotifyPlayerProxy = null;
            checkSpotifyStatus();
        });
}

// Import modal
// opts.into === 'current': opened from a playlist ("Import into this
// playlist"), so its preview pre-selects that playlist over a new one.
let importIntoCurrent = false;
let importIntoNew = false;
// The playlist "Add to …" means, fixed when the window opens (the phone may
// show a playlist other than the one playing; Add songs names its own "To")
let importPlaylistId = null;

function showSpotifyImportModal(opts) {
    importIntoCurrent = !!(opts && opts.into === 'current');
    // 'new': the phone's Add songs aimed somewhere other than the open
    // playlist, which an import can't target, so it starts on a new one
    importIntoNew = !!(opts && opts.into === 'new');
    importPlaylistId = String(opts && opts.playlist != null ? opts.playlist : listId());
    spotifyImportData = null;
    importSelection = [];
    const pasteEl = document.getElementById('pasteImportInput');
    if (pasteEl) pasteEl.value = '';
    // Last time's links and status don't come back (Spotify's fields only
    // exist when this server can import from Spotify)
    ['spotifyImportUrl', 'youtubeImportUrl', 'spotifyProfileUrl'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const profileStatus = document.getElementById('spotifyProfileImportStatus');
    if (profileStatus) profileStatus.style.display = 'none';
    document.getElementById('spotifyImportPreview').style.display = 'none';
    document.getElementById('spotifyImportLoading').style.display = 'none';
    setImportTab('paste'); // no-setup path first; Spotify link is a tab away
    document.getElementById('spotifyImportModal').classList.add('active');

    // Load user playlists if connected
    const userPlaylists = document.getElementById('spotifyUserPlaylists');
    if (spotifyConnected && userPlaylists) {
        const container = userPlaylists;
        const list = document.getElementById('spotifyPlaylistsList');
        container.style.display = '';
        list.innerHTML = '<p class="settings-hint" style="text-align:center">Loading playlists...</p>';

        fetch('/spotify?action=playlists')
            .then(r => r.json())
            .then(data => {
                if (!data.success || !data.playlists?.length) {
                    list.innerHTML = '<p class="settings-hint">No playlists found</p>';
                    return;
                }
                list.innerHTML = data.playlists.map((pl, i) => {
                    const img = safeUrl(pl.image);
                    return `
                    <button class="spotify-playlist-item" data-pl-idx="${i}">
                        ${img ? `<img class="spotify-playlist-img" src="${escapeHtml(img)}" alt="">` : '<div class="spotify-playlist-img"></div>'}
                        <div class="spotify-playlist-info">
                            <div class="spotify-playlist-name">${escapeHtml(pl.name)}</div>
                            <div class="spotify-playlist-meta">${Number(pl.tracks) || 0} tracks &middot; ${escapeHtml(pl.owner)}</div>
                        </div>
                    </button>
                `;
                }).join('');
                list.querySelectorAll('.spotify-playlist-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const idx = parseInt(btn.dataset.plIdx, 10);
                        const pl = data.playlists[idx];
                        if (pl) fetchSpotifyPlaylistById(pl.id, pl.name);
                    });
                });
            })
            .catch(() => {
                list.innerHTML = '<p class="settings-hint">Could not load playlists</p>';
            });
    } else if (userPlaylists) {
        userPlaylists.style.display = 'none';
    }
}

function hideSpotifyImportModal() {
    importRunSeq++;
    document.getElementById('spotifyImportModal').classList.remove('active');
    spotifyImportData = null;
}

// Whole-library import, driven from the browser: `planBody` asks the server
// for the sources (the signed-in account's own library, or a public
// profile's playlists), then each one is imported in short chunks so a big
// library never ties up a single request. Progress goes to `status`, and the
// page reloads at the end. The server replaces each mirrored playlist's
// songs, so re-running syncs rather than duplicates.
async function runSpotifyLibraryImport(planBody, btn, status) {
    if (!btn || !status || btn.disabled) return;
    btn.disabled = true;
    status.style.display = '';
    const say = (msg) => { status.textContent = msg; };
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const post = async (body) => {
        const resp = await fetch('/spotify-library', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        // Our own throttle; wait it out like a Spotify rate limit.
        if (resp.status === 429) return { success: false, retry_after: Number(resp.headers.get('Retry-After')) || 5 };
        return resp.json();
    };

    try {
        say('Reading the Spotify library\u2026');
        const plan = await post(planBody);
        if (!plan.success) throw new Error(plan.error || 'Could not read that library');
        const sources = plan.sources || [];
        const skipped = Number(plan.skipped) || 0;
        const skippedNote = skipped
            ? ` Skipped ${skipped} Spotify-made playlist${skipped === 1 ? '' : 's'} this app can\u2019t read.`
            : '';
        if (sources.length === 0) throw new Error('Nothing to import: no playlists found.' + skippedNote);

        let imported = 0;
        const failed = [];
        for (let i = 0; i < sources.length; i++) {
            const src = sources[i];
            let offset = 0, done = false, waits = 0;
            while (!done) {
                say(`Importing ${i + 1}/${sources.length}: ${src.name} (${Math.min(offset, src.total)}/${src.total})\u2026`);
                const res = await post({ action: 'import', kind: src.kind, id: src.id, offset });
                if (!res.success) {
                    if (res.retry_after && waits++ < 5) { await sleep(res.retry_after * 1000); continue; }
                    failed.push(src.name);
                    break;
                }
                imported += res.imported;
                offset = res.next_offset;
                done = res.done;
            }
        }

        const ok = sources.length - failed.length;
        say(`Imported ${imported} song${imported === 1 ? '' : 's'} into ${ok} playlist${ok === 1 ? '' : 's'}`
            + (failed.length ? ` \u00b7 could not read: ${failed.join(', ')}` : '') + '.' + skippedNote + ' Reloading\u2026');
        await sleep(1500);
        // New crate cards live in server-rendered markup — reload, like createPlaylist does.
        location.reload();
    } catch (e) {
        say(e.message || 'Import failed');
        btn.disabled = false;
    }
}

// "Import everything": the signed-in account's Liked Songs + every playlist.
function importEntireSpotifyLibrary() {
    return runSpotifyLibraryImport(
        { action: 'plan' },
        document.getElementById('spotifyImportAllBtn'),
        document.getElementById('spotifyImportAllStatus')
    );
}

// A public profile's playlists, read with the app's own credentials — works
// without connecting Spotify (Liked Songs and private playlists can't).
function importSpotifyProfile() {
    const link = (document.getElementById('spotifyProfileUrl')?.value || '').trim();
    if (!link) return;
    return runSpotifyLibraryImport(
        { action: 'plan', profile: link },
        document.getElementById('spotifyProfileImportBtn'),
        document.getElementById('spotifyProfileImportStatus')
    );
}

async function fetchSpotifyPlaylistUrl() {
    const url = document.getElementById('spotifyImportUrl').value.trim();
    if (!url) return;
    showImportLoading();
    try {
        const resp = await fetch('/spotify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'import_url', url })
        });
        const data = await resp.json();
        if (data.success) {
            showImportPreview(data);
        } else {
            alert(data.error || 'Could not fetch playlist');
            hideImportLoading();
        }
    } catch(e) {
        alert('Network error');
        hideImportLoading();
    }
}

async function fetchSpotifyPlaylistById(playlistId, name) {
    showImportLoading();
    try {
        const resp = await fetch('/spotify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'playlist_tracks', playlist_id: playlistId })
        });
        const data = await resp.json();
        if (data.success) {
            showImportPreview({ name: name, songs: data.songs, total: data.songs.length });
        } else {
            alert(data.error || 'Could not fetch tracks');
            hideImportLoading();
        }
    } catch(e) {
        alert('Network error');
        hideImportLoading();
    }
}

function showImportLoading() {
    document.getElementById('spotifyImportLoading').style.display = '';
    document.getElementById('spotifyImportPreview').style.display = 'none';
}

function hideImportLoading() {
    document.getElementById('spotifyImportLoading').style.display = 'none';
}

// ---- Unified import checklist (Spotify link + paste list) ----------------
// Every import path fills importSelection and renders one reviewable list.
let importSelection = []; // {title, artist, album, cover, spotify_id, youtube_id, matchLabel, checked}
// Bumped when the import window resets or closes: a paste match still
// running from before (it can take minutes) stops instead of taking over.
let importRunSeq = 0;

function activeImportTab() {
    const active = document.querySelector('#importTabs .import-tab.active');
    return active ? active.dataset.tab : 'paste';
}

function setImportTab(tab) {
    document.querySelectorAll('#importTabs .import-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tab));
    resetImportPreview();
}

// Restore the input view for the active tab (also the "Back" target).
function resetImportPreview() {
    importRunSeq++;
    importSelection = [];
    const prev = document.getElementById('spotifyImportPreview');
    if (prev) prev.style.display = 'none';
    hideImportLoading();
    const tab = activeImportTab();
    document.getElementById('importTabs').style.display = '';
    document.getElementById('importPastePane').style.display = tab === 'paste' ? '' : 'none';
    document.getElementById('importYoutubePane').style.display = tab === 'youtube' ? '' : 'none';
    document.getElementById('importSpotifyPane').style.display = tab === 'spotify' ? '' : 'none';
}

// YouTube playlist: server scrapes the playlist page (no keys) and returns
// every track already resolved to a youtube_id.
async function fetchYoutubePlaylist() {
    const url = (document.getElementById('youtubeImportUrl').value || '').trim();
    if (!url) return;

    const loading = document.getElementById('spotifyImportLoading');
    const loadingText = document.getElementById('spotifyImportLoadingText');
    if (loadingText) loadingText.textContent = 'Loading playlist…';
    loading.style.display = '';
    document.getElementById('spotifyImportPreview').style.display = 'none';
    document.getElementById('importTabs').style.display = 'none';
    document.getElementById('importYoutubePane').style.display = 'none';

    let data;
    try {
        const resp = await fetch('/youtube-playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ url }),
        });
        data = await resp.json();
    } catch (e) {
        data = { success: false, error: 'Could not reach the server' };
    }

    if (!data.success || !Array.isArray(data.songs) || data.songs.length === 0) {
        hideImportLoading();
        resetImportPreview();
        showBulkToast(data.error || 'No tracks found in that playlist');
        return;
    }

    // No client cap: the server already limits playlists, and bulkAddSongs
    // saves in 200-song chunks.
    importSelection = data.songs.map(s => ({
        title: s.title, artist: s.artist || '', album: '', cover: s.cover || '',
        spotify_id: '', youtube_id: s.youtube_id, needsMatch: true, matchLabel: '', checked: true,
    }));
    renderImportChecklist(data.name || 'YouTube playlist', true,
        data.truncated ? `This playlist is longer: these are the first ${importSelection.length} songs.` : '');
}

// Where an import lands. A playlist (or a long pasted list) defaults to a new
// playlist named after its source, so it keeps its identity; a handful of
// pasted songs defaults to the playlist that's open.
let importSourceName = '';

function setImportTarget(sourceName, preferNew) {
    importSourceName = sourceName || '';
    const nameEl = document.getElementById('importTargetName');
    if (nameEl) nameEl.value = importSourceName;
    const current = document.getElementById('importTargetCurrent');
    const meta = typeof playlistsMeta === 'object' ? playlistsMeta[importPlaylistId || activePlaylistId] : null;
    if (current) current.textContent = meta && meta.name ? `Add to “${meta.name}”` : 'Current playlist';
    // No playlist yet (a brand-new account): there's no "current" to add to,
    // so the import makes its own playlist.
    const currentRadio = document.querySelector('input[name="importTarget"][value="current"]');
    if (currentRadio) {
        currentRadio.disabled = !meta;
        const option = currentRadio.closest('.import-target-option');
        if (option) option.style.display = meta ? '' : 'none';
    }
    const wantNew = !meta || importIntoNew || (preferNew && !importIntoCurrent);
    const radio = document.querySelector(`input[name="importTarget"][value="${wantNew ? 'new' : 'current'}"]`);
    if (radio) radio.checked = true;
    updateImportTarget();
}

function importTargetChoice() {
    const checked = document.querySelector('input[name="importTarget"]:checked');
    return checked ? checked.value : 'current';
}

function updateImportTarget() {
    const group = document.getElementById('importTargetNameGroup');
    if (group) group.hidden = importTargetChoice() !== 'new';
}

// `note` says what didn't come through (never cut a list silently).
function renderImportChecklist(title, preferNew = true, note = '') {
    setImportTarget(title, preferNew);
    hideImportLoading();
    const info = document.getElementById('spotifyImportInfo');
    const tracks = document.getElementById('spotifyImportTracks');
    const matched = importSelection.filter(s => s.youtube_id !== null).length;
    const noMatch = importSelection.length - matched;
    info.innerHTML = `<div><strong>${escapeHtml(title || 'Import')}</strong><br>`
        + `<span style="font-size:0.75rem;color:var(--app-text-dim)">${importSelection.length} songs`
        + (noMatch > 0 ? ` &middot; ${noMatch} without a match` : '') + `</span>`
        + (note ? `<br><span class="import-note">${escapeHtml(note)}</span>` : '') + `</div>`;

    tracks.innerHTML = importSelection.map((s, i) => {
        const disabled = s.youtube_id === null && s.needsMatch;
        const sub = s.matchLabel
            ? `<span class="import-track-match">${escapeHtml(s.matchLabel)}</span>`
            : `<span class="import-track-sub">${escapeHtml(s.artist || '')}</span>`;
        return `<label class="import-check-row${disabled ? ' no-match' : ''}">
            <input type="checkbox" ${s.checked && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''} onchange="importSelection[${i}].checked=this.checked; updateImportAddBtn()">
            <span class="import-track-body">
                <span class="import-track-title">${escapeHtml(s.title)}</span>
                ${sub}
            </span>
        </label>`;
    }).join('');

    // Collapse the input view — the checklist takes over until Back.
    document.getElementById('importTabs').style.display = 'none';
    document.getElementById('importPastePane').style.display = 'none';
    document.getElementById('importSpotifyPane').style.display = 'none';
    document.getElementById('spotifyImportPreview').style.display = '';
    updateImportAddBtn();
}

// One import at a time: a double-click (or a second click during a slow,
// multi-chunk import) would send newPlaylist twice and make two playlists.
let importSaving = false;

function updateImportAddBtn() {
    // Addable = checked and playable. Spotify tracks use '' (resolve on play);
    // an unmatched paste line uses null and can't be added.
    const n = importSelection.filter(s => s.checked && s.youtube_id !== null).length;
    const btn = document.getElementById('importAddBtn');
    if (btn && !importSaving) {
        btn.textContent = n > 0 ? `Add ${n} song${n === 1 ? '' : 's'}` : 'Add songs';
        btn.disabled = n === 0;
    }
}

// Spotify preview: tracks are exact; YouTube id resolves lazily on play, so
// they need no per-song match here (youtube_id '' is playable via resolve).
function showImportPreview(data) {
    hideImportLoading();
    const songs = data.songs || [];
    importSelection = songs.map(s => ({
        title: s.title, artist: s.artist, album: s.album || '', cover: s.cover || '',
        spotify_id: s.spotify_id || '', youtube_id: '', matchLabel: '', needsMatch: false, checked: true,
    }));
    const missing = (data.playlistTotal || 0) - songs.length;
    const note = data.incomplete
        ? `Spotify stopped answering after ${songs.length} of ${data.playlistTotal} songs. Go back and try again to get them all.`
        : missing > 0
            ? `Spotify shared ${songs.length} of its ${data.playlistTotal} songs (local files and unavailable songs stay behind).`
            : '';
    renderImportChecklist(data.name || 'Playlist', true, note);
}

// Paste list: parse "Artist - Title" lines, resolve each to a YouTube video
// so the user can review matches before adding.
async function resolvePasteList() {
    const raw = (document.getElementById('pasteImportInput').value || '').trim();
    if (!raw) return;
    const PASTE_MAX = 1000;
    const allLines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    const lines = allLines.slice(0, PASTE_MAX);
    if (lines.length === 0) return;
    const pasteNote = allLines.length > PASTE_MAX
        ? `Matched the first ${PASTE_MAX} of ${allLines.length} lines: paste the rest as a second import.`
        : '';

    const parsed = lines.map(line => {
        const m = line.split(/\s+[-–—]\s+/); // "Artist - Title" (hyphen/en/em dash)
        if (m.length >= 2) return { artist: m[0].trim(), title: m.slice(1).join(' - ').trim(), query: line };
        return { artist: '', title: line, query: line };
    });

    const loading = document.getElementById('spotifyImportLoading');
    const loadingText = document.getElementById('spotifyImportLoadingText');
    loading.style.display = '';
    document.getElementById('spotifyImportPreview').style.display = 'none';
    document.getElementById('importTabs').style.display = 'none';
    document.getElementById('importPastePane').style.display = 'none';

    // Resolve with limited concurrency to stay friendly to the throttle.
    // Results collect locally and only become the preview if this run is
    // still current when it finishes (Back, a tab switch or closing cancels it).
    const run = ++importRunSeq;
    const stale = () => run !== importRunSeq;
    const results = new Array(parsed.length);
    let done = 0;
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
        while (cursor < parsed.length && !stale()) {
            const idx = cursor++;
            const p = parsed[idx];
            let match = null;
            let rateLimited = false;
            try {
                const data = await postJsonRetrying('/search-youtube', { query: p.query }, {
                    retries: 8,
                    cancelled: stale,
                    onWait: (s) => {
                        if (loadingText && !stale()) loadingText.textContent = `Matching ${done}/${parsed.length}… pausing ${s}s for YouTube's search limit`;
                    },
                });
                rateLimited = !!data.rateLimited;
                match = data.success && Array.isArray(data.results) ? data.results[0] : null;
            } catch (e) { /* leave unmatched */ }
            if (stale()) return;
            results[idx] = match ? {
                title: p.title, artist: p.artist, album: '', cover: match.thumbnail || '',
                spotify_id: '', youtube_id: match.videoId, needsMatch: true,
                matchLabel: `▸ ${match.title}${match.channel ? ' · ' + match.channel : ''}`, checked: true,
            } : {
                title: p.title, artist: p.artist, album: '', cover: '',
                spotify_id: '', youtube_id: null, needsMatch: true,
                matchLabel: rateLimited ? 'Not searched: too many searches, try again in a minute' : 'No match found',
                checked: false,
            };
            done++;
            if (loadingText) loadingText.textContent = `Matching ${done}/${parsed.length}…`;
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, parsed.length) }, worker));
    if (stale()) return;

    importSelection = results;
    renderImportChecklist('Pasted list', parsed.length >= 20, pasteNote);
}

async function confirmImportSelection() {
    if (importSaving) return;
    const songs = importSelection
        .filter(s => s.checked && s.youtube_id !== null)
        .map(s => ({
            title: s.title, artist: s.artist, album: s.album || '', cover: s.cover || '',
            youtube_id: s.youtube_id || '', mp3_url: '', spotify_id: s.spotify_id || '',
        }));
    if (songs.length === 0) return;
    const nameEl = document.getElementById('importTargetName');
    const target = importTargetChoice() === 'new'
        ? { newPlaylist: ((nameEl && nameEl.value) || '').trim() || importSourceName || 'Imported playlist' }
        : { playlist: String(importPlaylistId || activePlaylistId) };

    importSaving = true;
    const btn = document.getElementById('importAddBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = `Adding ${songs.length} song${songs.length === 1 ? '' : 's'}…`;
    }
    let result = null;
    try {
        result = await bulkAddSongs(songs, target);
    } finally {
        // A new playlist ends in a reload: stay locked until the page goes.
        if (!(result && result.reload)) {
            importSaving = false;
            updateImportAddBtn();
        }
    }
    if (!result) return;
    if (result.reload) {
        // Close first, then reload: on phones closing is a history.back(),
        // and a reload started before it would be cancelled by it.
        let started = false;
        const reload = () => { if (!started) { started = true; location.reload(); } };
        window.addEventListener('popstate', reload, { once: true });
        hideSpotifyImportModal();
        setTimeout(reload, 400); // desktop: closing was immediate, no popstate
        return;
    }
    if (result.success) hideSpotifyImportModal();
}

// Add many songs in ONE request (bulk import path). `target` is {} for the
// active playlist, { playlist: id }, or { newPlaylist: name } to create one: the first
// chunk creates it and later chunks follow it by id. Reloads the playlist
// from the server afterward so songsData reflects exactly what was stored
// (dedupe means the count may be lower than what was sent). A new playlist
// instead returns { reload: true }: the caller closes the import window and
// reloads onto it, since crate cards are server-rendered.
async function bulkAddSongs(songs, target = {}) {
    if (!Array.isArray(songs) || songs.length === 0) return { success: false };
    // The server caps one addBatch at 200 songs; long playlists go in chunks.
    const CHUNK = 200;
    const result = { success: true, added: 0, skipped: 0, playlistId: '' };
    let where = target;
    // The playlist the songs go to, named now (not whatever is open later)
    const id = target.newPlaylist ? null : String(target.playlist != null ? target.playlist : activePlaylistId);
    for (let i = 0; i < songs.length; i += CHUNK) {
        let part;
        if (id) writeBegin(id);
        try {
            const resp = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'addBatch', songs: songs.slice(i, i + CHUNK), ...where }),
            });
            part = await resp.json();
        } catch (e) {
            part = { success: false, error: 'Import failed — check your connection' };
        } finally {
            if (id) writeEnd(id);
        }
        if (!part.success) {
            // Earlier chunks are already saved; say so rather than hide them.
            const stopped = result.added > 0
                ? `Added ${result.added}, then stopped: ${part.error || 'import failed'}`
                : (part.error || 'Import failed');
            if (result.added === 0) { showBulkToast(stopped); return { success: false }; }
            result.success = false;
            result.message = stopped;
            break;
        }
        result.added += part.added || 0;
        result.skipped += part.skipped || 0;
        if (part.playlistId) {
            result.playlistId = part.playlistId;
            where = { playlist: part.playlistId };  // later chunks: same playlist
        }
    }

    if (target.newPlaylist && result.playlistId) {
        // Land on the new playlist: make it the active one; the caller then
        // reloads so its crate card renders, and the toast waits for that page.
        try {
            await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'switchPlaylist', playlist: result.playlistId }),
            });
        } catch (e) { /* the playlist exists either way; the reload shows it */ }
        const skipped = result.skipped > 0
            ? ` · ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} skipped`
            : '';
        const msg = result.message
            || `Imported “${target.newPlaylist}” · ${result.added} song${result.added === 1 ? '' : 's'}${skipped}`;
        toastAfterReload(msg);
        return { ...result, reload: true }; // the caller closes the window, then reloads
    }
    if (result.message) showBulkToast(result.message);

    // Reload that playlist's songs so local state matches the DB: into its
    // copy in memory (the playing list, or the one on screen), if any.
    try {
        const res = await saveMusicRequest({ action: 'getPlaylist', playlist: id });
        const fresh = res && res.success && res.playlist && Array.isArray(res.playlist.songs) ? res.playlist.songs : null;
        if (fresh) {
            const arr = id === String(activePlaylistId) ? songsData
                : (viewedId !== null && id === String(viewedId) && viewedSongs) ? viewedSongs : null;
            if (arr) {
                // The songs before stay the same objects (the playing song is
                // found by identity) when the server only appended.
                const prefix = fresh.length >= arr.length && arr.every((s, i) => songPlayKey(s) === songPlayKey(fresh[i]));
                if (prefix) arr.push(...fresh.slice(arr.length));
                else { arr.length = 0; fresh.forEach(s => arr.push(s)); }
                if (arr === songsData && shuffleMode !== 'off') buildShuffleQueue();
                if (arr === listSongs()) rebuildSongList();
                updateTrackCount(id, arr);
            } else if (playlistsMeta[id]) {
                playlistsMeta[id].songCount = fresh.length;
                setCrateCardCount(id, fresh.length);
            }
            if (id === 'favorites') {
                fresh.forEach(s => favoriteKeys.add(songPlayKey(s)));
                updateFavoriteHearts();
            }
        }
    } catch (e) { /* local state stays as-is; a reload will reconcile */ }

    if (!result.success) return result; // partial-failure toast already shown
    const msg = result.skipped > 0
        ? `Added ${result.added} · skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}`
        : `Added ${result.added} song${result.added === 1 ? '' : 's'}`;
    showBulkToast(msg);
    return result;
}

// A toast for the next page load, for actions that end in location.reload().
function toastAfterReload(msg) {
    try { sessionStorage.setItem('toastAfterReload', msg); } catch (e) { /* private mode: no toast */ }
}
document.addEventListener('DOMContentLoaded', () => {
    let msg = null;
    try {
        msg = sessionStorage.getItem('toastAfterReload');
        sessionStorage.removeItem('toastAfterReload');
    } catch (e) { /* storage blocked */ }
    if (msg) setTimeout(() => showBulkToast(msg), 400);
});

// Reuse the mobile toast when present; otherwise a lightweight fallback.
function showBulkToast(msg) {
    if (typeof window.mToast === 'function') { window.mToast(msg); return; }
    let t = document.getElementById('bulkToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'bulkToast';
        t.className = 'bulk-toast';
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove('show'), 3200);
}

// ============================================================
// SPOTIFY METADATA FETCH
// ============================================================

function extractSpotifyId(input) {
    if (!input) return '';
    input = input.trim();
    const match = input.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([a-zA-Z0-9]+)/i);
    if (match) return match[1];
    if (/^[a-zA-Z0-9]{22}$/.test(input)) return input;
    return '';
}

async function fetchSpotifyInfo(input) {
    const spotifyId = extractSpotifyId(input);
    if (!spotifyId) return;

    const spotifyUrl = `https://open.spotify.com/track/${spotifyId}`;
    const coverInput = document.getElementById('addSongCover');
    const titleInput = document.getElementById('addSongTitle');

    try {
        const resp = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`);
        if (!resp.ok) return;
        const data = await resp.json();

        if (data.thumbnail_url && coverInput) {
            coverInput.value = coverInput.value || data.thumbnail_url;
        }
        if (data.title && titleInput) {
            titleInput.value = titleInput.value || data.title;
        }
    } catch(e) {
        // oEmbed failed — user fills in manually
    }
}

// ============================================================
// NATIVE PLAYER PROXY (for React Native WebView)
// ============================================================
// When running inside a React Native WebView, YouTube IFrame API
// cannot reliably play inside a nested iframe. Instead, we create
// a proxy ytPlayer that forwards commands to React Native, which
// uses react-native-youtube-iframe for actual playback.
function setupNativePlayerProxy() {
    // Define YT namespace so existing code doesn't break
    window.YT = {
        PlayerState: {
            UNSTARTED: -1,
            ENDED: 0,
            PLAYING: 1,
            PAUSED: 2,
            BUFFERING: 3,
            CUED: 5
        }
    };

    ytPlayer = {
        _state: -1,
        _currentTime: 0,
        _duration: 0,
        _volume: 100,
        loadVideoById: function(id) {
            this._state = 3; // BUFFERING
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'ytCommand', command: 'loadVideo', youtubeId: id
            }));
        },
        cueVideoById: function(id) {
            this._state = 5; // CUED
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'ytCommand', command: 'cueVideo', youtubeId: id
            }));
        },
        playVideo: function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'ytCommand', command: 'play'
            }));
        },
        pauseVideo: function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'ytCommand', command: 'pause'
            }));
        },
        seekTo: function(seconds) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'ytCommand', command: 'seekTo', seconds: seconds
            }));
        },
        setVolume: function(vol) {
            this._volume = vol;
        },
        getVolume: function() { return this._volume; },
        isMuted: function() { return this._volume === 0; },
        mute: function() { this._volume = 0; },
        unMute: function() { this._volume = 100; },
        getPlayerState: function() { return this._state; },
        getCurrentTime: function() { return this._currentTime; },
        getDuration: function() { return this._duration; },
        setPlaybackRate: function() {},
        getPlaybackRate: function() { return 1; }
    };

    ytPlayerReady = true;
    ytPlayerReal = ytPlayer;

    // Cue initial song
    var currentSong = songsData[currentSongIndex];
    if (currentSong) {
        playSongSource(currentSong, true);
    }
}

// Auto-initialize
document.addEventListener('DOMContentLoaded', () => {
    if (window.ReactNativeWebView) {
        setupNativePlayerProxy();
    } else {
        loadYouTubeAPI();
    }
});

// ============================================================
// REACT NATIVE WEBVIEW BRIDGE
// ============================================================
(function() {
    if (!window.ReactNativeWebView) return;

    // Listen for messages from React Native. injectJavaScript dispatches a
    // synthetic MessageEvent on `window`, so e.source === window and origin
    // is empty. Drop anything else (e.g. an embedded iframe trying to drive
    // the player).
    window.addEventListener('message', function(e) {
        if (e.source !== window) return;
        if (e.origin && e.origin !== window.location.origin) return;
        try {
            var msg = JSON.parse(e.data);
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'selectPlaylist') {
                if (typeof msg.playlistId === 'string') selectPlaylistFromCrate(msg.playlistId);
            } else if (msg.type === 'switchSong') {
                if (typeof msg.index === 'number') switchSong(msg.index);
            } else if (msg.type === 'togglePlay') {
                toggleMusic();
            } else if (msg.type === 'nextSong') {
                nextSong();
            } else if (msg.type === 'prevSong') {
                prevSong();
            } else if (msg.type === 'ytStateUpdate') {
                // State update from native YouTube player
                if (ytPlayer) {
                    ytPlayer._state = typeof msg.state === 'number' ? msg.state : -1;
                    ytPlayer._currentTime = typeof msg.currentTime === 'number' ? msg.currentTime : 0;
                    ytPlayer._duration = typeof msg.duration === 'number' ? msg.duration : 0;
                    if (typeof onPlayerStateChange === 'function') {
                        onPlayerStateChange({ data: ytPlayer._state });
                    }
                }
            }
        } catch(err) {}
    });

    // Override showPlaylistPicker to navigate back to RN collection
    window.showPlaylistPicker = function() {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'navigateBack' }));
    };

    // Post state updates back to RN every second
    setInterval(function() {
        try {
            var song = currentRadioSong || songsData[currentSongIndex] || null;
            var playing = false;
            var curTime = 0;
            var dur = 0;
            if (ytPlayer) {
                if (ytPlayer.getPlayerState) playing = ytPlayer.getPlayerState() === 1;
                if (ytPlayer.getCurrentTime) curTime = ytPlayer.getCurrentTime() || 0;
                if (ytPlayer.getDuration) dur = ytPlayer.getDuration() || 0;
            }
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'stateUpdate',
                song: song,
                isPlaying: playing,
                currentTime: curTime,
                duration: dur,
                playlistId: activePlaylistId,
                loopMode: loopMode,
                shuffleMode: shuffleMode
            }));
        } catch(err) {}
    }, 1000);
})();

// ============================================================
// APP MODE — MOBILE DRAWER & TOUCH INTERACTIONS
// ============================================================
(function() {
    const isApp = new URLSearchParams(window.location.search).has('app') || !!window.ReactNativeWebView;
    if (!isApp) return;

    document.addEventListener('DOMContentLoaded', function() {
        // Sync app loop/shuffle button visuals
        const appLoopBtn = document.getElementById('appLoopBtn');
        const appShuffleBtn = document.getElementById('appShuffleBtn');

        function syncAppLoopBtn() {
            if (!appLoopBtn) return;
            appLoopBtn.classList.toggle('active', loopMode !== 'off');
            // Show "1" indicator for single-song loop
            const svg = appLoopBtn.querySelector('svg');
            if (loopMode === 'single') {
                appLoopBtn.dataset.mode = '1';
            } else {
                delete appLoopBtn.dataset.mode;
            }
        }

        function syncAppShuffleBtn() {
            if (!appShuffleBtn) return;
            appShuffleBtn.classList.toggle('active', shuffleMode !== 'off');
            if (shuffleMode === 'smart') {
                appShuffleBtn.dataset.mode = 'smart';
            } else {
                delete appShuffleBtn.dataset.mode;
            }
        }

        // Monkey-patch toggleLoopMode / toggleShuffle to sync app buttons
        const origToggleLoop = window.toggleLoopMode;
        window.toggleLoopMode = function() {
            origToggleLoop();
            syncAppLoopBtn();
        };
        const origToggleShuffle = window.toggleShuffle;
        window.toggleShuffle = function() {
            origToggleShuffle();
            syncAppShuffleBtn();
        };

        // Initial sync
        syncAppLoopBtn();
        syncAppShuffleBtn();

        const sidebar = document.getElementById('musicSidebar');
        const headerArea = sidebar?.querySelector('.sidebar-header-area');
        if (!sidebar || !headerArea) return;

        // Create backdrop overlay for drawer
        const backdrop = document.createElement('div');
        backdrop.className = 'app-drawer-backdrop';
        const musicMain = document.querySelector('.music-main');
        if (musicMain) musicMain.appendChild(backdrop);

        function openDrawer() {
            sidebar.classList.add('app-drawer-open');
            backdrop.classList.add('visible');
        }
        function closeDrawer() {
            sidebar.classList.remove('app-drawer-open');
            backdrop.classList.remove('visible');
        }

        // Tap backdrop to close
        backdrop.addEventListener('click', closeDrawer);

        // Toggle drawer on header tap
        headerArea.addEventListener('click', function(e) {
            // Don't toggle if they tapped the add or edit button
            if (e.target.closest('.add-song-btn') || e.target.closest('.app-edit-playlist-btn')) return;
            if (sidebar.classList.contains('app-drawer-open')) {
                closeDrawer();
            } else {
                openDrawer();
            }
        });

        // Close drawer when a song is tapped
        const songList = document.getElementById('songList');
        if (songList) {
            songList.addEventListener('click', function(e) {
                const songItem = e.target.closest('.song-list-item');
                if (songItem && sidebar.classList.contains('app-drawer-open')) {
                    // Delay closing so the user sees the selection
                    setTimeout(closeDrawer, 300);
                }
            });
        }

        // Swipe down to close drawer
        let touchStartY = 0;
        let touchStartTime = 0;
        sidebar.addEventListener('touchstart', function(e) {
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }, { passive: true });

        sidebar.addEventListener('touchend', function(e) {
            const deltaY = e.changedTouches[0].clientY - touchStartY;
            const deltaTime = Date.now() - touchStartTime;
            // Swipe down fast enough = close
            if (deltaY > 50 && deltaTime < 300 && sidebar.classList.contains('app-drawer-open')) {
                closeDrawer();
            }
            // Swipe up fast enough = open
            if (deltaY < -50 && deltaTime < 300 && !sidebar.classList.contains('app-drawer-open')) {
                openDrawer();
            }
        }, { passive: true });

        // Progress bar touch support
        const progressBar = document.getElementById('sleeveProgressBar');
        if (progressBar) {
            let isDraggingProgress = false;

            function seekFromTouch(e) {
                if (!ytPlayer || !ytPlayer.getDuration) return;
                const rect = progressBar.getBoundingClientRect();
                const touch = e.touches ? e.touches[0] : e.changedTouches[0];
                const pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                const seekTo = pct * ytPlayer.getDuration();
                ytPlayer.seekTo(seekTo, true);
                updateSleeveProgress();
            }

            progressBar.addEventListener('touchstart', function(e) {
                isDraggingProgress = true;
                seekFromTouch(e);
                e.preventDefault();
            }, { passive: false });

            progressBar.addEventListener('touchmove', function(e) {
                if (isDraggingProgress) {
                    seekFromTouch(e);
                    e.preventDefault();
                }
            }, { passive: false });

            progressBar.addEventListener('touchend', function() {
                isDraggingProgress = false;
            }, { passive: true });
        }

        // Swipe on album art / lyrics area for prev/next song
        const vinylSleeve = document.getElementById('vinylSleeve');
        if (vinylSleeve) {
            let swipeStartX = 0;
            let swipeStartY = 0;
            let swipeStartTime = 0;

            vinylSleeve.addEventListener('touchstart', function(e) {
                swipeStartX = e.touches[0].clientX;
                swipeStartY = e.touches[0].clientY;
                swipeStartTime = Date.now();
            }, { passive: true });

            vinylSleeve.addEventListener('touchend', function(e) {
                const deltaX = e.changedTouches[0].clientX - swipeStartX;
                const deltaY = e.changedTouches[0].clientY - swipeStartY;
                const deltaTime = Date.now() - swipeStartTime;

                // Horizontal swipe: must be more horizontal than vertical, >60px, <400ms
                if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 60 && deltaTime < 400) {
                    if (deltaX < 0) {
                        nextSong();
                    } else {
                        prevSong();
                    }
                }
            }, { passive: true });
        }

        // Auto-scroll active song into view in the drawer
        const origSwitchSong = window.switchSong;
        if (origSwitchSong) {
            // After song changes, scroll it into view if drawer is open
            const observer = new MutationObserver(function() {
                const activeSong = sidebar.querySelector('.song-list-item.active');
                if (activeSong && sidebar.classList.contains('app-drawer-open')) {
                    activeSong.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
            observer.observe(document.getElementById('songList'), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        }
    });
})();

// ==== Phase C: crackle SFX ====

// ===== Vinyl crackle sound effect =====
let crackleEnabled = localStorage.getItem('crackleEnabled') === '1';
let crackleAudioCtx = null;

function setCrackleEnabled(on) {
    crackleEnabled = !!on;
    localStorage.setItem('crackleEnabled', crackleEnabled ? '1' : '0');
    const btn = document.getElementById('crackleBtn');
    const label = document.getElementById('crackleLabel');
    if (btn) btn.dataset.crackle = crackleEnabled ? 'on' : 'off';
    if (label) label.textContent = crackleEnabled ? 'crackle on' : 'crackle';
}

function toggleCrackle() {
    setCrackleEnabled(!crackleEnabled);
}

// Restore the persisted state on the deck button
if (crackleEnabled) setCrackleEnabled(true);

function playCrackleSound() {
    if (!crackleEnabled) return Promise.resolve();
    pdbg('crackle sound');
    return new Promise(resolve => {
        try {
            if (!crackleAudioCtx) crackleAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const ctx = crackleAudioCtx;
            const duration = 1.5;
            const sampleRate = ctx.sampleRate;
            const bufferSize = sampleRate * duration;
            const buffer = ctx.createBuffer(1, bufferSize, sampleRate);
            const data = buffer.getChannelData(0);

            // Generate vinyl crackle noise
            for (let i = 0; i < bufferSize; i++) {
                // Base vinyl hiss
                data[i] = (Math.random() * 2 - 1) * 0.015;
                // Random pops and clicks
                if (Math.random() < 0.003) {
                    data[i] += (Math.random() * 2 - 1) * 0.3;
                }
                // Subtle crackle
                if (Math.random() < 0.01) {
                    data[i] += (Math.random() * 2 - 1) * 0.08;
                }
            }

            const source = ctx.createBufferSource();
            source.buffer = buffer;

            // Low-pass filter for warmth
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 3000;

            // Fade envelope
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, ctx.currentTime);
            gain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.8, ctx.currentTime + duration - 0.4);
            gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);

            source.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            source.start();
            source.onended = resolve;
            setTimeout(resolve, duration * 1000 + 100);
        } catch (e) {
            resolve();
        }
    });
}

// ==== Phase C: scan importer ====

// ============================================================
// SONG SCANNER (folder-scan local import)
// Identifies album covers (Gemini via /scan-cover) and reads ID3 tags
// (jsmediatags) from local audio, then matches each to a YouTube video
// (/search-youtube) so it can be added like any other song.
// ============================================================

let scanResults = [];

function showScanModal() {
    document.getElementById('scanModal').classList.add('active');
    resetScanModal();
}

function hideScanModal() {
    document.getElementById('scanModal').classList.remove('active');
    scanResults = [];
    window.mScanTarget = undefined; // the phone's Add songs → Snap sets it
}

// A phone camera photo is several MB, over the server's limit as base64:
// send large or unusual images as a JPEG of at most 1600px.
async function scanImagePayload(file) {
    const plain = /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= 1500000;
    if (!plain) {
        try {
            const bitmap = await createImageBitmap(file);
            const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            if (bitmap.close) bitmap.close();
            const url = canvas.toDataURL('image/jpeg', 0.85);
            return { image: url.split(',')[1], mimeType: 'image/jpeg' };
        } catch (e) { /* the browser can't decode it: send it as it is */ }
    }
    return { image: await fileToBase64(file), mimeType: file.type };
}

function resetScanModal() {
    document.getElementById('scanStep1').style.display = '';
    document.getElementById('scanStep2').style.display = 'none';
    document.getElementById('scanStep3').style.display = 'none';
    document.getElementById('scanFolderInput').value = '';
    document.getElementById('scanFilesInput').value = '';
    scanResults = [];
}

function setScanProgress(label, detail, percent) {
    document.getElementById('scanProgressLabel').textContent = label;
    document.getElementById('scanProgressDetail').textContent = detail;
    document.getElementById('scanProgressFill').style.width = percent + '%';
}

async function handleScanFiles(fileList) {
    const files = Array.from(fileList);
    const images = files.filter(f => f.type.startsWith('image/'));
    const audioFiles = files.filter(f => /\.(mp3|flac|m4a|ogg|wav|aac|wma)$/i.test(f.name));

    if (images.length === 0 && audioFiles.length === 0) {
        alert('No image or audio files found in the selected folder.');
        return;
    }

    // Switch to progress step
    document.getElementById('scanStep1').style.display = 'none';
    document.getElementById('scanStep2').style.display = '';
    scanResults = [];

    const totalItems = images.length + audioFiles.length;
    let processed = 0;

    // Process images via Gemini
    let coverError = '';
    for (const img of images) {
        setScanProgress(
            'Identifying album covers...',
            `Processing ${img.name}`,
            Math.round((processed / totalItems) * 100)
        );

        try {
            const payload = await scanImagePayload(img);
            const data = await postJsonRetrying('/scan-cover', payload, { retries: 3 });
            if (!data.success && data.error && !coverError) coverError = data.error;

            if (data.success && data.artist) {
                const songs = data.songs && data.songs.length > 0 ? data.songs : [data.album || 'Unknown'];
                for (const song of songs) {
                    scanResults.push({
                        artist: data.artist,
                        album: data.album || '',
                        title: song,
                        source: 'cover',
                        coverFile: img,
                        coverPreview: URL.createObjectURL(img),
                        youtube: null
                    });
                }
            }
        } catch (e) {
            console.warn('Scan cover error:', e);
        }

        processed++;
        // Rate limit between Gemini calls
        if (images.indexOf(img) < images.length - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    if (coverError && !scanResults.length) showBulkToast(`Couldn’t identify the cover: ${coverError}`);

    // Process audio files
    for (const audio of audioFiles) {
        setScanProgress(
            'Reading audio files...',
            `Processing ${audio.name}`,
            Math.round((processed / totalItems) * 100)
        );

        try {
            const info = await readTagsFromFile(audio);
            scanResults.push({
                artist: info.artist,
                album: info.album || '',
                title: info.title,
                source: 'audio',
                coverPreview: info.coverUrl || null,
                youtube: null
            });
        } catch (e) {
            // Fallback to filename parsing
            const parsed = cleanFilename(audio.name);
            scanResults.push({
                artist: parsed.artist,
                album: '',
                title: parsed.title,
                source: 'audio',
                coverPreview: null,
                youtube: null
            });
        }

        processed++;
    }

    // Now search YouTube for each result
    for (let i = 0; i < scanResults.length; i++) {
        const r = scanResults[i];
        setScanProgress(
            'Searching YouTube...',
            `"${r.artist} - ${r.title}"`,
            Math.round(((totalItems + i) / (totalItems + scanResults.length)) * 100)
        );

        try {
            const query = `${r.artist} ${r.title} official audio`;
            const data = await postJsonRetrying('/search-youtube', { query }, { retries: 8 });

            if (data.success && data.results && data.results.length > 0) {
                r.youtube = data.results[0];
                r.youtubeOptions = data.results;
            }
        } catch (e) {
            console.warn('YouTube search error:', e);
        }

        // Small delay between YouTube searches
        if (i < scanResults.length - 1) {
            await new Promise(r => setTimeout(r, 300));
        }
    }

    setScanProgress('Done!', '', 100);
    showScanResults();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // Strip data URL prefix to get raw base64
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function readTagsFromFile(file) {
    return new Promise((resolve, reject) => {
        if (typeof jsmediatags === 'undefined') {
            reject(new Error('jsmediatags not loaded'));
            return;
        }
        jsmediatags.read(file, {
            onSuccess: (tag) => {
                const t = tag.tags;
                let coverUrl = null;
                if (t.picture) {
                    const { data, format } = t.picture;
                    const bytes = new Uint8Array(data);
                    const blob = new Blob([bytes], { type: format });
                    coverUrl = URL.createObjectURL(blob);
                }
                resolve({
                    title: t.title || cleanFilename(file.name).title,
                    artist: t.artist || cleanFilename(file.name).artist,
                    album: t.album || '',
                    coverUrl
                });
            },
            onError: () => {
                reject(new Error('Could not read tags'));
            }
        });
    });
}

function cleanFilename(filename) {
    // Remove extension
    let name = filename.replace(/\.[^.]+$/, '');
    // Remove track numbers like "01 ", "01. ", "1 - "
    name = name.replace(/^\d+[\s.\-_]+/, '');
    // Try "Artist - Title" format
    if (name.includes(' - ')) {
        const parts = name.split(' - ');
        return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: '', title: name.trim() };
}

function showScanResults() {
    document.getElementById('scanStep2').style.display = 'none';
    document.getElementById('scanStep3').style.display = '';

    const withYoutube = scanResults.filter(r => r.youtube);
    document.getElementById('scanResultsCount').textContent =
        `${withYoutube.length} of ${scanResults.length} songs matched`;

    const list = document.getElementById('scanResultsList');
    list.innerHTML = '';

    scanResults.forEach((r, i) => {
        const hasMatch = !!r.youtube;
        const div = document.createElement('div');
        div.className = 'scan-result-item' + (hasMatch ? '' : ' no-match');

        const thumb = r.coverPreview || (r.youtube ? r.youtube.thumbnail : '');
        // coverPreview is a locally-created blob: object URL; safeUrl() only allows
        // http(s) and would strip it, so pass blob: URLs through unchanged.
        const safeThumb = thumb && thumb.startsWith('blob:') ? thumb : safeUrl(thumb);
        const ytTitle = r.youtube ? r.youtube.title : 'No YouTube match found';
        const ytChannel = r.youtube ? r.youtube.channel : '';

        div.innerHTML = `
            <label class="scan-result-check">
                <input type="checkbox" data-index="${i}" ${hasMatch ? 'checked' : (hasMatch ? '' : 'disabled')} onchange="updateScanAddCount()">
            </label>
            <div class="scan-result-cover">
                ${thumb ? `<img src="${safeThumb}" alt="">` : '<div class="scan-result-no-cover">&#9834;</div>'}
            </div>
            <div class="scan-result-info">
                <div class="scan-result-title">${escapeHtml(r.title)}</div>
                <div class="scan-result-artist">${escapeHtml(r.artist)}${r.album ? ' &middot; ' + escapeHtml(r.album) : ''}</div>
                <div class="scan-result-source">${r.source === 'cover' ? 'Album cover' : 'Audio file'}</div>
            </div>
            <div class="scan-result-youtube">
                <div class="scan-result-yt-title">${escapeHtml(ytTitle)}</div>
                ${ytChannel ? `<div class="scan-result-yt-channel">${escapeHtml(ytChannel)}</div>` : ''}
                ${r.youtubeOptions && r.youtubeOptions.length > 1 ? `
                    <select class="scan-result-yt-select" onchange="changeScanYoutube(${i}, this.value)">
                        ${r.youtubeOptions.map((opt, j) => `<option value="${j}"${j === 0 ? ' selected' : ''}>${escapeHtml(opt.title)}</option>`).join('')}
                    </select>
                ` : ''}
            </div>
        `;
        list.appendChild(div);
    });

    updateScanAddCount();
}

function changeScanYoutube(index, optIndex) {
    const r = scanResults[index];
    if (r.youtubeOptions && r.youtubeOptions[optIndex]) {
        r.youtube = r.youtubeOptions[optIndex];
    }
}

function toggleScanSelectAll(checked) {
    document.querySelectorAll('#scanResultsList input[type="checkbox"]:not(:disabled)').forEach(cb => {
        cb.checked = checked;
    });
    updateScanAddCount();
}

function updateScanAddCount() {
    const checked = document.querySelectorAll('#scanResultsList input[type="checkbox"]:checked').length;
    document.getElementById('scanAddBtn').textContent = `Add ${checked} Song${checked !== 1 ? 's' : ''}`;
    document.getElementById('scanAddBtn').disabled = checked === 0;
}

async function scanAddSelected() {
    const checkboxes = document.querySelectorAll('#scanResultsList input[type="checkbox"]:checked');
    const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index));

    if (indices.length === 0) return;

    const btn = document.getElementById('scanAddBtn');
    btn.disabled = true;
    btn.textContent = 'Adding...';

    // The phone's Add songs → Snap names a playlist (its "To" line); a
    // playlist the phone only shows gets them without them playing
    const target = typeof window.mScanTarget === 'string' ? window.mScanTarget
        : (!listIsPlaying() ? String(listId()) : null);
    const writeId = target !== null ? target : String(activePlaylistId);
    let added = 0;
    const countElsewhere = () => { // as each lands (see importAudioFiles)
        const m = playlistsMeta[target];
        if (!m) return;
        m.songCount = (m.songCount || 0) + 1;
        setCrateCardCount(target, m.songCount);
    };
    for (const i of indices) {
        const r = scanResults[i];
        if (!r.youtube) continue;

        const song = {
            title: r.title,
            artist: r.artist,
            album: r.album,
            cover: r.youtube.thumbnail || '',
            youtube_id: r.youtube.videoId
        };

        writeBegin(writeId);
        try {
            const resp = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.assign({ action: 'add', song }, target !== null ? { playlist: target } : {}))
            });
            const result = await resp.json();

            if (result.success) {
                added++;
                if (target === null) songsData.push(song);
                // Each loaded copy of the target list takes it (as it lands)
                else if (!joinList(target, song)) countElsewhere();
                if (target === 'favorites') favoriteKeys.add(songPlayKey(song));
            }
        } catch (e) {
            console.warn('Error adding song:', e);
        } finally {
            writeEnd(writeId);
        }
    }

    // Update UI
    if (target === null) {
        if (shuffleMode !== 'off') buildShuffleQueue();
        rebuildSongList();
        updateTrackCount();
    } else {
        const meta = playlistsMeta[target];
        if (target === 'favorites') updateFavoriteHearts();
        if (added && window.mToast) window.mToast(`Added ${added} to ${meta ? meta.name : 'your playlist'}`);
    }
    hideScanModal();
}

// ==== Phase C: vinyl GIF maker ====

// ==========================================
// Vinyl GIF Maker
// ==========================================
(function() {
    'use strict';

    const QUALITY_PRESETS = {
        small:  { size: 320, frames: 24, fps: 24, gifQuality: 12 },
        medium: { size: 460, frames: 36, fps: 30, gifQuality: 10 },
        large:  { size: 560, frames: 48, fps: 30, gifQuality: 8  }
    };

    const state = {
        sourceTab: 'youtube',
        coverImage: null,        // HTMLImageElement (square-cropped source for the label)
        ytVariants: [],          // [{url, label}]
        searchResults: [],       // [{videoId, title, channel, thumbnail, image}]
        selectedVariantUrl: null,
        style: 'classic',
        coloredColor: '#d4476b',
        caption: '',
        quality: 'medium',
        speed: 1.0,
        showHole: true,
        previewRAF: 0,
        previewAngle: 0,
        isGenerating: false,
        cropper: {
            srcImg: null,
            zoom: 1,
            offsetX: 0,
            offsetY: 0,
            dragging: false,
            dragStartX: 0,
            dragStartY: 0,
            offsetStartX: 0,
            offsetStartY: 0
        }
    };

    function $(id) { return document.getElementById(id); }

    function loadImageFromUrl(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Image load failed: ' + url));
            img.src = url;
        });
    }

    function extractYoutubeId(input) {
        if (!input) return null;
        input = input.trim();
        // Plain ID (11 chars, letters/numbers/-/_)
        if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
        // URLs
        const patterns = [
            /[?&]v=([A-Za-z0-9_-]{11})/,
            /youtu\.be\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
            /youtube\.com\/v\/([A-Za-z0-9_-]{11})/
        ];
        for (const p of patterns) {
            const m = input.match(p);
            if (m) return m[1];
        }
        return null;
    }

    // --- Modal open/close ---
    window.openVinylGifModal = function() {
        const modal = $('vinylGifModal');
        if (!modal) return;
        modal.classList.add('active');
        // Reset progress/result visual state on open
        $('vgmProgress').classList.remove('active');
        hideResult();
        // If we already have a cover image from a previous session, keep it; otherwise prompt empty
        if (state.coverImage) {
            $('vgmPreviewEmpty').style.display = 'none';
            $('vgmPreviewCanvas').parentElement.classList.add('ready');
            $('vgmGenerateBtn').disabled = false;
            startPreviewLoop();
        }
    };

    function hideResult() {
        const img = $('vgmResultImg');
        if (img && img.src) {
            try { URL.revokeObjectURL(img.src); } catch (_) {}
        }
        if (img) {
            img.removeAttribute('src');
            img.style.display = 'none';
        }
        $('vgmPreviewCanvas').style.display = '';
        $('vgmResultActions').style.display = 'none';
        $('vgmResultMeta').style.display = 'none';
    }

    window.vgmMakeAnother = function() {
        hideResult();
        if (state.coverImage) startPreviewLoop();
    };

    window.closeVinylGifModal = function() {
        const modal = $('vinylGifModal');
        if (!modal) return;
        modal.classList.remove('active');
        stopPreviewLoop();
    };

    // --- Source tabs ---
    window.vgmSwitchSourceTab = function(tab) {
        state.sourceTab = tab;
        document.querySelectorAll('#vinylGifModal .vgm-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.sourceTab === tab);
        });
        document.querySelectorAll('#vinylGifModal .vgm-source-panel').forEach(p => {
            p.style.display = p.dataset.sourcePanel === tab ? '' : 'none';
        });
    };

    // --- Search iTunes for album covers ---
    window.vgmSearchYoutube = async function() {
        const q = ($('vgmSearchQuery').value || '').trim();
        if (!q) return;
        const wrap = $('vgmSearchResults');
        wrap.innerHTML = '<div style="opacity:0.6;font-size:0.8rem;padding:8px">Searching…</div>';
        wrap.classList.add('active');
        try {
            const url = 'https://itunes.apple.com/search?' + new URLSearchParams({
                term: q, media: 'music', entity: 'song', limit: '20'
            });
            const res = await fetch(url);
            const data = await res.json();
            const items = (data.results || []).map(r => ({
                title:    r.trackName    || '',
                artist:   r.artistName   || '',
                album:    r.collectionName || '',
                // iTunes returns 100x100; bump to 600x600 by URL replacement
                thumbnail: (r.artworkUrl100 || '').replace('100x100bb', '600x600bb')
            })).filter(r => r.thumbnail);
            // De-dupe by thumbnail URL (same album for multiple tracks)
            const seen = new Set();
            const unique = items.filter(it => {
                if (seen.has(it.thumbnail)) return false;
                seen.add(it.thumbnail);
                return true;
            }).slice(0, 12);
            if (unique.length === 0) {
                wrap.innerHTML = '<div style="opacity:0.6;font-size:0.8rem;padding:8px">No results.</div>';
                return;
            }
            const loaded = await Promise.all(unique.map(async r => {
                try {
                    const img = await loadImageFromUrl(r.thumbnail);
                    return { ...r, image: img };
                } catch (e) { return null; }
            }));
            state.searchResults = loaded.filter(Boolean);
            renderSearchResults();
        } catch (e) {
            wrap.innerHTML = '<div style="opacity:0.6;font-size:0.8rem;padding:8px;color:#ff8888">Search failed.</div>';
        }
    };

    function renderSearchResults() {
        const wrap = $('vgmSearchResults');
        if (!wrap) return;
        wrap.innerHTML = '';
        (state.searchResults || []).forEach((r, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vgm-thumb-variant';
            btn.title = (r.artist ? r.artist + ' — ' : '') + (r.album || r.title || '');
            btn.onclick = () => selectSearchResult(i);
            const img = document.createElement('img');
            img.src = safeUrl(r.thumbnail);
            img.alt = r.album || r.title;
            btn.appendChild(img);
            const lbl = document.createElement('span');
            lbl.className = 'vgm-thumb-variant-label';
            const display = r.artist || r.album || r.title || '';
            const short = display.length > 20 ? display.slice(0, 20) + '…' : display;
            lbl.textContent = short;
            btn.appendChild(lbl);
            wrap.appendChild(btn);
        });
        wrap.classList.add('active');
    }

    function selectSearchResult(index) {
        const r = (state.searchResults || [])[index];
        if (!r || !r.image) return;
        document.querySelectorAll('#vgmSearchResults .vgm-thumb-variant').forEach((b, i) => {
            b.classList.toggle('active', i === index);
        });
        state.coverImage = makeSquareFromImage(r.image);
        markCoverReady();
    }

    // --- YouTube thumbnail loading ---
    window.vgmLoadYoutubeThumb = async function() {
        const url = $('vgmYoutubeUrl').value;
        const id = extractYoutubeId(url);
        if (!id) {
            alert('Could not find a YouTube video ID in that URL.');
            return;
        }
        const variantUrls = [
            { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, label: 'HD' },
            { url: `https://i.ytimg.com/vi/${id}/hq1.jpg`,            label: '25%' },
            { url: `https://i.ytimg.com/vi/${id}/hq2.jpg`,            label: '50%' },
            { url: `https://i.ytimg.com/vi/${id}/hq3.jpg`,            label: '75%' },
            { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,      label: 'Cover' },
            { url: `https://i.ytimg.com/vi/${id}/sddefault.jpg`,      label: 'SD' }
        ];
        // Filter out missing ones by probing in parallel
        const probed = await Promise.all(variantUrls.map(async v => {
            try {
                const img = await loadImageFromUrl(v.url);
                // YouTube's "missing" placeholder is 120x90 grey thumb — filter narrow ones
                if (img.naturalWidth < 200) return null;
                return { ...v, image: img };
            } catch (e) { return null; }
        }));
        state.ytVariants = probed.filter(Boolean);
        renderThumbVariants();
        if (state.ytVariants.length === 0) {
            alert('No thumbnails available for that video.');
            return;
        }
        // Auto-select first
        selectYoutubeVariant(0);
    };

    function renderThumbVariants() {
        const wrap = $('vgmThumbVariants');
        if (!wrap) return;
        wrap.innerHTML = '';
        state.ytVariants.forEach((v, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'vgm-thumb-variant';
            btn.onclick = () => selectYoutubeVariant(i);
            const img = document.createElement('img');
            img.src = safeUrl(v.url);
            img.alt = v.label;
            btn.appendChild(img);
            const lbl = document.createElement('span');
            lbl.className = 'vgm-thumb-variant-label';
            lbl.textContent = v.label;
            btn.appendChild(lbl);
            wrap.appendChild(btn);
        });
        wrap.classList.add('active');
    }

    function selectYoutubeVariant(index) {
        const v = state.ytVariants[index];
        if (!v) return;
        state.selectedVariantUrl = v.url;
        document.querySelectorAll('#vgmThumbVariants .vgm-thumb-variant').forEach((b, i) => {
            b.classList.toggle('active', i === index);
        });
        // Crop the variant to square (center-crop) for the vinyl label
        state.coverImage = makeSquareFromImage(v.image);
        markCoverReady();
    };

    function makeSquareFromImage(img) {
        const size = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - size) / 2;
        const sy = (img.naturalHeight - size) / 2;
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        c.getContext('2d').drawImage(img, sx, sy, size, size, 0, 0, size, size);
        // Return as an image-like canvas (drawImage accepts canvases too)
        return c;
    }

    // --- Upload + cropper ---
    window.vgmHandleUpload = async function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const img = await loadImageFromUrl(ev.target.result);
                state.cropper.srcImg = img;
                state.cropper.zoom = 1;
                state.cropper.offsetX = 0;
                state.cropper.offsetY = 0;
                $('vgmCropper').style.display = '';
                $('vgmCropZoom').value = 1;
                drawCropper();
            } catch (err) {
                alert('Failed to load image.');
            }
        };
        reader.readAsDataURL(file);
    };

    function drawCropper() {
        const c = $('vgmCropperCanvas');
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        const img = state.cropper.srcImg;
        if (!img) return;
        // Fit the image to canvas at zoom=1 (so smaller dimension covers canvas), then apply zoom + offset
        const baseScale = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
        const scale = baseScale * state.cropper.zoom;
        const drawW = img.naturalWidth * scale;
        const drawH = img.naturalHeight * scale;
        const cx = (c.width - drawW) / 2 + state.cropper.offsetX;
        const cy = (c.height - drawH) / 2 + state.cropper.offsetY;
        ctx.drawImage(img, cx, cy, drawW, drawH);
    }

    function bindCropperEvents() {
        const c = $('vgmCropperCanvas');
        if (!c || c._vgmBound) return;
        c._vgmBound = true;
        c.addEventListener('pointerdown', (e) => {
            if (!state.cropper.srcImg) return;
            state.cropper.dragging = true;
            state.cropper.dragStartX = e.clientX;
            state.cropper.dragStartY = e.clientY;
            state.cropper.offsetStartX = state.cropper.offsetX;
            state.cropper.offsetStartY = state.cropper.offsetY;
            c.setPointerCapture(e.pointerId);
        });
        c.addEventListener('pointermove', (e) => {
            if (!state.cropper.dragging) return;
            state.cropper.offsetX = state.cropper.offsetStartX + (e.clientX - state.cropper.dragStartX);
            state.cropper.offsetY = state.cropper.offsetStartY + (e.clientY - state.cropper.dragStartY);
            drawCropper();
        });
        c.addEventListener('pointerup', (e) => {
            state.cropper.dragging = false;
            try { c.releasePointerCapture(e.pointerId); } catch (_) {}
        });
        const zoom = $('vgmCropZoom');
        if (zoom) {
            zoom.addEventListener('input', () => {
                state.cropper.zoom = parseFloat(zoom.value);
                drawCropper();
            });
        }
    }

    window.vgmApplyCrop = function() {
        const c = $('vgmCropperCanvas');
        if (!c || !state.cropper.srcImg) return;
        // Copy the visible cropper canvas as the cover image (it's already square)
        const out = document.createElement('canvas');
        out.width = c.width;
        out.height = c.height;
        out.getContext('2d').drawImage(c, 0, 0);
        state.coverImage = out;
        markCoverReady();
    };

    function markCoverReady() {
        $('vgmPreviewEmpty').style.display = 'none';
        $('vgmPreviewCanvas').parentElement.classList.add('ready');
        $('vgmGenerateBtn').disabled = false;
        state.previewAngle = 0;
        startPreviewLoop();
    }

    // --- Style + color selection ---
    window.vgmSelectStyle = function(style) {
        state.style = style;
        document.querySelectorAll('#vgmStyleGrid .vgm-style-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.style === style);
        });
        // Show color picker for styles that use a vinyl color
        const showColor = (style === 'colored' || style === 'translucent');
        $('vgmColorRow').style.display = showColor ? '' : 'none';
        renderPreviewFrame();
    };

    function bindColorSwatches() {
        const clearActive = () => {
            document.querySelectorAll('#vgmColorSwatches .vgm-color-swatch').forEach(s => s.classList.remove('active'));
            const wheel = document.querySelector('#vgmColorSwatches .vgm-color-wheel');
            if (wheel) wheel.classList.remove('active');
        };
        document.querySelectorAll('#vgmColorSwatches .vgm-color-swatch').forEach(sw => {
            sw.addEventListener('click', () => {
                clearActive();
                sw.classList.add('active');
                state.coloredColor = sw.dataset.color;
                const picker = $('vgmColorPicker');
                if (picker) picker.value = sw.dataset.color;
                renderPreviewFrame();
            });
        });
        const picker = $('vgmColorPicker');
        if (picker) {
            picker.addEventListener('input', () => {
                clearActive();
                const wheel = document.querySelector('#vgmColorSwatches .vgm-color-wheel');
                if (wheel) wheel.classList.add('active');
                state.coloredColor = picker.value;
                renderPreviewFrame();
            });
        }
    }

    window.vgmSelectQuality = function(q) {
        state.quality = q;
        document.querySelectorAll('#vinylGifModal .vgm-quality-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.quality === q);
        });
    };

    window.vgmRedrawPreview = function() {
        state.caption = $('vgmCaption').value || '';
        renderPreviewFrame();
    };

    window.vgmSetShowHole = function(on) {
        state.showHole = !!on;
        renderPreviewFrame();
    };

    // ----------------------------------------
    // Canvas vinyl rendering
    // ----------------------------------------
    // Draws a single frame of the vinyl onto a square canvas (size x size).
    // Caption (if present) occupies the bottom ~10% of the canvas.
    // opts: { ctx, size, angle, style, coloredColor, coverImage, caption, transparentBg }
    // transparentBg: when true, fills the background with a magenta chroma-key
    // (#FE00FE) instead of the dark vignette, so the GIF encoder can mark those
    // pixels transparent. The vinyl is a black circle so it never conflicts.
    function drawVinylFrame(opts) {
        const { ctx, size, angle, style, coloredColor, coverImage, caption, transparentBg, showHole } = opts;

        if (transparentBg) {
            ctx.fillStyle = '#FE00FE';
            ctx.fillRect(0, 0, size, size);
        } else {
            // Background — radial vignette to match the live preview backdrop
            const bg = ctx.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.75);
            bg.addColorStop(0, '#1f1812');
            bg.addColorStop(1, '#0d0a07');
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, size, size);
        }

        // Vinyl positioned slightly above center to leave bottom strip for caption space
        const cx = size / 2;
        const cy = caption ? size * 0.46 : size * 0.50;
        const vinylR = size * (caption ? 0.40 : 0.43);
        const labelR = vinylR * 0.36;
        const holeR  = vinylR * 0.03;

        // Soft shadow under vinyl — skipped in transparent mode so we don't leave
        // a chroma-key-tinted halo around the disc in the exported GIF.
        if (!transparentBg) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy + size * 0.012, vinylR * 1.02, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.filter = 'blur(' + (size * 0.02) + 'px)';
            ctx.fill();
            ctx.restore();
        }

        // Draw the vinyl body based on style
        if (style === 'picture') {
            drawPictureDiscBody(ctx, cx, cy, vinylR, angle, coverImage);
        } else if (style === 'aura' && coverImage) {
            // Album-tinted body: a heavily blurred + darkened copy of the cover
            // fills the disc instead of solid black, giving each vinyl a unique
            // color cast that matches the album art.
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, vinylR, 0, Math.PI * 2);
            ctx.clip();
            ctx.filter = 'blur(' + (vinylR * 0.18) + 'px) saturate(1.5) brightness(0.55)';
            const d = vinylR * 2;
            ctx.drawImage(coverImage, cx - vinylR, cy - vinylR, d, d);
            ctx.filter = 'none';
            // Inner vignette to keep depth toward the rim
            const v = ctx.createRadialGradient(cx, cy, vinylR * 0.35, cx, cy, vinylR);
            v.addColorStop(0, 'rgba(0,0,0,0)');
            v.addColorStop(1, 'rgba(0,0,0,0.55)');
            ctx.fillStyle = v;
            ctx.fillRect(cx - vinylR, cy - vinylR, d, d);
            ctx.restore();
            // Grooves on top, slightly stronger so they read against the colors
            drawGrooves(ctx, cx, cy, vinylR, labelR, 'aura');
            drawVinylShine(ctx, cx, cy, vinylR, angle, style);
        } else {
            // Solid disc background color
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, vinylR, 0, Math.PI * 2);
            if (style === 'colored') {
                const g = ctx.createRadialGradient(cx, cy, vinylR * 0.3, cx, cy, vinylR);
                g.addColorStop(0, lighten(coloredColor, 0.05));
                g.addColorStop(1, darken(coloredColor, 0.4));
                ctx.fillStyle = g;
            } else if (style === 'gold') {
                ctx.fillStyle = '#080604';
            } else if (style === 'translucent') {
                ctx.fillStyle = hexToRgba(coloredColor, 0.55);
            } else { // classic
                const g = ctx.createRadialGradient(cx, cy, vinylR * 0.3, cx, cy, vinylR);
                g.addColorStop(0, '#161210');
                g.addColorStop(1, '#040302');
                ctx.fillStyle = g;
            }
            ctx.fill();
            ctx.restore();

            // Grooves
            drawGrooves(ctx, cx, cy, vinylR, labelR, style);

            // Light shine across the whole disc (rotating with the vinyl)
            drawVinylShine(ctx, cx, cy, vinylR, angle, style);
        }

        // Label (cover) — rotates with vinyl
        if (coverImage) {
            drawLabel(ctx, cx, cy, labelR, angle, coverImage, style);
        } else {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, labelR, 0, Math.PI * 2);
            ctx.fillStyle = '#d4a574';
            ctx.fill();
            ctx.restore();
        }

        // Center hole (optional — toggled by showHole)
        if (showHole !== false) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, holeR, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx, cy, holeR * 1.6, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
        }

        // Outer rim highlight
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, vinylR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // Caption
        if (caption) {
            drawCaption(ctx, size, caption);
        }
    }

    function drawGrooves(ctx, cx, cy, outerR, innerR, style) {
        ctx.save();
        const grooveCount = 90;
        const step = (outerR - innerR) / grooveCount;
        for (let i = 0; i < grooveCount; i++) {
            const r = innerR + i * step;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            const alpha = 0.05 + (i % 7 === 0 ? 0.08 : 0);
            if (style === 'gold') {
                ctx.strokeStyle = `rgba(212, 165, 116, ${alpha * 0.6})`;
            } else if (style === 'translucent') {
                ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.5})`;
            } else if (style === 'colored') {
                ctx.strokeStyle = `rgba(0,0,0,${alpha * 1.2})`;
            } else if (style === 'aura') {
                // alternate dark + bright grooves so they read on the colored body
                ctx.strokeStyle = (i % 2 === 0)
                    ? `rgba(0,0,0,${alpha * 1.6})`
                    : `rgba(255,255,255,${alpha * 0.7})`;
            } else { // classic
                ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
            }
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawVinylShine(ctx, cx, cy, r, angle, style) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        // Wedge-shaped highlight
        const grad = ctx.createLinearGradient(-r, 0, r, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.45, 'rgba(255,255,255,0.08)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.16)');
        grad.addColorStop(0.55, 'rgba(255,255,255,0.08)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.globalCompositeOperation = 'screen';
        ctx.fill();
        ctx.restore();
    }

    function drawLabel(ctx, cx, cy, labelR, angle, coverImage, style) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        // For 'gold' style, draw a gold ring behind the label
        if (style === 'gold') {
            const ringR = labelR * 1.18;
            const g = ctx.createRadialGradient(0, 0, labelR, 0, 0, ringR);
            g.addColorStop(0, '#f5d896');
            g.addColorStop(1, '#a87a3a');
            ctx.beginPath();
            ctx.arc(0, 0, ringR, 0, Math.PI * 2);
            ctx.fillStyle = g;
            ctx.fill();
        }
        // Clip to circle and draw cover
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, labelR, 0, Math.PI * 2);
        ctx.clip();
        const size = labelR * 2;
        ctx.drawImage(coverImage, -labelR, -labelR, size, size);
        ctx.restore();
        // Subtle label border
        ctx.beginPath();
        ctx.arc(0, 0, labelR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    // Cache the composite "radial-blur" picture disc image keyed by (cover, radius)
    // so we don't rebuild it on every frame of a sync.
    let pictureDiscCache = { coverRef: null, r: 0, canvas: null };

    function buildPictureDiscComposite(coverImage, r) {
        const size = r * 2;
        // Heavy-blur base layer (outer halo)
        const base = document.createElement('canvas');
        base.width = size; base.height = size;
        const bctx = base.getContext('2d');
        bctx.filter = 'blur(' + (r * 0.07) + 'px)';
        bctx.drawImage(coverImage, 0, 0, size, size);
        bctx.filter = 'none';

        // Sharp-ish layer, masked to fade out toward the rim
        const sharp = document.createElement('canvas');
        sharp.width = size; sharp.height = size;
        const sctx = sharp.getContext('2d');
        sctx.filter = 'blur(' + (r * 0.012) + 'px)';
        sctx.drawImage(coverImage, 0, 0, size, size);
        sctx.filter = 'none';
        sctx.globalCompositeOperation = 'destination-in';
        const mask = sctx.createRadialGradient(r, r, 0, r, r, r);
        mask.addColorStop(0,    'rgba(0,0,0,1)');
        mask.addColorStop(0.45, 'rgba(0,0,0,0.95)');
        mask.addColorStop(0.7,  'rgba(0,0,0,0.45)');
        mask.addColorStop(0.9,  'rgba(0,0,0,0.1)');
        mask.addColorStop(1,    'rgba(0,0,0,0)');
        sctx.fillStyle = mask;
        sctx.fillRect(0, 0, size, size);

        // Composite sharp on top of blurred
        bctx.drawImage(sharp, 0, 0);
        return base;
    }

    function drawPictureDiscBody(ctx, cx, cy, r, angle, coverImage) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        const size = r * 2;
        if (coverImage) {
            // Build (or reuse) the radial-blur composite
            if (pictureDiscCache.coverRef !== coverImage || pictureDiscCache.r !== r) {
                pictureDiscCache = {
                    coverRef: coverImage,
                    r: r,
                    canvas: buildPictureDiscComposite(coverImage, r)
                };
            }
            ctx.drawImage(pictureDiscCache.canvas, -r, -r);
        } else {
            ctx.fillStyle = '#d4a574';
            ctx.fillRect(-r, -r, size, size);
        }
        ctx.restore();
        // Groove ridges (subtle, on top)
        ctx.save();
        const grooveCount = 70;
        for (let i = 0; i < grooveCount; i++) {
            const rr = r * (0.18 + (i / grooveCount) * 0.82);
            ctx.beginPath();
            ctx.arc(cx, cy, rr, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0,0,0,${i % 6 === 0 ? 0.18 : 0.07})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawCaption(ctx, size, caption) {
        const textY = size * 0.94;
        ctx.save();
        ctx.fillStyle = '#f2e8d8';
        const fontSize = Math.max(14, Math.round(size * 0.048));
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Trim if too long
        const maxWidth = size * 0.9;
        let text = caption;
        while (ctx.measureText(text).width > maxWidth && text.length > 1) {
            text = text.slice(0, -1);
        }
        if (text !== caption) text = text.slice(0, -1) + '…';
        ctx.fillText(text, size / 2, textY);
        ctx.restore();
    }

    // --- Color helpers ---
    function hexToRgb(hex) {
        const m = hex.replace('#','').match(/.{1,2}/g);
        if (!m || m.length < 3) return { r: 0, g: 0, b: 0 };
        return { r: parseInt(m[0], 16), g: parseInt(m[1], 16), b: parseInt(m[2], 16) };
    }
    function hexToRgba(hex, a) {
        const { r, g, b } = hexToRgb(hex);
        return `rgba(${r},${g},${b},${a})`;
    }
    function lighten(hex, amt) {
        const { r, g, b } = hexToRgb(hex);
        const ll = (c) => Math.min(255, Math.round(c + (255 - c) * amt));
        return `rgb(${ll(r)},${ll(g)},${ll(b)})`;
    }
    function darken(hex, amt) {
        const { r, g, b } = hexToRgb(hex);
        const dd = (c) => Math.max(0, Math.round(c * (1 - amt)));
        return `rgb(${dd(r)},${dd(g)},${dd(b)})`;
    }

    // --- Preview loop ---
    function renderPreviewFrame() {
        const c = $('vgmPreviewCanvas');
        if (!c) return;
        const ctx = c.getContext('2d');
        // Square canvas matching stage width for crispness
        const stage = c.parentElement;
        const stageW = Math.max(280, stage.clientWidth || 420);
        if (c.width !== stageW || c.height !== stageW) {
            c.width = stageW;
            c.height = stageW;
        }
        ctx.clearRect(0, 0, c.width, c.height);
        drawVinylFrame({
            ctx,
            size: stageW,
            angle: state.previewAngle,
            style: state.style,
            coloredColor: state.coloredColor,
            coverImage: state.coverImage,
            caption: $('vgmCaption').value || '',
            showHole: state.showHole
        });
    }

    function startPreviewLoop() {
        stopPreviewLoop();
        let last = performance.now();
        const tick = (now) => {
            if (!$('vinylGifModal').classList.contains('active')) {
                state.previewRAF = 0;
                return;
            }
            const dt = (now - last) / 1000;
            last = now;
            // Base: 2.5s per rotation at 1.0x speed (chill, hypnotic). Slider scales from there.
            state.previewAngle += dt * (Math.PI * 2 / 2.5) * state.speed;
            if (state.previewAngle > Math.PI * 2) state.previewAngle -= Math.PI * 2;
            renderPreviewFrame();
            state.previewRAF = requestAnimationFrame(tick);
        };
        state.previewRAF = requestAnimationFrame(tick);
    }

    function stopPreviewLoop() {
        if (state.previewRAF) {
            cancelAnimationFrame(state.previewRAF);
            state.previewRAF = 0;
        }
    }

    // --- GIF generation ---
    window.vgmGenerateGif = async function() {
        if (state.isGenerating || !state.coverImage) return;
        if (typeof GIF === 'undefined') {
            alert('GIF encoder not loaded yet — try again in a moment.');
            return;
        }
        state.isGenerating = true;
        $('vgmGenerateBtn').disabled = true;
        hideResult();
        stopPreviewLoop();
        $('vgmProgress').classList.add('active');
        $('vgmProgressFill').style.width = '0%';
        $('vgmProgressText').textContent = 'Rendering frames…';

        const preset = QUALITY_PRESETS[state.quality];
        const size = preset.size;

        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = size;
        frameCanvas.height = size;
        const frameCtx = frameCanvas.getContext('2d');

        const gif = new GIF({
            workers: 2,
            quality: preset.gifQuality,
            width: size,
            height: size,
            workerScript: 'vendor/gif.js/gif.worker.js',
            // Magenta chroma key — drawVinylFrame fills the background with #FE00FE
            // and the encoder marks that exact color as transparent in the output.
            transparent: 0xFE00FE,
            background: '#FE00FE'
        });

        // Frame delay derived from a 2.5s base revolution to match the preview.
        // Faster slider speed = shorter delay = quicker spin in the exported GIF.
        const baseRevolutionMs = 2500;
        const baseDelay = baseRevolutionMs / preset.frames;
        const frameDelay = Math.max(20, Math.round(baseDelay / state.speed));
        for (let i = 0; i < preset.frames; i++) {
            const angle = (i / preset.frames) * Math.PI * 2;
            drawVinylFrame({
                ctx: frameCtx,
                size,
                angle,
                style: state.style,
                coloredColor: state.coloredColor,
                coverImage: state.coverImage,
                caption: state.caption,
                transparentBg: true,
                showHole: state.showHole
            });
            gif.addFrame(frameCtx, { copy: true, delay: frameDelay });
            // Yield occasionally so UI updates
            if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
            $('vgmProgressFill').style.width = ((i + 1) / preset.frames * 40) + '%';
        }

        $('vgmProgressText').textContent = 'Encoding…';
        gif.on('progress', (p) => {
            $('vgmProgressFill').style.width = (40 + p * 60) + '%';
            $('vgmProgressText').textContent = 'Encoding ' + Math.round(p * 100) + '%';
        });
        gif.on('finished', (blob) => {
            const url = URL.createObjectURL(blob);
            $('vgmProgress').classList.remove('active');
            const sizeKb = Math.round(blob.size / 1024);

            // Swap live canvas with the rendered GIF in the same preview slot
            $('vgmPreviewCanvas').style.display = 'none';
            const resultImg = $('vgmResultImg');
            resultImg.src = url;
            resultImg.style.display = '';

            // Show meta + actions below the stage
            const meta = $('vgmResultMeta');
            meta.textContent = `${size}px · ${preset.frames} frames · ${sizeKb} KB`;
            meta.style.display = '';
            const dl = $('vgmDownloadLink');
            dl.href = url;
            const stamp = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
            dl.download = `vinyl-${stamp}.gif`;
            $('vgmResultActions').style.display = 'flex';

            state.isGenerating = false;
            $('vgmGenerateBtn').disabled = false;
        });
        gif.render();
    };

    // --- Bind events that need DOM ready ---
    function init() {
        if (!$('vinylGifModal')) return;
        bindCropperEvents();
        bindColorSwatches();
        $('vgmCaption').addEventListener('input', () => { state.caption = $('vgmCaption').value || ''; });
        const speed = $('vgmSpeed');
        if (speed) {
            speed.addEventListener('input', () => {
                state.speed = parseFloat(speed.value) || 1.0;
                $('vgmSpeedValue').textContent = state.speed.toFixed(1) + '×';
            });
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

// ==== Phase C: records conveyor + source filter ====
// ==========================================
// Source filter (local vs spotify playlists)
// Toggles data-active-source on the crate room-center; CSS hides the
// non-matching record-cards. Persists the choice in localStorage.
// ==========================================
// Library cards open from the keyboard too: the cover is their button
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const cover = e.target && e.target.closest && e.target.closest('.record-card-cover[role="button"]');
    if (!cover || e.target !== cover) return;
    e.preventDefault();
    cover.click();
});

window.setSourceFilter = function(value) {
    const valid = ['all', 'user', 'spotify'];
    if (!valid.includes(value)) value = 'all';
    // MP's .room-center has no id; target it directly (scoped to the crate view).
    const room = document.getElementById('roomCenter')
        || document.querySelector('#vinylCrateView .room-center')
        || document.querySelector('.room-center');
    if (room) room.setAttribute('data-active-source', value);
    document.querySelectorAll('#sourceFilter .source-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sourceFilter === value);
    });
    try { localStorage.setItem('music_source_filter', value); } catch (_) {}
    // Filtering hides cards, which can flip a row between fitting and
    // overflowing — re-measure the marquee either way.
    updateConveyorMarquee();
};

(function initSourceFilter() {
    function apply() {
        if (!document.getElementById('sourceFilter')) return;
        const saved = (localStorage.getItem('music_source_filter') || 'all');
        window.setSourceFilter(saved);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
    else apply();
})();

// The desktop crate draws the source filter on the "Your playlists" row and,
// on wide windows, "+ New playlist" after Settings. Move those nodes there in
// the DOM too, so Tab follows what's on screen; phones and tablets get the
// toolbar's markup order back. The queries mirror the DESKTOP CRATE CSS.
(function initCrateFocusOrder() {
    const desktop = window.matchMedia('(min-width: 901px) and (min-height: 501px)');
    const narrow = window.matchMedia('(max-width: 1120px), (max-width: calc(560px + 28.5em))');
    function place() {
        const toolbar = document.querySelector('#vinylCrateView .collection-toolbar');
        const shelf = document.querySelector('#vinylCrateView .crate-shelf');
        const filter = document.getElementById('sourceFilter');
        const settings = toolbar && toolbar.querySelector('.crate-settings-btn');
        const newBtn = toolbar && toolbar.querySelector('.new-playlist-btn:not(.crate-search-btn):not(.crate-stats-btn):not(.crate-settings-btn)');
        if (!toolbar || !shelf || !filter || !settings || !newBtn) return;
        if (desktop.matches && !narrow.matches) settings.after(newBtn);
        else toolbar.prepend(newBtn);
        if (desktop.matches) shelf.before(filter);  // still a grid item of .room-center
        else toolbar.prepend(filter);
    }
    function init() {
        place();
        desktop.addEventListener('change', place);
        narrow.addEventListener('change', place);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

// The marquee (and its seamless-loop clones) only earns its keep when the
// real cards overflow the row; otherwise the clones show every playlist
// twice. Rows toggle between marquee and a static centered layout.
function updateConveyorMarquee() {
    // The static shelf dissolves the rows (display:contents), so measure
    // with it off and decide afterwards.
    const conveyor = document.getElementById('recordsConveyor');
    if (conveyor) conveyor.classList.remove('is-static');
    const rows = document.querySelectorAll('.conveyor-row');
    rows.forEach(row => {
        const track = row.querySelector('.conveyor-track');
        if (!track) return;
        // With clones visible the track is double-width, so halve it to get
        // the real cards' span; with .no-marquee already on, it's exact.
        const realWidth = row.classList.contains('no-marquee')
            ? track.scrollWidth
            : track.scrollWidth / 2;
        row.classList.toggle('no-marquee', realWidth <= row.clientWidth);
    });
    // Every row fits: show one ordered shelf instead of two centered rows.
    if (conveyor && rows.length) {
        conveyor.classList.toggle('is-static', [...rows].every(r => r.classList.contains('no-marquee')));
    }
}
window.addEventListener('resize', updateConveyorMarquee);

// ============================================================
// AUDIO FILE UPLOAD (single via Add Song modal, batch via multi-
// select or drag-and-drop anywhere on the page)
// ============================================================

const AUDIO_EXT_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;

function isAudioFile(file) {
    return file && (file.type.startsWith('audio/') || AUDIO_EXT_RE.test(file.name));
}

/** Read ID3 tags, falling back to "Artist - Title" filename parsing. */
async function tagsForAudioFile(file) {
    try { return await readTagsFromFile(file); } catch (e) {
        const fromName = cleanFilename(file.name);
        return { title: fromName.title || file.name, artist: fromName.artist, album: '', coverUrl: null };
    }
}

/** POST one audio file (plus its embedded cover, if any) to /upload-song. */
async function uploadAudioFile(file, tags, onProgress) {
    const form = new FormData();
    form.append('audio', file);
    if (tags && tags.coverUrl) {
        // The embedded ID3 picture is a blob URL — turn it back into a blob
        // and upload it alongside so the song keeps its cover art.
        try {
            const coverBlob = await (await fetch(tags.coverUrl)).blob();
            if (coverBlob.size <= 2 * 1024 * 1024) {
                const ext = (coverBlob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
                form.append('cover', coverBlob, 'cover.' + ext);
            }
        } catch (e) {}
    }

    // XHR instead of fetch: upload progress events.
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload-song');
        xhr.setRequestHeader('X-CSRF-TOKEN', window.getCsrfToken ? window.getCsrfToken() : '');
        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
            };
        }
        xhr.onload = () => {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { resolve({ success: false, error: 'Upload failed (' + xhr.status + ')' }); }
        };
        xhr.onerror = () => resolve({ success: false, error: 'Upload failed — network error' });
        xhr.send(form);
    });
}

/** Add Song modal file input: one file fills the form for review; a
    multi-select goes straight to the batch importer. */
async function handleAudioUpload(files) {
    if (!files || files.length === 0) return;
    // The phone's Add songs: always the batch path (progress in a toast,
    // offline copies linked), to the playlist its "To" line names.
    const phoneTarget = typeof window.mCurrentAddTarget === 'function' ? window.mCurrentAddTarget() : undefined;
    const phoneSheet = typeof window.mAddSheetOnPhone === 'function' && window.mAddSheetOnPhone();
    if (phoneTarget !== undefined || phoneSheet) {
        const list = [...files];
        document.getElementById('addSongFile').value = '';
        hideAddSongModal();
        // (the setup wizard: no target, so the first song is cued as before)
        importAudioFiles(list, phoneTarget !== undefined ? { playlist: phoneTarget } : {});
        return;
    }
    if (files.length > 1) {
        const list = [...files];
        document.getElementById('addSongFile').value = '';
        hideAddSongModal();
        // A playlist the phone only shows (landscape) gets them without a cue
        importAudioFiles(list, !listIsPlaying() ? { playlist: listId() } : {});
        return;
    }

    const file = files[0];
    const statusEl = document.getElementById('uploadStatus');
    const progressEl = document.getElementById('uploadProgress');
    const fillEl = document.getElementById('uploadProgressFill');

    const tags = await tagsForAudioFile(file);

    progressEl.style.display = '';
    fillEl.style.width = '0%';
    statusEl.textContent = 'Uploading ' + file.name + '…';
    statusEl.classList.remove('upload-error');

    const result = await uploadAudioFile(file, tags, (pct) => { fillEl.style.width = pct + '%'; });

    progressEl.style.display = 'none';
    document.getElementById('addSongFile').value = '';

    if (!result.success) {
        statusEl.textContent = result.error || (result.errors ? Object.values(result.errors).flat().join(' ') : 'Upload failed');
        statusEl.classList.add('upload-error');
        return;
    }

    // Fill the form; the user reviews and hits "Add to Playlist" as usual.
    document.getElementById('addSongYoutube').value = result.mp3_url;
    const titleInput = document.getElementById('addSongTitle');
    const artistInput = document.getElementById('addSongArtist');
    const albumInput = document.getElementById('addSongAlbum');
    const coverInput = document.getElementById('addSongCover');
    if (!titleInput.value) titleInput.value = tags.title || '';
    if (!artistInput.value) artistInput.value = tags.artist || '';
    if (!albumInput.value) albumInput.value = tags.album || '';
    if (result.cover && !coverInput.value) coverInput.value = result.cover;
    statusEl.textContent = 'Uploaded — review the details and add it.';
}

// ---- Batch import (library / album / podcast folder) ----

let importInProgress = false;

// opts.playlist: send the files there (the phone's "To" line) instead of the
// open playlist, without cueing over whatever is playing.
async function importAudioFiles(files, opts = {}) {
    const target = opts.playlist !== undefined && opts.playlist !== null ? String(opts.playlist) : null;
    const addedSongs = [];
    let linkedOpen = 0;
    // A song not joined to the list on screen (which counts itself) counts
    // here, as it lands: opening that playlist mid-run recounts it from then
    const countElsewhere = () => {
        const meta = playlistsMeta[target];
        if (!meta) return;
        meta.songCount = (meta.songCount || 0) + 1;
        setCrateCardCount(target, meta.songCount);
    };
    const audio = [...files].filter(isAudioFile);
    if (audio.length === 0) {
        showImportToast('No audio files found — supported: mp3, m4a, aac, ogg, opus, wav, flac', true);
        setTimeout(hideImportToast, 4000);
        return;
    }
    if (importInProgress) {
        showImportToast('An import is already running — one batch at a time.', true);
        setTimeout(hideImportToast, 3000);
        return;
    }

    importInProgress = true;
    let added = 0, linked = 0, failed = 0;
    // Ensure add-song mode is MP3-friendly on the backend side: the 'add'
    // action doesn't care about musicSource, so no state to flip here.
    for (let i = 0; i < audio.length; i++) {
        const file = audio[i];
        showImportToast(`Importing ${i + 1}/${audio.length} — ${file.name}`);
        try {
            const tags = await tagsForAudioFile(file);
            const up = await uploadAudioFile(file, tags);
            if (!up.success) { failed++; continue; }

            const song = {
                title: tags.title || file.name,
                artist: tags.artist || '',
                album: tags.album || '',
                cover: up.cover || '',
                youtube_id: '',
                mp3_url: up.mp3_url,
                spotify_id: ''
            };
            // link: an upload matching a song already in this playlist
            // attaches as its offline copy instead of duplicating it.
            const writeId = target !== null ? target : String(activePlaylistId);
            let result;
            writeBegin(writeId);
            try {
                const res = await fetch('/save-music', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.assign({ action: 'add', song, link: true }, target !== null ? { playlist: target } : {}))
                });
                result = await res.json();
            } finally {
                writeEnd(writeId);
            }
            if (result.success && result.linked) {
                // The index is into the target playlist: only its own copy in
                // memory (asked per song: the user may open another meanwhile)
                const arr = target === null || target === String(activePlaylistId) ? songsData
                    : (viewedId !== null && target === String(viewedId) && viewedSongs) ? viewedSongs : null;
                const existing = arr ? arr[result.index] : null;
                if (existing) {
                    existing.mp3_url = song.mp3_url;
                    if (!existing.album) existing.album = song.album;
                    if (!existing.cover) existing.cover = song.cover;
                    linkedOpen++;
                }
                linked++;
            } else if (result.success) {
                if (target === null) {
                    songsData.push(song);
                    currentSongIndex = result.index;
                } else if (!joinList(target, song)) {
                    countElsewhere(); // no loaded copy of it took the song
                }
                addedSongs.push(song);
                added++;
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }

    importInProgress = false;
    if (target === null) {
        if (shuffleMode !== 'off') buildShuffleQueue();
        rebuildSongList();
        updateTrackCount();
        if (added > 0) {
            const current = songsData[currentSongIndex];
            updateSongDisplay(current);
            playSongSource(current, true); // cue, don't blast the speakers
            loadLyricsForSong(current); // keep lyrics in sync with the shown song
        }
    } else {
        // Its loaded copies already took their songs (joinList); the
        // chosen playlist's count and Favorites' hearts follow.
        if (target === 'favorites' && addedSongs.length) {
            addedSongs.forEach((sg) => favoriteKeys.add(songPlayKey(sg)));
            updateFavoriteHearts();
        }
        if (linkedOpen) rebuildSongList();
    }
    if (typeof updateOfflineButton === 'function') updateOfflineButton();
    const parts = [];
    if (added) parts.push(`imported ${added}`);
    if (linked) parts.push(`linked ${linked} to existing song${linked === 1 ? '' : 's'} for offline`);
    if (failed) parts.push(`${failed} failed`);
    const into = target !== null && playlistsMeta[target] ? ` into “${playlistsMeta[target].name}”` : '';
    showImportToast(
        parts.length ? parts.join(', ').replace(/^./, c => c.toUpperCase()) + into : 'Nothing imported',
        failed > 0
    );
    setTimeout(hideImportToast, 5000);
}

// ---- Import progress toast ----

function getImportToast() {
    let el = document.getElementById('importToast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'importToast';
        el.className = 'import-toast';
        document.body.appendChild(el);
    }
    return el;
}

function showImportToast(text, isError = false) {
    const el = getImportToast();
    el.textContent = text;
    el.classList.toggle('import-toast-error', isError);
    el.classList.add('visible');
}

function hideImportToast() {
    const el = document.getElementById('importToast');
    if (el) el.classList.remove('visible');
}

// ---- Drag & drop: drop audio files anywhere to add them ----

function dragHasFiles(e) {
    return e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
}

function getDropOverlay() {
    let el = document.getElementById('dropOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'dropOverlay';
        el.className = 'drop-overlay';
        el.innerHTML = '<div class="drop-overlay-box">'
            + '<div class="drop-overlay-icon">&#9834;</div>'
            + '<div class="drop-overlay-title">Drop your music</div>'
            + '<div class="drop-overlay-sub" id="dropOverlaySub"></div>'
            + '</div>';
        document.body.appendChild(el);
    }
    const sub = el.querySelector('#dropOverlaySub');
    const plName = (playlistsMeta[activePlaylistId] && playlistsMeta[activePlaylistId].name) || 'the current playlist';
    if (sub) sub.textContent = 'Adds to “' + plName + '” · mp3, m4a, ogg, opus, wav, flac';
    return el;
}

let dragDepth = 0;

document.addEventListener('dragenter', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    getDropOverlay().classList.add('visible');
});

document.addEventListener('dragover', (e) => {
    if (dragHasFiles(e)) e.preventDefault();
});

document.addEventListener('dragleave', (e) => {
    if (!dragHasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
        const el = document.getElementById('dropOverlay');
        if (el) el.classList.remove('visible');
    }
});

document.addEventListener('drop', (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    const el = document.getElementById('dropOverlay');
    if (el) el.classList.remove('visible');
    importAudioFiles(e.dataTransfer.files);
});

// ============================================================
// PWA + OFFLINE PLAYLISTS
// Uploaded (/media/) songs can be saved into the 'media-v1' cache and
// played with no network; YouTube/Spotify songs are online-only and
// grey out while offline.
// ============================================================

const OFFLINE_MEDIA_CACHE = 'media-v1';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

function getOfflinePlaylists() {
    try { return JSON.parse(localStorage.getItem('offlinePlaylists')) || []; }
    catch (e) { return []; }
}

function setOfflinePlaylists(ids) {
    localStorage.setItem('offlinePlaylists', JSON.stringify(ids));
}

/** Same-origin uploaded audio + covers for a playlist (the one on screen). */
function offlineUrlsForActivePlaylist(songs = listSongs()) {
    const urls = new Set();
    songs.forEach(s => {
        if (s.mp3_url && s.mp3_url.startsWith('/media/')) {
            urls.add(s.mp3_url);
            if (s.cover && s.cover.startsWith('/media/')) urls.add(s.cover);
        }
    });
    return [...urls];
}

// A save in progress (the phone menu can be reopened meanwhile).
let offlineSaving = false;

async function toggleOfflinePlaylist() {
    if (offlineSaving) return;
    if (!('caches' in window)) {
        alert('Offline storage is not supported by this browser.');
        return;
    }
    const btn = document.getElementById('offlineBtn');
    const saved = getOfflinePlaylists();
    // The playlist on screen, held for the whole (slow) save
    const id = listId();
    const songs = listSongs();

    if (saved.includes(id)) {
        // Un-save: drop this playlist's files from the cache. A file shared
        // with another offline playlist gets re-added next time that playlist
        // is re-toggled — acceptable for a personal library.
        const cache = await caches.open(OFFLINE_MEDIA_CACHE);
        for (const url of offlineUrlsForActivePlaylist(songs)) {
            await cache.delete(url, { ignoreSearch: true });
        }
        setOfflinePlaylists(saved.filter(x => x !== id));
        updateOfflineButton();
        return;
    }

    const urls = offlineUrlsForActivePlaylist(songs);
    if (urls.length === 0) {
        alert('Nothing here can be saved for offline.\n\nOnly uploaded songs (and MP3s hosted on this app) play offline — YouTube and Spotify tracks always need a connection.');
        return;
    }

    offlineSaving = true;
    btn.classList.add('offline-saving');
    const cache = await caches.open(OFFLINE_MEDIA_CACHE);
    let done = 0, failed = 0;
    for (const url of urls) {
        try {
            // ?dl=1 forces a same-origin full-file stream when uploads live
            // on a bucket (normal playback 302s to a signed URL, which the
            // Cache API can't store usefully). Cache under the clean URL so
            // the service worker matches <audio> requests.
            const res = await fetch(url + '?dl=1');
            if (res.ok) await cache.put(url, res);
            else failed++;
        } catch (e) { failed++; }
        done++;
        btn.title = `Saving for offline… ${done}/${urls.length}`;
    }
    btn.classList.remove('offline-saving');
    offlineSaving = false;

    if (failed === 0) {
        setOfflinePlaylists([...saved, id]);
    } else {
        alert(`Some files failed to download (${failed}/${urls.length}). Try again while online.`);
    }
    updateOfflineButton();
}

function updateOfflineButton() {
    const btn = document.getElementById('offlineBtn');
    if (!btn) return;
    const isSaved = getOfflinePlaylists().includes(listId());
    btn.classList.toggle('offline-saved', isSaved);
    btn.title = isSaved ? 'Saved for offline — tap to remove' : 'Save playlist for offline';

    // Only meaningful for playlists that contain uploaded/MP3 songs
    const hasOfflinable = listSongs().some(s => s.mp3_url && s.mp3_url.startsWith('/media/'));
    btn.style.display = (hasOfflinable || isSaved) ? '' : 'none';
}

// Grey out online-only songs while disconnected
function applyOnlineState() {
    document.body.classList.toggle('offline-mode', !navigator.onLine);
}
window.addEventListener('online', applyOnlineState);
window.addEventListener('offline', applyOnlineState);

document.addEventListener('DOMContentLoaded', () => {
    applyOnlineState();
    updateOfflineButton();
});

// ============================================================
// MOBILE V2 — phone-browser shell (dock, sheets, gestures)
// ============================================================
// Lives at the END of script.js on purpose: top-level bindings like
// loopMode/shuffleMode/songsData are file-scoped to classic scripts'
// global bindings, and same-file access is what makes direct reads
// reliable. Everything here is inert unless the viewport is a phone
// and we're NOT inside the ReactNative WebView / ?app mode.
(function mobileV2() {
    const isAppShell = !!window.ReactNativeWebView
        || new URLSearchParams(window.location.search).has('app');

    // These two are referenced from HTML the SHEET BRANCH of showSendMenu
    // emits, and that branch also serves the RN app shell — so they must
    // exist even when the rest of mobileV2 stands down.
    window.mToast = function (text) {
        document.querySelectorAll('.m-toast').forEach((t) => t.remove());
        const toast = document.createElement('div');
        toast.className = 'm-toast';
        toast.setAttribute('role', 'status');
        toast.textContent = text;
        document.body.appendChild(toast);
        // Long enough to read: 2s, plus a little per character, up to 6s.
        setTimeout(() => toast.remove(), Math.min(6000, 2000 + String(text).length * 40));
    };

    // Two-tap inline delete confirm: first tap arms the row for 3s
    window.mArmDelete = function (row, songIndex, ctx) {
        if (row.classList.contains('m-confirm-armed')) {
            closeSendMenu();
            if (songOpInFlight || reordersPending > 0) {
                mToast('Still saving your last change…');
                return;
            }
            deleteSong(songIndex, { skipConfirm: true, ctx });
            if (window.mToast) mToast('Removed');
            return;
        }
        row.classList.add('m-confirm-armed');
        const nameEl = row.querySelector('.send-menu-name');
        if (nameEl) {
            row.dataset.origLabel = nameEl.textContent;
            nameEl.textContent = 'Tap again to remove';
        }
        setTimeout(() => {
            if (row.isConnected && row.classList.contains('m-confirm-armed')) {
                row.classList.remove('m-confirm-armed');
                const n = row.querySelector('.send-menu-name');
                if (n && row.dataset.origLabel) n.textContent = row.dataset.origLabel;
            }
        }, 3000);
    };

    // One frame without transitions when the 600px breakpoint flips (see
    // .m-mq-flip in styles.css): the playlist fade and the Now Playing slide
    // would otherwise play across a rotation. Registered before the app-shell
    // gate: the phone CSS applies inside the app's WebView too.
    window.matchMedia('(max-width: 600px)').addEventListener('change', () => {
        const root = document.documentElement;
        root.classList.add('m-mq-flip');
        requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('m-mq-flip')));
    });

    if (isAppShell) return;

    const mq = window.matchMedia('(max-width: 600px)');
    const onPhone = () => mq.matches;
    // Back-button layers (playlist screen, modals) serve both phone shells:
    // portrait, and short landscape phones (same query as the CSS dock).
    // Now Playing, lyrics and the song sheet stay portrait-only (onPhone).
    const shellMq = window.matchMedia('(max-width: 600px), (min-width: 601px) and (max-height: 500px) and (pointer: coarse)');
    const inShell = () => shellMq.matches;
    // Only the shell shows a playlist without playing it: leaving it (an
    // unfold, a split-screen resize) puts the playing list back on screen.
    shellMq.addEventListener('change', (e) => { if (!e.matches) collapseView(); });

    const dock = document.getElementById('mDock');
    if (!dock) return;
    const dockInfo = document.getElementById('mDockInfo');
    const dockArt = document.getElementById('mDockArt');
    const dockPlay = document.getElementById('mDockPlay');
    const dockNext = document.getElementById('mDockNext');

    // ---- Play state: #vinyl.playing is the single source of truth toggled
    // by onPlayerStateChange for all three engines — mirror it on <body>.
    const vinyl = document.getElementById('vinyl');
    if (vinyl) {
        const syncPlaying = () => {
            document.body.classList.toggle('m-playing', vinyl.classList.contains('playing'));
            // Dock visibility depends on play state (empty-playlist case)
            if (typeof updateDockVisibility === 'function') updateDockVisibility();
        };
        new MutationObserver(syncPlaying)
            .observe(vinyl, { attributes: true, attributeFilter: ['class'] });
        // Deferred: updateDockVisibility's lexical bindings (keyboardOpen)
        // are declared further down the IIFE — calling synchronously here
        // would hit the temporal dead zone.
        setTimeout(syncPlaying, 0);
    }

    // ---- Dock art mirrors the sleeve art (updated on every track change)
    const sleeveArt = document.getElementById('sleeveArtImg');
    if (sleeveArt && dockArt) {
        const syncArt = () => {
            dockArt.src = sleeveArt.src || '';
            dockArt.style.display = sleeveArt.style.display === 'none' || !sleeveArt.src
                ? 'none' : '';
        };
        new MutationObserver(syncArt)
            .observe(sleeveArt, { attributes: true, attributeFilter: ['src', 'style'] });
    }

    // ---- Dock visibility: hidden when the playlist is empty or while the
    // software keyboard is up (a text field has focus). The tab bar follows
    // the keyboard through body.m-kb.
    let keyboardOpen = false;
    const TYPING_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), select, textarea';
    // A mouse-driven narrow window has no on-screen keyboard to make room for.
    const softKeyboard = window.matchMedia('(pointer: coarse)');
    const typingInField = (el) => softKeyboard.matches && !!(el && el.matches && el.matches(TYPING_FIELD));
    function updateDockVisibility() {
        // An empty playlist hides the dock — unless audio is still playing
        // (switching into an empty playlist doesn't stop the old track, and
        // the dock would be the only reachable transport).
        const empty = (typeof songsData === 'undefined' || songsData.length === 0)
            && !document.body.classList.contains('m-playing');
        dock.classList.toggle('m-dock-hidden', empty || keyboardOpen);
        document.body.classList.toggle('m-kb', keyboardOpen);
    }
    document.addEventListener('focusin', (e) => {
        if (typingInField(e.target)) {
            keyboardOpen = true;
            updateDockVisibility();
        }
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => {
            keyboardOpen = typingInField(document.activeElement);
            updateDockVisibility();
        }, 150);
    });
    // Android's back button can put the keyboard away and leave the field
    // focused — the dock and tab bar would stay hidden. When the visual
    // viewport grows back (not a pinch zoom), let the field go.
    if (window.visualViewport) {
        let keyboardSeen = false;
        window.visualViewport.addEventListener('resize', () => {
            const vv = window.visualViewport;
            if (Math.abs(vv.scale - 1) > 0.01) return;
            if (vv.height < window.innerHeight - 120) {
                keyboardSeen = true;
            } else if (keyboardSeen) {
                keyboardSeen = false;
                const el = document.activeElement;
                if (keyboardOpen && typingInField(el)) el.blur();
            }
        });
    }
    // Playlist switches / song add+delete rebuild the list — piggyback on it.
    const origRebuildSongList = window.rebuildSongList;
    if (typeof origRebuildSongList === 'function') {
        window.rebuildSongList = function () {
            const out = origRebuildSongList.apply(this, arguments);
            updateDockVisibility();
            applyRowFilter();
            return out;
        };
    }
    updateDockVisibility();

    // ---- Hero actions: Play pill + shuffle chip ----
    const playAll = document.getElementById('mPlayAll');
    if (playAll) {
        playAll.addEventListener('click', () => {
            if (!listIsPlaying()) {
                // A playlist that's only shown: Play makes it the playing one,
                // at its saved song (a random one with shuffle on), then shows
                // Now Playing. Never toggleMusic: it would pause what plays.
                if (listLoading() || !viewedSongs.length) return;
                const n = viewedSongs.length;
                const at = shuffleMode !== 'off' ? Math.floor(Math.random() * n)
                    : Math.max(0, Math.min(viewedResume, n - 1));
                startInViewedList(at).then((ok) => {
                    if (ok && window.mOpenNowPlaying) window.mOpenNowPlaying();
                });
                return;
            }
            if (songsData.length === 0) return;
            const startingPlayback = !document.body.classList.contains('m-playing');
            toggleMusic();
            // Starting playback is the flagship moment — reveal Now Playing
            if (startingPlayback && window.mOpenNowPlaying) window.mOpenNowPlaying();
        });
    }

    // The chip mirrors the coaster's three-state cycle (off/shuffle/smart)
    function mSyncModes() {
        const chip = document.getElementById('mShuffleChip');
        if (chip) {
            chip.dataset.mode = shuffleMode;
            chip.setAttribute('aria-pressed', shuffleMode !== 'off' ? 'true' : 'false');
            // The label is its own span: the phone action row shows just the icon.
            const label = chip.querySelector('.m-shuffle-label');
            const text = shuffleMode === 'smart' ? 'Smart mix' : 'Shuffle';
            if (label) label.textContent = text; else chip.textContent = text;
            chip.setAttribute('aria-label', shuffleMode === 'smart' ? 'Smart mix (on)' : (shuffleMode === 'shuffle' ? 'Shuffle (on)' : 'Shuffle'));
        }
        const npShuffle = document.getElementById('mShuffleBtn');
        if (npShuffle) {
            npShuffle.dataset.mode = shuffleMode;
            npShuffle.setAttribute('aria-pressed', shuffleMode !== 'off' ? 'true' : 'false');
        }
        const npLoop = document.getElementById('mLoopBtn');
        if (npLoop) {
            npLoop.dataset.mode = loopMode;
            npLoop.setAttribute('aria-pressed', loopMode !== 'off' ? 'true' : 'false');
        }
    }

    const shuffleChip = document.getElementById('mShuffleChip');
    if (shuffleChip) {
        shuffleChip.addEventListener('click', () => {
            toggleShuffle();
            mSyncModes();
        });
    }

    // ---- Mode persistence (all platforms — desktop lost loop/shuffle on
    // every reload too). Stored on toggle; restored by DIRECT assignment,
    // mirroring the exact DOM writes the toggles perform. Never restore by
    // cycling toggleShuffle: passing through 'smart' fires radio-
    // recommendation fetches on every page load.
    const origToggleShuffle = window.toggleShuffle;
    window.toggleShuffle = function () {
        const out = origToggleShuffle.apply(this, arguments);
        try { localStorage.setItem('mShuffleMode', shuffleMode); } catch (e) {}
        mSyncModes();
        return out;
    };
    const origToggleLoopMode = window.toggleLoopMode;
    window.toggleLoopMode = function () {
        const out = origToggleLoopMode.apply(this, arguments);
        try { localStorage.setItem('mLoopMode', loopMode); } catch (e) {}
        mSyncModes();
        return out;
    };

    (function restoreModes() {
        let savedLoop = null, savedShuffle = null;
        try {
            savedLoop = localStorage.getItem('mLoopMode');
            savedShuffle = localStorage.getItem('mShuffleMode');
        } catch (e) {}

        if (savedLoop && ['off', 'playlist', 'single'].includes(savedLoop) && savedLoop !== loopMode) {
            loopMode = savedLoop;
            const btn = document.getElementById('loopCoaster');
            const icon = document.getElementById('loopIcon');
            const label = document.getElementById('loopLabel');
            if (btn) btn.dataset.loop = savedLoop;
            if (icon) icon.innerHTML = loopSvgs[savedLoop];
            if (label) {
                if (savedLoop === 'single') updateLoopSongLabel();
                else label.textContent = savedLoop === 'playlist' ? 'loop all' : 'no loop';
            }
        }

        if (savedShuffle && ['off', 'shuffle', 'smart'].includes(savedShuffle) && savedShuffle !== shuffleMode) {
            shuffleMode = savedShuffle;
            const btn = document.getElementById('shuffleBtn');
            const label = document.getElementById('shuffleLabel');
            if (btn) btn.dataset.shuffle = savedShuffle;
            if (label) {
                label.textContent = savedShuffle === 'off' ? 'shuffle'
                    : (savedShuffle === 'shuffle' ? 'shuffle on' : 'smart shuffle');
            }
            if (savedShuffle !== 'off') buildShuffleQueue();
            else shuffleQueue = [];
            // Restoring 'smart' deliberately does NOT fetch radio at boot;
            // switchSong's own low-pool branch refills on the next change.
        }
        mSyncModes();
    })();

    // ---- Find in this crate: client-side row filter ----
    const filterInput = document.getElementById('mFilterInput');
    const filterEmpty = document.getElementById('mFilterEmpty');
    function applyRowFilter() {
        if (!filterInput) return;
        const raw = filterInput.value.trim();
        const q = raw.toLowerCase();
        let shown = 0;
        // Only filter library songs — Discover rows and the now-playing radio
        // row aren't part of the crate.
        document.querySelectorAll('#songList .song-list-item:not(.discover-item):not(.radio-song-item)').forEach((row) => {
            if (!q) {
                row.classList.remove('m-filtered-out');
                return;
            }
            const text = ((row.querySelector('.song-list-title') || {}).textContent || '')
                + ' ' + ((row.querySelector('.song-list-artist') || {}).textContent || '');
            const match = text.toLowerCase().includes(q);
            row.classList.toggle('m-filtered-out', !match);
            if (match) shown++;
        });
        const echo = raw.length > 40 ? raw.slice(0, 40) + '…' : raw;
        // (Nothing to match yet while the list loads)
        if (filterEmpty) filterEmpty.textContent = q && shown === 0 && !listLoading() ? `No songs here match “${echo}”.` : '';
    }
    if (filterInput) filterInput.addEventListener('input', applyRowFilter);

    // ============================================================
    // Layer manager: every mobile surface (tab, playlist screen, NP sheet,
    // modals, song sheet) is a history entry, so hardware back / edge
    // swipe closes the topmost surface instead of leaving the app.
    // Programmatic closes route through history.back()/go() — popstate is
    // the single close path; closeFns are idempotent as insurance.
    // Each entry records {mLayer, mDepth, mTab, mStack}: the depth lets
    // popstate reconcile instead of blind-popping, the rest lets a reload
    // rebuild the stack (adoptHistory below).
    // ============================================================
    const layerStack = [];
    // One programmatic traversal at a time: double-taps on any close
    // control must not fire two history.back()s (two layers would close,
    // or the user would leave the page from the last one).
    let pendingBack = false;
    // Layers opened while that back is still in flight wait for its
    // popstate: pushing first would let the queued back pop the new entry
    // ("close this sheet, open that one" would close both).
    const afterBack = [];
    let backWatchdog = 0;
    // Bumped on every pushed layer / every tab change the USER makes (a tap,
    // or a back off a tab — not a rotation fold): a playlist that finishes
    // loading after either has moved on must not open on top of it.
    let openGen = 0;
    let tabGen = 0;

    const TABS = ['home', 'search', 'library'];
    const htmlEl = document.documentElement;
    let currentTab = TABS.includes(htmlEl.dataset.mTab) ? htmlEl.dataset.mTab : 'home';

    function stateFor() {
        const top = layerStack[layerStack.length - 1];
        return {
            mLayer: top ? top.name : null,
            mDepth: layerStack.length,
            mTab: currentTab,
            mStack: layerStack.map((l) => Object.assign({ n: l.name }, l.meta || {})),
        };
    }

    // Rewrite the CURRENT entry (never another one) — after landing on an
    // entry whose contents may be stale, or after relabelling the tab.
    function stamp() {
        try { history.replaceState(stateFor(), ''); } catch (e) {}
    }

    function openLayer(name, closeFn, meta) {
        if (pendingBack) {
            afterBack.push(() => openLayer(name, closeFn, meta));
            return;
        }
        layerStack.push({ name, closeFn, meta });
        try {
            history.pushState(stateFor(), '');
            openGen++;
        } catch (e) { layerStack.pop(); }
    }

    // Every programmatic traversal goes through here, so the latch is always
    // set. The watchdog only matters if no popstate ever arrives (history
    // and stack out of step): closes and opens must not stay dead.
    function traverse(delta) {
        pendingBack = true;
        clearTimeout(backWatchdog);
        backWatchdog = setTimeout(() => {
            if (!pendingBack) return;
            pendingBack = false;
            flushAfterBack();
        }, 2500);
        history.go(delta);
    }

    function flushAfterBack() {
        // Stop as soon as a callback starts another traversal: the rest
        // wait for that one to land.
        while (afterBack.length && !pendingBack) {
            const fn = afterBack.shift();
            try { fn(); } catch (e) {}
        }
    }

    window.addEventListener('popstate', (event) => {
        pendingBack = false;
        clearTimeout(backWatchdog);
        const depth = (event.state && typeof event.state.mDepth === 'number')
            ? event.state.mDepth : 0;
        if (depth > layerStack.length) {
            // Forward traversal into an entry we no longer track (e.g. the
            // user swiped forward after closing a sheet) — snap back.
            traverse(layerStack.length - depth);
            return;
        }
        // Pop first, close after: a closeFn may open a layer (the welcome
        // card re-guards itself), and that must land above the new depth.
        const closed = layerStack.splice(depth);
        if (closed.some((l) => l.name === 'tab')) tabGen++;
        closed.reverse().forEach((layer) => { try { layer.closeFn(); } catch (e) {} });
        if (layerStack.length === depth) stamp();
        // Back on the You page: edits made above it (a delete, a like) count
        if (topLayerIs('you')) renderYouCounts();
        // Landscape has no tab bar: a bare tab layer left on top would make
        // the next back press a dead one — fold it (Home there is the full
        // crate anyway).
        if (!onPhone() && (topLayerIs('tab') || topLayerIs('you'))) backOneLayer();
        // What the closed layers covered must take focus again before any
        // queued step (Done in reorder mode, Now Playing) reaches for it.
        try { syncInert(); } catch (e) {}
        flushAfterBack();
    });

    function topLayerIs(name) {
        return layerStack.length > 0 && layerStack[layerStack.length - 1].name === name;
    }

    const hasLayer = (name) => layerStack.some((l) => l.name === name);

    // The single programmatic close path: every UI close control routes
    // here so popstate stays the one place layers actually close.
    function backOneLayer() {
        if (pendingBack || layerStack.length === 0) return;
        traverse(-1);
    }

    function popToDepth(d) {
        const n = layerStack.length - d;
        if (n <= 0 || pendingBack) return;
        traverse(-n);
    }

    // Width-change teardown (rotation to landscape, or a desktop-width
    // window): close the portrait-only surfaces (NP, lyrics, song sheet,
    // modals) but keep the playlist screen — a rotation must not kick the
    // user back to the crate — and the welcome guard. A bare tab layer
    // folds (no tab bar there). The closed entries are consumed with one
    // history.go(); the depth-reconciling popstate makes that a no-op pop.
    function teardownPhoneLayers() {
        if (pendingBack) {
            afterBack.push(teardownPhoneLayers);
            return;
        }
        const keep = (name) => name === 'playlist' || name === 'tab' || name === 'memberWelcome';
        let d = layerStack.length;
        while (d > 0 && !keep(layerStack[d - 1].name)) d--;
        if (d > 0 && layerStack[d - 1].name === 'tab') d--;
        const closed = layerStack.splice(d);
        if (!closed.length) return;
        closed.reverse().forEach((layer) => { try { layer.closeFn(); } catch (e) {} });
        traverse(-closed.length);
    }

    // ============================================================
    // Tabs (portrait phones): Home / Search / Library.
    // Home is the base entry. Another tab adds ONE 'tab' layer above it,
    // relabelled in place (replaceState) when switching between the other
    // two, so back from any tab goes Home and back on Home leaves the app
    // (like Spotify). Playlists, Now Playing, sheets and modals stack on
    // top; switching tabs closes them. The tab lives in html[data-m-tab]
    // (the head script sets it before first paint); the phone CSS does the
    // showing and hiding, and ignores it in landscape and the app.
    // ============================================================
    const tabBar = document.getElementById('mTabs');
    const roomCenter = document.getElementById('roomCenter');
    const searchPage = document.getElementById('mSearchPage');
    const playerView = document.getElementById('musicPlayerView');
    const backText = document.querySelector('#backToCrate .back-text');
    const TAB_NAMES = { home: 'Home', search: 'Search', library: 'Library' };
    const tabScroll = {};

    const tabScroller = (t) => (t === 'search' ? searchPage : roomCenter);

    function setBackLabel() {
        // A playlist opened over the You page goes back to it
        const name = hasLayer('you') ? 'You' : TAB_NAMES[currentTab];
        if (backText) backText.textContent = onPhone() ? name : 'Crate';
        const barBack = document.getElementById('mPlBack');
        if (barBack) barBack.setAttribute('aria-label', 'Back to ' + name);
    }

    function setTab(t) {
        if (!TABS.includes(t)) t = 'home';
        const prev = currentTab;
        if (prev !== t) {
            // Home and Library share the crate's scroller: keep each tab's place.
            const from = tabScroller(prev);
            if (from) tabScroll[prev] = from.scrollTop;
        }
        currentTab = t;
        htmlEl.dataset.mTab = t;
        if (tabBar) {
            tabBar.querySelectorAll('.m-tab').forEach((b) => {
                if (b.dataset.tab === t) b.setAttribute('aria-current', 'page');
                else b.removeAttribute('aria-current');
            });
        }
        setBackLabel();
        if (prev !== t) {
            const to = tabScroller(t);
            if (to) to.scrollTop = tabScroll[t] || 0;
        }
    }

    function closeTabLayer() {
        setTab('home');
    }

    const tabLayerIndex = () => layerStack.findIndex((l) => l.name === 'tab');

    // Depth of the current tab's root screen (above the welcome guard).
    function tabRootDepth() {
        const ti = tabLayerIndex();
        if (ti >= 0) return ti + 1;
        let d = 0;
        while (d < layerStack.length && layerStack[d].name === 'memberWelcome') d++;
        return d;
    }

    function scrollTabToTop(t) {
        const el = tabScroller(t);
        if (el) {
            try { el.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { el.scrollTop = 0; }
        }
        if (t === 'search' && searchInput) searchInput.focus();
    }

    // Converges rather than chaining: while a traversal is in flight it
    // re-runs once that lands, so rapid taps end on the last tab tapped.
    function switchTab(t) {
        if (!TABS.includes(t) || !onPhone()) return;
        if (pendingBack) {
            afterBack.push(() => switchTab(t));
            return;
        }
        if (hasLayer('memberWelcome')) return; // the PIN card goes first
        if (t !== currentTab) tabGen++;
        const root = tabRootDepth();
        if (t === currentTab) {
            // Re-tap: back to this tab's root, or to the top of it.
            if (layerStack.length > root) popToDepth(root);
            else scrollTabToTop(t);
            return;
        }
        if (layerStack.length > root) {
            // A playlist (or sheet) is open on this tab: close it first.
            afterBack.push(() => switchTab(t));
            popToDepth(root);
            return;
        }
        const ti = tabLayerIndex();
        if (t === 'home') {
            if (ti >= 0) popToDepth(ti); // its closeFn shows Home
            else setTab('home');
            return;
        }
        if (ti >= 0) {
            layerStack[ti].meta = { t };
            setTab(t);
            stamp();
            return;
        }
        setTab(t);
        openLayer('tab', closeTabLayer, { t });
    }

    if (tabBar) {
        tabBar.addEventListener('click', (e) => {
            const btn = e.target.closest('.m-tab');
            if (btn) switchTab(btn.dataset.tab);
        });
    }

    // The Search page hides while a playlist screen is open over it; the
    // player view's .active is toggled from several places, so mirror it.
    if (playerView) {
        const sidebar = document.getElementById('musicSidebar');
        const syncPlayerView = () => {
            const on = playerView.classList.contains('active');
            htmlEl.classList.toggle('m-pv', on);
            // Closing the playlist screen fades the sidebar out but can leave
            // its find field focused (hardware back): drop that focus, or the
            // "keyboard" flag keeps the tab bar and dock hidden.
            const a = document.activeElement;
            if (!on && a && sidebar && sidebar.contains(a)) a.blur();
        };
        new MutationObserver(syncPlayerView)
            .observe(playerView, { attributes: true, attributeFilter: ['class'] });
        syncPlayerView();
    }

    // ---- Playlist screen: a layer over whichever tab opened it
    const playerViewActive = () => !!playerView && playerView.classList.contains('active');

    // Closing the screen also ends any view: the list behind it is the
    // playing one again (a late answer for the view is then dropped).
    function closePlaylistLayer() {
        if (playerViewActive()) origShowPicker();
        collapseView();
    }

    // Every way into the playlist screen (crate card, Home tile, a search
    // hit) records one 'playlist' layer. While a back is still in flight
    // (a search hit closes the search sheet first) the push waits for it.
    // stillWanted is checked when the push actually runs: if the user moved
    // on meanwhile (another tab, or Now Playing / a sheet opened while it
    // loaded) the playlist screen closes instead of landing on top of that.
    function pushPlaylistLayer(stillWanted) {
        const push = () => {
            if (!playerViewActive() || hasLayer('playlist')) return;
            if (stillWanted && !stillWanted()) {
                origShowPicker();
                collapseView();
                return;
            }
            openLayer('playlist', closePlaylistLayer, { p: String(listId()) });
        };
        if (pendingBack) afterBack.push(push); else push();
    }

    // The playlist layer's entry records the list on screen (a reload brings
    // it back): it follows a view change under an existing layer. Not while
    // a back is in flight: the landing popstate stamps the updated stack.
    function syncPlaylistLayerMeta() {
        const l = layerStack.find((x) => x.name === 'playlist');
        if (!l) return;
        l.meta = { p: String(listId()) };
        if (!pendingBack) stamp();
    }

    // ---- Browsing (like Spotify): opening a playlist in the shell shows it
    // and leaves the player alone; it plays once the user starts it (Play, a
    // song). The screen and a loading row come up at once, the songs follow.
    // Resolves true once that playlist is on screen with its songs; false if
    // it didn't load or the user left it meanwhile.
    let viewOpening = null; // the open still loading: { id, gen, promise }
    function openPlaylistView(playlistId) {
        const id = String(playlistId);
        const wasRoot = !playerViewActive();
        const genAt = openGen;
        const tabGenAt = tabGen;
        const stillWanted = () => openGen === genAt && tabGen === tabGenAt;
        if (id === String(activePlaylistId)) {
            // The playing list: already loaded, nothing to wait for
            collapseView();
            origOpenPlayerView();
            if (wasRoot) pushPlaylistLayer(stillWanted);
            return Promise.resolve(true);
        }
        // A second tap while it is still loading on screen: the same open
        if (viewOpening && viewOpening.id === id && viewOpening.gen === viewGen && viewedId === id
            && listLoading() && !viewFailed && playerViewActive()) {
            return viewOpening.promise;
        }
        viewGen++;
        viewedId = id;
        viewedSongs = null;
        viewedResume = 0;
        viewDirty = false;
        viewFailed = false;
        // Its name, colour and count right away (from what the page knows)
        const meta = playlistsMeta[id];
        const title = document.getElementById('playlistTitle');
        if (title) title.textContent = meta ? meta.name : 'Playlist';
        const countEl = document.querySelector('.sidebar-track-count');
        const n = meta ? (meta.songCount || 0) : 0;
        if (countEl) countEl.textContent = n + (n === 1 ? ' song' : ' songs');
        rebuildSongList(); // the loading row
        const scroller = songListScroller();
        if (scroller) scroller.scrollTop = 0;
        if (typeof updateOfflineButton === 'function') updateOfflineButton();
        viewChanged();
        origOpenPlayerView();
        if (wasRoot) pushPlaylistLayer(stillWanted);
        const gen = viewGen;
        const promise = loadView(id, gen);
        viewOpening = { id, gen, promise };
        return promise;
    }

    // Fetch the viewed playlist (after any write to it has saved: an answer
    // read before that would miss it). An answer for a view the user has
    // left (another open, back, Show in playlist) is dropped unseen.
    async function loadView(id, gen) {
        const current = () => viewGen === gen && viewedId === id;
        let res = null;
        for (let again = 0; ; again++) {
            await writesSettled(id);
            if (!current()) return false;
            viewDirty = false;
            res = null;
            try {
                res = await saveMusicRequest({ action: 'getPlaylist', playlist: id });
            } catch (e) { /* below */ }
            if (!current()) return false;
            // A write landed while it loaded: once more, so it's included
            if (!res || !res.success || !res.playlist || !viewDirty || again >= 2) break;
        }
        if (!res || !res.success || !res.playlist) {
            // Stays put with a Retry (whatever is on top of it, or a back in flight)
            viewFailed = true;
            rebuildSongList();
            viewChanged();
            const top = layerStack[layerStack.length - 1];
            if (playerViewActive() && (!top || ['playlist', 'find', 'reorder'].includes(top.name))) {
                window.mToast('Couldn\'t load this playlist. Check your connection.');
            }
            return false;
        }
        const pl = res.playlist;
        viewedSongs = Array.isArray(pl.songs) ? pl.songs : [];
        viewedResume = Math.max(0, parseInt(pl.currentIndex, 10) || 0);
        viewDirty = false;
        // The page's copy of its name, colour and cover may be older
        const meta = playlistsMeta[id];
        if (meta) {
            if (pl.name) meta.name = pl.name;
            if (/^#[0-9a-fA-F]{6}$/.test(pl.color || '')) meta.color = pl.color;
            meta.coverSongIndex = pl.coverSongIndex !== undefined ? pl.coverSongIndex : null;
        }
        const title = document.getElementById('playlistTitle');
        if (title && pl.name) title.textContent = pl.name;
        rebuildSongList();
        updateTrackCount(id, viewedSongs);
        viewChanged();
        return playerViewActive();
    }

    // The failed view's Retry
    window.mRetryView = function () {
        if (!listLoading() || !viewFailed) return;
        viewGen++;
        viewFailed = false;
        viewDirty = false;
        rebuildSongList();
        viewChanged();
        const id = viewedId;
        const gen = viewGen;
        viewOpening = { id, gen, promise: loadView(id, gen) };
    };

    const origSelectPlaylist = window.selectPlaylistFromCrate;
    window.selectPlaylistFromCrate = async function (playlistId) {
        // Decided now, before any wait: the shell shows the playlist without
        // playing it; elsewhere opening a playlist plays it, as always.
        if (inShell()) return openPlaylistView(playlistId);
        collapseView(); // (a view left over from the shell: the playing list first)
        const wasRoot = !playerViewActive();
        const genAt = openGen;
        const tabGenAt = tabGen;
        const out = await origSelectPlaylist.apply(this, arguments);
        if (inShell() && wasRoot) pushPlaylistLayer(() => openGen === genAt && tabGen === tabGenAt);
        return out;
    };

    // Reveals the screen without naming a playlist (Show in playlist, a
    // landscape Jump back in): it shows the playing list.
    const origOpenPlayerView = window.openPlayerView;
    window.openPlayerView = function () {
        const wasRoot = !playerViewActive();
        if (!inShell() || wasRoot) collapseView();
        const out = origOpenPlayerView.apply(this, arguments);
        if (inShell() && wasRoot) pushPlaylistLayer();
        return out;
    };

    const origShowPicker = window.showPlaylistPicker;
    window.showPlaylistPicker = function () {
        const pi = layerStack.findIndex((l) => l.name === 'playlist');
        if (inShell() && pi >= 0) {
            popToDepth(pi);
            return;
        }
        return origShowPicker.apply(this, arguments);
    };

    // Jump back in plays in place on phones: the mini player shows it, and
    // Home stays put (the desktop crate still opens the player).
    const origPlayRecentSong = window.playRecentSong;
    window.playRecentSong = function (i, opts) {
        if (onPhone()) return origPlayRecentSong.call(this, i, Object.assign({ stay: true }, opts));
        return origPlayRecentSong.apply(this, arguments);
    };

    // Modals: wrap every show/hide global pair. Create and edit share the
    // playlistEditModal element (and its hide), so they share a layer key.
    const modalOpen = {};
    const modalOrigHide = {};

    function wrapModalPair(showName, hideName, key) {
        const origShow = window[showName];
        if (typeof origShow !== 'function') return;
        window[showName] = function () {
            const out = origShow.apply(this, arguments);
            if (inShell() && !modalOpen[key]) {
                modalOpen[key] = true;
                const push = () => {
                    if (!modalOpen[key]) return; // closed before the back landed
                    openLayer('modal:' + key, () => {
                        if (modalOpen[key]) {
                            modalOpen[key] = false;
                            modalOrigHide[key]();
                        }
                    });
                };
                if (pendingBack) afterBack.push(push); else push();
            }
            return out;
        };
        if (!modalOrigHide[key]) {
            const origHide = window[hideName];
            if (typeof origHide !== 'function') return;
            modalOrigHide[key] = origHide;
            window[hideName] = function () {
                if (inShell() && modalOpen[key] && topLayerIs('modal:' + key)) {
                    backOneLayer();
                    return;
                }
                modalOpen[key] = false;
                return origHide.apply(this, arguments);
            };
        }
    }

    // The Library "+" (new playlist / import)
    const addSheet = document.getElementById('mAddSheet');
    window.mShowAddSheet = function () {
        if (!addSheet) return;
        addSheet.classList.add('active');
        const first = addSheet.querySelector('.m-sheet-row');
        if (first) first.focus({ preventScroll: true });
    };
    window.mHideAddSheet = function () {
        if (!addSheet) return;
        const hadFocus = addSheet.contains(document.activeElement);
        addSheet.classList.remove('active');
        if (hadFocus && !document.querySelector('.add-song-modal.active')) {
            const plus = document.getElementById('mLibraryNew');
            if (plus) plus.focus({ preventScroll: true });
        }
    };

    // ---- You page (the Home avatar): who you are, your listening, the
    // doors into Settings, log out. A layer over Home, so back (or the
    // chevron, or a Home re-tap) closes it; Settings and Stats open as
    // sheets on top of it and back returns to it.
    const youPage = document.getElementById('mYouPage');
    const youBack = document.getElementById('mYouBack');
    const youListen = document.getElementById('mYouListen');
    const youSeeAll = document.getElementById('mYouSeeAll');
    const youCounts = document.getElementById('mYouCounts');
    const avatarBtn = document.getElementById('mAvatarBtn');
    let youReturnFocus = null;   // the row that opened Settings or Stats
    let youStats = null;         // the last all-time stats, shown at once on reopen
    let youStatsSeq = 0;

    const youOpen = () => htmlEl.classList.contains('m-you');
    const countOf = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

    // Live from playlistsMeta (adds, moves and deletes keep it current).
    function renderYouCounts() {
        if (!youCounts) return;
        const ids = typeof playlistsMeta === 'object' && playlistsMeta ? Object.keys(playlistsMeta) : [];
        const songs = ids.reduce((n, id) => n + (Number(playlistsMeta[id].songCount) || 0), 0);
        youCounts.textContent = ids.length
            ? `${countOf(songs, 'song', 'songs')} in ${countOf(ids.length, 'playlist', 'playlists')}`
            : 'No playlists yet';
    }

    const statNum = (n) => {
        n = Number(n) || 0;
        if (n < 10000) return n.toLocaleString();
        try {
            // No decimal from 100K up: some locales' compact forms are wide
            return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: n < 100000 ? 1 : 0 }).format(n);
        } catch (e) { return n.toLocaleString(); }
    };

    function renderYouStats() {
        if (!youListen) return;
        const st = youStats;
        if (!st || (!st.totalPlays && !st.distinctSongs)) {
            youListen.innerHTML = '<p class="m-you-note">Play some songs and your listening will show up here.</p>';
            if (youSeeAll) youSeeAll.hidden = true;
            return;
        }
        const tile = (n, one, many) => {
            const v = Number(n) || 0;
            const txt = statNum(v);
            return `<div class="m-you-stat"><b${txt.length > 6 ? ' class="m-you-stat-long"' : ''}>${escapeHtml(txt)}</b> <span>${v === 1 ? one : many}</span></div>`;
        };
        let html = '<div class="m-you-stats">'
            + tile(st.totalPlays, 'play', 'plays')
            + tile(st.distinctArtists, 'artist', 'artists')
            + tile(st.distinctSongs, 'song played', 'songs played')
            + '</div>';
        const top = Array.isArray(st.topSongs) ? st.topSongs[0] : null;
        if (top && top.title) {
            const cover = safeUrl(top.cover);
            const plays = Number(top.plays) || 0;
            html += `<div class="m-you-top">
                ${cover ? `<img class="m-you-top-art" src="${escapeHtml(cover)}" alt="" loading="lazy">` : `<span class="m-you-top-art m-you-top-empty">${NOTE_ICON}</span>`}
                <span class="m-you-top-text"><small>Most played</small> <b>${escapeHtml(top.title)}</b>${top.artist ? ` <span>${escapeHtml(top.artist)}</span>` : ''}</span>
                <span class="m-you-top-plays">${escapeHtml(countOf(plays, 'play', 'plays'))}</span>
            </div>`;
        }
        youListen.innerHTML = html;
        if (youSeeAll) youSeeAll.hidden = false;
    }

    // All time, fetched on each open (cheap); the last answer shows at once.
    async function loadYouStats() {
        if (!youListen) return;
        const seq = ++youStatsSeq;
        // Try again had focus: it goes to what replaces it, not to <body>
        const hadFocus = youListen.contains(document.activeElement);
        if (hadFocus && youPage) youPage.focus({ preventScroll: true });
        if (youStats) renderYouStats();
        else youListen.innerHTML = '<p class="m-you-note">Loading…</p>';
        let data = null;
        try {
            data = await saveMusicRequest({ action: 'stats', range: 'all' });
        } catch (e) { /* below */ }
        if (seq !== youStatsSeq) return;
        if (data && data.success && data.stats) {
            youStats = data.stats;
            renderYouStats();
        } else if (!youStats) {
            youListen.innerHTML = '<p class="m-you-note">Couldn’t load your listening. <button type="button" class="m-you-link m-you-retry">Try again</button></p>';
            if (youSeeAll) youSeeAll.hidden = true;
        }
        if (hadFocus && document.activeElement === youPage) {
            const next = youListen.querySelector('.m-you-retry') || (youSeeAll && !youSeeAll.hidden ? youSeeAll : null);
            if (next) next.focus({ preventScroll: true });
        }
    }

    // The top bar gets a background once the page scrolls under it.
    function syncYouBar() {
        if (youPage) youPage.classList.toggle('m-you-raised', youPage.scrollTop > 8);
    }

    function closeYouPage() {
        const had = !!youPage && youPage.contains(document.activeElement);
        htmlEl.classList.remove('m-you');
        youReturnFocus = null;
        setBackLabel();
        if (had && avatarBtn && !document.querySelector('.add-song-modal.active')) avatarBtn.focus({ preventScroll: true });
    }

    function openYouPage() {
        if (!youPage || !onPhone()) return;
        if (pendingBack) {
            afterBack.push(openYouPage);
            return;
        }
        if (hasLayer('you') || hasLayer('memberWelcome') || currentTab !== 'home' || playerViewActive()) return;
        renderYouCounts();
        htmlEl.classList.add('m-you');
        youPage.scrollTop = 0; // once it has a box (a hidden page ignores it)
        syncYouBar();
        openLayer('you', closeYouPage);
        setBackLabel();
        if (youBack) youBack.focus({ preventScroll: true });
        loadYouStats();
    }

    if (avatarBtn) avatarBtn.addEventListener('click', openYouPage);
    if (youBack) youBack.addEventListener('click', () => { if (topLayerIs('you')) backOneLayer(); });
    if (youPage) {
        youPage.addEventListener('click', (e) => {
            const row = e.target.closest('[data-m-you]');
            if (row) {
                youReturnFocus = row;
                window.showSettingsModal();
                setSettingsTab(row.dataset.mYou); // it opens on Playback
                return;
            }
            if (e.target.closest('#mYouSeeAll')) {
                youReturnFocus = youSeeAll;
                window.showStatsModal('all'); // the card's numbers are all time
                return;
            }
            if (e.target.closest('.m-you-retry')) loadYouStats();
        });
        youPage.addEventListener('scroll', syncYouBar, { passive: true });
    }

    // Settings or Stats closed back onto the page: focus returns to the row
    // that opened it (their own controls are gone, so it would fall to body).
    ['settingsModal', 'statsModal'].forEach((id) => {
        const modal = document.getElementById(id);
        if (!modal) return;
        new MutationObserver(() => {
            if (modal.classList.contains('active') || !youOpen() || !youReturnFocus) return;
            if (document.querySelector('.add-song-modal.active')) return;
            const a = document.activeElement;
            if (a && a !== document.body && !modal.contains(a)) return;
            youReturnFocus.focus({ preventScroll: true });
        }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    });

    // ---- "This phone" on the You page, in a browser tab only: Full screen
    // (the Fullscreen API: Android's first back press leaves it, like a
    // video player, and a lock, app switch or dialog ends it) and Install
    // the app (the browser's own prompt when it offered one, else how-to).
    // An installed app is already free of the address bar: neither shows.
    // Two switches under Full screen, kept on this device: open in full
    // screen (browsers only allow it from a tap, so the first tap after
    // opening does it) and a full-screen button on Home.
    const youDevice = document.getElementById('mYouDevice');
    const fsRow = document.getElementById('mYouFullscreen');
    const fsAutoRow = document.getElementById('mYouFsAuto');
    const fsButtonRow = document.getElementById('mYouFsButton');
    const fsBtn = document.getElementById('mFsBtn');
    const FS_AUTO = 'mFullscreenAuto';
    const FS_BUTTON = 'mFullscreenButton';
    const fsPref = (key) => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } };
    const setFsPref = (key, on) => { try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (e) {} };
    const installRow = document.getElementById('mYouInstall');
    const installSheet = document.getElementById('mInstallSheet');
    const canFullscreen = document.fullscreenEnabled === true && typeof htmlEl.requestFullscreen === 'function';
    const inBrowserTab = window.matchMedia('(display-mode: browser)');
    // iPadOS reports a Mac; a touch screen gives it away
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let appInstalled = false;

    // Not on iOS: no back gesture there to leave it, and iPhone can't
    const fsPossible = () => canFullscreen && !isIos && (inBrowserTab.matches || !!document.fullscreenElement);

    function syncDeviceRows() {
        const fsOn = !!document.fullscreenElement;
        const can = fsPossible();
        htmlEl.classList.toggle('m-fs', fsOn);
        if (fsRow) {
            fsRow.hidden = !can;
            fsRow.querySelector('b').textContent = fsOn ? 'Exit full screen' : 'Full screen';
            fsRow.querySelector('small').textContent = fsOn ? 'Bring back the browser bars' : 'Hide the browser bars · back exits';
        }
        [[fsAutoRow, FS_AUTO], [fsButtonRow, FS_BUTTON]].forEach(([row, key]) => {
            if (!row) return;
            row.hidden = !can;
            row.setAttribute('aria-checked', String(fsPref(key)));
        });
        if (fsBtn) {
            fsBtn.hidden = !can || !fsPref(FS_BUTTON);
            fsBtn.classList.toggle('is-on', fsOn);
            fsBtn.setAttribute('aria-label', fsOn ? 'Exit full screen' : 'Full screen');
        }
        if (installRow) installRow.hidden = !inBrowserTab.matches || appInstalled;
        if (youDevice) youDevice.hidden = (!fsRow || fsRow.hidden) && (!installRow || installRow.hidden);
    }
    syncDeviceRows();
    document.addEventListener('fullscreenchange', syncDeviceRows);
    if (inBrowserTab.addEventListener) inBrowserTab.addEventListener('change', syncDeviceRows);

    async function toggleFullscreen() {
        if (document.fullscreenElement) {
            try { await document.exitFullscreen(); } catch (e) { /* already out */ }
            return;
        }
        try {
            // The whole document: the tab bar, mini player and sheets live
            // outside #music-section.
            await htmlEl.requestFullscreen({ navigationUI: 'hide' });
        } catch (e) {
            window.mToast('Full screen isn’t available in this browser.');
            return;
        }
        // Land on Home: a back press there would only leave full screen.
        if (topLayerIs('you')) backOneLayer();
    }

    window.mShowInstallSheet = function () {
        if (!installSheet) return;
        const android = document.getElementById('mInstallSteps');
        const ios = document.getElementById('mInstallStepsIos');
        if (android) android.hidden = isIos;
        if (ios) ios.hidden = !isIos;
        installSheet.classList.add('active');
        const close = installSheet.querySelector('.add-song-modal-close');
        if (close) close.focus({ preventScroll: true });
    };
    window.mHideInstallSheet = function () {
        if (!installSheet) return;
        const hadFocus = installSheet.contains(document.activeElement);
        installSheet.classList.remove('active');
        if (hadFocus && installRow && !installRow.hidden && !document.querySelector('.add-song-modal.active')) installRow.focus({ preventScroll: true });
    };
    wrapModalPair('mShowInstallSheet', 'mHideInstallSheet', 'installHelp');
    if (installSheet) {
        installSheet.addEventListener('click', (e) => {
            if (e.target.closest('[data-m-install-close]')) window.mHideInstallSheet();
        });
    }

    async function installApp() {
        const prompt = window.__installPrompt;
        if (!prompt) {
            window.mShowInstallSheet();
            return;
        }
        window.__installPrompt = null; // a prompt can be shown once
        try {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            if (choice && choice.outcome === 'accepted') window.mToast('Installing: open Music from its new icon.');
        } catch (e) {
            window.mShowInstallSheet();
        }
    }
    window.addEventListener('appinstalled', () => {
        window.__installPrompt = null;
        appInstalled = true;
        syncDeviceRows();
        window.mToast('Installed: open Music from its new icon.');
    });

    if (fsRow) fsRow.addEventListener('click', toggleFullscreen);
    if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    if (installRow) installRow.addEventListener('click', installApp);

    // Open in full screen: armed when the page opens or comes back into
    // view on a phone, spent by the first tap or by going full screen any
    // other way. Leaving full screen (back, or Exit) stays left until the
    // next time the app is opened or brought back.
    let fsArmed = false;
    let fsRequesting = false;
    const autoFsHere = () => fsPref(FS_AUTO) && fsPossible() && inShell();
    const armAutoFullscreen = () => { fsArmed = autoFsHere() && !document.fullscreenElement; };
    function enterFullscreenQuietly() {
        if (!fsArmed || fsRequesting || document.fullscreenElement) return;
        fsRequesting = true;
        htmlEl.requestFullscreen({ navigationUI: 'hide' })
            .catch(() => { /* no tap to go on: stay armed for the next one */ })
            .finally(() => { fsRequesting = false; });
    }
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) fsArmed = false;
    });
    // Capturing, so a control that stops the click still counts; the
    // request waits a beat so the tap does its own job first. Controls
    // that need the tap themselves after a wait (Share), and the
    // full-screen controls, carry data-keeps-gesture.
    window.addEventListener('click', (e) => {
        if (!fsArmed || !e.isTrusted) return;
        if (e.target && e.target.closest && e.target.closest('[data-keeps-gesture]')) return;
        if (!autoFsHere()) { fsArmed = false; return; }
        setTimeout(enterFullscreenQuietly, 0);
    }, true);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') armAutoFullscreen();
    });
    armAutoFullscreen();

    function flipFsSwitch(key) {
        const on = !fsPref(key);
        setFsPref(key, on);
        syncDeviceRows();
        if (key !== FS_AUTO) return;
        // Not on this tap: full screen over You would spend the next back
        // on bringing the bars back. The next tap (often You's back arrow)
        // goes in.
        armAutoFullscreen();
        if (on && fsArmed) window.mToast('Full screen starts with your next tap');
    }
    if (fsAutoRow) fsAutoRow.addEventListener('click', () => flipFsSwitch(FS_AUTO));
    if (fsButtonRow) fsButtonRow.addEventListener('click', () => flipFsSwitch(FS_BUTTON));

    // ---- One screen at a time for keyboards and screen readers (portrait
    // phones). Whatever the top surface covers is inert: out of the Tab and
    // swipe order, and untappable. A surface that opens gets focus; one that
    // closes hands it back to what opened it, if focus was lost with it.
    const crateViewEl = document.getElementById('vinylCrateView');
    const sidebarEl = document.getElementById('musicSidebar');
    const npMainEl = document.querySelector('#musicPlayerView .music-main');
    const musicSectionEl = document.getElementById('music-section');
    const SHEETS = '.add-song-modal.active, .send-menu-sheet, .vgm-modal.active';
    let inertNow = new Set();
    let lastFocus = null;
    let prevFocus = null;
    const surfaces = []; // { el, opener }, bottom to top
    document.addEventListener('focusin', (e) => {
        if (e.target === lastFocus) return;
        prevFocus = lastFocus;
        lastFocus = e.target;
    }, true);

    function openSurfaces() {
        const list = [];
        if (htmlEl.classList.contains('m-you')) list.push(youPage);
        if (htmlEl.classList.contains('m-pv')) list.push(sidebarEl);
        if (document.body.classList.contains('m-np-open')) list.push(npMainEl);
        document.querySelectorAll(SHEETS).forEach((s) => list.push(s));
        return list.filter(Boolean);
    }

    function wantedInert(top) {
        const set = new Set();
        if (!onPhone()) return set;
        const add = (el) => { if (el) set.add(el); };
        if (dock && dock.classList.contains('m-dock-hidden')) add(dock);
        if (!document.body.classList.contains('m-np-open')) add(npMainEl); // the closed Now Playing
        if (!htmlEl.classList.contains('m-pv')) add(sidebarEl);
        if (!youOpen()) add(youPage);
        if (currentTab !== 'search') add(searchPage);
        if (!top) return set;
        if (top.matches && top.matches(SHEETS)) {
            add(musicSectionEl);
            add(dock);
            add(tabBar);
            document.querySelectorAll(SHEETS).forEach((s) => { if (s !== top) add(s); });
        } else if (top === npMainEl) {
            [crateViewEl, searchPage, youPage, sidebarEl, dock, tabBar].forEach(add);
            set.delete(npMainEl);
        } else if (top === sidebarEl) {
            [crateViewEl, searchPage, youPage].forEach(add);
        } else if (top === youPage) {
            [crateViewEl, sidebarEl].forEach(add);
        }
        return set;
    }

    const focusLost = () => {
        const a = document.activeElement;
        return !a || a === document.body || !!(a.closest && a.closest('[inert]')) || a.getClientRects().length === 0;
    };
    const usable = (el) => !!el && el.isConnected && !(el.closest && el.closest('[inert]')) && el.getClientRects().length > 0;
    const FOCUSABLE = 'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    function firstFocusable(surface) {
        const preferred = surface === npMainEl ? document.getElementById('mNpCollapse')
            : surface === sidebarEl ? document.getElementById('mPlBack')
                : surface === youPage ? document.getElementById('mYouBack') : null;
        if (usable(preferred)) return preferred;
        return [...surface.querySelectorAll(FOCUSABLE)].find(usable) || null;
    }

    function syncFocus() {
        const open = openSurfaces();
        const top = open[open.length - 1];
        // Closed surfaces leave the stack; focus goes back to their opener,
        // or into what's left on top when the opener went with them
        while (surfaces.length && !open.includes(surfaces[surfaces.length - 1].el)) {
            const gone = surfaces.pop();
            if (!focusLost()) continue;
            const back = usable(gone.opener) ? gone.opener : (top && surfaces.some((s) => s.el === top) ? firstFocusable(top) : null);
            if (back) back.focus({ preventScroll: true });
        }
        if (!top || (surfaces.length && surfaces[surfaces.length - 1].el === top)) return;
        // A new surface: remember what opened it, then move focus in
        const opener = lastFocus && top.contains(lastFocus) ? prevFocus : lastFocus;
        surfaces.push({ el: top, opener });
        if (top.contains(document.activeElement)) return;
        requestAnimationFrame(() => {
            if (openSurfaces().slice(-1)[0] !== top || top.contains(document.activeElement)) return;
            const target = firstFocusable(top);
            if (target) target.focus({ preventScroll: true });
        });
    }

    function syncInert() {
        const open = openSurfaces();
        const want = wantedInert(open[open.length - 1] || null);
        inertNow.forEach((el) => { if (!want.has(el)) el.inert = false; });
        want.forEach((el) => { if (!el.inert) el.inert = true; });
        inertNow = want;
        if (onPhone()) syncFocus();
        else surfaces.length = 0;
    }
    let inertQueued = false;
    const queueInert = () => {
        if (inertQueued) return;
        inertQueued = true;
        queueMicrotask(() => { inertQueued = false; syncInert(); });
    };
    const surfaceWatch = new MutationObserver(queueInert);
    surfaceWatch.observe(htmlEl, { attributes: true, attributeFilter: ['class', 'data-m-tab'] });
    surfaceWatch.observe(document.body, { attributes: true, attributeFilter: ['class'], childList: true });
    document.querySelectorAll('.add-song-modal, .vgm-modal').forEach((m) => surfaceWatch.observe(m, { attributes: true, attributeFilter: ['class'] }));
    if (dock) surfaceWatch.observe(dock, { attributes: true, attributeFilter: ['class'] });
    window.matchMedia('(max-width: 600px)').addEventListener('change', queueInert);
    queueInert();

    // An email attached in Settings reaches the page (and the initial, while
    // the name is still a placeholder: the server takes it from the email).
    window.mOnAccountEmail = function (email) {
        const clean = String(email || '').trim();
        if (!clean) return;
        const sub = document.getElementById('mYouSub');
        if (sub) {
            sub.textContent = clean;
            sub.hidden = false;
        }
        const name = document.getElementById('mAccountName');
        if (name && name.textContent === 'Your account') {
            const initial = Array.from(clean)[0].toUpperCase();
            document.querySelectorAll('.m-avatar').forEach((el) => { el.textContent = initial; });
        }
    };

    wrapModalPair('showSettingsModal', 'hideSettingsModal', 'settings');
    wrapModalPair('showAddSongModal', 'hideAddSongModal', 'addSong');
    wrapModalPair('showScanModal', 'hideScanModal', 'scan');
    wrapModalPair('showSpotifyImportModal', 'hideSpotifyImportModal', 'import');
    wrapModalPair('showPlaylistEditModal', 'hidePlaylistEditModal', 'playlistEdit');
    wrapModalPair('showPlaylistCreateModal', 'hidePlaylistEditModal', 'playlistEdit');
    wrapModalPair('showSearchModal', 'hideSearchModal', 'search');
    wrapModalPair('showStatsModal', 'hideStatsModal', 'stats');
    wrapModalPair('openQueueModal', 'hideQueueModal', 'queue');
    wrapModalPair('openVinylGifModal', 'closeVinylGifModal', 'vinylGif');
    wrapModalPair('mShowAddSheet', 'mHideAddSheet', 'libraryAdd');

    // Portrait phones search on the Search tab; the modal is for landscape
    // and desktop (the crate's Search button is hidden on the Home tab).
    const modalShowSearch = window.showSearchModal;
    window.showSearchModal = function () {
        if (onPhone()) {
            switchTab('search');
            return;
        }
        return modalShowSearch.apply(this, arguments);
    };

    const libraryNew = document.getElementById('mLibraryNew');
    if (libraryNew) libraryNew.addEventListener('click', () => window.mShowAddSheet());
    if (addSheet) {
        addSheet.addEventListener('click', (e) => {
            if (e.target.closest('[data-m-add-close]')) {
                window.mHideAddSheet();
                return;
            }
            const row = e.target.closest('[data-m-add]');
            if (!row) return;
            window.mHideAddSheet();
            if (row.dataset.mAdd === 'playlist') window.showPlaylistCreateModal();
            else if (row.dataset.mAdd === 'songs') window.showAddSongModal();
            else if (row.dataset.mAdd === 'import') window.showSpotifyImportModal();
        });
    }

    // A saved display name reaches the avatar and the You page.
    window.mOnAccountName = function (name) {
        const clean = String(name || '').trim();
        if (!clean || clean === 'New member' || clean === 'Spotify listener') return;
        const initial = Array.from(clean)[0].toUpperCase();
        document.querySelectorAll('.m-avatar').forEach((el) => { el.textContent = initial; });
        const label = document.getElementById('mAccountName');
        if (label) label.textContent = clean;
    };

    // ---- Home: greeting + recently opened playlists
    const greetingEl = document.getElementById('mGreeting');
    function greet() {
        if (!greetingEl) return;
        const h = new Date().getHours();
        greetingEl.textContent = h >= 5 && h < 12 ? 'Good morning'
            : (h >= 12 && h < 18 ? 'Good afternoon' : 'Good evening');
    }
    greet();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) greet();
    });

    const recentPlaylistsEl = document.getElementById('mRecentPlaylists');
    const NOTE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>';

    // The Library card's cover is the server's pick (it avoids repeating a
    // cover across playlists); the meta covers are the fallback.
    function playlistCover(id) {
        let img = null;
        try { img = document.querySelector('.record-card[data-playlist="' + CSS.escape(id) + '"] img.cover-main'); } catch (e) {}
        if (img && img.getAttribute('src')) return img.getAttribute('src');
        const meta = playlistsMeta[id] || {};
        const covers = Array.isArray(meta.covers) ? meta.covers : [];
        const pick = covers.find((c) => c.index === meta.coverSongIndex) || covers[0];
        return pick ? pick.url : '';
    }

    function renderRecentPlaylists() {
        if (!recentPlaylistsEl || typeof playlistsMeta !== 'object' || !playlistsMeta) return;
        const ids = [];
        const add = (id) => {
            id = String(id);
            if (Object.prototype.hasOwnProperty.call(playlistsMeta, id) && !ids.includes(id)) ids.push(id);
        };
        // Recently opened first (the server's list can fall back to every
        // playlist in order, hence the cap), then the rest of the library.
        (Array.isArray(recentlyPlayed) ? recentlyPlayed : []).forEach(add);
        Object.keys(playlistsMeta).forEach(add);
        const list = ids.slice(0, 6);
        recentPlaylistsEl.classList.toggle('is-empty', list.length === 0);
        recentPlaylistsEl.innerHTML = list.map((id) => {
            const meta = playlistsMeta[id];
            const cover = safeUrl(playlistCover(id));
            const color = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#d4a574';
            const art = cover
                ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">`
                : `<span class="m-rp-art-empty">${NOTE_ICON}</span>`;
            const active = id === String(activePlaylistId) ? ' is-active' : '';
            return `<button type="button" class="m-rp-tile${active}" data-playlist="${escapeHtml(id)}" style="--pl-color:${color}">
                <span class="m-rp-art">${art}</span>
                <span class="m-rp-name">${escapeHtml(meta.name || id)}</span>
            </button>`;
        }).join('');
    }

    if (recentPlaylistsEl) {
        recentPlaylistsEl.addEventListener('click', (e) => {
            const tile = e.target.closest('.m-rp-tile');
            if (tile) window.selectPlaylistFromCrate(tile.dataset.playlist);
        });
    }
    // Playlist switches and edits (name, colour, cover) already refresh the
    // crate's recent records — follow them.
    const origUpdateCrateRecords = window.updateCrateRecords;
    if (typeof origUpdateCrateRecords === 'function') {
        window.updateCrateRecords = function () {
            const out = origUpdateCrateRecords.apply(this, arguments);
            renderRecentPlaylists();
            return out;
        };
    }
    renderRecentPlaylists();

    // ---- Library: long-press a playlist to edit it (the ⋯ in its caption
    // does the same; the pencil over the art is gone on phones).
    const conveyor = document.getElementById('recordsConveyor');
    if (conveyor) {
        let pressTimer = 0;
        let pressCard = null;
        let pressX = 0;
        let pressY = 0;
        let swallowClick = false;
        const cancelPress = () => {
            clearTimeout(pressTimer);
            pressCard = null;
        };
        const firePress = () => {
            clearTimeout(pressTimer);
            const id = pressCard && pressCard.dataset.playlist;
            pressCard = null;
            if (!id) return;
            // The finger is still down: its release must not also open the
            // playlist (or tap the sheet that just opened under it).
            swallowClick = true;
            try { if (navigator.vibrate) navigator.vibrate(12); } catch (err) {}
            window.showPlaylistEditModal(id);
        };
        // Only the press that fired may lose its click: a release often
        // produces none (Android's own long-press eats it), and the flag must
        // not then swallow the next tap somewhere else.
        document.addEventListener('pointerdown', () => { swallowClick = false; }, true);
        conveyor.addEventListener('pointerdown', (e) => {
            if (!onPhone() || e.pointerType === 'mouse') return;
            const card = e.target.closest('.record-card');
            if (!card || e.target.closest('.card-more, .playlist-edit-btn')) return;
            pressCard = card;
            pressX = e.clientX;
            pressY = e.clientY;
            clearTimeout(pressTimer);
            pressTimer = setTimeout(firePress, 500);
        });
        conveyor.addEventListener('pointermove', (e) => {
            if (pressCard && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) cancelPress();
        });
        conveyor.addEventListener('pointerup', cancelPress);
        conveyor.addEventListener('pointercancel', cancelPress);
        document.addEventListener('click', (e) => {
            if (!swallowClick) return;
            swallowClick = false;
            e.preventDefault();
            e.stopPropagation();
        }, true);
        // No image "Download / Share" menu on a long press — and when the
        // platform recognises the long press first, act on it right away.
        conveyor.addEventListener('contextmenu', (e) => {
            if (!onPhone() || !e.target.closest('.record-card')) return;
            e.preventDefault();
            if (pressCard) firePress();
        });
    }

    // Local / Spotify chips only mean something once a Spotify playlist
    // exists; without one, don't leave the grid filtered to nothing.
    const hasSpotifyPlaylists = !!document.querySelector('.record-card[data-source="spotify"]');
    htmlEl.classList.toggle('m-has-spotify', hasSpotifyPlaylists);
    const dropDeadFilter = () => {
        if (!hasSpotifyPlaylists && onPhone() && roomCenter
            && roomCenter.dataset.activeSource === 'spotify' && typeof setSourceFilter === 'function') {
            setSourceFilter('all');
        }
    };
    // The saved filter is restored on DOMContentLoaded (by a listener added
    // earlier, so it runs first).
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dropDeadFilter);
    else dropDeadFilter();
    // A filter picked in landscape (where the chips always show) mustn't
    // leave the portrait Library empty with no chips to undo it.
    mq.addEventListener('change', () => { if (mq.matches) dropDeadFilter(); });

    // ---- Search tab: your library first, then YouTube. While the field is
    // empty: recent searches and your playlists. A pasted link offers to
    // import the playlist or add the song. Library hits play in place.
    const searchInput = document.getElementById('mSearchInput');
    const searchResultsEl = document.getElementById('mSearchResults');
    const searchClear = document.getElementById('mSearchClear');
    const searchStatus = document.getElementById('mSearchStatus');
    const announce = (text) => { if (searchStatus) searchStatus.textContent = text; };
    const RECENT_SEARCHES = 'mRecentSearches';
    const CLOCK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
    let pageResults = [];        // library hits for the current query
    let ytResults = [];          // YouTube hits for the current query
    let ytState = 'idle';        // idle | loading | done | error | limited
    let libDone = false;
    let pageSearchTimer = 0;
    let ytTimer = 0;
    let pageSearchSeq = 0;
    const ytCache = new Map();
    // What the rows on screen hold: a tap acts on what it shows, even while
    // a newer query is still on its way.
    let shownLib = [];
    let shownYt = [];
    let shownQuery = null;       // the query whose YouTube part is on screen

    // A re-render keeps keyboard / TalkBack focus on the same row where it
    // can, and in the results otherwise (not on <body>).
    const FOCUS_KEYS = ['lib', 'open', 'yt', 'add', 'link', 'playlist'];
    function keepingFocus(render) {
        const el = document.activeElement;
        const had = !!searchResultsEl && !!el && searchResultsEl.contains(el);
        const key = had && el.dataset ? FOCUS_KEYS.find((k) => el.dataset[k] !== undefined) : null;
        const sel = key ? `[data-${key}="${el.dataset[key]}"]` : null;
        render();
        if (!had || searchResultsEl.contains(document.activeElement)) return;
        const next = (sel && searchResultsEl.querySelector(sel)) || searchResultsEl;
        next.focus({ preventScroll: true });
    }

    function setResultsHtml(html) {
        if (!searchResultsEl) return;
        keepingFocus(() => { searchResultsEl.innerHTML = html; });
        shownLib = [];
        shownYt = [];
        shownQuery = null;
    }

    function searchHint(text) {
        setResultsHtml('<div class="m-search-hint">' + escapeHtml(text) + '</div>');
    }

    function loadRecentSearches() {
        try {
            const list = JSON.parse(localStorage.getItem(RECENT_SEARCHES) || '[]');
            return Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()).slice(0, 8) : [];
        } catch (e) { return []; }
    }
    function saveRecentSearches(list) {
        try { localStorage.setItem(RECENT_SEARCHES, JSON.stringify(list.slice(0, 8))); } catch (e) {}
    }
    // Remembered once it led somewhere (a play, an open, Enter).
    function rememberSearch() {
        const q = searchInput ? searchInput.value.trim() : '';
        if (q.length < 2 || linkKind(q)) return;
        const list = loadRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase());
        list.unshift(q);
        saveRecentSearches(list);
    }

    // What kind of link was pasted (null: not a link)
    function linkKind(q) {
        if (!/^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be|open\.spotify\.com)\//i.test(q)) {
            return /^https?:\/\//i.test(q) ? 'other' : null;
        }
        const spotify = q.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?([a-z]+)\//i);
        if (spotify) {
            const type = spotify[1].toLowerCase();
            return type === 'playlist' || type === 'track' || type === 'album' ? 'spotify-' + type : 'spotify-other';
        }
        if (/open\.spotify\.com\//i.test(q)) return 'spotify-other';
        const video = /[?&]v=|youtu\.be\/|youtube\.com\/(shorts|live)\//i.test(q);
        const list = q.match(/[?&]list=([\w-]+)/);
        // A Mix (list=RD…) is made up on the fly: there's no list to import.
        // RDCLAK… are YouTube Music's curated playlists, which import fine.
        if (list && /^RD(?!CLAK)/.test(list[1])) return video ? 'youtube-video' : 'youtube-mix';
        if (list) return video ? 'youtube-both' : 'youtube-playlist';
        return video ? 'youtube-video' : 'other';
    }

    function playlistTileHtml(id) {
        const meta = playlistsMeta[id];
        const cover = safeUrl(playlistCover(id));
        const color = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#d4a574';
        const art = cover
            ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">`
            : `<span class="m-rp-art-empty">${NOTE_ICON}</span>`;
        const active = id === String(activePlaylistId) ? ' is-active' : '';
        return `<button type="button" class="m-rp-tile${active}" data-playlist="${escapeHtml(id)}" style="--pl-color:${color}">
            <span class="m-rp-art">${art}</span>
            <span class="m-rp-name">${escapeHtml(meta.name || id)}</span>
        </button>`;
    }

    // The empty field: recent searches, then your playlists.
    function renderSearchHome() {
        if (!searchResultsEl) return;
        const recent = loadRecentSearches();
        let html = '';
        if (recent.length) {
            html += `<div class="m-search-section"><h2 class="m-search-heading">Recent searches</h2>
                <button type="button" class="m-search-clear-all" data-clear-recent>Clear</button></div>
                <ul class="m-recent-list">${recent.map((q, i) => `<li class="m-recent-row">
                    <button type="button" class="m-recent-q" data-recent="${i}">${CLOCK_ICON}<span>${escapeHtml(q)}</span></button>
                    <button type="button" class="m-recent-x" data-recent-x="${i}" aria-label="Remove “${escapeHtml(q)}” from recent searches">&times;</button>
                </li>`).join('')}</ul>`;
        }
        const ids = typeof playlistsMeta === 'object' && playlistsMeta ? Object.keys(playlistsMeta) : [];
        if (ids.length) {
            html += `<div class="m-search-section"><h2 class="m-search-heading">Your playlists</h2></div>
                <div class="m-search-browse">${ids.slice(0, 12).map(playlistTileHtml).join('')}</div>`;
        }
        setResultsHtml(html || '<div class="m-search-hint">Find any song across your playlists, or search YouTube.</div>');
    }
    // Renames, recolors and playlist switches repaint the tiles.
    const searchPrevCrateRecords = window.updateCrateRecords;
    if (typeof searchPrevCrateRecords === 'function') {
        window.updateCrateRecords = function () {
            const out = searchPrevCrateRecords.apply(this, arguments);
            if (searchInput && !searchInput.value.trim()) renderSearchHome();
            return out;
        };
    }

    const songFromYoutube = (r) => {
        const parsed = parseYoutubeResultTitle(r.title, r.channel);
        return { title: parsed.title || r.title, artist: parsed.artist || '', album: '', cover: safeUrl(r.thumbnail), youtube_id: r.videoId, mp3_url: '', spotify_id: '' };
    };

    function linkRowsHtml(q, kind) {
        const row = (action, title, sub, icon) => `<button type="button" class="m-search-link" data-link="${action}">
            <span class="m-search-link-ic">${icon}</span>
            <span class="m-search-link-text"><b>${title}</b><small>${sub}</small></span>
        </button>`;
        const importIc = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>';
        const addIc = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
        let html = '<div class="m-search-section"><h2 class="m-search-heading">That’s a link</h2></div>';
        if (kind === 'youtube-playlist' || kind === 'youtube-both') html += row('import-yt', 'Import this YouTube playlist', 'All its songs, into a new playlist', importIc);
        if (kind === 'youtube-video' || kind === 'youtube-both' || kind === 'spotify-track') html += row('add-song', 'Add this song', 'Check its title, then save it', addIc);
        if (kind === 'spotify-playlist') {
            html += spotifyOn ? row('import-sp', 'Import this Spotify playlist', 'All its songs, into a new playlist', importIc)
                : '<div class="m-search-hint m-search-hint-sm">Spotify playlists can’t be imported here. Copy the songs as a list: Library → + → Import a playlist → Paste a list.</div>';
        }
        const hint = (text) => `<div class="m-search-hint m-search-hint-sm">${text}</div>`;
        if (kind === 'youtube-mix') html += hint('YouTube Mixes can’t be imported: paste a regular playlist link, or search a song from it.');
        if (kind === 'spotify-album') html += hint('Spotify albums can’t be imported yet: paste a playlist link, or search the album’s songs.');
        if (kind === 'spotify-other') html += hint('Paste a Spotify playlist or song link, or search the song’s name.');
        if (kind === 'other') html += hint('Paste a YouTube or Spotify playlist link, or a song link.');
        return html;
    }

    function libraryHtml(q) {
        if (!pageResults.length) {
            return libDone ? `<div class="m-search-hint m-search-hint-sm">Nothing in your library matches “${escapeHtml(q)}”.</div>` : '';
        }
        return '<div class="m-search-section"><h2 class="m-search-heading">In your library</h2></div>'
            + pageResults.map((r, i) => {
                const cover = safeUrl(r.cover);
                const coverHtml = cover
                    ? `<img class="search-result-cover" src="${escapeHtml(cover)}" alt="" loading="lazy">`
                    : `<div class="search-result-cover search-result-cover-empty">${NOTE_ICON}</div>`;
                const artist = r.artist ? `<span class="search-result-artist">${escapeHtml(r.artist)}</span>` : '';
                const color = /^#[0-9a-fA-F]{6}$/.test(r.playlistColor || '') ? r.playlistColor : '#d4a574';
                return `<div class="m-sr-row">
                    <button type="button" class="search-result" data-lib="${i}" aria-label="Play ${escapeHtml(r.title)}${r.artist ? ' by ' + escapeHtml(r.artist) : ''}">
                        ${coverHtml}
                        <span class="search-result-info">
                            <span class="search-result-title">${escapeHtml(r.title)}</span>
                            ${artist}
                        </span>
                    </button>
                    <button type="button" class="m-sr-open" data-open="${i}" style="--pl-color:${color}" aria-label="Open in ${escapeHtml(r.playlistName)}"><span class="search-result-pl">${escapeHtml(r.playlistName)}</span></button>
                </div>`;
            }).join('');
    }

    function youtubeHtml() {
        let html = '<div class="m-search-section"><h2 class="m-search-heading">From YouTube</h2></div>';
        const hint = (text) => `<div class="m-search-hint m-search-hint-sm">${text}</div>`;
        if (ytState === 'limited') return html + hint('Searching too fast: wait a few seconds.');
        if (ytState === 'error') return html + hint('YouTube search failed. Try again in a moment.');
        if (ytState !== 'done') return html + hint('Searching YouTube…');
        if (!ytResults.length) return html + hint('No YouTube matches.');
        return html + ytResults.map((r, i) => {
            const song = songFromYoutube(r);
            const thumb = safeUrl(r.thumbnail);
            return `<div class="m-sr-row">
                <button type="button" class="search-result" data-yt="${i}" aria-label="Preview ${escapeHtml(song.title)}${song.artist ? ' by ' + escapeHtml(song.artist) : ''}">
                    ${thumb ? `<img class="search-result-cover" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : `<div class="search-result-cover search-result-cover-empty">${NOTE_ICON}</div>`}
                    <span class="search-result-info">
                        <span class="search-result-title">${escapeHtml(song.title)}</span>
                        <span class="search-result-artist">${escapeHtml(song.artist || r.channel || '')}</span>
                    </span>
                </button>
                <button type="button" class="m-sr-add" data-add="${i}" aria-label="Add ${escapeHtml(song.title)} to a playlist">
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                </button>
            </div>`;
        }).join('');
    }

    // The library part renders once per query; YouTube's loading and
    // answer only redraw their own part, so the library rows (and focus on
    // them) stay put.
    function renderSearchResults(q, youtubeOnly) {
        if (!searchResultsEl) return;
        const kind = linkKind(q);
        if (kind) {
            setResultsHtml(linkRowsHtml(q, kind));
            return;
        }
        const ytBox = searchResultsEl.querySelector('.m-sr-yt');
        if (youtubeOnly && ytBox && shownQuery === q) {
            keepingFocus(() => { ytBox.innerHTML = youtubeHtml(); });
            shownYt = ytState === 'done' ? ytResults : [];
            return;
        }
        const lib = libraryHtml(q);
        if (!lib && q.length < 3) {
            setResultsHtml(`<div class="m-search-hint">No songs in your library match “${escapeHtml(q)}”.</div>`);
            return;
        }
        keepingFocus(() => {
            searchResultsEl.innerHTML = `<div class="m-sr-lib">${lib}</div>`
                + (q.length >= 3 ? `<div class="m-sr-yt">${youtubeHtml()}</div>` : '');
        });
        shownLib = pageResults;
        shownYt = ytState === 'done' ? ytResults : [];
        shownQuery = q.length >= 3 ? q : null;
    }

    const songCount = (n, where) => (n === 1 ? '1 song' : n + ' songs') + where;
    // For screen readers once both parts are in. withLibrary: YouTube got
    // there first, so the library count hasn't been said yet.
    function announceTotals(withLibrary) {
        const lib = pageResults.length;
        let yt = '';
        if (ytState === 'limited') yt = 'YouTube search is busy. Wait a few seconds.';
        else if (ytState === 'error') yt = 'YouTube search failed';
        else if (ytResults.length) yt = lib ? ytResults.length + ' more from YouTube' : songCount(ytResults.length, ' from YouTube');
        else if (!lib) yt = 'No songs found';
        // (library hits and nothing from YouTube: the library count stands)
        const text = [withLibrary && lib ? songCount(lib, ' in your library') : '', yt].filter(Boolean).join('. ');
        if (text) announce(text);
    }

    function runPageSearch() {
        if (!searchInput) return;
        const q = searchInput.value.trim();
        if (searchClear) searchClear.hidden = !searchInput.value;
        try { sessionStorage.setItem('mSearchQuery', searchInput.value); } catch (e) {}
        clearTimeout(pageSearchTimer);
        clearTimeout(ytTimer);
        const seq = ++pageSearchSeq;
        pageResults = [];
        ytResults = [];
        libDone = false;
        ytState = 'idle';
        if (!q) {
            renderSearchHome();
            return;
        }
        if (linkKind(q)) {
            renderSearchResults(q);
            announce('Link found');
            return;
        }
        if (q.length < 2) {
            searchHint('Keep typing…');
            return;
        }
        const withYoutube = q.length >= 3;
        pageSearchTimer = setTimeout(async () => {
            try {
                const list = await fetchLibrarySearch(q);
                if (seq !== pageSearchSeq) return;
                pageResults = list;
                libDone = true;
                renderSearchResults(q);
                const ytIn = ytState === 'done' || ytState === 'limited' || ytState === 'error';
                if (withYoutube && ytIn) announceTotals(true);
                else if (list.length) announce(songCount(list.length, ' in your library'));
                else announce(withYoutube ? 'No songs in your library' : 'No songs found');
            } catch (e) {
                if (seq === pageSearchSeq) {
                    searchHint('Search failed. Check your connection and try again.');
                    announce('Search failed');
                }
            }
        }, 220);
        if (withYoutube) {
            // YouTube once the typing settles (and once per query)
            ytTimer = setTimeout(async () => {
                const cacheKey = q.toLowerCase();
                if (ytCache.has(cacheKey)) {
                    ytResults = ytCache.get(cacheKey);
                    ytState = 'done';
                } else {
                    ytState = 'loading';
                    if (libDone) renderSearchResults(q, true);
                    let data = null;
                    try {
                        data = await postJsonRetrying('/search-youtube', { query: q }, { retries: 0 });
                    } catch (e) { /* below */ }
                    if (seq !== pageSearchSeq) return;
                    if (data && data.rateLimited) ytState = 'limited';
                    else if (!data || !data.success) ytState = data && data.error && /no results|not found/i.test(data.error) ? 'done' : 'error';
                    else {
                        ytResults = Array.isArray(data.results) ? data.results.filter((r) => r && r.videoId).slice(0, 6) : [];
                        ytCache.set(cacheKey, ytResults);
                        ytState = 'done';
                    }
                }
                if (seq === pageSearchSeq && libDone) {
                    renderSearchResults(q, true);
                    announceTotals();
                }
            }, 650);
        }
    }

    // A hit plays where you are: from the list on screen when it's in it
    // (so it's never a preview whose + would save a second copy), otherwise
    // on its own (like Jump back in).
    function playInPlace(song) {
        const key = songPlayKey(song);
        const idx = songsData.findIndex((s) => songPlayKey(s) === key);
        if (idx < 0) playRadioSong(song);
        else if (idx === currentSongIndex && !currentRadioSong && !currentRowUnloaded) playSongSource(songsData[idx], false);
        else switchSong(idx);
    }

    // Import / add from a pasted link: the right sheet, filled in.
    function actOnLink(action, q) {
        if (action === 'import-yt' || action === 'import-sp') {
            window.showSpotifyImportModal();
            setImportTab(action === 'import-yt' ? 'youtube' : 'spotify');
            const field = document.getElementById(action === 'import-yt' ? 'youtubeImportUrl' : 'spotifyImportUrl');
            if (field) field.value = q;
            if (action === 'import-yt' && typeof fetchYoutubePlaylist === 'function') fetchYoutubePlaylist();
            if (action === 'import-sp' && typeof fetchSpotifyPlaylistUrl === 'function') fetchSpotifyPlaylistUrl();
        } else if (action === 'add-song') {
            window.showAddSongModal();
            const field = document.getElementById('addSongSearch');
            if (field) {
                field.value = q;
                const sheet = document.getElementById('addSongModal');
                if (sheet) sheet.classList.add('m-add-searching'); // the rows make way, as when typing
                if (typeof runAddSongSearch === 'function') runAddSongSearch();
            }
        }
    }

    if (searchInput) {
        searchInput.addEventListener('input', runPageSearch);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            rememberSearch();
            searchInput.blur(); // done typing: drop the keyboard
        });
        let savedQuery = '';
        try { savedQuery = sessionStorage.getItem('mSearchQuery') || ''; } catch (e) {}
        searchInput.value = savedQuery;
        runPageSearch();
    }
    if (searchClear) {
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            runPageSearch();
            searchInput.focus();
        });
    }
    if (searchResultsEl) {
        searchResultsEl.addEventListener('click', (e) => {
            const q = searchInput ? searchInput.value.trim() : '';
            const t = e.target.closest('[data-lib], [data-open], [data-yt], [data-add], [data-recent], [data-recent-x], [data-clear-recent], [data-playlist], [data-link]');
            if (!t) return;
            const d = t.dataset;
            if (d.lib !== undefined || d.open !== undefined) {
                const hit = shownLib[parseInt(d.lib !== undefined ? d.lib : d.open, 10)];
                if (!hit) return;
                rememberSearch();
                if (searchInput) searchInput.blur();
                if (d.lib !== undefined) playInPlace(hit);
                else playSearchHit(hit); // open its playlist at the song
            } else if (d.yt !== undefined || d.add !== undefined) {
                const r = shownYt[parseInt(d.yt !== undefined ? d.yt : d.add, 10)];
                if (!r) return;
                rememberSearch();
                if (searchInput) searchInput.blur();
                if (d.yt !== undefined) playInPlace(songFromYoutube(r)); // a preview
                else window.mShowAddToSheet(songFromYoutube(r), d.add);
            } else if (d.recent !== undefined) {
                const recent = loadRecentSearches()[parseInt(d.recent, 10)];
                if (!recent || !searchInput) return;
                searchInput.value = recent;
                runPageSearch();
            } else if (d.recentX !== undefined) {
                const i = parseInt(d.recentX, 10);
                const list = loadRecentSearches();
                list.splice(i, 1);
                saveRecentSearches(list);
                renderSearchHome();
                // The next × (not the field: that would pop the keyboard).
                const xs = searchResultsEl.querySelectorAll('.m-recent-x');
                (xs[Math.min(i, xs.length - 1)] || searchResultsEl).focus({ preventScroll: true });
            } else if (d.clearRecent !== undefined) {
                saveRecentSearches([]);
                renderSearchHome();
                searchResultsEl.focus({ preventScroll: true });
            } else if (d.playlist !== undefined) {
                window.selectPlaylistFromCrate(d.playlist);
            } else if (d.link !== undefined) {
                actOnLink(d.link, q);
            }
        });
    }

    // "Add to playlist" for a song found on YouTube (not in the library yet)
    const addToSheet = document.getElementById('mAddToSheet');
    let addToSong = null;
    let addToOpener = null;      // the + it came from (its data-add), for focus
    let addToPick = null;        // picker mode (Add songs' "To"): called with the id
    let addToReturn = null;      // where focus goes back to in picker mode
    // opts.pick turns it into a playlist picker: no song, opts.current marked.
    window.mShowAddToSheet = function (song, opener, opts) {
        const pick = opts && typeof opts.pick === 'function' ? opts.pick : null;
        if (!addToSheet || (!song && !pick)) return;
        addToSong = pick ? null : song;
        addToPick = pick;
        addToReturn = pick && opts.returnFocus ? opts.returnFocus : null;
        addToOpener = opener === undefined || opener === null ? null : String(opener);
        const heading = document.getElementById('mAddToTitle');
        if (heading) heading.textContent = pick ? (opts.title || 'Choose a playlist') : 'Add to playlist';
        const list = addToSheet.querySelector('.m-addto-list');
        const title = addToSheet.querySelector('.m-addto-song');
        if (title) {
            title.hidden = !!pick;
            if (!pick) title.textContent = song.artist ? `${song.title} · ${song.artist}` : song.title;
        }
        const current = pick && opts.current !== undefined ? String(opts.current) : null;
        if (list) {
            list.innerHTML = Object.keys(playlistsMeta).map((id) => {
                const meta = playlistsMeta[id];
                const thumb = safeUrl(playlistThumbUrl(id));
                const color = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#d4a574';
                const count = meta.songCount || 0;
                const here = id === current ? ' aria-current="true"' : '';
                return `<button type="button" class="m-sheet-row m-sheet-compact m-addto-row${here ? ' is-current' : ''}" data-addto="${escapeHtml(id)}"${here}>
                    <span class="send-menu-pick-art" aria-hidden="true" style="--pl-color:${color}">${thumb ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '&#9834;'}</span>
                    <span class="m-sheet-text"><b>${escapeHtml(meta.name)}</b><small>${count} ${count === 1 ? 'song' : 'songs'}</small></span>
                </button>`;
            }).join('') || '<p class="m-sleep-status">Make a playlist first (Library → +).</p>';
        }
        addToSheet.classList.add('active');
        const first = addToSheet.querySelector('.m-addto-row.is-current') || addToSheet.querySelector('.m-addto-row');
        if (first) first.focus({ preventScroll: true });
    };
    window.mHideAddToSheet = function () {
        if (!addToSheet) return;
        const hadFocus = addToSheet.contains(document.activeElement);
        addToSheet.classList.remove('active');
        if (addToReturn) {
            // Picker mode: back to its button (its sheet is still open below)
            if (hadFocus) addToReturn.focus({ preventScroll: true });
            addToReturn = null;
            addToPick = null;
            return;
        }
        if (hadFocus && searchResultsEl && !document.querySelector('.add-song-modal.active')) {
            const back = addToOpener !== null ? searchResultsEl.querySelector(`[data-add="${addToOpener}"]`) : null;
            (back || searchResultsEl).focus({ preventScroll: true });
        }
    };
    wrapModalPair('mShowAddToSheet', 'mHideAddToSheet', 'addTo');

    // Resolves to 'added', 'already' or false (failed; it said so).
    // opts.quiet: no "Added to" toast (the Add songs sheet ticks the row).
    async function addFoundSong(id, song, opts) {
        const meta = playlistsMeta[id];
        if (!meta || !song) return false;
        const genAt = viewGen;
        let res = null;
        writeBegin(id);
        try {
            res = await saveMusicRequest({ action: 'addBatch', playlist: id, songs: [song] });
        } catch (e) { /* below */ }
        writeEnd(id);
        if (!res || !res.success) {
            window.mToast(res && res.error ? `Couldn't add it: ${res.error}` : 'Couldn\'t add it. Check your connection and try again.');
            return false;
        }
        if (!res.added) {
            window.mToast(`Already in ${meta.name}`);
            return 'already';
        }
        meta.songCount = (meta.songCount || 0) + res.added;
        setCrateCardCount(id, meta.songCount);
        if (id === 'favorites') {
            favoriteKeys.add(songPlayKey(song));
            updateFavoriteHearts();
        }
        joinList(id, song, { genAt });
        if (!(opts && opts.quiet)) window.mToast(`Added to ${meta.name}`);
        return 'added';
    }

    // Kept for older callers: the list on screen takes the song (see joinList).
    function joinOnScreenList(song) {
        return joinList(listId(), song);
    }

    if (addToSheet) {
        addToSheet.addEventListener('click', (e) => {
            if (e.target.closest('[data-m-addto-close]')) {
                window.mHideAddToSheet();
                return;
            }
            const row = e.target.closest('[data-addto]');
            if (!row) return;
            if (addToPick) {
                const pick = addToPick;
                addToPick = null;
                window.mHideAddToSheet();
                pick(row.dataset.addto);
                return;
            }
            if (!addToSong) return;
            const song = addToSong;
            addToSong = null; // one add per open
            window.mHideAddToSheet();
            addFoundSong(row.dataset.addto, song);
        });
    }

    // The batch file import and the Song Scanner (outside this shell) hand
    // songs for a playlist to the same rules: window.mJoinList(id, song).
    window.mJoinOnScreenList = joinOnScreenList;
    window.mJoinList = joinList;

    // ---- Add songs (portrait phones): a "To" line naming the playlist the
    // songs go to (the open one to start with; a picker changes it without
    // opening another), results that add on a tap and keep the sheet open
    // for the next one, and rows for an import, files and a cover photo.
    // The setup wizard keeps its search-tap-play first song.
    const addSongModal = document.getElementById('addSongModal');
    const addSongSearch = document.getElementById('addSongSearch');
    const addToBtn = document.getElementById('mAddToBtn');
    const addToNameEl = document.getElementById('mAddToName');
    let addTarget = null;
    let addWizard = false;

    // The playlist on screen (or, off it, the playing one), else Favorites
    // (made on the first add if missing)
    function defaultAddTarget() {
        const id = String(listId());
        if (playlistsMeta[id]) return id;
        return playlistsMeta.favorites ? 'favorites' : (Object.keys(playlistsMeta)[0] || 'favorites');
    }
    const currentAddTarget = () => addTarget || defaultAddTarget();

    function renderAddTarget() {
        const meta = playlistsMeta[currentAddTarget()];
        if (addToNameEl) addToNameEl.textContent = meta ? meta.name : 'Favorites';
    }

    const shownAddSong = window.showAddSongModal;
    window.showAddSongModal = function (opts) {
        addWizard = !!(opts && opts.wizard);
        addTarget = defaultAddTarget();
        renderAddTarget();
        if (addSongModal) addSongModal.classList.remove('m-add-searching');
        return shownAddSong.apply(this, arguments);
    };

    // The rows make way for results while there's a search
    if (addSongSearch && addSongModal) {
        addSongSearch.addEventListener('input', () => {
            addSongModal.classList.toggle('m-add-searching', addSongSearch.value.trim() !== '');
        });
    }

    // Where the phone's file pick goes (handleAudioUpload asks); the wizard's
    // pick takes the same visible batch path, untargeted
    window.mAddSheetOnPhone = () => onPhone() && !!addSongModal && addSongModal.classList.contains('active');
    window.mCurrentAddTarget = () => (window.mAddSheetOnPhone() && !addWizard ? currentAddTarget() : undefined);

    // Favorites before it exists (a new account): 'add' creates it
    async function addSongTo(id, song) {
        if (playlistsMeta[id]) return addFoundSong(id, song, { quiet: true });
        const genAt = viewGen;
        let res = null;
        writeBegin(id);
        try {
            res = await saveMusicRequest({ action: 'add', song, playlist: id });
        } catch (e) { /* below */ }
        writeEnd(id);
        if (!res || !res.success) {
            window.mToast(res && res.error ? `Couldn't add it: ${res.error}` : 'Couldn\'t add it. Check your connection and try again.');
            return false;
        }
        if (id === 'favorites') {
            favoriteKeys.add(songPlayKey(song));
            updateFavoriteHearts();
        }
        joinList(id, song, { genAt });
        return 'added';
    }

    const origPickAdd = window.pickAddSearchResult;
    window.pickAddSearchResult = async function (index) {
        if (!onPhone() || addWizard || !addSongModal || !addSongModal.classList.contains('active')) {
            return origPickAdd.apply(this, arguments);
        }
        const r = addSearchResults[index];
        const row = document.querySelector(`#addSongSearchResults [data-add-i="${index}"]`);
        // aria-disabled, not disabled: the row keeps keyboard/TalkBack focus
        if (!r || !r.videoId || !row || row.getAttribute('aria-disabled') === 'true') return;
        row.setAttribute('aria-disabled', 'true');
        row.classList.add('adding');
        const parsed = parseYoutubeResultTitle(r.title, r.channel);
        const song = { title: parsed.title || r.title, artist: parsed.artist, album: '', cover: safeUrl(r.thumbnail), youtube_id: r.videoId, mp3_url: '', spotify_id: '' };
        const out = await addSongTo(currentAddTarget(), song);
        row.classList.remove('adding');
        if (out) {
            row.classList.add('is-added'); // stays aria-disabled: one add per result
            row.setAttribute('aria-label', `${song.title}: ${out === 'already' ? 'already there' : 'added'}`);
            const meta = playlistsMeta[currentAddTarget()];
            const said = document.getElementById('mAddStatus');
            if (said) said.textContent = `${out === 'already' ? 'Already in' : 'Added to'} ${meta ? meta.name : 'Favorites'}`;
        } else {
            row.removeAttribute('aria-disabled');
        }
    };

    // The manual form (a pasted song link lands there too) adds to the To
    // playlist as well, and the sheet stays for the next song
    const origSaveAndPlay = window.saveAndPlaySong;
    window.saveAndPlaySong = async function (song) {
        if (!onPhone() || addWizard || !addSongModal || !addSongModal.classList.contains('active')) {
            return origSaveAndPlay.apply(this, arguments);
        }
        const target = currentAddTarget();
        const out = await addSongTo(target, Object.assign({ spotify_id: '' }, song));
        if (!out) return false;
        const meta = playlistsMeta[target];
        // ("Already in …" was said on the way)
        if (out === 'added') window.mToast(`Added to ${meta ? meta.name : 'Favorites'}`);
        const form = document.getElementById('addSongForm');
        if (form) form.reset();
        lastFetchedYtId = ''; // the same link pasted again fills the form again
        const manual = document.getElementById('addSongManualDetails');
        if (manual) manual.open = false;
        if (addSongSearch) {
            addSongSearch.value = '';
            addSongModal.classList.remove('m-add-searching');
        }
        renderAddSearchResults(null);
        return true;
    };

    if (addToBtn) {
        addToBtn.addEventListener('click', () => {
            window.mShowAddToSheet(null, null, {
                title: 'Add songs to',
                current: currentAddTarget(),
                returnFocus: addToBtn,
                pick: (id) => {
                    addTarget = id;
                    renderAddTarget();
                },
            });
        });
    }

    if (addSongModal) {
        addSongModal.addEventListener('click', (e) => {
            const row = e.target.closest('[data-m-addsong]');
            if (!row) return;
            const what = row.dataset.mAddsong;
            if (what === 'import') {
                // Into whatever "To" names (a playlist that doesn't exist yet,
                // e.g. Favorites on a new account: a new one)
                const t = String(currentAddTarget());
                window.hideAddSongModal();
                window.showSpotifyImportModal(playlistsMeta[t] ? { into: 'current', playlist: t } : { into: 'new' });
            } else if (what === 'files') {
                // Inside the tap (a file picker needs it); the sheet stays
                // until the files are picked
                const input = document.getElementById('addSongFile');
                if (input) {
                    input.value = '';
                    input.click();
                }
            } else if (what === 'snap') {
                window.mScanTarget = currentAddTarget();
                window.showScanModal(); // over this sheet: back returns here
                const cam = document.getElementById('scanCameraInput');
                if (cam) {
                    cam.value = '';
                    cam.click();
                }
            }
        });
    }

    // ============================================================
    // Playlist screen (portrait): the whole sidebar scrolls under a compact
    // top bar (back, the title once the big one has scrolled away, find, ⋯),
    // the action row, find, the ⋯ menu and reorder mode. Find, the menu and
    // reorder are history layers, so back closes them first.
    // ============================================================
    const plSidebar = document.getElementById('musicSidebar');
    const plBar = document.getElementById('mPlBar');
    const plBarTitle = document.getElementById('mPlBarTitle');
    const plTitle = document.getElementById('playlistTitle');
    const plFind = document.getElementById('mPlFind');
    const plSheet = document.getElementById('mPlaylistSheet');
    const musicSection = document.getElementById('music-section');
    let reordering = false; // reorder mode (below); the bar then says so

    // The bar's title and the menu's heading follow the playlist's name
    // (switches and renames both rewrite #playlistTitle).
    function syncPlTitle() {
        const name = plTitle ? plTitle.textContent.trim() : '';
        if (plBarTitle && !reordering) plBarTitle.textContent = name;
        const sheetTitle = document.getElementById('mPlaylistSheetTitle');
        if (sheetTitle) sheetTitle.textContent = name || 'Playlist';
    }
    if (plTitle) {
        new MutationObserver(syncPlTitle).observe(plTitle, { childList: true, characterData: true, subtree: true });
    }

    // The screen takes on the playlist's colour at the top.
    function syncPlColor() {
        if (!musicSection) return;
        const meta = typeof playlistsMeta === 'object' && playlistsMeta ? playlistsMeta[listId()] : null;
        const color = meta && /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '';
        if (color) musicSection.style.setProperty('--pl-color', color);
        else musicSection.style.removeProperty('--pl-color');
    }

    // An empty playlist leads with its empty card: Play, shuffle and find step
    // aside. Also which list the screen shows: one that isn't playing
    // (m-pl-viewing: Play reads Play), still loading (m-pl-loading).
    function syncPlEmpty() {
        if (!plSidebar) return;
        const list = listSongs();
        plSidebar.classList.toggle('m-pl-empty', !listLoading() && (!Array.isArray(list) || list.length === 0));
        plSidebar.classList.toggle('m-pl-viewing', !listIsPlaying());
        plSidebar.classList.toggle('m-pl-loading', listLoading());
    }

    // A view change (see viewChanged at the top): the screen's colour and
    // classes, and the playlist its history entry records.
    viewChangedHook = function () {
        syncPlColor();
        syncPlEmpty();
        syncPlaylistLayerMeta();
    };

    // The bar gets a background once content slides under it, and the title
    // once the big one has scrolled past it.
    let plScrollFrame = 0;
    function syncPlScroll() {
        plScrollFrame = 0;
        if (!plSidebar || !plBar) return;
        plSidebar.classList.toggle('m-pl-raised', plSidebar.scrollTop > 2);
        const titled = !!plTitle && plTitle.getBoundingClientRect().bottom <= plBar.getBoundingClientRect().bottom;
        plSidebar.classList.toggle('m-pl-titled', titled);
    }
    if (plSidebar) {
        plSidebar.addEventListener('scroll', () => {
            if (!plScrollFrame) plScrollFrame = requestAnimationFrame(syncPlScroll);
        }, { passive: true });
    }

    function plScreenShown() {
        // Every visit starts at the top (the same playlist opens without a
        // reload, so nothing else resets it).
        if (plSidebar && onPhone()) plSidebar.scrollTop = 0;
        syncPlTitle();
        syncPlColor();
        syncPlEmpty();
        syncPlScroll();
    }
    if (playerView) {
        new MutationObserver(() => { if (playerViewActive()) plScreenShown(); })
            .observe(playerView, { attributes: true, attributeFilter: ['class'] });
    }
    // Song adds/removes and playlist switches rebuild the list; switches and
    // edits (name, colour) also refresh the crate records.
    const plPrevRebuild = window.rebuildSongList;
    window.rebuildSongList = function () {
        const out = plPrevRebuild.apply(this, arguments);
        syncPlEmpty();
        // Fewer than two songs left on screen: nothing to reorder.
        if (reordering && listSongs().length < 2) {
            if (topLayerIs('reorder')) backOneLayer(); else exitReorder();
        }
        return out;
    };
    const plPrevCrateRecords = window.updateCrateRecords;
    window.updateCrateRecords = function () {
        const out = plPrevCrateRecords.apply(this, arguments);
        syncPlColor();
        return out;
    };
    plScreenShown();

    const plBack = document.getElementById('mPlBack');
    if (plBack) plBack.addEventListener('click', () => window.showPlaylistPicker());
    const plAdd = document.getElementById('mPlAdd');
    if (plAdd) plAdd.addEventListener('click', () => window.showAddSongModal());

    // ---- Find: the field shows under the header; back closes it (and clears it).
    const findOpen = () => !!plSidebar && plSidebar.classList.contains('m-find-open');
    function closeFind() {
        if (!plSidebar) return;
        plSidebar.classList.remove('m-find-open');
        if (plFind) plFind.setAttribute('aria-expanded', 'false');
        if (filterInput) {
            if (filterInput.value) {
                filterInput.value = '';
                applyRowFilter();
            }
            if (document.activeElement === filterInput) filterInput.blur();
        }
    }
    function openFind() {
        if (!plSidebar || !filterInput) return;
        plSidebar.classList.add('m-find-open');
        if (plFind) plFind.setAttribute('aria-expanded', 'true');
        plSidebar.scrollTop = 0;
        filterInput.focus(); // synchronously, so iOS raises the keyboard
        openLayer('find', closeFind);
    }
    if (plFind) {
        plFind.addEventListener('click', () => {
            if (!findOpen()) openFind();
            else if (topLayerIs('find')) backOneLayer();
            else closeFind();
        });
    }

    // ---- Reorder mode: handles appear, the ⋯ and hearts go, taps don't play.
    function exitReorder() {
        const hadDoneFocus = document.activeElement && document.activeElement.id === 'mPlDone';
        reordering = false;
        if (plSidebar) plSidebar.classList.remove('m-reordering');
        syncPlTitle();
        // Done hides itself: keep keyboard focus in the bar.
        if (hadDoneFocus || document.activeElement === document.body) {
            const more = document.getElementById('mPlMore');
            if (more && hadDoneFocus) more.focus({ preventScroll: true });
        }
    }
    function enterReorder() {
        // Converges like switchTab: wait for a closing sheet, and close find first.
        if (pendingBack) {
            afterBack.push(enterReorder);
            return;
        }
        if (topLayerIs('find')) {
            afterBack.push(enterReorder);
            backOneLayer();
            return;
        }
        if (!plSidebar || reordering || listLoading() || listSongs().length < 2) return;
        reordering = true;
        const a = document.activeElement;
        const focusWasInBar = !a || a === document.body || (plBar && plBar.contains(a)) || (plSheet && plSheet.contains(a));
        plSidebar.classList.add('m-reordering');
        if (plBarTitle) plBarTitle.textContent = 'Reorder songs';
        // The ⋯ hides in reorder mode: hand keyboard focus to Done.
        const done = document.getElementById('mPlDone');
        if (done && focusWasInBar) done.focus({ preventScroll: true });
        openLayer('reorder', exitReorder);
    }
    const plDone = document.getElementById('mPlDone');
    if (plDone) {
        plDone.addEventListener('click', () => {
            if (topLayerIs('reorder')) backOneLayer();
            else exitReorder();
        });
    }
    const songListEl = document.getElementById('songList');
    if (songListEl) {
        songListEl.addEventListener('click', (e) => {
            if (!reordering || e.target.closest('.song-drag-handle, .song-list-empty')) return;
            e.preventDefault();
            e.stopPropagation();
        }, true);
    }

    // ---- The ⋯ playlist menu
    const plRow = (key) => (plSheet ? plSheet.querySelector(`[data-m-pl="${key}"]`) : null);
    let plDeleteTimer = 0;
    function disarmPlDelete() {
        clearTimeout(plDeleteTimer);
        const r = plRow('delete');
        if (!r) return;
        r.classList.remove('m-confirm-armed');
        r.disabled = false;
        r.querySelector('b').textContent = 'Delete playlist';
    }
    function syncPlSheet() {
        // The list on screen (none while it loads)
        const list = listSongs();
        const count = list.length;
        const reorderRow = plRow('reorder');
        if (reorderRow) reorderRow.hidden = count < 2;
        const queueSub = document.getElementById('mPlSheetQueueSub');
        const queued = typeof playQueue !== 'undefined' && Array.isArray(playQueue) ? playQueue.length : 0;
        if (queueSub) queueSub.textContent = queued ? (queued === 1 ? '1 song queued' : queued + ' songs queued') : 'Nothing queued';
        // Offline only works for uploaded songs (YouTube and Spotify always stream).
        const offlineRow = plRow('offline');
        if (offlineRow) {
            const saved = getOfflinePlaylists().includes(listId());
            const offlinable = count > 0 && list.some((s) => s.mp3_url && s.mp3_url.startsWith('/media/'));
            const saving = typeof offlineSaving !== 'undefined' && offlineSaving;
            offlineRow.hidden = !('caches' in window) || !(saved || offlinable || saving);
            offlineRow.disabled = saving;
            offlineRow.querySelector('b').textContent = saving ? 'Saving for offline…' : (saved ? 'Remove download' : 'Save for offline');
            const sub = document.getElementById('mPlSheetOfflineSub');
            if (sub) sub.textContent = saved ? 'Saved on this phone' : 'Keep the uploaded songs on this phone';
        }
        disarmPlDelete();
    }
    window.mShowPlaylistSheet = function () {
        if (!plSheet) return;
        syncPlSheet();
        plSheet.classList.add('active');
        const first = plSheet.querySelector('.m-sheet-row:not([hidden])');
        if (first) first.focus({ preventScroll: true });
    };
    window.mHidePlaylistSheet = function () {
        if (!plSheet) return;
        const hadFocus = plSheet.contains(document.activeElement);
        plSheet.classList.remove('active');
        disarmPlDelete();
        if (hadFocus && !document.querySelector('.add-song-modal.active')) {
            const more = document.getElementById('mPlMore');
            if (more) more.focus({ preventScroll: true });
        }
    };
    wrapModalPair('mShowPlaylistSheet', 'mHidePlaylistSheet', 'playlistMenu');
    const plMore = document.getElementById('mPlMore');
    if (plMore) plMore.addEventListener('click', () => window.mShowPlaylistSheet());

    // Share: the playlist's link (the server returns the existing one or
    // makes one — asking every time means a link stopped elsewhere is never
    // handed out); the phone's share sheet when there is one, else the clipboard.
    async function sharePlaylistLink(id) {
        const meta = playlistsMeta[id];
        if (!meta) return;
        let url = '';
        try {
            const res = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'share', playlist: id })
            });
            const d = await res.json();
            if (d && d.success && d.url) {
                url = d.url;
                if (typeof shareTokens === 'object' && shareTokens) shareTokens[id] = url;
            }
        } catch (e) { /* handled below */ }
        if (!url) {
            window.mToast('Couldn\'t make a share link. Try again.');
            return;
        }
        if (navigator.share) {
            try {
                await navigator.share({ title: meta.name, url });
                return;
            } catch (e) {
                if (e && e.name === 'AbortError') return; // the user closed the share sheet
            }
        }
        try {
            await navigator.clipboard.writeText(url);
            window.mToast('Link copied');
        } catch (e) {
            window.mToast(url);
        }
    }

    async function offlineFromMenu() {
        const id = listId();
        const wasSaved = getOfflinePlaylists().includes(id);
        if (!wasSaved) window.mToast('Saving for offline…');
        await toggleOfflinePlaylist();
        const nowSaved = getOfflinePlaylists().includes(id);
        if (nowSaved !== wasSaved) window.mToast(nowSaved ? 'Saved for offline' : 'Download removed');
    }

    if (plSheet) {
        plSheet.addEventListener('click', (e) => {
            if (e.target.closest('[data-m-pl-close]')) {
                window.mHidePlaylistSheet();
                return;
            }
            const row = e.target.closest('[data-m-pl]');
            if (!row || row.disabled) return;
            const id = String(listId()); // the playlist on screen
            const action = row.dataset.mPl;
            if (action === 'delete') {
                // Two taps: the first arms the row for a few seconds.
                if (!row.classList.contains('m-confirm-armed')) {
                    row.classList.add('m-confirm-armed');
                    row.querySelector('b').textContent = 'Tap again to delete';
                    clearTimeout(plDeleteTimer);
                    plDeleteTimer = setTimeout(disarmPlDelete, 3500);
                    return;
                }
                clearTimeout(plDeleteTimer);
                row.disabled = true;
                row.querySelector('b').textContent = 'Deleting…';
                // It reloads on success (the sheet's history entry is dropped
                // by adoptHistory); on failure it says why.
                Promise.resolve(deleteCurrentPlaylist(id, { confirmed: true })).finally(() => {
                    if (row.isConnected) disarmPlDelete();
                });
                return;
            }
            window.mHidePlaylistSheet();
            if (action === 'add') window.showAddSongModal();
            else if (action === 'import') window.showSpotifyImportModal({ into: 'current', playlist: id });
            else if (action === 'reorder') enterReorder();
            else if (action === 'edit') window.showPlaylistEditModal(id);
            else if (action === 'share') sharePlaylistLink(id);
            else if (action === 'queue') window.openQueueModal();
            else if (action === 'offline') offlineFromMenu();
            else if (action === 'scan') window.showScanModal();
        });
    }

    // ---- Reload: history.state survives it (back stays in this document),
    // so rebuild what the page can still show — the tab, and the playlist
    // screen if it's still the active playlist (it's already rendered) —
    // WITHOUT pushing: entries pushed before the first tap are skipped by
    // Chromium's hardware back. Entries for surfaces that didn't survive
    // (Now Playing, sheets, modals, an old welcome guard) are consumed with
    // one history.go(), so no back press goes dead.
    (function adoptHistory() {
        const st = history.state;
        const depth = st && typeof st.mDepth === 'number' ? st.mDepth : 0;
        const saved = st && Array.isArray(st.mStack) ? st.mStack : [];
        let i = 0;
        // A playlist that's still there (deleting the last one leaves
        // 'favorites' active with no such playlist); the playing one, or one
        // that was only being shown (it loads again)
        const playlistAt = (k) => inShell() && !!saved[k] && saved[k].n === 'playlist'
            && typeof playlistsMeta === 'object' && !!playlistsMeta
            && Object.prototype.hasOwnProperty.call(playlistsMeta, saved[k].p);
        if (saved[i] && saved[i].n === 'tab' && (saved[i].t === 'search' || saved[i].t === 'library')
            && (onPhone() || playlistAt(i + 1))) {
            // Landscape keeps [tab, playlist] too (a rotation does); a bare
            // tab there folds on the next back.
            layerStack.push({ name: 'tab', closeFn: closeTabLayer, meta: { t: saved[i].t } });
            i++;
        }
        // The You page (over Home only) comes back on a phone; anywhere else
        // its entry is consumed, and the head script's early class dropped.
        const youAdopted = i === 0 && !!saved[0] && saved[0].n === 'you' && !!youPage
            && (onPhone() || playlistAt(1)); // landscape keeps [you, playlist]; a bare one folds
        if (youAdopted) {
            layerStack.push({ name: 'you', closeFn: closeYouPage });
            i++;
        }
        htmlEl.classList.toggle('m-you', youAdopted);
        if (playlistAt(i)) {
            const p = saved[i].p;
            origOpenPlayerView();
            layerStack.push({ name: 'playlist', closeFn: closePlaylistLayer, meta: { p } });
            if (p !== String(activePlaylistId)) {
                // Shown but not playing: the loading row under its name now
                // (the page rendered the playing list), its songs when they come
                viewGen++;
                viewedId = p;
                viewedSongs = null;
                viewedResume = 0;
                viewDirty = false;
                viewFailed = false;
                const meta = playlistsMeta[p];
                if (plTitle) plTitle.textContent = meta.name;
                const countEl = document.querySelector('.sidebar-track-count');
                const n = meta.songCount || 0;
                if (countEl) countEl.textContent = n + (n === 1 ? ' song' : ' songs');
                rebuildSongList();
                if (typeof updateOfflineButton === 'function') updateOfflineButton();
                syncPlColor();
                syncPlEmpty();
                const gen = viewGen;
                viewOpening = { id: p, gen, promise: loadView(p, gen) };
            }
            i++;
        }
        setTab(tabLayerIndex() >= 0 ? layerStack[tabLayerIndex()].meta.t : 'home');
        if (youAdopted) {
            // Filled now even in landscape (under a playlist there), so it's
            // ready when a rotation and a back show it.
            setBackLabel();
            renderYouCounts();
            syncYouBar();
            loadYouStats();
        }
        const extra = depth - layerStack.length;
        if (extra > 0) traverse(-extra); // the landing popstate stamps it
        else stamp();
    })();

    // The member welcome card shows the PIN exactly once and must not be
    // dismissible — a hardware back would otherwise leave the page and
    // lose the PIN forever. While the card is up, back is a no-op: the
    // popped guard layer re-pushes itself (after the pop, see popstate).
    const welcomeCardUp = () => {
        const card = document.getElementById('memberWelcomeModal');
        return !!card && getComputedStyle(card).display !== 'none';
    };
    if (document.getElementById('memberWelcomeModal')) {
        const reGuardWelcome = () => {
            if (welcomeCardUp()) openLayer('memberWelcome', reGuardWelcome);
        };
        openLayer('memberWelcome', reGuardWelcome);

        // Once the card is dismissed its guard goes too — else the next back
        // press would be a dead one (and tabs stay locked behind it).
        const dropWelcomeGuard = () => {
            if (topLayerIs('memberWelcome') && !welcomeCardUp()) backOneLayer();
        };
        const origWizard = window.showFirstRunWizard;
        if (typeof origWizard === 'function') {
            window.showFirstRunWizard = function () {
                dropWelcomeGuard(); // the wizard's modal layer then waits for it
                return origWizard.apply(this, arguments);
            };
        }
        const origFinishWelcome = window.finishMemberWelcome;
        if (typeof origFinishWelcome === 'function') {
            window.finishMemberWelcome = async function () {
                const out = await origFinishWelcome.apply(this, arguments);
                dropWelcomeGuard();
                return out;
            };
        }
    }

    // ============================================================
    // Now Playing sheet
    // ============================================================
    function openNp() {
        if (!onPhone() || document.body.classList.contains('m-np-open')) return;
        setVolumeOpen(false);
        // A song sheet still up (keyboard users can reach the mini player
        // behind it): close it first, then open.
        if (songSheetOpen) {
            afterBack.push(openNp);
            window.closeSendMenu();
            return;
        }
        // The playing playlist (the screen behind may show another one)
        const fromName = document.getElementById('mNpFromName');
        const fromMeta = playlistsMeta[activePlaylistId];
        const title = document.getElementById('playlistTitle');
        if (fromName) fromName.textContent = fromMeta ? fromMeta.name : (listIsPlaying() && title ? title.textContent : '');
        document.body.classList.add('m-np-open');
        const npSheet = document.querySelector('.music-main');
        if (npSheet) {
            npSheet.setAttribute('role', 'dialog');
            npSheet.setAttribute('aria-modal', 'true');
            npSheet.setAttribute('aria-label', 'Now playing');
        }
        openLayer('np', () => {
            document.body.classList.remove('m-np-open');
            if (npSheet) ['role', 'aria-modal', 'aria-label'].forEach((a) => npSheet.removeAttribute(a));
            setVolumeOpen(false);
        });
    }

    function closeNp() {
        if (topLayerIs('np')) backOneLayer();
    }

    const npCollapse = document.getElementById('mNpCollapse');
    if (npCollapse) npCollapse.addEventListener('click', closeNp);

    // Drag down on the header to dismiss
    const npHeader = document.getElementById('mNpHeader');
    const musicMain = document.querySelector('.music-main');
    if (npHeader && musicMain) {
        let dragY = 0, dragStart = 0, dragT = 0, dragging = false;

        npHeader.addEventListener('pointerdown', (e) => {
            if (!onPhone() || !document.body.classList.contains('m-np-open')) return;
            if (e.target.closest && e.target.closest('#mNpCollapse, #mNpKebab')) return;
            dragging = true;
            dragStart = e.clientY;
            dragT = performance.now();
            dragY = 0;
            npHeader.setPointerCapture(e.pointerId);
            musicMain.style.transition = 'none';
        });

        npHeader.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            dragY = Math.max(0, e.clientY - dragStart);
            musicMain.style.transform = 'translateY(' + dragY + 'px)';
        });

        const npSettle = () => {
            if (!dragging) return;
            dragging = false;
            musicMain.style.transition = '';
            musicMain.style.transform = '';
            const dt = Math.max(1, performance.now() - dragT);
            const velocity = dragY / dt;
            if (dragY > window.innerHeight / 3 || velocity > 0.5) closeNp();
        };
        npHeader.addEventListener('pointerup', npSettle);
        npHeader.addEventListener('pointercancel', npSettle);
    }

    // ---- NP transport ----
    const bind = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };
    bind('mPlayBtn', () => toggleMusic());
    bind('mPrevBtn', () => prevSong());
    bind('mNextBtn', () => nextSong());
    bind('mShuffleBtn', () => { toggleShuffle(); mSyncModes(); });
    bind('mLoopBtn', () => { toggleLoopMode(); mSyncModes(); });

    // ---- Touch scrubbing on the seek bar (all three engines via the
    // facade). The 100ms tick yields via the __mScrubbing guard; the
    // legacy click handler is suppressed right after a scrub. ----
    const progressBar = document.getElementById('sleeveProgressBar');
    if (progressBar) {
        let scrubbing = false;
        let lastScrubEnd = 0;

        const scrubRatio = (e) => {
            const rect = progressBar.getBoundingClientRect();
            return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        };

        const previewScrub = (ratio) => {
            const fill = document.getElementById('sleeveProgressFill');
            const knob = document.getElementById('sleeveProgressKnob');
            const elapsed = document.getElementById('sleeveTimeElapsed');
            if (fill) fill.style.width = (ratio * 100) + '%';
            if (knob) knob.style.left = (ratio * 100) + '%';
            if (elapsed && ytPlayer && ytPlayer.getDuration) {
                try { elapsed.textContent = formatTime(ratio * ytPlayer.getDuration()); } catch (e) {}
            }
        };

        progressBar.addEventListener('pointerdown', (e) => {
            if (!onPhone()) return;
            scrubbing = true;
            window.__mScrubbing = true;
            document.body.classList.add('m-scrubbing');
            progressBar.setPointerCapture(e.pointerId);
            previewScrub(scrubRatio(e));
        });

        progressBar.addEventListener('pointermove', (e) => {
            if (!scrubbing) return;
            previewScrub(scrubRatio(e));
        });

        const endScrub = (e) => {
            if (!scrubbing) return;
            scrubbing = false;
            document.body.classList.remove('m-scrubbing');
            const ratio = scrubRatio(e);
            try {
                if (ytPlayer && ytPlayer.seekTo && ytPlayer.getDuration) {
                    ytPlayer.seekTo(ratio * ytPlayer.getDuration(), true);
                }
            } catch (err) {}
            window.__mScrubbing = false;
            lastScrubEnd = performance.now();
        };
        progressBar.addEventListener('pointerup', endScrub);
        progressBar.addEventListener('pointercancel', (e) => {
            scrubbing = false;
            document.body.classList.remove('m-scrubbing');
            window.__mScrubbing = false;
        });

        // The legacy click-to-seek fires right after pointerup — swallow it
        // once so the scrub position isn't re-seeked from the click point.
        progressBar.addEventListener('click', (e) => {
            if (performance.now() - lastScrubEnd < 350) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
    }

    // ---- Volume slider (hidden on iOS: programmatic volume is hardware-
    // locked there; never render an inert control) ----
    const mVolume = document.getElementById('mVolume');
    const mVolumeRange = document.getElementById('mVolumeRange');
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (mVolume && isIOS) {
        mVolume.style.display = 'none';
    } else if (mVolumeRange) {
        mVolumeRange.addEventListener('input', () => setVolume(parseInt(mVolumeRange.value, 10)));
    }

    // ============================================================
    // Now Playing tools row: like · sleep timer · up next · volume (the
    // slider shows on demand, so it doesn't take a row of its own).
    // ============================================================
    const npLike = document.getElementById('mNpLike');
    const npSleep = document.getElementById('mNpSleep');
    const npQueue = document.getElementById('mNpQueue');
    const npVolume = document.getElementById('mNpVolume');

    // The song on screen. A track change shows the new song before the
    // playlist position catches up (switchSong saves first), so follow what
    // is displayed rather than songsData[currentSongIndex].
    let npShown = null;
    const npSong = () => npShown || (typeof currentRadioSong !== 'undefined' && currentRadioSong)
        || (Array.isArray(songsData) ? songsData[currentSongIndex] : null) || null;
    const inLoadedList = (song) => !!song && Array.isArray(songsData)
        && songsData.some((x) => x === song || songPlayKey(x) === songPlayKey(song));

    // In Favorites a song of the list can't be unliked from here (the list
    // and the server's positions would drift apart); the song menu's Remove
    // does it properly.
    const lockedInFavorites = (song) => activePlaylistId === 'favorites' && inLoadedList(song);

    let npLikeBusy = false;
    function syncNpLike() {
        if (!npLike) return;
        const song = npSong();
        const locked = lockedInFavorites(song);
        const liked = !!song && (locked || favoriteKeys.has(songPlayKey(song)));
        npLike.classList.toggle('is-on', liked);
        npLike.setAttribute('aria-pressed', liked ? 'true' : 'false');
        npLike.setAttribute('aria-label', 'Favorite');
        if (locked) npLike.setAttribute('aria-disabled', 'true'); else npLike.removeAttribute('aria-disabled');
        npLike.disabled = !song;
    }

    if (npLike) {
        npLike.addEventListener('click', async () => {
            const song = npSong();
            if (!song || npLikeBusy) return;
            if (lockedInFavorites(song)) {
                window.mToast('In your Favorites — remove it from the song menu (⋯)');
                return;
            }
            const key = songPlayKey(song);
            const wasFav = favoriteKeys.has(key);
            npLikeBusy = true;
            npLike.classList.toggle('is-on', !wasFav); // answer the tap at once
            try {
                await toggleFavoriteSong(song);
            } finally {
                npLikeBusy = false;
            }
            // (A loaded Favorites list took the like in toggleFavoriteSong.)
            const nowFav = favoriteKeys.has(key);
            syncNpLike();
            window.mToast(nowFav === wasFav ? 'Couldn\'t update Favorites. Try again.'
                : (nowFav ? 'Added to Favorites' : 'Removed from Favorites'));
        });
    }

    // Track changes rewrite the now-playing text (the song object comes
    // through animateRecordChange / updateSongDisplay just before); favorites
    // changes redraw the hearts. Both keep the ♥ right.
    const npPrevRecordChange = window.animateRecordChange;
    if (typeof npPrevRecordChange === 'function') {
        window.animateRecordChange = function (newSong) {
            npShown = newSong || null;
            return npPrevRecordChange.apply(this, arguments);
        };
    }
    const npPrevSongDisplay = window.updateSongDisplay;
    if (typeof npPrevSongDisplay === 'function') {
        window.updateSongDisplay = function (song) {
            // Only real songs (the empty-playlist placeholder isn't one).
            const real = song && (inLoadedList(song) || song === currentRadioSong);
            npShown = real ? song : null;
            return npPrevSongDisplay.apply(this, arguments);
        };
    }
    const npPrevNowPlayingText = window.setNowPlayingText;
    if (typeof npPrevNowPlayingText === 'function') {
        window.setNowPlayingText = function (title, artist) {
            const out = npPrevNowPlayingText.apply(this, arguments);
            const same = (x) => x && (x.title || '') === (title || '') && (x.artist || '') === (artist || '');
            const radio = typeof currentRadioSong !== 'undefined' ? currentRadioSong : null;
            const listed = Array.isArray(songsData) ? songsData[currentSongIndex] : null;
            npShown = [npShown, radio, listed].find(same) || null;
            syncNpLike();
            return out;
        };
    }
    const npPrevHearts = window.updateFavoriteHearts;
    if (typeof npPrevHearts === 'function') {
        window.updateFavoriteHearts = function () {
            const out = npPrevHearts.apply(this, arguments);
            syncNpLike();
            return out;
        };
    }
    syncNpLike();
    if (typeof updateQueueBadge === 'function') updateQueueBadge();
    if (typeof updateSleepLabel === 'function') updateSleepLabel();

    if (npQueue) npQueue.addEventListener('click', () => window.openQueueModal());

    // Volume on demand: the slider slides in under the row, and tucks away a
    // few seconds after the last touch (or when Now Playing closes).
    let volumeTimer = 0;
    let volumeHeld = false;
    function armVolumeHide() {
        clearTimeout(volumeTimer);
        volumeTimer = setTimeout(function hide() {
            // Not from under a finger, and not while it has keyboard focus.
            const a = document.activeElement;
            if (volumeHeld || (mVolume && mVolume.contains(a))) {
                volumeTimer = setTimeout(hide, 5000);
                return;
            }
            setVolumeOpen(false);
        }, 5000);
    }
    function setVolumeOpen(open) {
        document.body.classList.toggle('m-vol-open', open);
        if (npVolume) npVolume.setAttribute('aria-expanded', open ? 'true' : 'false');
        clearTimeout(volumeTimer);
        if (open) {
            if (mVolumeRange && typeof currentVolume !== 'undefined') mVolumeRange.value = currentVolume;
            armVolumeHide();
        }
    }
    if (npVolume) {
        if (isIOS) npVolume.hidden = true; // hardware-locked there
        npVolume.addEventListener('click', () => setVolumeOpen(!document.body.classList.contains('m-vol-open')));
    }
    if (mVolumeRange) {
        const keepOpen = () => { if (document.body.classList.contains('m-vol-open')) armVolumeHide(); };
        mVolumeRange.addEventListener('input', keepOpen);
        mVolumeRange.addEventListener('focus', keepOpen);
        mVolumeRange.addEventListener('pointerdown', () => { volumeHeld = true; keepOpen(); });
        ['pointerup', 'pointercancel'].forEach((t) => mVolumeRange.addEventListener(t, () => { volumeHeld = false; keepOpen(); }));
    }

    // Sleep timer sheet
    const sleepSheet = document.getElementById('mSleepSheet');
    function syncSleepSheet() {
        if (!sleepSheet) return;
        const endOfTrack = typeof sleepEndOfTrack !== 'undefined' && sleepEndOfTrack;
        const deadline = typeof sleepDeadline !== 'undefined' ? sleepDeadline : 0;
        const status = document.getElementById('mSleepStatus');
        if (status) {
            const mins = deadline ? Math.max(1, Math.ceil((deadline - Date.now()) / 60000)) : 0;
            status.textContent = endOfTrack ? 'Pausing when this song ends.'
                : (mins ? `Pausing in ${mins} min.` : 'Fades the music out and pauses.');
        }
        const off = document.getElementById('mSleepOff');
        if (off) off.hidden = !(endOfTrack || deadline);
        sleepSheet.querySelectorAll('[data-m-sleep]').forEach((b) => {
            b.classList.toggle('is-current', b.dataset.mSleep === 'end' && endOfTrack);
        });
    }
    window.mSyncSleepSheet = function () {
        if (sleepSheet && sleepSheet.classList.contains('active')) syncSleepSheet();
    };
    window.mShowSleepSheet = function () {
        if (!sleepSheet) return;
        syncSleepSheet();
        sleepSheet.classList.add('active');
        const first = sleepSheet.querySelector('.m-sleep-opt');
        if (first) first.focus({ preventScroll: true });
    };
    window.mHideSleepSheet = function () {
        if (!sleepSheet) return;
        const hadFocus = sleepSheet.contains(document.activeElement);
        sleepSheet.classList.remove('active');
        if (hadFocus && npSleep && !document.querySelector('.add-song-modal.active')) npSleep.focus({ preventScroll: true });
    };
    wrapModalPair('mShowSleepSheet', 'mHideSleepSheet', 'sleep');
    if (npSleep) npSleep.addEventListener('click', () => window.mShowSleepSheet());
    if (sleepSheet) {
        sleepSheet.addEventListener('click', (e) => {
            if (e.target.closest('[data-m-sleep-close]')) {
                window.mHideSleepSheet();
                return;
            }
            const opt = e.target.closest('[data-m-sleep]');
            if (!opt) return;
            const v = opt.dataset.mSleep;
            setSleepTimer(v === 'end' ? 'end' : parseInt(v, 10));
            window.mHideSleepSheet();
            window.mToast(v === '0' ? 'Sleep timer off'
                : (v === 'end' ? 'Pausing when this song ends' : `Pausing in ${v === '60' ? '1 hour' : v + ' minutes'}`));
        });
    }

    // ---- Dock tap opens the NP sheet over whatever is showing (any tab or
    // the playlist screen); closing it reveals that same screen.
    window.mOpenNowPlaying = function () {
        openNp();
    };

    // ============================================================
    // Song sheet (phase 6): layer registration (mToast/mArmDelete are
    // defined above the app-shell gate — the sheet serves the app too)
    // ============================================================
    // The open sheet is a history layer: hardware back closes it first.
    // backOneLayer's latch stops the backdrop onclick + document outside-
    // click pair (same tick) from traversing history twice.
    let songSheetOpen = false;
    const origCloseSendMenu = window.closeSendMenu;
    window.closeSendMenu = function () {
        // The sheet (and its playlist-picker page, a layer of its own) closes
        // through history: pop back to below the sheet in one traversal.
        const sheetAt = layerStack.findIndex((l) => l.name === 'songSheet');
        if (onPhone() && songSheetOpen && sheetAt >= 0
            && layerStack.slice(sheetAt).every((l) => l.name === 'songSheet' || l.name === 'songPicker')) {
            popToDepth(sheetAt);
            return;
        }
        songSheetOpen = false;
        return origCloseSendMenu.apply(this, arguments);
    };

    // The sheet's "Add to playlist…" page is a step: back returns to the
    // sheet's first page.
    const origShowSongPicker = window.showSongPicker;
    const origHideSongPicker = window.hideSongPicker;
    window.showSongPicker = function () {
        const out = origShowSongPicker.apply(this, arguments);
        if (onPhone() && songSheetOpen && topLayerIs('songSheet')) {
            openLayer('songPicker', () => origHideSongPicker());
        }
        return out;
    };
    window.hideSongPicker = function () {
        if (topLayerIs('songPicker')) {
            backOneLayer();
            return;
        }
        return origHideSongPicker.apply(this, arguments);
    };

    // The row "Show in playlist" points at, while it's lit.
    let rowFlash = null;
    function markFlashRow() {
        if (!rowFlash || performance.now() > rowFlash.until) {
            rowFlash = null;
            return;
        }
        const row = document.querySelector(`#songList .song-list-item[data-index="${rowFlash.index}"]:not(.discover-item)`);
        if (!row || row.classList.contains('m-row-flash')) return;
        if (document.activeElement === document.body) {
            const more = row.querySelector('.song-send-btn');
            if (more) more.focus({ preventScroll: true });
        }
        const left = rowFlash.until - performance.now();
        row.style.animationDelay = `-${Math.round(1600 - left)}ms`;
        row.classList.add('m-row-flash');
        // A timer, not animationend: reduced motion has no animation.
        setTimeout(() => {
            row.classList.remove('m-row-flash');
            row.style.animationDelay = '';
        }, left);
    }
    const flashPrevRebuild = window.rebuildSongList;
    window.rebuildSongList = function () {
        const out = flashPrevRebuild.apply(this, arguments);
        markFlashRow();
        return out;
    };

    // Point at row `index` of the list on screen (scrolled to, lit). Also the
    // Search chip's answer when the player moved on while its playlist loaded.
    function flashRow(index) {
        const row = document.querySelector(`#songList .song-list-item[data-index="${index}"]:not(.discover-item)`);
        if (!row) return null;
        row.scrollIntoView({ block: 'center' });
        // The list is often rebuilt right after (Discover starting):
        // the rebuild wrapper re-marks the row until the flash is over.
        rowFlash = { index, until: performance.now() + 1600 };
        markFlashRow();
        return row;
    }
    window.mFlashRow = flashRow;

    // Now Playing's song menu → "Show in playlist": close Now Playing, open
    // the playlist screen if it isn't, and point at the song.
    window.mGoToSong = function (index) {
        const show = () => {
            if (!playerViewActive()) window.openPlayerView();
            const reveal = () => {
                const row = flashRow(index);
                if (!row) return;
                // Keyboard and screen-reader users land on the song too.
                const more = row.querySelector('.song-send-btn');
                if (more) more.focus({ preventScroll: true });
            };
            requestAnimationFrame(() => requestAnimationFrame(reveal));
        };
        const npAt = layerStack.findIndex((l) => l.name === 'np');
        if (viewedId !== null) {
            // Another playlist is on screen: the playing one takes its place
            // first. Find and reorder belonged to the other list, so they
            // close too (back to just above the playlist screen).
            collapseView();
            const plAt = layerStack.findIndex((l) => l.name === 'playlist');
            if (npAt >= 0) {
                afterBack.push(show);
                popToDepth(plAt >= 0 && plAt < npAt ? plAt + 1 : npAt);
            } else {
                window.closeSendMenu();
                show();
            }
            return;
        }
        // A find query hiding the song would leave nothing to point at: close
        // find too (that clears it).
        const findAt = layerStack.findIndex((l) => l.name === 'find');
        const target = document.querySelector(`#songList .song-list-item[data-index="${index}"]:not(.discover-item)`);
        const hidden = !!target && target.classList.contains('m-filtered-out');
        if (npAt >= 0) {
            afterBack.push(show);
            popToDepth(hidden && findAt >= 0 && findAt < npAt ? findAt : npAt);
        } else {
            window.closeSendMenu();
            show();
        }
    };
    const origShowSendMenu = window.showSendMenu;
    window.showSendMenu = function () {
        // Re-entrant open (e.g. NP kebab while a row sheet is up): close the
        // old sheet's DOM synchronously and REUSE its history entry — the
        // deferred history.back() path would orphan the old menu node.
        const hadSheet = songSheetOpen;
        if (hadSheet) {
            songSheetOpen = false;
            origCloseSendMenu();
        }
        const out = origShowSendMenu.apply(this, arguments);
        if (onPhone() && document.querySelector('.send-menu-sheet')) {
            songSheetOpen = true;
            if (!hadSheet) {
                openLayer('songSheet', () => {
                    if (songSheetOpen) {
                        songSheetOpen = false;
                        origCloseSendMenu();
                    }
                });
            }
        }
        return out;
    };

    // NP header kebab: song options for the current track. During smart-
    // shuffle radio, the playing track is NOT in the playlist and
    // currentSongIndex points at an unrelated song — never open the sheet
    // on the wrong target.
    const npKebab = document.getElementById('mNpKebab');
    if (npKebab) {
        npKebab.addEventListener('click', () => {
            if (typeof currentRadioSong !== 'undefined' && currentRadioSong) {
                if (window.mToast) mToast('Radio track — not in this playlist');
                return;
            }
            if (!songsData[currentSongIndex]) return; // the playlist emptied
            // The current row hasn't started: what plays is from elsewhere
            if (!currentRowStarted()) {
                if (window.mToast) mToast('This song isn\'t in the playlist');
                return;
            }
            window.showSendMenu(npKebab, currentSongIndex);
        });
    }

    // ============================================================
    // Full-screen lyrics (phase 7)
    // ============================================================
    function syncLyricsToggle() {
        const btn = document.getElementById('mLyricsExpand');
        if (!btn) return;
        const open = document.body.classList.contains('m-lyrics-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Collapse lyrics' : 'Expand lyrics');
    }

    function openLyrics() {
        if (!onPhone() || document.body.classList.contains('m-lyrics-open')) return;
        document.body.classList.add('m-lyrics-open');
        syncLyricsToggle();
        openLayer('lyrics', () => {
            document.body.classList.remove('m-lyrics-open');
            syncLyricsToggle();
        });
    }

    function toggleLyricsExpand() {
        if (topLayerIs('lyrics')) backOneLayer();
        else openLyrics();
    }

    const lyricsExpand = document.getElementById('mLyricsExpand');
    if (lyricsExpand) lyricsExpand.addEventListener('click', toggleLyricsExpand);

    // Tapping the collapsed preview card expands too — but taps on lyric
    // lines keep their seek behavior, and the control row keeps its own.
    const lyricsZone = document.querySelector('.sleeve-lyrics-zone');
    if (lyricsZone) {
        lyricsZone.addEventListener('click', (e) => {
            if (!onPhone() || document.body.classList.contains('m-lyrics-open')) return;
            if (e.target.closest && e.target.closest('.lyrics-line, .lyrics-controls')) return;
            openLyrics();
        });
    }

    // The NP chevron closes the topmost NP-owned layer: lyrics first
    if (npCollapse) {
        npCollapse.addEventListener('click', () => {
            if (topLayerIs('lyrics')) backOneLayer();
        }, true);
    }

    // ---- Transport
    if (dockPlay) dockPlay.addEventListener('click', () => toggleMusic());
    if (dockNext) dockNext.addEventListener('click', () => nextSong());

    // ---- Info area: tap opens the player; horizontal swipe = prev/next.
    if (dockInfo) {
        let startX = 0, startY = 0, startT = 0, dx = 0, dy = 0, tracking = false, horizontal = false;
        // Whether the last pointer gesture on the info area was a tap.
        let lastWasTap = false;

        dockInfo.addEventListener('pointerdown', (e) => {
            if (!onPhone()) return;
            tracking = true;
            horizontal = false;
            startX = e.clientX;
            startY = e.clientY;
            startT = performance.now();
            dx = 0;
            dy = 0;
        });

        dockInfo.addEventListener('pointermove', (e) => {
            if (!tracking) return;
            dx = e.clientX - startX;
            dy = e.clientY - startY;
            if (!horizontal && Math.abs(dx) > 10 && Math.abs(dx) > 2 * Math.abs(dy)) {
                horizontal = true;
                dockInfo.setPointerCapture(e.pointerId);
            }
            if (horizontal) {
                const drag = Math.max(-72, Math.min(72, dx * 0.6));
                dock.style.transform = 'translateX(' + drag + 'px)';
            }
        });

        const settle = (e) => {
            if (!tracking) return;
            tracking = false;
            const dt = Math.max(1, performance.now() - startT);
            dock.style.transform = '';
            if (horizontal) {
                const velocity = Math.abs(dx) / dt;
                if (Math.abs(dx) >= 48 || velocity > 0.4) {
                    if (dx < 0) nextSong(); else prevSong();
                }
            }
            // Cancelled pointers and vertical flicks (touch-action:pan-y
            // hands them to the scroller) must never count as taps.
            lastWasTap = !horizontal && e.type !== 'pointercancel'
                && Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 500;
            dx = 0;
            dy = 0;
            horizontal = false;
        };
        dockInfo.addEventListener('pointerup', settle);
        dockInfo.addEventListener('pointercancel', settle);

        // Tap: open the Now Playing sheet over the current screen — on the
        // click, not on pointerup. The dock hides as the sheet opens, and a
        // tap's click comes after pointerup: it would land on whatever was
        // under the dock (a song row, a search hit) and play that instead.
        // A keyboard click (detail 0) has no pointer gesture to check.
        dockInfo.addEventListener('click', (e) => {
            if (!onPhone()) return;
            if (e.detail !== 0 && !lastWasTap) return;
            lastWasTap = false;
            if (window.mOpenNowPlaying) window.mOpenNowPlaying();
        });
    }

    // ---- Leaving phone widths: strip mobile-only state so desktop is clean.
    mq.addEventListener('change', (e) => {
        if (!e.matches) {
            teardownPhoneLayers();
            dock.style.transform = '';
            dock.classList.remove('m-dock-hidden');
            document.body.classList.remove('m-np-open', 'm-lyrics-open', 'm-scrubbing');
            window.__mScrubbing = false;
            // Leaving portrait closes find (a layer), which clears its query.
        } else if (modalOpen.search) {
            // Back to portrait with the landscape search open: carry on in
            // the Search tab (the switch waits for the modal's back).
            window.hideSearchModal();
            switchTab('search');
        }
        // A find query typed in landscape (where the field always shows) must
        // not leave the portrait list filtered behind a closed find.
        if (e.matches && filterInput && filterInput.value && !findOpen()) {
            filterInput.value = '';
            applyRowFilter();
        }
        setBackLabel();
        updateDockVisibility();
    });
})();
