@php
    // Render-side sanitizers ported from the legacy sanitize.php. Colors are
    // validated before being interpolated raw into style="..." attributes.
    if (!function_exists('nt_safe_css_color')) {
        function nt_safe_css_color($c, string $fallback = '#d4a574'): string
        {
            if (!is_string($c)) {
                return $fallback;
            }
            $c = trim($c);
            if (preg_match('/^#[0-9a-fA-F]{3,8}$/', $c)) {
                return $c;
            }
            if (preg_match('/^(rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s]+\)$/i', $c)) {
                return $c;
            }
            if (preg_match('/^[a-zA-Z]{1,30}$/', $c)) {
                return $c;
            }
            return $fallback;
        }
    }
@endphp<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Music Player</title>
    <link rel="manifest" href="/manifest.webmanifest">
    <meta name="theme-color" content="#1a1510">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="apple-touch-icon" href="/icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="{{ asset('css/styles.css') }}?v={{ filemtime(public_path('css/styles.css')) }}">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js" defer></script>
</head>
<body>

    <div id="music-section">
        <!-- Vinyl Collection Room -->
        <div class="vinyl-crate-view" id="vinylCrateView">
            <!-- Room Background -->
            <div class="room-bg">
                <div class="room-wall"></div>
                <div class="room-floor"></div>

                <!-- Floor rug -->
                <div class="floor-rug"></div>

                <!-- Wall decorations -->
                <div class="wall-art">
                    <div class="art-frame">
                        <div class="art-content">&#9834;</div>
                    </div>
                </div>

                <div class="wall-poster">
                    <div class="poster-content">
                        <div class="poster-text">LIVE<br>MUSIC</div>
                    </div>
                </div>

                <div class="wall-shelf">
                    <div class="shelf-board"></div>
                    <div class="shelf-items">
                        <div class="shelf-book"></div>
                        <div class="shelf-book b2"></div>
                        <div class="shelf-headphones"></div>
                    </div>
                </div>

                <div class="wall-clock">
                    <div class="clock-face">
                        <div class="clock-marks">
                            <div class="clock-mark major" style="transform:rotate(0deg)"></div>
                            <div class="clock-mark" style="transform:rotate(30deg)"></div>
                            <div class="clock-mark" style="transform:rotate(60deg)"></div>
                            <div class="clock-mark major" style="transform:rotate(90deg)"></div>
                            <div class="clock-mark" style="transform:rotate(120deg)"></div>
                            <div class="clock-mark" style="transform:rotate(150deg)"></div>
                            <div class="clock-mark major" style="transform:rotate(180deg)"></div>
                            <div class="clock-mark" style="transform:rotate(210deg)"></div>
                            <div class="clock-mark" style="transform:rotate(240deg)"></div>
                            <div class="clock-mark major" style="transform:rotate(270deg)"></div>
                            <div class="clock-mark" style="transform:rotate(300deg)"></div>
                            <div class="clock-mark" style="transform:rotate(330deg)"></div>
                        </div>
                        <div class="clock-hand hour"></div>
                        <div class="clock-hand minute"></div>
                        <div class="clock-center"></div>
                    </div>
                </div>

                <!-- String lights -->
                <div class="string-lights">
                    <svg class="string-wire" viewBox="0 0 800 60" preserveAspectRatio="none">
                        <path d="M0,10 Q200,50 400,20 T800,30" fill="none" stroke="#333" stroke-width="2"/>
                    </svg>
                    <div class="string-bulb" style="left: 10%;"></div>
                    <div class="string-bulb" style="left: 25%;"></div>
                    <div class="string-bulb" style="left: 40%;"></div>
                    <div class="string-bulb" style="left: 55%;"></div>
                    <div class="string-bulb" style="left: 70%;"></div>
                    <div class="string-bulb" style="left: 85%;"></div>
                </div>

                <!-- Hanging main lights -->
                <div class="hanging-lights">
                    <div class="light-bulb"><div class="bulb-glow"></div></div>
                    <div class="light-bulb"><div class="bulb-glow"></div></div>
                    <div class="light-bulb"><div class="bulb-glow"></div></div>
                </div>

                <!-- Floating dust particles -->
                <div class="dust-particles">
                    <span></span><span></span><span></span><span></span><span></span>
                </div>

                <!-- Ambient overlay -->
                <div class="ambient-overlay"></div>

                <!-- Floor decorations -->
                <div class="floor-speaker left-speaker">
                    <div class="speaker-body">
                        <div class="speaker-cone large"></div>
                        <div class="speaker-cone small"></div>
                        <div class="speaker-led"></div>
                    </div>
                </div>
                <div class="floor-speaker right-speaker">
                    <div class="speaker-body">
                        <div class="speaker-cone large"></div>
                        <div class="speaker-cone small"></div>
                        <div class="speaker-led"></div>
                    </div>
                </div>
                <div class="floor-records">
                    <div class="floor-vinyl v1"></div>
                    <div class="floor-vinyl v2"></div>
                    <div class="floor-vinyl v3"></div>
                </div>
                <div class="floor-plant">
                    <div class="plant-pot"></div>
                    <div class="plant-stem s1"></div>
                    <div class="plant-stem s2"></div>
                    <div class="plant-stem s3"></div>
                    <div class="plant-leaf l1"></div>
                    <div class="plant-leaf l2"></div>
                    <div class="plant-leaf l3"></div>
                </div>
            </div>

            <!-- Main Content -->
            <div class="room-content">
                <!-- Left Side - Turntable setup -->
                <div class="room-left">
                    <div class="setup-stand">
                        <div class="mini-turntable" onclick="selectPlaylistFromCrate('{{ $activePlaylistId }}')" title="{{ $activePlaylist['name'] ?? 'Now Playing' }}">
                            <div class="turntable-base">
                                <div class="turntable-platter">
                                    <div class="mini-strobe-dots"></div>
                                    <div class="platter-vinyl" id="platterVinyl">
                                        <div class="platter-label" id="platterLabel" style="--label-color: {!! nt_safe_css_color($activePlaylist['color'] ?? '#d4a574') !!}">
                                            @if (!empty($current['cover']))
                                            <img src="{{ $current['cover'] }}" alt="">
                                            @endif
                                        </div>
                                    </div>
                                </div>
                                <div class="turntable-arm" id="miniTonearm"></div>
                                <div class="mini-tonearm-base"></div>
                                <div class="mini-pitch-slider" onclick="event.stopPropagation()">
                                    <div class="mini-pitch-track" id="miniPitchTrack">
                                        <div class="mini-pitch-thumb" id="miniPitchThumb"></div>
                                        <div class="mini-pitch-detent"></div>
                                    </div>
                                    <div class="mini-pitch-value" id="miniPitchValue">0%</div>
                                </div>
                                <div class="turntable-led" id="turntableLed"></div>
                            </div>
                        </div>
                        <div class="stand-shelf">
                            <div class="amp-unit">
                                <div class="amp-display"><span class="amp-display-text" id="ampDisplayText">{{ ($current['artist'] ?? '') . ' - ' . ($current['title'] ?? 'No song') }}</span></div>
                                <div class="amp-knobs">
                                    <span onclick="prevSong()" title="Previous"></span><span onclick="toggleMusic()" title="Play/Pause"></span><span onclick="nextSong()" title="Next"></span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="side-table">
                        <div class="loop-btn" id="loopCoaster" data-loop="playlist" onclick="toggleLoopMode()">
                            <div class="loop-btn-icon" id="loopIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M17 2l4 4-4 4"/>
                                    <path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
                                    <path d="M7 22l-4-4 4-4"/>
                                    <path d="M21 13v1a4 4 0 0 1-4 4H3"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="loopLabel">loop all</div>
                        </div>
                        <div class="loop-btn shuffle-btn" id="shuffleBtn" data-shuffle="shuffle" onclick="toggleShuffle()">
                            <div class="loop-btn-icon" id="shuffleIcon">
                                <svg class="loop-svg shuffle-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M16 3h5v5"/>
                                    <path d="M4 20L21 3"/>
                                    <path d="M21 16v5h-5"/>
                                    <path d="M15 15l6 6"/>
                                    <path d="M4 4l5 5"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="shuffleLabel">shuffle on</div>
                        </div>
                        <div class="loop-btn make-gif-btn" id="makeGifBtn" onclick="openVinylGifModal()" title="Make a spinning vinyl GIF">
                            <div class="loop-btn-icon" id="makeGifIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="9"/>
                                    <circle cx="12" cy="12" r="3.5"/>
                                    <circle cx="12" cy="12" r="0.8" fill="currentColor"/>
                                    <path d="M12 3 A9 9 0 0 1 21 12" stroke-width="2.4"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="makeGifLabel">make gif</div>
                        </div>
                        <div class="loop-btn crackle-btn" id="crackleBtn" data-crackle="off" onclick="toggleCrackle()">
                            <div class="loop-btn-icon" id="crackleIcon">
                                <svg class="loop-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="6"/>
                                    <circle cx="12" cy="12" r="2"/>
                                </svg>
                            </div>
                            <div class="loop-btn-label" id="crackleLabel">crackle</div>
                        </div>
                    </div>
                </div>

                <!-- Center - Records -->
                <div class="room-center" id="roomCenter">
                    <div class="greeting-text">
                        <h1>My Collection</h1>
                        <p>pick something to play</p>
                    </div>

                    @php
                    // ---- Conveyor precompute: gather one render-record per playlist ----
                    // NOTE: keeps $totalTracks / $usedCovers so the <div class="collection-stats">
                    // block that follows (tracks / playlists / vibes) still works unchanged.
                    $totalTracks = 0;
                    $usedCovers = [];
                    $cards = [];
                    foreach ($playlists as $playlistId => $playlist) {
                        $playlistSongs = $playlist['songs'] ?? [];
                        $songCount = count($playlistSongs);
                        $totalTracks += $songCount;
                        $playlistColor = $playlist['color'] ?? '#d4a574';

                        // Find cover for this playlist
                        $coverUrl = '';
                        $coverSong = null;
                        $coverSongIdx = $playlist['coverSongIndex'] ?? null;
                        if ($coverSongIdx !== null && isset($playlistSongs[$coverSongIdx]) && !empty($playlistSongs[$coverSongIdx]['cover'])) {
                            $coverUrl = $playlistSongs[$coverSongIdx]['cover'];
                            $coverSong = $playlistSongs[$coverSongIdx];
                        } else {
                            foreach ($playlistSongs as $song) {
                                $songCover = $song['cover'] ?? '';
                                if ($songCover && !in_array($songCover, $usedCovers)) {
                                    $coverUrl = $songCover;
                                    $coverSong = $song;
                                    $usedCovers[] = $songCover;
                                    break;
                                }
                            }
                            if (!$coverUrl && !empty($playlistSongs[0]['cover'])) {
                                $coverUrl = $playlistSongs[0]['cover'];
                                $coverSong = $playlistSongs[0];
                            }
                        }
                        $cards[] = [
                            'id'        => $playlistId,
                            'playlist'  => $playlist,
                            'songCount' => $songCount,
                            'color'     => $playlistColor,
                            'coverUrl'  => $coverUrl,
                            'firstSong' => $coverSong ?? $playlistSongs[0] ?? null,
                        ];
                    }

                    // Interleave into two rows so they stay balanced even with odd totals.
                    $row1 = $row2 = [];
                    foreach ($cards as $i => $c) {
                        if ($i % 2 === 0) $row1[] = $c;
                        else              $row2[] = $c;
                    }

                    $renderCard = function ($c) use ($activePlaylistId) {
                        $playlistId = $c['id'];
                        $playlist   = $c['playlist'];
                        $songCount  = $c['songCount'];
                        // Validate before it is interpolated raw into style="" attributes below.
                        $color      = nt_safe_css_color($c['color'] ?? '#d4a574');
                        $coverUrl   = $c['coverUrl'];
                        $firstSong  = $c['firstSong'];
                        // Card source for the Local/Spotify filter: an explicit
                        // 'source' field wins; otherwise a playlist is Spotify only
                        // if it has songs and every one carries a spotify_id (which
                        // survives YouTube resolution — that only ADDS youtube_id).
                        $plSongs = $playlist['songs'] ?? [];
                        if (($playlist['source'] ?? '') === 'spotify') {
                            $source = 'spotify';
                        } elseif (!empty($plSongs) && count(array_filter($plSongs, fn($s) => !empty($s['spotify_id']))) === count($plSongs)) {
                            $source = 'spotify';
                        } else {
                            $source = 'user';
                        }

                        $pid        = htmlspecialchars($playlistId);
                        $nowPlaying = $playlistId === $activePlaylistId ? ' now-playing' : '';
                        $plName     = htmlspecialchars($playlist['name']);
                        $vinylImg   = $coverUrl ? '<img src="' . htmlspecialchars($coverUrl) . '" alt="">' : '';
                        $coverMain  = $coverUrl ? '<img src="' . htmlspecialchars($coverUrl) . '" alt="" class="cover-main">' : '';
                        $preview    = '';
                        if ($firstSong) {
                            $preview = '<span class="preview-track">' . htmlspecialchars(substr($firstSong['title'], 0, 18)) . (strlen($firstSong['title']) > 18 ? '...' : '') . '</span>';
                        }
                        echo <<<HTML
                        <div class="record-card{$nowPlaying}"
                             data-playlist="{$pid}"
                             data-source="{$source}"
                             style="--card-color: {$color}"
                             onclick="selectPlaylistFromCrate('{$pid}')">
                            <div class="record-card-vinyl">
                                <div class="vinyl-peek">
                                    <div class="vinyl-grooves"></div>
                                    <div class="vinyl-shine"></div>
                                    <div class="vinyl-label">{$vinylImg}</div>
                                    <div class="vinyl-hole"></div>
                                </div>
                            </div>
                            <div class="record-card-cover">
                                <div class="cover-art" style="background: linear-gradient(135deg, {$color} 0%, {$color}99 100%);">
                                    {$coverMain}
                                    <div class="cover-overlay"></div>
                                    <div class="cover-texture"></div>
                                </div>
                                <div class="cover-badge" style="background: {$color};">{$songCount}</div>
                                <div class="cover-info">
                                    <div class="cover-title">{$plName}</div>
                                    <div class="cover-preview">{$preview}</div>
                                </div>
                                <div class="cover-glow"></div>
                            </div>
                            <div class="play-hint"><span>&#9654;</span></div>
                            <button class="playlist-edit-btn" onclick="event.stopPropagation(); showPlaylistEditModal('{$pid}')" title="Edit playlist">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                </svg>
                            </button>
                            <div class="card-reflection"></div>
                        </div>
                        HTML;
                    };
                    @endphp
                    <div class="collection-toolbar">
                        <div class="source-filter" id="sourceFilter">
                            <button class="source-filter-btn active" data-source-filter="all"     onclick="setSourceFilter('all')">All</button>
                            <button class="source-filter-btn"        data-source-filter="user"    onclick="setSourceFilter('user')">Local</button>
                            <button class="source-filter-btn"        data-source-filter="spotify" onclick="setSourceFilter('spotify')">Spotify</button>
                        </div>
                        <button class="new-playlist-btn" onclick="showPlaylistCreateModal()">+ New playlist</button>
                    </div>
                    <div class="records-conveyor" id="recordsConveyor">
                        <div class="conveyor-rows">
                            <div class="conveyor-row" data-row="1">
                                <div class="conveyor-track">
                                    @php foreach ($row1 as $c) $renderCard($c); @endphp
                                    @php foreach ($row1 as $c) $renderCard($c); /* duplicate for seamless marquee loop */ @endphp
                                </div>
                            </div>
                            <div class="conveyor-row" data-row="2">
                                <div class="conveyor-track">
                                    @php foreach ($row2 as $c) $renderCard($c); @endphp
                                    @php foreach ($row2 as $c) $renderCard($c); /* duplicate */ @endphp
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="collection-stats">
                        <div class="stat-item">
                            <span class="stat-icon">&#128191;</span>
                            <span class="stat-num">{{ $totalTracks }}</span>
                            <span class="stat-text">tracks</span>
                        </div>
                        <div class="stat-divider"></div>
                        <div class="stat-item">
                            <span class="stat-icon">&#128193;</span>
                            <span class="stat-num">{{ count($playlists) }}</span>
                            <span class="stat-text">playlists</span>
                        </div>
                        <div class="stat-divider"></div>
                        <div class="stat-item">
                            <span class="stat-icon">&#10024;</span>
                            <span class="stat-num">&#8734;</span>
                            <span class="stat-text">vibes</span>
                        </div>
                    </div>
                </div>

                <!-- Right Side - Decorations -->
                <div class="room-right">
                    <div class="vinyl-crate-decor">
                        <div class="crate-box">
                            <div class="crate-records" id="crateRecords">
                                @foreach ($recentlyPlayed as $crateId)
                                    @continue(!isset($playlists[$crateId]))
                                    @php
                                        $cratePlaylist = $playlists[$crateId];
                                        $crateColor = nt_safe_css_color($cratePlaylist['color'] ?? '#d4a574');
                                        $crateName = $cratePlaylist['name'] ?? $crateId;
                                    @endphp
                                <div class="crate-record" data-crate-playlist="{{ $crateId }}" style="--r-color: {{ $crateColor }};" onclick="selectPlaylistFromCrate('{{ $crateId }}')" title="{{ $crateName }}"></div>
                                @endforeach
                            </div>
                        </div>
                        <div class="crate-label">VINYLS</div>
                    </div>
                    <div class="cat-silhouette">
                        <div class="cat-body"></div>
                        <div class="cat-head">
                            <div class="cat-ear left"></div>
                            <div class="cat-ear right"></div>
                        </div>
                        <div class="cat-tail"></div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Music Player View (hidden initially) -->
        <div class="music-player-view" id="musicPlayerView">
            <!-- Sidebar with song list -->
            <div class="music-sidebar" id="musicSidebar">
            <div class="sidebar-resize-handle" id="sidebarResizeHandle"></div>
            <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" title="Collapse sidebar">&#8249;</button>

            <button class="back-to-crate" id="backToCrate" onclick="showPlaylistPicker()">
                <span class="back-arrow">&#8592;</span>
                <span class="back-text">Crate</span>
            </button>

            <div class="sidebar-header-area">
                <div class="sidebar-header-row">
                    <div class="music-sidebar-title" id="playlistTitle">{{ $activePlaylist['name'] ?? 'My Records' }}</div>
                    <button class="add-song-btn settings-gear-btn" onclick="showSettingsModal()" title="Settings &amp; Spotify">&#9881;</button>
                        <button class="scan-songs-btn" onclick="showScanModal()" title="Scan for songs">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
                                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                            </svg>
                        </button>
                    <button class="scan-songs-btn offline-toggle-btn" id="offlineBtn" onclick="toggleOfflinePlaylist()" title="Save playlist for offline">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="add-song-btn" onclick="showAddSongModal()" title="Add a song">+</button>
                </div>
                <div class="sidebar-track-count">{{ count($songs) }} tracks</div>
            </div>
            <ul class="song-list" id="songList">
                @if (count($songs) === 0)
                <li class="song-list-empty">
                    <div class="song-list-empty-icon">&#9834;</div>
                    <div class="song-list-empty-text">This playlist is empty</div>
                    <button class="song-list-empty-add" onclick="showAddSongModal()">+ Add a song</button>
                </li>
                @endif
                @foreach ($songs as $index => $song)
                <li class="song-list-item {{ $index === $currentIndex ? 'active' : '' }}"
                    data-index="{{ $index }}"
                    data-src="{{ !empty($song['mp3_url']) ? 'mp3' : (!empty($song['youtube_id']) ? 'yt' : 'spotify') }}"
                    onclick="switchSong({{ $index }})">
                    <div class="song-list-vinyl">
                        <div class="song-list-vinyl-groove"></div>
                        @if (!empty($song['cover']))
                        <img class="song-list-cover" src="{{ $song['cover'] }}" alt="">
                        @else
                        <div class="song-list-cover song-list-cover-empty">&#9834;</div>
                        @endif
                        <div class="song-list-vinyl-hole"></div>
                    </div>
                    <div class="song-list-info">
                        <div class="song-list-title">{{ $song['title'] }}</div>
                        <div class="song-list-artist">{{ $song['artist'] }}</div>
                        <div class="song-list-playing-indicator">
                            <span></span><span></span><span></span><span></span>
                        </div>
                    </div>
                    <span class="song-list-num">{{ str_pad($index + 1, 2, '0', STR_PAD_LEFT) }}</span>
                    <div class="song-actions">
                        <button class="song-send-btn" onclick="event.stopPropagation(); showSendMenu(this, {{ $index }})" title="Send to playlist">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                            </svg>
                        </button>
                        <button class="song-delete-btn" onclick="event.stopPropagation(); deleteSong({{ $index }})" title="Remove song">&times;</button>
                    </div>
                </li>
                @endforeach
            </ul>
        </div>

        <!-- Main record player area -->
        <div class="music-main">
            <div class="music-main-backdrop" id="musicBackdrop">
                @if (!empty($current['cover']))
                <img src="{{ $current['cover'] }}" alt="" id="backdropImg">
                @else
                <img src="" alt="" id="backdropImg" style="display:none;">
                @endif
            </div>
            <div class="player-eq-visualizer" id="playerEqVis">
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
                <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
            </div>
            <div class="aurora-orbs">
                <div class="aurora-orb aurora-orb-1"></div>
                <div class="aurora-orb aurora-orb-2"></div>
                <div class="aurora-orb aurora-orb-3"></div>
                <div class="aurora-orb aurora-orb-4"></div>
                <div class="aurora-orb aurora-orb-5"></div>
            </div>
            <div class="vinyl-groove-bg"></div>
            <div class="turntable-area">
            <!-- Vinyl Sleeve - Song Info -->
            <div class="vinyl-sleeve" id="vinylSleeve">
                <div class="sleeve-art">
                    @if (!empty($current['cover']))
                        <img src="{{ $current['cover'] }}" alt="Album Cover" id="sleeveArtImg">
                    @else
                        <img src="" alt="" id="sleeveArtImg" style="display:none;">
                        <div class="sleeve-art-placeholder" id="sleeveArtPlaceholder">&#9834;</div>
                    @endif
                </div>
                <div class="sleeve-lyrics-zone">
                    <div class="sleeve-lyrics" id="sleeveLyrics">
                        <div class="lyrics-placeholder">Play a song to see lyrics</div>
                    </div>
                    <div class="lyrics-controls" id="lyricsControls">
                        <button type="button" class="lyrics-ctrl-btn" id="lyricsOffsetMinus" title="Lyrics show later (fix lyrics that run ahead)">&minus;</button>
                        <button type="button" class="lyrics-ctrl-sync" id="lyricsOffsetValue" title="Sync offset for this song — click to reset">0s</button>
                        <button type="button" class="lyrics-ctrl-btn" id="lyricsOffsetPlus" title="Lyrics show sooner (fix lyrics that lag behind)">+</button>
                        <button type="button" class="lyrics-ctrl-btn lyrics-ctrl-toggle" id="lyricsToggleBtn" title="Lyrics on/off">&#9834;</button>
                    </div>
                </div>
                <div class="sleeve-progress">
                    <div class="sleeve-progress-times">
                        <span id="sleeveTimeElapsed">0:00</span>
                        <span id="sleeveTimeTotal">0:00</span>
                    </div>
                    <div class="sleeve-progress-bar" id="sleeveProgressBar">
                        <div class="sleeve-progress-fill" id="sleeveProgressFill"></div>
                        <div class="sleeve-progress-knob" id="sleeveProgressKnob"></div>
                    </div>
                </div>
                <div class="sleeve-catalog">
                    <span class="sleeve-side">SIDE A</span>
                    <span class="sleeve-track-num" id="sleeveTrackNum">TRACK {{ str_pad($currentIndex + 1, 2, '0', STR_PAD_LEFT) }}</span>
                </div>
            </div>

            <div class="record-player">
                <div class="record-player-body">
                    <div class="record-player-platter">
                        <div class="strobe-dots"></div>
                        <div class="record" id="vinyl">
                            <div class="record-label">
                                @if (!empty($current['cover']))
                                    <img src="{{ $current['cover'] }}" alt="Album Cover">
                                @else
                                    <div class="record-label-placeholder">&#9834;</div>
                                @endif
                            </div>
                            <div class="record-hole"></div>
                            <div class="rubber-mat"></div>
                        </div>
                    </div>
                    <div class="tonearm" id="tonearm"></div>
                    <div class="tonearm-base"></div>
                    <div class="tonearm-rest" onclick="restartSong()" title="Restart song"></div>
                    <div class="tonearm-counterweight"></div>
                    <div class="record-player-right">
                        <div class="rp-song-info song-info">
                            <div class="sleeve-now-playing">NOW PLAYING</div>
                            <div class="song-title">{{ $current['title'] ?? 'No song playing' }}</div>
                            <div class="song-artist">{{ $current['artist'] ?? '' }}</div>
                            <div class="song-album">{{ $current['album'] ?? '' }}</div>
                        </div>
                        <div class="record-player-controls">
                            <button class="rp-btn" onclick="prevSong()" title="Previous">&#9198;</button>
                            <button class="rp-btn rp-play" id="playBtn" onclick="toggleMusic()">&#9654;</button>
                            <button class="rp-btn" onclick="nextSong()" title="Next">&#9197;</button>
                        </div>
                        <div class="pitch-slider" id="pitchSlider">
                            <div class="pitch-track" id="pitchTrack">
                                <div class="pitch-thumb" id="pitchThumb"></div>
                                <div class="pitch-detent"></div>
                            </div>
                            <div class="pitch-value" id="pitchValue">0%</div>
                            <div class="pitch-label">PITCH</div>
                        </div>
                        <div class="record-player-volume">
                            <div class="volume-knob-wrapper" id="volumeKnobWrapper" title="Drag to adjust volume">
                                <div class="volume-knob" id="volumeKnob">
                                    <div class="knob-indicator"></div>
                                </div>
                                <div class="knob-ring"></div>
                            </div>
                            <span class="volume-label" id="volumeLabel">100</span>
                        </div>
                    </div>
                    <div class="deck-foot deck-foot-tl"></div>
                    <div class="deck-foot deck-foot-tr"></div>
                    <div class="deck-foot deck-foot-bl"></div>
                    <div class="deck-foot deck-foot-br"></div>
                    <input type="range" class="volume-slider" id="volumeSlider" min="0" max="100" value="100" style="display:none;">
                    <div class="record-player-led" id="bigPlayerLed"></div>
                </div>
            </div>

            </div><!-- End turntable-area -->

            <!-- Hidden YouTube Player -->
            <div class="youtube-player-container" id="youtubeContainer">
                <div id="youtubePlayer"></div>
            </div>
        </div>
        </div><!-- End music-player-view -->
    </div>

    <!-- Add Song Modal -->
    <div class="add-song-modal" id="addSongModal">
        <div class="add-song-modal-backdrop" onclick="hideAddSongModal()"></div>
        <div class="add-song-modal-panel">
            <button class="add-song-modal-close" onclick="hideAddSongModal()">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#9834;</div>
                <h2 class="add-song-modal-title">Add Song</h2>
            </div>
            <form id="addSongForm" onsubmit="addSongToPlaylist(event)">
                <div class="add-song-form-group">
                    <label for="addSongYoutube" id="addSongSourceLabel">YouTube URL or ID</label>
                    <input type="text" id="addSongYoutube" placeholder="https://youtube.com/watch?v=... or video ID" required>
                </div>
                <div class="add-song-form-group" id="addSongUploadGroup" style="display:none">
                    <button type="button" class="upload-audio-btn" onclick="document.getElementById('addSongFile').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        <span>Or upload audio files</span>
                    </button>
                    <p class="upload-hint">Pick several to import them all — or just drop files anywhere on the page.</p>
                    <input type="file" id="addSongFile" multiple accept="audio/*,.mp3,.m4a,.ogg,.opus,.wav,.flac" style="display:none" onchange="handleAudioUpload(this.files)">
                    <div class="upload-progress" id="uploadProgress" style="display:none">
                        <div class="upload-progress-fill" id="uploadProgressFill"></div>
                    </div>
                    <div class="upload-status" id="uploadStatus"></div>
                </div>
                <div class="add-song-form-group">
                    <label for="addSongTitle">Title</label>
                    <input type="text" id="addSongTitle" placeholder="Song title" required>
                </div>
                <div class="add-song-form-group">
                    <label for="addSongArtist">Artist</label>
                    <input type="text" id="addSongArtist" placeholder="Artist name">
                </div>
                <div class="add-song-form-group">
                    <label for="addSongAlbum">Album</label>
                    <input type="text" id="addSongAlbum" placeholder="Album name">
                </div>
                <div class="add-song-form-group">
                    <label for="addSongCover">Cover URL</label>
                    <input type="text" id="addSongCover" placeholder="https://... (optional)">
                </div>
                <div class="add-song-modal-buttons">
                    <button type="button" class="add-song-btn-cancel" onclick="hideAddSongModal()">Cancel</button>
                    <button type="submit" class="add-song-btn-save">Add to Playlist</button>
                </div>
            </form>
        </div>
    </div>

    <!-- Playlist Edit Modal -->
    <div class="add-song-modal" id="playlistEditModal">
        <div class="add-song-modal-backdrop" onclick="hidePlaylistEditModal()"></div>
        <div class="add-song-modal-panel">
            <button class="add-song-modal-close" onclick="hidePlaylistEditModal()">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#127912;</div>
                <h2 class="add-song-modal-title" id="playlistEditModalTitle">Edit Playlist</h2>
            </div>
            <input type="hidden" id="playlistEditId" value="">
            <div class="add-song-form-group">
                <label for="playlistEditName">Playlist Name</label>
                <input type="text" id="playlistEditName" placeholder="Playlist name" maxlength="30">
            </div>
            <div class="add-song-form-group">
                <label>Color</label>
                <div class="color-swatch-grid" id="colorSwatchGrid">
                    <div class="color-swatch" data-color="#d4a574" style="background:#d4a574" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#e85d75" style="background:#e85d75" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#7eb8da" style="background:#7eb8da" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#9b7ed9" style="background:#9b7ed9" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#5cba5c" style="background:#5cba5c" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#e8a838" style="background:#e8a838" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#e86d5e" style="background:#e86d5e" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#d474b4" style="background:#d474b4" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#5bbfbf" style="background:#5bbfbf" onclick="selectPlaylistColor(this)"></div>
                    <div class="color-swatch" data-color="#8b9dc3" style="background:#8b9dc3" onclick="selectPlaylistColor(this)"></div>
                </div>
            </div>
            <div class="add-song-form-group" id="coverArtGroup">
                <label>Cover Art</label>
                <div class="cover-picker-grid" id="coverPickerGrid"></div>
            </div>
            <div class="add-song-modal-buttons">
                <button type="button" class="playlist-delete-btn" id="playlistDeleteBtn" onclick="deleteCurrentPlaylist()">Delete</button>
                <button type="button" class="add-song-btn-cancel" onclick="hidePlaylistEditModal()">Cancel</button>
                <button type="button" class="add-song-btn-save" id="playlistEditSaveBtn" onclick="savePlaylistEdit()">Save Changes</button>
            </div>
        </div>
    </div>

    <!-- Song Scanner Modal (reuses .add-song-modal shell; scan-specific inner steps) -->
    <div class="add-song-modal scan-modal" id="scanModal">
        <div class="add-song-modal-backdrop" onclick="hideScanModal()"></div>
        <div class="add-song-modal-panel">
            <button class="add-song-modal-close" onclick="hideScanModal()">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">
                        <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                </div>
                <h2 class="add-song-modal-title">Song Scanner</h2>
            </div>

            <!-- Step 1: Folder Picker -->
            <div class="scan-step" id="scanStep1">
                <p class="scan-step-desc">Select a folder with album cover images or audio files to identify and add songs.</p>
                <button class="scan-folder-btn" onclick="document.getElementById('scanFolderInput').click()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>Choose Folder</span>
                </button>
                <input type="file" id="scanFolderInput" webkitdirectory multiple style="display:none" onchange="handleScanFiles(this.files)">
                <div class="scan-or-divider">or drop files</div>
                <button class="scan-files-btn" onclick="document.getElementById('scanFilesInput').click()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" stroke="currentColor"/><polyline points="13 2 13 9 20 9" stroke="currentColor"/>
                    </svg>
                    <span>Select Files</span>
                </button>
                <input type="file" id="scanFilesInput" multiple accept="image/*,audio/*" style="display:none" onchange="handleScanFiles(this.files)">
                <div class="scan-or-divider">or snap a cover</div>
                <div class="scan-capture-row">
                    <button class="scan-capture-btn" onclick="document.getElementById('scanCameraInput').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <span>Camera</span>
                    </button>
                    <button class="scan-capture-btn" onclick="document.getElementById('scanGalleryInput').click()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        <span>Gallery</span>
                    </button>
                </div>
                <input type="file" id="scanCameraInput" accept="image/*" capture="environment" style="display:none" onchange="handleScanFiles(this.files)">
                <input type="file" id="scanGalleryInput" accept="image/*" multiple style="display:none" onchange="handleScanFiles(this.files)">
            </div>

            <!-- Step 2: Progress -->
            <div class="scan-step" id="scanStep2" style="display:none">
                <div class="scan-progress-label" id="scanProgressLabel">Scanning files...</div>
                <div class="scan-progress-bar">
                    <div class="scan-progress-fill" id="scanProgressFill"></div>
                </div>
                <div class="scan-progress-detail" id="scanProgressDetail"></div>
            </div>

            <!-- Step 3: Results -->
            <div class="scan-step" id="scanStep3" style="display:none">
                <div class="scan-results-header">
                    <span class="scan-results-count" id="scanResultsCount">0 songs found</span>
                    <label class="scan-select-all">
                        <input type="checkbox" id="scanSelectAll" checked onchange="toggleScanSelectAll(this.checked)">
                        Select all
                    </label>
                </div>
                <div class="scan-results-list" id="scanResultsList"></div>
                <div class="add-song-modal-buttons">
                    <button type="button" class="add-song-btn-cancel" onclick="resetScanModal()">Scan Again</button>
                    <button type="button" class="add-song-btn-save" id="scanAddBtn" onclick="scanAddSelected()">Add Selected</button>
                </div>
            </div>
        </div>
    </div>
    <!-- Settings Modal (playback source + Spotify) -->
    <div class="add-song-modal" id="settingsModal">
        <div class="add-song-modal-backdrop" onclick="hideSettingsModal()"></div>
        <div class="add-song-modal-panel">
            <button class="add-song-modal-close" onclick="hideSettingsModal()">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#9881;</div>
                <h2 class="add-song-modal-title">Settings</h2>
            </div>

            <div class="add-song-form-group">
                <label>Add-song source</label>
                <div class="settings-source-options" id="settingsSourceOptions">
                    <button type="button" class="settings-source-btn active" data-source="youtube" onclick="setMusicSource('youtube')">YouTube</button>
                    <button type="button" class="settings-source-btn" data-source="mp3" onclick="setMusicSource('mp3')">MP3 URL</button>
                    <button type="button" class="settings-source-btn" data-source="spotify" onclick="setMusicSource('spotify')">Spotify</button>
                </div>
                <p class="settings-hint">Sets what the Add Song box expects. Spotify tracks stream via the Web Playback SDK (Premium) or a matched YouTube video.</p>
            </div>

            <div class="add-song-form-group">
                <label>Playback</label>
                <label class="settings-toggle-row">
                    <span>Live lyrics</span>
                    <input type="checkbox" id="settingsLyricsToggle" onchange="setLyricsEnabledFromSettings(this.checked)">
                    <span class="settings-switch"></span>
                </label>
                <label class="settings-toggle-row">
                    <span>Vinyl crackle between songs</span>
                    <input type="checkbox" id="settingsCrackleToggle" onchange="setCrackleEnabledFromSettings(this.checked)">
                    <span class="settings-switch"></span>
                </label>
            </div>

            <div class="add-song-form-group settings-spotify-group">
                <label>Spotify</label>
                <div id="spotifyNotConfigured" class="spotify-state" style="display:none">
                    <p class="settings-hint">Not configured. Add your Spotify app's Client ID/Secret and redirect URI to the server's environment (services.spotify).</p>
                </div>
                <div id="spotifyNotConnected" class="spotify-state" style="display:none">
                    <button type="button" class="spotify-connect-btn" onclick="connectSpotify()">
                        <span class="spotify-glyph">&#9835;</span> Connect Spotify
                    </button>
                </div>
                <div id="spotifyConnected" class="spotify-state" style="display:none">
                    <div class="spotify-user" id="spotifyUserInfo"></div>
                    <div class="spotify-connected-actions">
                        <button type="button" class="add-song-btn-save" onclick="showSpotifyImportModal()">Import playlist</button>
                        <button type="button" class="add-song-btn-cancel" onclick="disconnectSpotify()">Disconnect</button>
                    </div>
                </div>
            </div>

            <div class="add-song-form-group settings-account-group">
                <label>Account</label>
                <div class="settings-hint" id="settingsAccountEmail">{{ auth()->user()->email }}</div>

                <div class="settings-inline-form">
                    <input type="text" id="settingsNameInput" value="{{ auth()->user()->name }}" maxlength="100" placeholder="Display name" autocomplete="name">
                    <button type="button" class="add-song-btn-save" onclick="saveAccountName()">Save</button>
                </div>
                <div class="settings-status" id="settingsNameStatus"></div>

                <details class="settings-password-details" id="settingsPasswordDetails">
                    <summary>Change password</summary>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsCurrentPassword" placeholder="Current password" autocomplete="current-password">
                    </div>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsNewPassword" placeholder="New password (at least 8 characters)" autocomplete="new-password">
                    </div>
                    <div class="add-song-form-group">
                        <input type="password" id="settingsNewPasswordConfirm" placeholder="Repeat new password" autocomplete="new-password">
                    </div>
                    <button type="button" class="add-song-btn-save" onclick="changeAccountPassword()">Update password</button>
                    <div class="settings-status" id="settingsPasswordStatus"></div>
                </details>

                <form method="POST" action="{{ route('logout') }}" class="settings-logout-form">
                    @csrf
                    <button class="add-song-btn-cancel">Log out</button>
                </form>
            </div>

            <div class="add-song-modal-buttons">
                <button type="button" class="add-song-btn-cancel" onclick="hideSettingsModal()">Close</button>
            </div>
        </div>
    </div>

    <!-- Spotify Import Modal -->
    <div class="add-song-modal" id="spotifyImportModal">
        <div class="add-song-modal-backdrop" onclick="hideSpotifyImportModal()"></div>
        <div class="add-song-modal-panel">
            <button class="add-song-modal-close" onclick="hideSpotifyImportModal()">&times;</button>
            <div class="add-song-modal-header">
                <div class="add-song-modal-icon">&#9835;</div>
                <h2 class="add-song-modal-title">Import from Spotify</h2>
            </div>

            <div class="add-song-form-group">
                <label for="spotifyImportUrl">Public playlist URL</label>
                <div class="spotify-import-url-row">
                    <input type="text" id="spotifyImportUrl" placeholder="https://open.spotify.com/playlist/...">
                    <button type="button" class="add-song-btn-save" onclick="fetchSpotifyPlaylistUrl()">Fetch</button>
                </div>
            </div>

            <div id="spotifyUserPlaylists" class="add-song-form-group" style="display:none">
                <label>Your playlists</label>
                <div class="spotify-playlists-list" id="spotifyPlaylistsList"></div>
            </div>

            <div id="spotifyImportLoading" class="spotify-import-loading" style="display:none">
                <span class="spotify-spinner"></span> Loading tracks&hellip;
            </div>

            <div id="spotifyImportPreview" class="spotify-import-preview" style="display:none">
                <div class="spotify-import-info" id="spotifyImportInfo"></div>
                <div class="spotify-import-tracks" id="spotifyImportTracks"></div>
                <div class="add-song-modal-buttons">
                    <button type="button" class="add-song-btn-cancel" onclick="hideSpotifyImportModal()">Cancel</button>
                    <button type="button" class="add-song-btn-save" onclick="importSpotifyPlaylist()">Add to current playlist</button>
                </div>
            </div>
        </div>
    </div>

    <!-- Vinyl GIF Maker modal -->
    <div class="vgm-modal" id="vinylGifModal">
        <div class="vgm-backdrop" onclick="closeVinylGifModal()"></div>
        <div class="vgm-panel">
            <button class="vgm-close" onclick="closeVinylGifModal()" title="Close">&times;</button>
            <div class="vgm-header">
                <div class="vgm-header-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <circle cx="12" cy="12" r="4"/>
                        <circle cx="12" cy="12" r="1" fill="currentColor"/>
                    </svg>
                </div>
                <div class="vgm-header-text">
                    <h2>Vinyl GIF Maker</h2>
                    <p>Spin a cover into a shareable GIF</p>
                </div>
            </div>

            <div class="vgm-body">
                <!-- Left: Preview -->
                <div class="vgm-preview-side">
                    <div class="vgm-preview-stage">
                        <canvas id="vgmPreviewCanvas" width="480" height="480"></canvas>
                        <img id="vgmResultImg" class="vgm-result-img" alt="Generated vinyl GIF" style="display:none">
                        <div class="vgm-preview-empty" id="vgmPreviewEmpty">
                            <div class="vgm-preview-empty-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="9"/>
                                    <circle cx="12" cy="12" r="3"/>
                                </svg>
                            </div>
                            <p>Load a cover to start</p>
                        </div>
                    </div>
                    <div class="vgm-progress" id="vgmProgress">
                        <div class="vgm-progress-bar"><div class="vgm-progress-fill" id="vgmProgressFill"></div></div>
                        <div class="vgm-progress-text" id="vgmProgressText">Encoding 0%</div>
                    </div>
                    <div class="vgm-result-meta" id="vgmResultMeta" style="display:none"></div>
                    <div class="vgm-result-actions" id="vgmResultActions" style="display:none">
                        <a class="vgm-btn vgm-btn-primary" id="vgmDownloadLink" download>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download GIF
                        </a>
                        <button class="vgm-btn vgm-btn-ghost" onclick="vgmMakeAnother()">Make another</button>
                    </div>
                </div>

                <!-- Right: Controls -->
                <div class="vgm-controls-side">
                    <!-- Source Tabs -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Cover Source</div>
                        <div class="vgm-tab-toggle">
                            <button class="vgm-tab active" data-source-tab="youtube" onclick="vgmSwitchSourceTab('youtube')">URL</button>
                            <button class="vgm-tab" data-source-tab="search"  onclick="vgmSwitchSourceTab('search')">Search</button>
                            <button class="vgm-tab" data-source-tab="upload"  onclick="vgmSwitchSourceTab('upload')">Upload</button>
                        </div>

                        <div class="vgm-source-panel" data-source-panel="youtube">
                            <div class="vgm-input-row">
                                <input type="text" id="vgmYoutubeUrl" placeholder="Paste YouTube URL or video ID" autocomplete="off">
                                <button class="vgm-btn vgm-btn-secondary" onclick="vgmLoadYoutubeThumb()">Load</button>
                            </div>
                            <div class="vgm-thumb-variants" id="vgmThumbVariants"></div>
                        </div>

                        <div class="vgm-source-panel" data-source-panel="search" style="display:none">
                            <div class="vgm-input-row">
                                <input type="text" id="vgmSearchQuery" placeholder="Search album / artist (iTunes)…" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault(); vgmSearchYoutube();}">
                                <button class="vgm-btn vgm-btn-secondary" onclick="vgmSearchYoutube()">Search</button>
                            </div>
                            <div class="vgm-thumb-variants" id="vgmSearchResults"></div>
                        </div>

                        <div class="vgm-source-panel" data-source-panel="upload" style="display:none">
                            <label class="vgm-upload-drop" id="vgmUploadDrop">
                                <input type="file" id="vgmUploadInput" accept="image/*" style="display:none" onchange="vgmHandleUpload(event)">
                                <span class="vgm-upload-icon">&#8682;</span>
                                <span class="vgm-upload-text">Click to upload an image</span>
                            </label>
                            <div class="vgm-cropper" id="vgmCropper" style="display:none">
                                <div class="vgm-cropper-stage">
                                    <canvas id="vgmCropperCanvas" width="280" height="280"></canvas>
                                    <div class="vgm-cropper-overlay" id="vgmCropperOverlay"></div>
                                </div>
                                <div class="vgm-cropper-controls">
                                    <label class="vgm-slider-label">Zoom</label>
                                    <input type="range" id="vgmCropZoom" min="1" max="3" step="0.01" value="1">
                                    <button class="vgm-btn vgm-btn-secondary vgm-btn-small" onclick="vgmApplyCrop()">Use this crop</button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Vinyl Style -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Vinyl Style</div>
                        <div class="vgm-style-grid" id="vgmStyleGrid">
                            <button class="vgm-style-chip active" data-style="classic" onclick="vgmSelectStyle('classic')"><span class="vgm-chip-swatch vgm-swatch-classic"></span><span>Classic</span></button>
                            <button class="vgm-style-chip" data-style="colored" onclick="vgmSelectStyle('colored')"><span class="vgm-chip-swatch vgm-swatch-colored"></span><span>Colored</span></button>
                            <button class="vgm-style-chip" data-style="picture" onclick="vgmSelectStyle('picture')"><span class="vgm-chip-swatch vgm-swatch-picture"></span><span>Picture Disc</span></button>
                            <button class="vgm-style-chip" data-style="gold" onclick="vgmSelectStyle('gold')"><span class="vgm-chip-swatch vgm-swatch-gold"></span><span>Gold Label</span></button>
                            <button class="vgm-style-chip" data-style="translucent" onclick="vgmSelectStyle('translucent')"><span class="vgm-chip-swatch vgm-swatch-translucent"></span><span>Translucent</span></button>
                            <button class="vgm-style-chip" data-style="aura" onclick="vgmSelectStyle('aura')"><span class="vgm-chip-swatch vgm-swatch-aura"></span><span>Aura</span></button>
                        </div>
                        <label class="vgm-toggle-row" title="Toggle the small hole at the center of the vinyl">
                            <input type="checkbox" id="vgmShowHole" checked onchange="vgmSetShowHole(this.checked)">
                            <span class="vgm-toggle-switch"></span>
                            <span class="vgm-toggle-label">Center hole</span>
                        </label>
                        <div class="vgm-color-row" id="vgmColorRow" style="display:none">
                            <span class="vgm-color-row-label">Vinyl color</span>
                            <div class="vgm-color-swatches" id="vgmColorSwatches">
                                <button class="vgm-color-swatch active" data-color="#d4476b" style="background:#d4476b"></button>
                                <button class="vgm-color-swatch" data-color="#e8a838" style="background:#e8a838"></button>
                                <button class="vgm-color-swatch" data-color="#5cba5c" style="background:#5cba5c"></button>
                                <button class="vgm-color-swatch" data-color="#7eb8da" style="background:#7eb8da"></button>
                                <button class="vgm-color-swatch" data-color="#9b7ed9" style="background:#9b7ed9"></button>
                                <button class="vgm-color-swatch" data-color="#f0f0f0" style="background:#f0f0f0"></button>
                                <label class="vgm-color-wheel" title="Custom color">
                                    <input type="color" id="vgmColorPicker" value="#d4476b">
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Caption -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Caption (optional)</div>
                        <input type="text" id="vgmCaption" class="vgm-text-input" placeholder="e.g. Late Night Mix" maxlength="60" oninput="vgmRedrawPreview()">
                    </div>

                    <!-- Spin Speed -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">
                            <span>Spin Speed</span>
                            <span class="vgm-speed-value" id="vgmSpeedValue">1.0&times;</span>
                        </div>
                        <div class="vgm-speed-row">
                            <span class="vgm-speed-tick">0.5&times;</span>
                            <input type="range" id="vgmSpeed" class="vgm-speed-slider" min="0.5" max="2.5" step="0.1" value="1">
                            <span class="vgm-speed-tick">2.5&times;</span>
                        </div>
                    </div>

                    <!-- Quality -->
                    <div class="vgm-section">
                        <div class="vgm-section-title">Quality</div>
                        <div class="vgm-quality-grid">
                            <button class="vgm-quality-chip" data-quality="small" onclick="vgmSelectQuality('small')">
                                <span class="vgm-quality-name">Small</span>
                                <span class="vgm-quality-meta">320 &middot; 24 fr</span>
                            </button>
                            <button class="vgm-quality-chip active" data-quality="medium" onclick="vgmSelectQuality('medium')">
                                <span class="vgm-quality-name">Medium</span>
                                <span class="vgm-quality-meta">460 &middot; 36 fr</span>
                            </button>
                            <button class="vgm-quality-chip" data-quality="large" onclick="vgmSelectQuality('large')">
                                <span class="vgm-quality-name">Large</span>
                                <span class="vgm-quality-meta">560 &middot; 48 fr</span>
                            </button>
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="vgm-actions">
                        <button class="vgm-btn vgm-btn-ghost" onclick="closeVinylGifModal()">Cancel</button>
                        <button class="vgm-btn vgm-btn-primary" id="vgmGenerateBtn" onclick="vgmGenerateGif()" disabled>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Generate GIF
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <!-- PHP-injected data for JavaScript -->
    @php
        $meta = [];
        foreach ($playlists as $id => $pl) {
            $covers = [];
            $seenCovers = [];
            foreach (($pl['songs'] ?? []) as $idx => $s) {
                $c = $s['cover'] ?? '';
                if ($c && !in_array($c, $seenCovers)) {
                    $seenCovers[] = $c;
                    $covers[] = ['index' => $idx, 'url' => $c, 'title' => $s['title'] ?? ''];
                }
            }
            $meta[$id] = ['name' => $pl['name'] ?? $id, 'color' => nt_safe_css_color($pl['color'] ?? '#d4a574'), 'songCount' => count($pl['songs'] ?? []), 'coverSongIndex' => $pl['coverSongIndex'] ?? null, 'covers' => $covers];
        }
    @endphp
    <script>
        let activePlaylistId = '{{ $activePlaylistId }}';
        let songsData = @json($songs);
        let currentSongIndex = {{ (int) $currentIndex }};
        let playlistsMeta = @json((object) $meta);
        let recentlyPlayed = @json($recentlyPlayed);
    </script>
    <!-- gif.js encoder for the Vinyl GIF Maker (client-side GIF encoding + worker) -->
    <script src="{{ asset('vendor/gif.js/gif.js') }}?v={{ filemtime(public_path('vendor/gif.js/gif.js')) }}" defer></script>
    <script src="{{ asset('js/script.js') }}?v={{ filemtime(public_path('js/script.js')) }}"></script>
    <!-- Spotify Web Playback SDK (Premium streaming). Loaded after script.js so
         window.onSpotifyWebPlaybackSDKReady is defined before the SDK fires it. -->
    <script src="https://sdk.scdn.co/spotify-player.js"></script>
</body>
</html>
