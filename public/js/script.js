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
    const ORIGIN_ENDPOINTS = /^\/(save-music|spotify|spotify-resolve|search-youtube|scan-cover|settings|upload-song)(\/|\?|$)/;
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

function nextSong() {
    if (isChangingSong || songsData.length === 0) return;

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
        : (currentSongIndex + 1) % songsData.length;

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
        const prevIndex = (currentSongIndex - 1 + songsData.length) % songsData.length;
        switchSong(prevIndex);
    }
}

// Switch song from sidebar
async function switchSong(index) {
    if (index === currentSongIndex && !currentRadioSong) return;
    if (isChangingSong) return;

    isChangingSong = true;
    const song = songsData[index];

    // Clear radio state — we're playing a playlist song now
    currentRadioSong = null;
    removeRadioSidebarItem();

    // Update sidebar active state
    document.querySelectorAll('.song-list-item:not(.radio-song-item)').forEach((item, i) => {
        item.classList.toggle('active', i === index);
    });

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

    // Save to server
    await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch', index: index })
    });

    currentSongIndex = index;
    updateLoopSongLabel();
    updateAmpDisplay();
    loadLyricsForSong(song);
    isChangingSong = false;

    // In smart shuffle, refresh radio recommendations if pool is low
    if (shuffleMode === 'smart' && radioPool.length < 3 && song.youtube_id) {
        fetchRadioRecommendations(song.youtube_id);
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

    // Fetch playlist from server
    const response = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switchPlaylist', playlist: playlistId })
    });
    const result = await response.json();

    if (result.success) {
        // Update now-playing indicator on crate
        document.querySelectorAll('.record-card.now-playing').forEach(c => c.classList.remove('now-playing'));
        const newActive = document.querySelector(`.record-card[data-playlist="${playlistId}"]`);
        if (newActive) newActive.classList.add('now-playing');

        // Update local data
        activePlaylistId = playlistId;
        songsData = result.playlist.songs;
        currentSongIndex = result.playlist.currentIndex || 0;
        if (shuffleMode !== 'off') buildShuffleQueue();
        // Clear smart shuffle state on playlist switch
        radioPool = [];
        smartShuffleNextIsRadio = false;
        currentRadioSong = null;
        removeRadioSidebarItem();
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
        const songListEl = document.getElementById('songList');
        if (songListEl) songListEl.scrollTop = 0;
        updateOfflineButton();

        // Update track count
        const trackCountEl = document.querySelector('.sidebar-track-count');
        if (trackCountEl) trackCountEl.textContent = songsData.length + ' tracks';

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
    }

    if (!window.ReactNativeWebView) {
        // Wait for pull animation
        const pullMs = window.matchMedia('(max-width: 600px)').matches ? 250 : 500;
        await new Promise(resolve => setTimeout(resolve, pullMs));
    }

    // Transition to player view
    vinylCrate.classList.add('hidden');
    playerView.classList.add('active');

    // Reset the vinyl animation
    if (clickedRecord) {
        clickedRecord.classList.remove('pulling');
    }

    isChangingPlaylist = false;
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
let radioProbePlayer = null;
let isFetchingRadio = false;

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
        // Clear smart shuffle state
        radioPool = [];
        smartShuffleNextIsRadio = false;
        currentRadioSong = null;
        removeRadioSidebarItem();
    }
}

function buildShuffleQueue() {
    // Create array of all indices except the current song
    shuffleQueue = [];
    for (let i = 0; i < songsData.length; i++) {
        if (i !== currentSongIndex) shuffleQueue.push(i);
    }
    // Fisher-Yates shuffle
    for (let i = shuffleQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]];
    }
}

function getRandomSongIndex() {
    if (songsData.length <= 1) return 0;
    // If queue is empty, rebuild it
    if (shuffleQueue.length === 0) {
        buildShuffleQueue();
    }
    return shuffleQueue.shift();
}

// ============================================================
// SMART SHUFFLE — RADIO PROBE & PLAYBACK
// ============================================================

function fetchRadioRecommendations(videoId) {
    if (isFetchingRadio || !videoId) return;
    isFetchingRadio = true;
    showRadioLoading(true);

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
                    attempts++;
                    try {
                        const playlist = event.target.getPlaylist();
                        if (playlist && playlist.length > 1) {
                            clearInterval(poll);
                            processRadioPlaylist(playlist, videoId);
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
                        radioProbePlayer = null;
                        isFetchingRadio = false;
                        showRadioLoading(false);
                    }
                }, 500);
            },
            onError: function() {
                isFetchingRadio = false;
                showRadioLoading(false);
                try { if (radioProbePlayer) { radioProbePlayer.destroy(); } } catch(e) {}
                radioProbePlayer = null;
            }
        }
    });
}

function processRadioPlaylist(videoIds, sourceVideoId) {
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

    fetchRadioMetadata(toFetch);
}

async function fetchRadioMetadata(videoIds) {
    let fetched = 0;
    for (const videoId of videoIds) {
        try {
            const resp = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
            if (resp.ok) {
                const data = await resp.json();
                // Parse "Artist - Title" format, fallback to full title
                let title = data.title || 'Unknown';
                let artist = data.author_name || 'Unknown';
                const dashIdx = title.indexOf(' - ');
                if (dashIdx > 0) {
                    artist = title.substring(0, dashIdx).trim();
                    title = title.substring(dashIdx + 3).trim();
                }
                // Clean common suffixes from title
                title = title.replace(/\s*\(official\s*(music\s*)?video\)/i, '')
                             .replace(/\s*\[official\s*(music\s*)?video\]/i, '')
                             .replace(/\s*\(lyric(s)?\s*video\)/i, '')
                             .replace(/\s*\[lyric(s)?\s*video\]/i, '')
                             .replace(/\s*\(audio\)/i, '')
                             .replace(/\s*\[audio\]/i, '');
                radioPool.push({
                    title,
                    artist,
                    cover: data.thumbnail_url || '',
                    youtube_id: videoId
                });
                fetched++;
            }
        } catch(e) { /* skip failed fetches */ }
    }
    isFetchingRadio = false;
    showRadioLoading(false);
}

function showRadioLoading(show) {
    let indicator = document.getElementById('radioLoadingIndicator');
    if (show) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'radioLoadingIndicator';
            indicator.className = 'radio-loading';
            indicator.innerHTML = '<span class="radio-loading-dot"></span><span class="radio-loading-dot"></span><span class="radio-loading-dot"></span> finding songs...';
            const songList = document.getElementById('songList');
            if (songList) songList.parentElement.insertBefore(indicator, songList);
        }
        indicator.style.display = '';
    } else {
        if (indicator) indicator.style.display = 'none';
    }
}

async function playRadioSong(song) {
    if (isChangingSong) return;
    isChangingSong = true;

    currentRadioSong = song;

    // Remove previous radio item, add new one
    removeRadioSidebarItem();
    addRadioSidebarItem(song);

    // Deactivate all playlist items in sidebar
    document.querySelectorAll('.song-list-item:not(.radio-song-item)').forEach(item => item.classList.remove('active'));

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
    isChangingSong = false;
}

function addRadioSidebarItem(song) {
    const songList = document.getElementById('songList');
    if (!songList) return;
    const li = document.createElement('li');
    li.className = 'song-list-item radio-song-item active';
    const radioCover = safeUrl(song.cover);
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
            <button class="song-save-btn" onclick="event.stopPropagation(); saveRadioSong()" title="Add to playlist">+</button>
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

    const response = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', song })
    });
    const result = await response.json();

    if (result.success) {
        songsData.push(song);
        if (shuffleMode !== 'off') buildShuffleQueue();
        rebuildSongList();
        updateTrackCount();
        // Re-add radio item since rebuild cleared it, then show saved state
        if (currentRadioSong) {
            addRadioSidebarItem(currentRadioSong);
            const saveBtn = document.querySelector('.radio-song-item .song-save-btn');
            if (saveBtn) {
                saveBtn.textContent = '✓';
                saveBtn.disabled = true;
            }
        }
    }
}

function playNextByLoop() {
    if (loopMode === 'single') {
        // Replay current song (even if it's a radio song)
        if (ytPlayer && ytPlayer.seekTo) {
            ytPlayer.seekTo(0);
            ytPlayer.playVideo();
        }
    } else if (loopMode === 'playlist') {
        // Smart shuffle: alternate playlist ↔ radio
        if (shuffleMode === 'smart' && smartShuffleNextIsRadio && radioPool.length > 0) {
            songHistory.push(currentRadioSong ? {type: 'radio', song: currentRadioSong} : currentSongIndex);
            const radioSong = radioPool.shift();
            smartShuffleNextIsRadio = false;
            playRadioSong(radioSong);
            return;
        }

        // Play next playlist song (shuffle-aware)
        songHistory.push(currentRadioSong ? {type: 'radio', song: currentRadioSong} : currentSongIndex);
        const nextIndex = shuffleMode !== 'off'
            ? getRandomSongIndex()
            : (currentSongIndex + 1) % songsData.length;

        if (shuffleMode === 'smart') {
            smartShuffleNextIsRadio = true;
        }

        switchSong(nextIndex);
    }
    // 'off' = do nothing, song ends
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
                            event.target.cueVideoById(source);
                        }
                    }
                }
            },
            'onStateChange': onPlayerStateChange,
            'onError': function(event) {
                console.warn('YouTube player error:', event.data);
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

    // Keep the lock-screen play/pause button in sync
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState =
            event.data === YT.PlayerState.PLAYING ? 'playing' : 'paused';
    }

    var isApp = !!window.ReactNativeWebView;

    if (event.data === YT.PlayerState.PLAYING) {
        if (vinyl) vinyl.classList.add('playing');
        if (tonearm) tonearm.classList.add('playing');
        if (platterVinyl) platterVinyl.classList.add('spinning');
        if (miniTonearm) miniTonearm.classList.add('playing');
        if (led) led.classList.add('on');
        if (eqVis) eqVis.classList.add('active');
        if (playBtn) {
            if (isApp) { playBtn.textContent = '||'; } else { playBtn.innerHTML = '&#9208;'; }
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
            if (isApp) { playBtn.textContent = '\u25B6'; } else { playBtn.innerHTML = '&#9654;'; }
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
            if (isApp) { playBtn.textContent = '\u25B6'; } else { playBtn.innerHTML = '&#9654;'; }
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
    const text = (currentRadioSong ? '📻 ' : '') + song.artist + ' - ' + song.title;
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
    // Check if returning from Spotify OAuth
    if (new URLSearchParams(window.location.search).get('spotify') === 'connected') {
        checkSpotifyStatus();
    }
});

function restartSong() {
    if (!ytPlayer || !ytPlayer.seekTo) return;
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
    resetSleeveProgress();
    clearActiveLyricHighlight();
}

function toggleMusic() {
    const song = currentRadioSong || songsData[currentSongIndex];

    // Activate the right player for this song
    if (song) activatePlayerForSong(song);

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
    } else if (state === YT.PlayerState.PAUSED) {
        // Resume from pause
        ytPlayer.playVideo();
    } else {
        // Unstarted (-1), cued (5), ended (0), or buffering (3)
        const source = getPlaybackSource(song);
        if (song && source) {
            ytPlayer.loadVideoById(source);
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
    if (title) title.textContent = opts.wizard ? 'Add your first song' : 'Add music';
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
    const parts = clean.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
        return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    const cleanChannel = String(channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
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

    // A pasted link (or bare video ID) isn't a search — hand it to the
    // manual form, prefilled. NB extractYoutubeId can't gate this: it
    // returns its raw input as a fallback, so it's truthy for any text.
    const looksLikeLink = /^https?:\/\//i.test(q)
        || /^(www\.)?(youtube\.com|youtu\.be)\//i.test(q)
        || /^[a-zA-Z0-9_-]{11}$/.test(q);
    if (looksLikeLink) {
        const manual = document.getElementById('addSongManualDetails');
        if (manual) manual.open = true;
        const urlInput = document.getElementById('addSongYoutube');
        if (urlInput) {
            urlInput.value = q;
            urlInput.dispatchEvent(new Event('input'));  // triggers title autofill
        }
        renderAddSearchResults([], 'Link detected — finish it below.');
        return;
    }

    const seq = ++addSearchSeq;
    renderAddSearchResults([], 'Searching…');
    try {
        const resp = await fetch('/search-youtube', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ query: q }),
        });
        const data = await resp.json();
        if (seq !== addSearchSeq) return;  // a newer search superseded this one
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
    if (results === null) { box.innerHTML = ''; return; }
    let html = status ? `<div class="search-result-status">${escapeHtml(status)}</div>` : '';
    addSearchResults.forEach((r, i) => {
        const parsed = parseYoutubeResultTitle(r.title, r.channel);
        const thumb = safeUrl(r.thumbnail);
        html += `<button type="button" class="search-result-row" onclick="pickAddSearchResult(${i})">
            ${thumb ? `<img class="search-result-thumb" src="${escapeHtml(thumb)}" alt="" loading="lazy">` : '<span class="search-result-thumb"></span>'}
            <span class="search-result-meta">
                <span class="search-result-title">${escapeHtml(parsed.title)}</span>
                <span class="search-result-artist">${escapeHtml(parsed.artist)}</span>
            </span>
            <span class="search-result-play">&#9654;</span>
        </button>`;
    });
    box.innerHTML = html;
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
    // youtube.com/embed/ID
    match = input.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (match) return match[1];
    // raw 11-char ID
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    return input;
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

// Auto-fetch info when URL is pasted or typed (source-aware)
document.getElementById('addSongYoutube')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (musicSource === 'youtube' && val.length >= 11) {
        fetchYoutubeInfo(val);
    } else if (musicSource === 'spotify' && val.length >= 10) {
        fetchSpotifyInfo(val);
    }
    // MP3 mode: no auto-fetch, user fills in metadata manually
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
        artwork.push({ src: new URL(cover, location.origin).href, sizes: '512x512' });
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
        navigator.mediaSession.setActionHandler('play', safe(() => {
            if (!ytPlayer || !ytPlayer.getPlayerState || ytPlayer.getPlayerState() !== 1) toggleMusic();
        }));
        navigator.mediaSession.setActionHandler('pause', safe(() => {
            if (ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === 1) toggleMusic();
        }));
        navigator.mediaSession.setActionHandler('previoustrack', safe(() => prevSong()));
        navigator.mediaSession.setActionHandler('nexttrack', safe(() => nextSong()));
        navigator.mediaSession.setActionHandler('seekto', (details) => {
            try {
                if (ytPlayer && ytPlayer.seekTo && details.seekTime != null) {
                    ytPlayer.seekTo(details.seekTime, true);
                }
            } catch (e) {}
        });
    } catch (e) { /* some handlers unsupported on some platforms */ }
})();

function buildSongListItem(song, index) {
    const itemCover = safeUrl(song.cover);
    return `
        <li class="song-list-item ${index === currentSongIndex ? 'active' : ''}"
            data-index="${index}"
            data-src="${song.mp3_url ? 'mp3' : (song.youtube_id ? 'yt' : 'spotify')}"
            onclick="switchSong(${index})">
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
            <span class="song-list-num">${String(index + 1).padStart(2, '0')}</span>
            <div class="song-actions">
                <button class="song-send-btn" onclick="event.stopPropagation(); showSendMenu(this, ${index})" title="Send to playlist">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                        <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                    </svg>
                </button>
                <button class="song-delete-btn" onclick="event.stopPropagation(); deleteSong(${index})" title="Remove song">&times;</button>
            </div>
        </li>`;
}

function rebuildSongList() {
    const songList = document.getElementById('songList');
    if (songsData.length === 0) {
        songList.innerHTML = `
            <li class="song-list-empty">
                <div class="song-list-empty-icon">&#9834;</div>
                <div class="song-list-empty-text">This playlist is empty</div>
                <button class="song-list-empty-add" onclick="showAddSongModal()">+ Add a song</button>
            </li>`;
        return;
    }
    // The innerHTML swap resets scroll — a delete halfway down a long list
    // must not fling the user back to the top.
    const scrollTop = songList.scrollTop;
    songList.innerHTML = songsData.map((song, index) => buildSongListItem(song, index)).join('');
    songList.scrollTop = scrollTop;
}

function updateTrackCount() {
    const trackCountEl = document.querySelector('.sidebar-track-count');
    if (trackCountEl) trackCountEl.textContent = songsData.length + ' tracks';
    // Update crate badge
    const crateCard = document.querySelector(`.record-card[data-playlist="${activePlaylistId}"]`);
    if (crateCard) {
        const badge = crateCard.querySelector('.cover-badge');
        if (badge) badge.textContent = songsData.length;
    }
    // Keep meta covers in sync
    refreshMetaCovers();
    // Offline toggle only shows for playlists with uploaded/MP3 songs
    if (typeof updateOfflineButton === 'function') updateOfflineButton();
}

function refreshMetaCovers() {
    const meta = playlistsMeta[activePlaylistId];
    if (!meta) return;
    const seen = new Set();
    meta.covers = [];
    songsData.forEach((s, idx) => {
        if (s.cover && !seen.has(s.cover)) {
            seen.add(s.cover);
            meta.covers.push({ index: idx, url: s.cover, title: s.title });
        }
    });
    meta.songCount = songsData.length;
}

async function addSongToPlaylist(e) {
    e.preventDefault();
    const sourceValue = document.getElementById('addSongYoutube').value.trim();
    const title = document.getElementById('addSongTitle').value.trim();
    const artist = document.getElementById('addSongArtist').value.trim();
    const album = document.getElementById('addSongAlbum').value.trim();
    const cover = document.getElementById('addSongCover').value.trim();

    if (!title || !sourceValue) return;

    let song;
    if (musicSource === 'mp3') {
        song = { title, artist, album, cover, youtube_id: '', mp3_url: sourceValue };
    } else if (musicSource === 'spotify') {
        // Spotify: metadata only, no direct playback source
        song = { title, artist, album, cover, youtube_id: '', mp3_url: '' };
    } else {
        // YouTube (default)
        const youtubeId = extractYoutubeId(sourceValue);
        song = { title, artist, album, cover, youtube_id: youtubeId, mp3_url: '' };
    }

    await saveAndPlaySong(song);
}

// Persist a new song, then start it — shared by the manual form and the
// search results. Returns false if the save failed (caller re-enables UI).
async function saveAndPlaySong(song) {
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

async function deleteSong(index, opts) {
    const victim = songsData[index];
    if (!victim) return;
    const label = [victim.title, victim.artist].filter(Boolean).join(' — ');
    // skipConfirm: the mobile song sheet already two-tap confirmed
    if (!(opts && opts.skipConfirm) && !confirm(`Remove "${label}" from this playlist?`)) return;

    const response = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', index })
    });
    const result = await response.json();

    if (result.success) {
        const wasPlaying = index === currentSongIndex;
        songsData.splice(index, 1);
        currentSongIndex = result.newIndex;
        if (shuffleMode !== 'off') buildShuffleQueue();
        rebuildSongList();
        updateTrackCount();
        if (songsData.length === 0) {
            showEmptyPlaylistState();
        } else if (wasPlaying) {
            const song = songsData[currentSongIndex];
            updateSongDisplay(song);
            playSongSource(song, true);
        }
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
    document.getElementById('playlistEditModal').classList.add('active');
    document.getElementById('playlistEditName').focus();
}

// Same modal, create mode: no cover picker (no songs yet), no delete button.
function showPlaylistCreateModal() {
    creatingPlaylist = true;
    editingPlaylistId = '';
    document.getElementById('playlistEditModalTitle').textContent = 'New Playlist';
    document.getElementById('playlistEditSaveBtn').textContent = 'Create';
    document.getElementById('coverArtGroup').style.display = 'none';
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

async function deleteCurrentPlaylist() {
    const id = editingPlaylistId;
    const meta = playlistsMeta[id];
    if (!id || !meta) return;
    const trackNote = meta.songCount > 0 ? ` and its ${meta.songCount} song${meta.songCount === 1 ? '' : 's'}` : '';
    if (!confirm(`Delete "${meta.name}"${trackNote}? This cannot be undone.`)) return;

    const response = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deletePlaylist', playlist: id })
    });
    const result = await response.json();
    if (result.success) {
        // Crate cards, conveyor rows, and recents all shift — let the server re-render.
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
        && document.getElementById('playlistEditModal')) {
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
        }
        if (colorChanged) {
            card.style.setProperty('--card-color', selectedEditColor);
            const badge = card.querySelector('.cover-badge');
            if (badge) badge.style.background = selectedEditColor;
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

    // Update sidebar title if this is the active playlist
    if (id === activePlaylistId) {
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
    if (activeSendMenu && !activeSendMenu.contains(e.target)) {
        closeSendMenu();
    }
}

function showSendMenu(btn, songIndex) {
    closeSendMenu();
    const isApp = !!window.ReactNativeWebView || new URLSearchParams(window.location.search).has('app');
    // Phones get a bottom sheet (the widened app-mode branch); desktop
    // keeps the anchored popover.
    const useSheet = isApp || window.matchMedia('(max-width: 600px) and (pointer: coarse)').matches;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'send-menu';
    if (useSheet) menu.classList.add('send-menu-sheet');

    let html = '';
    if (useSheet) {
        const sheetSong = songsData[songIndex];
        if (sheetSong) {
            const sheetCover = safeUrl(sheetSong.cover);
            html += `<div class="send-menu-song">
                ${sheetCover
                    ? `<img class="send-menu-song-cover" src="${escapeHtml(sheetCover)}" alt="">`
                    : '<div class="send-menu-song-cover send-menu-song-cover-empty">&#9834;</div>'}
                <div class="send-menu-song-meta">
                    <div class="send-menu-song-title">${escapeHtml(sheetSong.title || '')}</div>
                    <div class="send-menu-song-artist">${escapeHtml(sheetSong.artist || '')}</div>
                </div>
            </div>`;
        }
    }

    html += '<div class="send-menu-title">Send to...</div>';
    for (const [id, meta] of Object.entries(playlistsMeta)) {
        if (id === activePlaylistId) continue;
        const idJs = JSON.stringify(String(id));
        const colorAttr = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#888';
        html += `
            <div class="send-menu-item" onclick="event.stopPropagation(); moveSongTo(${escapeHtml(idJs)}, ${songIndex})" style="cursor:pointer">
                <span class="send-menu-dot" style="background:${colorAttr}"></span>
                <span class="send-menu-name">${escapeHtml(meta.name)}</span>
            </div>`;
    }

    if (useSheet) {
        // Copy keeps the song here too — the non-destructive alternative
        // the popover never offered (first call sites for copySongTo).
        let copyRows = '';
        for (const [id, meta] of Object.entries(playlistsMeta)) {
            if (id === activePlaylistId) continue;
            const idJs = JSON.stringify(String(id));
            const colorAttr = /^#[0-9a-fA-F]{6}$/.test(meta.color || '') ? meta.color : '#888';
            copyRows += `
                <div class="send-menu-item" onclick="event.stopPropagation(); copySongTo(${escapeHtml(idJs)}, ${songIndex})" style="cursor:pointer">
                    <span class="send-menu-dot" style="background:${colorAttr}"></span>
                    <span class="send-menu-name">${escapeHtml(meta.name)}</span>
                </div>`;
        }
        if (copyRows) {
            html += '<div class="send-menu-divider"></div>';
            html += '<div class="send-menu-title">Keep a copy in...</div>' + copyRows;
        }
        html += '<div class="send-menu-divider"></div>';
        html += `<div class="send-menu-item send-menu-delete" onclick="event.stopPropagation(); mArmDelete(this, ${songIndex})">
            <span class="send-menu-delete-icon">&#10005;</span>
            <span class="send-menu-name">Remove from this playlist</span>
        </div>`;
        html += `<div class="send-menu-cancel" onclick="event.stopPropagation(); closeSendMenu()">Cancel</div>`;
    }

    menu.innerHTML = html;

    if (useSheet) {
        const smBackdrop = document.createElement('div');
        smBackdrop.className = 'send-menu-backdrop';
        smBackdrop.onclick = function() { closeSendMenu(); };
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
            menu.style.top = (rect.top - menuRect.height - 4) + 'px';
        }
        // Narrow windows: rect.left - 160 can land off-screen left
        if (menu.getBoundingClientRect().left < 8) {
            menu.style.left = '8px';
        }
    }

    activeSendMenu = menu;
    setTimeout(() => document.addEventListener('click', onSendMenuOutsideClick), 0);
}

async function copySongTo(toPlaylist, songIndex) {
    const response = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'copySong', fromPlaylist: activePlaylistId, toPlaylist, songIndex })
    });
    const result = await response.json();
    if (result.success) {
        playlistsMeta[toPlaylist].songCount = result.toCount;
        // Update target badge on crate
        const targetCard = document.querySelector(`.record-card[data-playlist="${toPlaylist}"]`);
        if (targetCard) {
            const badge = targetCard.querySelector('.cover-badge');
            if (badge) badge.textContent = result.toCount;
        }
        // Flash the song item
        const songItem = document.querySelector(`.song-list-item[data-index="${songIndex}"]`);
        if (songItem) {
            songItem.classList.add('copied-flash');
            setTimeout(() => songItem.classList.remove('copied-flash'), 600);
        }
        if (window.mToast && window.matchMedia('(max-width: 600px)').matches) {
            const toMeta = playlistsMeta[toPlaylist];
            mToast('Copied to ' + (toMeta ? toMeta.name : 'playlist'));
        }
    }
    closeSendMenu();
}

async function moveSongTo(toPlaylist, songIndex) {
    const response = await fetch('/save-music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'moveSong', fromPlaylist: activePlaylistId, toPlaylist, songIndex })
    });
    const result = await response.json();
    if (result.success) {
        const wasPlaying = songIndex === currentSongIndex;
        songsData.splice(songIndex, 1);
        currentSongIndex = result.newIndex;
        if (shuffleMode !== 'off') buildShuffleQueue();
        playlistsMeta[activePlaylistId].songCount = result.fromCount;
        playlistsMeta[toPlaylist].songCount = result.toCount;
        rebuildSongList();
        updateTrackCount();
        // Update target badge
        const targetCard = document.querySelector(`.record-card[data-playlist="${toPlaylist}"]`);
        if (targetCard) {
            const badge = targetCard.querySelector('.cover-badge');
            if (badge) badge.textContent = result.toCount;
        }
        if (wasPlaying && songsData.length > 0) {
            const song = songsData[currentSongIndex];
            updateSongDisplay(song);
            playSongSource(song, true);
        }
        if (window.mToast && window.matchMedia('(max-width: 600px)').matches) {
            const toMeta = playlistsMeta[toPlaylist];
            mToast('Moved to ' + (toMeta ? toMeta.name : 'playlist'));
        }
    }
    closeSendMenu();
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
    // Clear any leftover form status from a previous visit
    const nameStatus = document.getElementById('settingsNameStatus');
    if (nameStatus) nameStatus.textContent = '';
    const pwStatus = document.getElementById('settingsPasswordStatus');
    if (pwStatus) pwStatus.textContent = '';
    // Check Spotify status
    checkSpotifyStatus();
}

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

    mp3PlayerProxy = {
        _audio: audio,
        _state: -1,
        loadVideoById: function(url) {
            this._state = 3;
            this._audio.src = url;
            this._audio.play().catch(() => {});
        },
        cueVideoById: function(url) {
            this._state = 5;
            this._audio.src = url;
            this._audio.load();
        },
        playVideo: function() {
            this._audio.play().catch(() => {});
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
async function playSongSource(song, cueOnly) {
    let source = getPlaybackSource(song);
    // Spotify-only track that can't stream via Premium (user isn't premium, or
    // no active device): resolve a matching YouTube video on demand so it still
    // plays. Premium+connected users keep native Spotify playback.
    if (!source && song && song.spotify_id && !song.youtube_id && !song.mp3_url
        && song.title && !(spotifyPremium && spotifyConnected)) {
        source = await resolveYoutubeIdForSong(song);
    }
    if (!source) return;
    activatePlayerForSong(song);
    if (cueOnly) {
        if (ytPlayer && ytPlayer.cueVideoById) ytPlayer.cueVideoById(source);
    } else {
        if (ytPlayer && ytPlayer.loadVideoById) ytPlayer.loadVideoById(source);
    }
}

// Resolve a Spotify-only track to a YouTube video id. The server scrapes YT
// search, caches by spotify_id, and writes youtube_id back onto the song in
// music.json; we also set it in memory so the next play is instant.
async function resolveYoutubeIdForSong(song) {
    try {
        const idx = (typeof songsData !== 'undefined') ? songsData.indexOf(song) : -1;
        const resp = await fetch('/spotify-resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                spotify_id: song.spotify_id || '',
                title: song.title || '',
                artist: song.artist || '',
                playlist_key: (typeof activePlaylistId !== 'undefined') ? activePlaylistId : '',
                song_index: idx
            })
        });
        const data = await resp.json();
        if (data.success && data.youtube_id) {
            song.youtube_id = data.youtube_id;
            return data.youtube_id;
        }
    } catch (e) {}
    return '';
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
function showSpotifyImportModal() {
    spotifyImportData = null;
    document.getElementById('spotifyImportUrl').value = '';
    document.getElementById('spotifyImportPreview').style.display = 'none';
    document.getElementById('spotifyImportLoading').style.display = 'none';
    document.getElementById('spotifyImportModal').classList.add('active');

    // Load user playlists if connected
    if (spotifyConnected) {
        const container = document.getElementById('spotifyUserPlaylists');
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
    } else {
        document.getElementById('spotifyUserPlaylists').style.display = 'none';
    }
}

function hideSpotifyImportModal() {
    document.getElementById('spotifyImportModal').classList.remove('active');
    spotifyImportData = null;
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

function showImportPreview(data) {
    hideImportLoading();
    spotifyImportData = data.songs || [];

    const info = document.getElementById('spotifyImportInfo');
    info.innerHTML = `<div><strong>${escapeHtml(data.name || 'Playlist')}</strong><br><span style="font-size:0.75rem;color:var(--app-text-dim)">${Number(data.total) || 0} tracks</span></div>`;

    const tracks = document.getElementById('spotifyImportTracks');
    tracks.innerHTML = spotifyImportData.slice(0, 50).map((s, i) =>
        `<div class="spotify-import-track"><span class="spotify-import-track-title">${escapeHtml(s.title)}</span> &mdash; ${escapeHtml(s.artist)}</div>`
    ).join('') + (spotifyImportData.length > 50 ? `<div class="spotify-import-track" style="opacity:0.5">+ ${spotifyImportData.length - 50} more...</div>` : '');

    document.getElementById('spotifyImportPreview').style.display = '';
}

async function importSpotifyPlaylist() {
    if (!spotifyImportData || spotifyImportData.length === 0) return;

    // Add each song to the current playlist
    for (const s of spotifyImportData) {
        const song = {
            title: s.title,
            artist: s.artist,
            album: s.album || '',
            cover: s.cover || '',
            youtube_id: '',
            mp3_url: '',
            spotify_id: s.spotify_id || ''
        };

        await fetch('/save-music', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', song })
        });

        songsData.push(song);
    }

    currentSongIndex = songsData.length - spotifyImportData.length;
    if (shuffleMode !== 'off') buildShuffleQueue();
    rebuildSongList();
    updateTrackCount();

    // Display the first imported song
    const firstSong = songsData[currentSongIndex];
    if (firstSong) {
        updateSongDisplay(firstSong);
        playSongSource(firstSong, true);
    }

    hideSpotifyImportModal();
}

// ============================================================
// SPOTIFY METADATA FETCH
// ============================================================

function extractSpotifyId(input) {
    if (!input) return '';
    input = input.trim();
    const match = input.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
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
    for (const img of images) {
        setScanProgress(
            'Identifying album covers...',
            `Processing ${img.name}`,
            Math.round((processed / totalItems) * 100)
        );

        try {
            const base64 = await fileToBase64(img);
            const resp = await fetch('/scan-cover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64, mimeType: img.type })
            });
            const data = await resp.json();

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
            const resp = await fetch('/search-youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            const data = await resp.json();

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

        try {
            const resp = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', song })
            });
            const result = await resp.json();

            if (result.success) {
                songsData.push(song);
            }
        } catch (e) {
            console.warn('Error adding song:', e);
        }
    }

    // Update UI
    if (shuffleMode !== 'off') buildShuffleQueue();
    rebuildSongList();
    updateTrackCount();
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

// The marquee (and its seamless-loop clones) only earns its keep when the
// real cards overflow the row; otherwise the clones show every playlist
// twice. Rows toggle between marquee and a static centered layout.
function updateConveyorMarquee() {
    document.querySelectorAll('.conveyor-row').forEach(row => {
        const track = row.querySelector('.conveyor-track');
        if (!track) return;
        // With clones visible the track is double-width, so halve it to get
        // the real cards' span; with .no-marquee already on, it's exact.
        const realWidth = row.classList.contains('no-marquee')
            ? track.scrollWidth
            : track.scrollWidth / 2;
        row.classList.toggle('no-marquee', realWidth <= row.clientWidth);
    });
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
    if (files.length > 1) {
        const list = [...files];
        document.getElementById('addSongFile').value = '';
        hideAddSongModal();
        importAudioFiles(list);
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

async function importAudioFiles(files) {
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
            const res = await fetch('/save-music', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add', song, link: true })
            });
            const result = await res.json();
            if (result.success && result.linked) {
                const existing = songsData[result.index];
                if (existing) {
                    existing.mp3_url = song.mp3_url;
                    if (!existing.album) existing.album = song.album;
                    if (!existing.cover) existing.cover = song.cover;
                }
                linked++;
            } else if (result.success) {
                songsData.push(song);
                currentSongIndex = result.index;
                added++;
            } else {
                failed++;
            }
        } catch (e) {
            failed++;
        }
    }

    importInProgress = false;
    if (shuffleMode !== 'off') buildShuffleQueue();
    rebuildSongList();
    updateTrackCount();
    if (typeof updateOfflineButton === 'function') updateOfflineButton();
    if (added > 0) {
        const current = songsData[currentSongIndex];
        updateSongDisplay(current);
        playSongSource(current, true); // cue, don't blast the speakers
    }
    const parts = [];
    if (added) parts.push(`imported ${added}`);
    if (linked) parts.push(`linked ${linked} to existing song${linked === 1 ? '' : 's'} for offline`);
    if (failed) parts.push(`${failed} failed`);
    showImportToast(
        parts.length ? parts.join(', ').replace(/^./, c => c.toUpperCase()) : 'Nothing imported',
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

/** Same-origin uploaded audio + covers for the active playlist. */
function offlineUrlsForActivePlaylist() {
    const urls = new Set();
    songsData.forEach(s => {
        if (s.mp3_url && s.mp3_url.startsWith('/media/')) {
            urls.add(s.mp3_url);
            if (s.cover && s.cover.startsWith('/media/')) urls.add(s.cover);
        }
    });
    return [...urls];
}

async function toggleOfflinePlaylist() {
    if (!('caches' in window)) {
        alert('Offline storage is not supported by this browser.');
        return;
    }
    const btn = document.getElementById('offlineBtn');
    const saved = getOfflinePlaylists();

    if (saved.includes(activePlaylistId)) {
        // Un-save: drop this playlist's files from the cache. A file shared
        // with another offline playlist gets re-added next time that playlist
        // is re-toggled — acceptable for a personal library.
        const cache = await caches.open(OFFLINE_MEDIA_CACHE);
        for (const url of offlineUrlsForActivePlaylist()) {
            await cache.delete(url, { ignoreSearch: true });
        }
        setOfflinePlaylists(saved.filter(id => id !== activePlaylistId));
        updateOfflineButton();
        return;
    }

    const urls = offlineUrlsForActivePlaylist();
    if (urls.length === 0) {
        alert('Nothing here can be saved for offline.\n\nOnly uploaded songs (and MP3s hosted on this app) play offline — YouTube and Spotify tracks always need a connection.');
        return;
    }

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

    if (failed === 0) {
        setOfflinePlaylists([...saved, activePlaylistId]);
    } else {
        alert(`Some files failed to download (${failed}/${urls.length}). Try again while online.`);
    }
    updateOfflineButton();
}

function updateOfflineButton() {
    const btn = document.getElementById('offlineBtn');
    if (!btn) return;
    const isSaved = getOfflinePlaylists().includes(activePlaylistId);
    btn.classList.toggle('offline-saved', isSaved);
    btn.title = isSaved ? 'Saved for offline — tap to remove' : 'Save playlist for offline';

    // Only meaningful for playlists that contain uploaded/MP3 songs
    const hasOfflinable = songsData.some(s => s.mp3_url && s.mp3_url.startsWith('/media/'));
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
        toast.textContent = text;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    };

    // Two-tap inline delete confirm: first tap arms the row for 3s
    window.mArmDelete = function (row, songIndex) {
        if (row.classList.contains('m-confirm-armed')) {
            closeSendMenu();
            deleteSong(songIndex, { skipConfirm: true });
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

    if (isAppShell) return;

    const mq = window.matchMedia('(max-width: 600px)');
    const onPhone = () => mq.matches;

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
    // software keyboard is up (an input has focus).
    let keyboardOpen = false;
    function updateDockVisibility() {
        // An empty playlist hides the dock — unless audio is still playing
        // (switching into an empty playlist doesn't stop the old track, and
        // the dock would be the only reachable transport).
        const empty = (typeof songsData === 'undefined' || songsData.length === 0)
            && !document.body.classList.contains('m-playing');
        dock.classList.toggle('m-dock-hidden', empty || keyboardOpen);
    }
    document.addEventListener('focusin', (e) => {
        if (e.target.matches && e.target.matches('input, select, textarea')) {
            keyboardOpen = true;
            updateDockVisibility();
        }
    });
    document.addEventListener('focusout', () => {
        setTimeout(() => {
            const el = document.activeElement;
            keyboardOpen = !!(el && el.matches && el.matches('input, select, textarea'));
            updateDockVisibility();
        }, 150);
    });
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
            chip.textContent = shuffleMode === 'smart' ? 'Smart mix' : 'Shuffle';
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
    function applyRowFilter() {
        if (!filterInput) return;
        const q = filterInput.value.trim().toLowerCase();
        document.querySelectorAll('#songList .song-list-item').forEach((row) => {
            if (!q) {
                row.classList.remove('m-filtered-out');
                return;
            }
            const text = ((row.querySelector('.song-list-title') || {}).textContent || '')
                + ' ' + ((row.querySelector('.song-list-artist') || {}).textContent || '');
            row.classList.toggle('m-filtered-out', !text.toLowerCase().includes(q));
        });
    }
    if (filterInput) filterInput.addEventListener('input', applyRowFilter);

    // ============================================================
    // Layer manager: every mobile surface (playlist screen, NP sheet,
    // modals, song sheet) is a history entry, so hardware back / edge
    // swipe closes the topmost surface instead of leaving the app.
    // Programmatic closes route through history.back() — popstate is
    // the single close path; closeFns are idempotent as insurance.
    // ============================================================
    const layerStack = [];
    // One programmatic traversal at a time: double-taps on any close
    // control must not fire two history.back()s (two layers would close,
    // or the user would leave the page from the last one).
    let pendingBack = false;

    function openLayer(name, closeFn) {
        layerStack.push({ name, closeFn });
        // The entry records its own depth so popstate can reconcile
        // instead of blind-popping (forward traversals fire it too).
        try { history.pushState({ mLayer: name, mDepth: layerStack.length }, ''); } catch (e) {}
    }

    window.addEventListener('popstate', (event) => {
        pendingBack = false;
        const depth = (event.state && typeof event.state.mDepth === 'number')
            ? event.state.mDepth : 0;
        if (depth > layerStack.length) {
            // Forward traversal into an entry we no longer track (e.g. the
            // user swiped forward after closing a sheet) — snap back.
            history.go(layerStack.length - depth);
            return;
        }
        while (layerStack.length > depth) {
            const layer = layerStack.pop();
            try { layer.closeFn(); } catch (e) {}
        }
    });

    function topLayerIs(name) {
        return layerStack.length > 0 && layerStack[layerStack.length - 1].name === name;
    }

    // The single programmatic close path: every UI close control routes
    // here so popstate stays the one place layers actually close.
    function backOneLayer() {
        if (pendingBack || layerStack.length === 0) return;
        pendingBack = true;
        history.back();
    }

    // Width-change teardown: close phone-only surfaces (NP, lyrics, song
    // sheet, modals) but keep the playlist screen — a rotation must not
    // kick the user back to the crate. The closed layers' history entries
    // are consumed with one history.go() so back presses don't go dead;
    // the depth-reconciling popstate handler makes that a no-op pop.
    function teardownPhoneLayers() {
        let n = 0;
        while (layerStack.length && layerStack[layerStack.length - 1].name !== 'playlist') {
            const layer = layerStack.pop();
            try { layer.closeFn(); } catch (e) {}
            n++;
        }
        if (n > 0) {
            try { history.go(-n); } catch (e) {}
        }
    }

    // Playlist screen is a layer over the crate
    const origSelectPlaylist = window.selectPlaylistFromCrate;
    window.selectPlaylistFromCrate = async function () {
        const crate = document.getElementById('vinylCrateView');
        const wasCrate = crate && !crate.classList.contains('hidden');
        const out = await origSelectPlaylist.apply(this, arguments);
        if (onPhone() && wasCrate && !topLayerIs('playlist')) {
            openLayer('playlist', () => {
                if (document.getElementById('musicPlayerView').classList.contains('active')) {
                    origShowPicker();
                }
            });
        }
        return out;
    };

    const origShowPicker = window.showPlaylistPicker;
    window.showPlaylistPicker = function () {
        if (onPhone() && topLayerIs('playlist')) {
            backOneLayer();
            return;
        }
        return origShowPicker.apply(this, arguments);
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
            if (onPhone() && !modalOpen[key]) {
                modalOpen[key] = true;
                openLayer('modal:' + key, () => {
                    if (modalOpen[key]) {
                        modalOpen[key] = false;
                        modalOrigHide[key]();
                    }
                });
            }
            return out;
        };
        if (!modalOrigHide[key]) {
            const origHide = window[hideName];
            if (typeof origHide !== 'function') return;
            modalOrigHide[key] = origHide;
            window[hideName] = function () {
                if (onPhone() && modalOpen[key] && topLayerIs('modal:' + key)) {
                    backOneLayer();
                    return;
                }
                modalOpen[key] = false;
                return origHide.apply(this, arguments);
            };
        }
    }

    wrapModalPair('showSettingsModal', 'hideSettingsModal', 'settings');
    wrapModalPair('showAddSongModal', 'hideAddSongModal', 'addSong');
    wrapModalPair('showScanModal', 'hideScanModal', 'scan');
    wrapModalPair('showPlaylistEditModal', 'hidePlaylistEditModal', 'playlistEdit');
    wrapModalPair('showPlaylistCreateModal', 'hidePlaylistEditModal', 'playlistEdit');

    // The member welcome card shows the PIN exactly once and must not be
    // dismissible — a hardware back would otherwise leave the page and
    // lose the PIN forever. While the card is up, back is a no-op: the
    // popped guard layer immediately re-pushes itself.
    if (document.getElementById('memberWelcomeModal')) {
        const reGuardWelcome = () => {
            const card = document.getElementById('memberWelcomeModal');
            if (card && getComputedStyle(card).display !== 'none') {
                openLayer('memberWelcome', reGuardWelcome);
            }
        };
        openLayer('memberWelcome', reGuardWelcome);
    }

    // ============================================================
    // Now Playing sheet
    // ============================================================
    function openNp() {
        if (!onPhone() || document.body.classList.contains('m-np-open')) return;
        const fromName = document.getElementById('mNpFromName');
        const title = document.getElementById('playlistTitle');
        if (fromName && title) fromName.textContent = title.textContent;
        document.body.classList.add('m-np-open');
        openLayer('np', () => document.body.classList.remove('m-np-open'));
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

    // ---- Dock tap opens the NP sheet (entering the playlist screen
    // first when coming from the crate, so back unwinds naturally) ----
    window.mOpenNowPlaying = async function () {
        const crate = document.getElementById('vinylCrateView');
        if (crate && !crate.classList.contains('hidden')) {
            await window.selectPlaylistFromCrate(activePlaylistId);
        }
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
        if (onPhone() && songSheetOpen && topLayerIs('songSheet')) {
            backOneLayer();
            return;
        }
        songSheetOpen = false;
        return origCloseSendMenu.apply(this, arguments);
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
                if (window.mToast) mToast('Radio track — not in this crate');
                return;
            }
            window.showSendMenu(npKebab, currentSongIndex);
        });
    }

    // ============================================================
    // Full-screen lyrics (phase 7)
    // ============================================================
    function openLyrics() {
        if (!onPhone() || document.body.classList.contains('m-lyrics-open')) return;
        document.body.classList.add('m-lyrics-open');
        openLayer('lyrics', () => document.body.classList.remove('m-lyrics-open'));
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
            } else if (e.type !== 'pointercancel'
                && Math.abs(dx) < 10 && Math.abs(dy) < 10 && dt < 300) {
                // Tap: open the Now Playing sheet (via the playlist screen
                // when coming from the crate, so back unwinds naturally).
                // Cancelled pointers and vertical flicks (touch-action:pan-y
                // hands them to the scroller) must never count as taps.
                if (window.mOpenNowPlaying) window.mOpenNowPlaying();
            }
            dx = 0;
            dy = 0;
            horizontal = false;
        };
        dockInfo.addEventListener('pointerup', settle);
        dockInfo.addEventListener('pointercancel', settle);
    }

    // ---- Leaving phone widths: strip mobile-only state so desktop is clean.
    mq.addEventListener('change', (e) => {
        if (!e.matches) {
            teardownPhoneLayers();
            dock.style.transform = '';
            dock.classList.remove('m-dock-hidden');
            document.body.classList.remove('m-np-open', 'm-lyrics-open', 'm-scrubbing');
            window.__mScrubbing = false;
            if (filterInput) {
                filterInput.value = '';
                applyRowFilter();
            }
        }
        updateDockVisibility();
    });
})();
