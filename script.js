// Lazy-load YouTube IFrame API
let ytApiLoaded = false;
function loadYouTubeAPI() {
    if (ytApiLoaded) return;
    ytApiLoaded = true;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
}

// Music player controls
// Song and playlist data from PHP
// activePlaylistId is injected by PHP in index.php
// songsData is injected by PHP in index.php
// currentSongIndex is injected by PHP in index.php
let isChangingSong = false;
let isChangingPlaylist = false;

// Animate record change
async function animateRecordChange(newSong) {
    const vinyl = document.getElementById('vinyl');
    const songInfo = document.querySelector('.song-info');
    const tonearm = document.getElementById('tonearm');
    const miniTonearm = document.getElementById('miniTonearm');
    const platterVinyl = document.getElementById('platterVinyl');

    // Stop vinyl spinning during change
    vinyl.classList.remove('playing');
    tonearm.classList.remove('playing');
    if (miniTonearm) miniTonearm.classList.remove('playing');
    if (platterVinyl) platterVinyl.classList.remove('spinning');

    // Move tonearm away
    tonearm.style.transition = 'transform 0.4s ease';
    tonearm.style.transform = 'rotate(-30deg)';

    // Lift off old record
    vinyl.classList.add('lifting');
    songInfo.classList.add('changing');

    // Wait for lift animation
    await new Promise(resolve => setTimeout(resolve, 600));

    // Update the cover while hidden
    const label = document.querySelector('.record-label');
    if (newSong.cover) {
        label.innerHTML = `<img src="${newSong.cover}" alt="Album Cover">`;
    } else {
        label.innerHTML = '<div class="record-label-placeholder">&#9834;</div>';
    }

    // Update song info while hidden
    document.querySelector('.song-title').textContent = newSong.title;
    document.querySelector('.song-artist').textContent = newSong.artist;
    document.querySelector('.song-album').textContent = newSong.album || '';

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

    // Reset mini turntable elements (they'll be set to playing by onPlayerStateChange when video plays)
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
    await animateRecordChange(song);

    // Reset progress bar for new song
    resetSleeveProgress();

    // Update YouTube player with new song
    if (song.youtube_id && ytPlayer && ytPlayer.loadVideoById) {
        ytPlayer.loadVideoById(song.youtube_id);
    }

    // Save to server
    await fetch('save-music.php', {
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
        if (clickedRecord) clickedRecord.classList.add('pulling');
        await new Promise(resolve => setTimeout(resolve, 500));
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
    const response = await fetch('save-music.php', {
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

        // Rebuild song list
        const songList = document.getElementById('songList');
        songList.innerHTML = songsData.map((song, index) => buildSongListItem(song, index)).join('');

        // Update track count
        const trackCountEl = document.querySelector('.sidebar-track-count');
        if (trackCountEl) trackCountEl.textContent = songsData.length + ' tracks';

        // Update the record player with first song
        const currentSong = songsData[currentSongIndex] || {};
        const label = document.querySelector('.record-label');
        if (currentSong.cover) {
            label.innerHTML = `<img src="${currentSong.cover}" alt="Album Cover">`;
        } else {
            label.innerHTML = '<div class="record-label-placeholder">&#9834;</div>';
        }
        document.querySelector('.song-title').textContent = currentSong.title || 'No song';
        document.querySelector('.song-artist').textContent = currentSong.artist || '';
        document.querySelector('.song-album').textContent = currentSong.album || '';

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

        // Cue the video without auto-playing - let the user choose
        if (currentSong.youtube_id && ytPlayer && ytPlayer.cueVideoById) {
            ytPlayer.cueVideoById(currentSong.youtube_id);
        }

        // Load lyrics for the new playlist's first song
        loadLyricsForSong(currentSong);
    }

    // Wait for pull animation
    await new Promise(resolve => setTimeout(resolve, 500));

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
    await animateRecordChange(song);

    // Reset progress bar
    resetSleeveProgress();

    // Load in YouTube player
    if (song.youtube_id && ytPlayer && ytPlayer.loadVideoById) {
        ytPlayer.loadVideoById(song.youtube_id);
    }

    updateAmpDisplay();
    loadLyricsForSong(song);
    isChangingSong = false;
}

function addRadioSidebarItem(song) {
    const songList = document.getElementById('songList');
    if (!songList) return;
    const li = document.createElement('li');
    li.className = 'song-list-item radio-song-item active';
    li.innerHTML = `
        <div class="song-list-vinyl">
            <div class="song-list-vinyl-groove"></div>
            ${song.cover
                ? `<img class="song-list-cover" src="${song.cover}" alt="">`
                : `<div class="song-list-cover song-list-cover-empty">&#9834;</div>`
            }
            <div class="song-list-vinyl-hole"></div>
        </div>
        <div class="song-list-info">
            <div class="song-list-title">${song.title}</div>
            <div class="song-list-artist">${song.artist}</div>
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

    const response = await fetch('save-music.php', {
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

function onYouTubeIframeAPIReady() {
    const currentSong = songsData[currentSongIndex];
    const youtubeId = currentSong ? currentSong.youtube_id : '';

    ytPlayer = new YT.Player('youtubePlayer', {
        height: '225',
        width: '400',
        videoId: youtubeId,
        playerVars: {
            'playsinline': 1,
            'rel': 0,
            'modestbranding': 1
        },
        events: {
            'onStateChange': onPlayerStateChange
        }
    });
}

function onPlayerStateChange(event) {
    const vinyl = document.getElementById('vinyl');
    const tonearm = document.getElementById('tonearm');
    const playBtn = document.getElementById('playBtn');
    const platterVinyl = document.getElementById('platterVinyl');
    const miniTonearm = document.getElementById('miniTonearm');
    const led = document.getElementById('turntableLed');
    const eqVis = document.getElementById('playerEqVis');

    if (event.data === YT.PlayerState.PLAYING) {
        if (vinyl) vinyl.classList.add('playing');
        if (tonearm) tonearm.classList.add('playing');
        if (platterVinyl) platterVinyl.classList.add('spinning');
        if (miniTonearm) miniTonearm.classList.add('playing');
        if (led) led.classList.add('on');
        if (eqVis) eqVis.classList.add('active');
        if (playBtn) {
            playBtn.innerHTML = '&#9208;';
            playBtn.classList.add('playing');
        }
        startSleeveProgress();
    } else if (event.data === YT.PlayerState.ENDED) {
        if (vinyl) vinyl.classList.remove('playing');
        if (tonearm) tonearm.classList.remove('playing');
        if (platterVinyl) platterVinyl.classList.remove('spinning');
        if (miniTonearm) miniTonearm.classList.remove('playing');
        if (led) led.classList.remove('on');
        if (eqVis) eqVis.classList.remove('active');
        if (playBtn) {
            playBtn.innerHTML = '&#9654;';
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
            playBtn.innerHTML = '&#9654;';
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

function updateSleeveProgress() {
    if (!ytPlayer || !ytPlayer.getCurrentTime || !ytPlayer.getDuration) return;
    const current = ytPlayer.getCurrentTime();
    const duration = ytPlayer.getDuration();
    if (!duration) return;

    const pct = Math.min((current / duration) * 100, 100);
    const fill = document.getElementById('sleeveProgressFill');
    const knob = document.getElementById('sleeveProgressKnob');
    const elapsedEl = document.getElementById('sleeveTimeElapsed');
    const totalEl = document.getElementById('sleeveTimeTotal');

    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    if (elapsedEl) elapsedEl.textContent = formatTime(current);
    if (totalEl) totalEl.textContent = formatTime(duration);

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

async function fetchLyrics(title, artist) {
    const cacheKey = `${artist}|||${title}`;
    if (lyricsCache[cacheKey] !== undefined) return lyricsCache[cacheKey];

    try {
        const params = new URLSearchParams({ track_name: title, artist_name: artist });
        const resp = await fetch(`https://lrclib.net/api/search?${params}`);
        if (!resp.ok) {
            lyricsCache[cacheKey] = null;
            return null;
        }
        const data = await resp.json();
        if (!data || data.length === 0) {
            lyricsCache[cacheKey] = null;
            return null;
        }

        // Pick best result: prefer one with synced lyrics
        const best = data.find(r => r.syncedLyrics) || data[0];
        if (best.syncedLyrics) {
            const parsed = parseLRC(best.syncedLyrics);
            if (parsed.length > 0) {
                const result = { type: 'synced', lines: parsed };
                lyricsCache[cacheKey] = result;
                return result;
            }
        }
        if (best.plainLyrics) {
            const result = { type: 'plain', text: best.plainLyrics };
            lyricsCache[cacheKey] = result;
            return result;
        }

        lyricsCache[cacheKey] = null;
        return null;
    } catch (e) {
        lyricsCache[cacheKey] = null;
        return null;
    }
}

function renderLyrics(lyrics) {
    const container = document.getElementById('sleeveLyrics');
    if (!container) return;
    container.innerHTML = '';
    activeLyricIndex = -1;
    activeWordIndex = -1;

    if (!lyrics) {
        currentLyrics = null;
        container.innerHTML = '<div class="lyrics-placeholder">No lyrics available</div>';
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
        return;
    }

    // Synced lyrics — render each word as a span for word-level highlighting
    currentLyrics = lyrics.lines;
    lyrics.lines.forEach((line, i) => {
        const div = document.createElement('div');
        div.className = 'lyrics-line';
        div.dataset.index = i;

        const words = line.text.split(/(\s+)/);
        words.forEach(word => {
            if (/^\s+$/.test(word)) {
                div.appendChild(document.createTextNode(word));
            } else {
                const span = document.createElement('span');
                span.className = 'lyrics-word';
                span.textContent = word;
                div.appendChild(span);
            }
        });

        div.addEventListener('click', () => {
            if (ytPlayer && ytPlayer.seekTo) {
                ytPlayer.seekTo(line.time, true);
                updateSleeveProgress();
            }
        });
        container.appendChild(div);
    });
}

let activeWordIndex = -1;
let wordAnimFrame = null;

function updateActiveLyric() {
    if (!currentLyrics || !ytPlayer || !ytPlayer.getCurrentTime) return;
    const time = ytPlayer.getCurrentTime();
    let newIndex = -1;
    for (let i = currentLyrics.length - 1; i >= 0; i--) {
        if (time >= currentLyrics[i].time) {
            newIndex = i;
            break;
        }
    }

    const container = document.getElementById('sleeveLyrics');
    if (!container) return;
    const lines = container.querySelectorAll('.lyrics-line');

    if (newIndex !== activeLyricIndex) {
        activeLyricIndex = newIndex;
        activeWordIndex = -1;
        if (wordAnimFrame) { cancelAnimationFrame(wordAnimFrame); wordAnimFrame = null; }

        lines.forEach((el, i) => {
            el.classList.toggle('active', i === newIndex);
            // Reset word highlights on non-active lines
            if (i !== newIndex) {
                el.querySelectorAll('.lyrics-word').forEach(w => w.classList.remove('word-active'));
            }
        });

        // Auto-scroll active line into view (only within lyrics container)
        if (newIndex >= 0 && lines[newIndex]) {
            const scrollTarget = lines[newIndex].offsetTop - container.offsetTop - container.clientHeight / 2 + lines[newIndex].offsetHeight / 2;
            container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
        }
    }

    // Word-level highlighting within active line (character-weighted timing)
    if (newIndex >= 0 && newIndex < currentLyrics.length && lines[newIndex]) {
        const lineStart = currentLyrics[newIndex].time;
        const lineEnd = (newIndex + 1 < currentLyrics.length) ? currentLyrics[newIndex + 1].time : (ytPlayer.getDuration ? ytPlayer.getDuration() : lineStart + 5);
        const lineDuration = Math.min(lineEnd - lineStart, 8) * 0.85; // tighter timing — words finish before next line
        const elapsed = time - lineStart;
        const words = lines[newIndex].querySelectorAll('.lyrics-word');
        if (words.length > 0) {
            // Weight each word by its character length
            const charLengths = Array.from(words).map(w => w.textContent.length);
            const totalChars = charLengths.reduce((a, b) => a + b, 0);
            const progress = Math.max(0, Math.min(1, elapsed / lineDuration));

            let cumulative = 0;
            let newWordIdx = 0;
            for (let wi = 0; wi < charLengths.length; wi++) {
                cumulative += charLengths[wi] / totalChars;
                if (progress < cumulative) {
                    newWordIdx = wi;
                    break;
                }
                newWordIdx = wi;
            }

            if (newWordIdx !== activeWordIndex) {
                activeWordIndex = newWordIdx;
                words.forEach((w, wi) => {
                    w.classList.toggle('word-active', wi <= newWordIdx);
                });
            }
        }
    }
}

function showLyricsLoading() {
    const container = document.getElementById('sleeveLyrics');
    if (!container) return;
    container.innerHTML = '<div class="lyrics-placeholder">Loading lyrics...</div>';
    currentLyrics = null;
    activeLyricIndex = -1;
}

async function loadLyricsForSong(song) {
    if (!song || !song.title || !song.artist) {
        renderLyrics(null);
        return;
    }
    showLyricsLoading();
    const lyrics = await fetchLyrics(song.title, song.artist);
    renderLyrics(lyrics);
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
        if (song.cover) {
            platterLabel.innerHTML = `<img src="${song.cover}" alt="">`;
        } else {
            platterLabel.innerHTML = '';
        }
    }
}

// Init amp display scroll on load
document.addEventListener('DOMContentLoaded', () => {
    updateAmpDisplay();
    if (shuffleMode !== 'off') buildShuffleQueue();
});

function restartSong() {
    if (!ytPlayer || !ytPlayer.seekTo) return;
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
    resetSleeveProgress();
    activeLyricIndex = -1;
}

function toggleMusic() {
    if (!ytPlayer) return;

    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
        ytPlayer.pauseVideo();
    } else {
        ytPlayer.playVideo();
        // Load lyrics on first play if not yet loaded
        if (!currentLyrics && activeLyricIndex === -1) {
            const song = currentRadioSong || songsData[currentSongIndex];
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

    volumeKnobWrapper.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = volumeKnobWrapper.getBoundingClientRect();
        lastAngle = getAngleFromEvent(e, rect);
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
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

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            lastAngle = null;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });

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

function showAddSongModal() {
    document.getElementById('addSongModal').classList.add('active');
    document.getElementById('addSongYoutube').focus();
}

function hideAddSongModal() {
    document.getElementById('addSongModal').classList.remove('active');
    document.getElementById('addSongForm').reset();
    lastFetchedYtId = '';
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

// Auto-fetch info when YouTube URL is pasted or typed
document.getElementById('addSongYoutube')?.addEventListener('input', (e) => {
    const val = e.target.value.trim();
    if (val.length >= 11) fetchYoutubeInfo(val);
});

function updateSongDisplay(song) {
    // Record label
    const label = document.querySelector('.record-label');
    if (label) {
        label.innerHTML = song.cover
            ? `<img src="${song.cover}" alt="Album Cover">`
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
    document.querySelector('.song-title').textContent = song.title || 'No song';
    document.querySelector('.song-artist').textContent = song.artist || '';
    document.querySelector('.song-album').textContent = song.album || '';
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
}

function buildSongListItem(song, index) {
    return `
        <li class="song-list-item ${index === currentSongIndex ? 'active' : ''}"
            data-index="${index}"
            onclick="switchSong(${index})">
            <div class="song-list-vinyl">
                <div class="song-list-vinyl-groove"></div>
                ${song.cover
                    ? `<img class="song-list-cover" src="${song.cover}" alt="">`
                    : `<div class="song-list-cover song-list-cover-empty">&#9834;</div>`
                }
                <div class="song-list-vinyl-hole"></div>
            </div>
            <div class="song-list-info">
                <div class="song-list-title">${song.title}</div>
                <div class="song-list-artist">${song.artist}</div>
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
    songList.innerHTML = songsData.map((song, index) => buildSongListItem(song, index)).join('');
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
    const youtubeId = extractYoutubeId(document.getElementById('addSongYoutube').value);
    const title = document.getElementById('addSongTitle').value.trim();
    const artist = document.getElementById('addSongArtist').value.trim();
    const album = document.getElementById('addSongAlbum').value.trim();
    const cover = document.getElementById('addSongCover').value.trim();

    if (!title || !youtubeId) return;

    const song = { title, artist, album, cover, youtube_id: youtubeId };

    const response = await fetch('save-music.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', song })
    });
    const result = await response.json();

    if (result.success) {
        songsData.push(song);
        const prevIndex = currentSongIndex;
        currentSongIndex = songsData.length - 1;
        if (shuffleMode !== 'off') buildShuffleQueue();
        rebuildSongList();
        updateTrackCount();
        hideAddSongModal();
        // Load the new song — can't use switchSong since we already updated currentSongIndex
        updateSongDisplay(song);
        if (song.youtube_id && ytPlayer && ytPlayer.cueVideoById) {
            ytPlayer.cueVideoById(song.youtube_id);
        }
    }
}

async function deleteSong(index) {
    if (songsData.length <= 1) return; // don't delete the last song

    const response = await fetch('save-music.php', {
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
        if (wasPlaying && songsData.length > 0) {
            const song = songsData[currentSongIndex];
            updateSongDisplay(song);
            if (song.youtube_id && ytPlayer && ytPlayer.cueVideoById) {
                ytPlayer.cueVideoById(song.youtube_id);
            }
        }
    }
}

// ============================================================
// PLAYLIST EDIT (RENAME / RECOLOR)
// ============================================================

let editingPlaylistId = '';
let selectedEditColor = '';
let selectedCoverIndex = null; // null = auto, number = song index

function showPlaylistEditModal(id) {
    editingPlaylistId = id;
    const meta = playlistsMeta[id];
    if (!meta) return;
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
        const safeTitle = c.title.replace(/"/g, '&quot;');
        html += `<div class="cover-picker-item ${isSelected ? 'selected' : ''}" data-cover-index="${c.index}" onclick="selectCoverSong(this)" title="${safeTitle}">
            <img class="cover-picker-thumb" src="${c.url}" alt="">
        </div>`;
    });
    grid.innerHTML = html;
}

function hidePlaylistEditModal() {
    document.getElementById('playlistEditModal').classList.remove('active');
    editingPlaylistId = '';
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
    const id = editingPlaylistId;
    const name = document.getElementById('playlistEditName').value.trim();
    if (!id || !name) return;

    const oldMeta = playlistsMeta[id];
    const nameChanged = name !== oldMeta.name;
    const colorChanged = selectedEditColor !== oldMeta.color;
    const coverChanged = selectedCoverIndex !== (oldMeta.coverSongIndex ?? null);

    // Send rename if changed
    if (nameChanged) {
        await fetch('save-music.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rename', playlist: id, name })
        });
        playlistsMeta[id].name = name;
    }

    // Send recolor if changed
    if (colorChanged) {
        await fetch('save-music.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'recolor', playlist: id, color: selectedEditColor })
        });
        playlistsMeta[id].color = selectedEditColor;
    }

    // Send cover change if changed
    if (coverChanged) {
        await fetch('save-music.php', {
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
                    vinylLabel.innerHTML = `<img src="${newCoverUrl}" alt="">`;
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
    document.removeEventListener('click', onSendMenuOutsideClick);
}

function onSendMenuOutsideClick(e) {
    if (activeSendMenu && !activeSendMenu.contains(e.target)) {
        closeSendMenu();
    }
}

function showSendMenu(btn, songIndex) {
    closeSendMenu();
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'send-menu';

    let html = '<div class="send-menu-title">Move to...</div>';
    for (const [id, meta] of Object.entries(playlistsMeta)) {
        if (id === activePlaylistId) continue;
        html += `
            <div class="send-menu-item" onclick="event.stopPropagation(); moveSongTo('${id}', ${songIndex})" style="cursor:pointer">
                <span class="send-menu-dot" style="background:${meta.color}"></span>
                <span class="send-menu-name">${meta.name}</span>
            </div>`;
    }
    menu.innerHTML = html;

    // Position menu
    menu.style.position = 'fixed';
    menu.style.top = (rect.bottom + 4) + 'px';
    menu.style.left = (rect.left - 160) + 'px';
    document.body.appendChild(menu);

    // Ensure menu stays within viewport
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.right > window.innerWidth - 8) {
        menu.style.left = (window.innerWidth - menuRect.width - 8) + 'px';
    }
    if (menuRect.bottom > window.innerHeight - 8) {
        menu.style.top = (rect.top - menuRect.height - 4) + 'px';
    }

    activeSendMenu = menu;
    setTimeout(() => document.addEventListener('click', onSendMenuOutsideClick), 0);
}

async function copySongTo(toPlaylist, songIndex) {
    const response = await fetch('save-music.php', {
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
    }
    closeSendMenu();
}

async function moveSongTo(toPlaylist, songIndex) {
    const response = await fetch('save-music.php', {
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
            if (song.youtube_id && ytPlayer && ytPlayer.cueVideoById) {
                ytPlayer.cueVideoById(song.youtube_id);
            }
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
            return `<div class="crate-record" data-crate-playlist="${id}" style="--r-color: ${meta.color};" onclick="selectPlaylistFromCrate('${id}')" title="${meta.name}"></div>`;
        }).join('');
}


// Auto-initialize: load YouTube API on page load (standalone app, no tabs)
document.addEventListener('DOMContentLoaded', () => {
    loadYouTubeAPI();
});
