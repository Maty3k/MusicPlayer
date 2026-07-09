<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Music Player</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles.css?v=<?= filemtime('styles.css') ?>">
</head>
<body>
<?php
require_once __DIR__ . '/sanitize.php';
$musicPath = __DIR__ . '/data/music.json';
$music = file_exists($musicPath) ? json_decode(file_get_contents($musicPath), true) : [];
$playlists = $music['playlists'] ?? [];
$activePlaylistId = $music['activePlaylist'] ?? (!empty($playlists) ? array_key_first($playlists) : 'favorites');
$activePlaylist = $playlists[$activePlaylistId] ?? ['songs' => [], 'currentIndex' => 0];
$songs = $activePlaylist['songs'] ?? [];
$currentIndex = $activePlaylist['currentIndex'] ?? 0;
$current = $songs[$currentIndex] ?? [];
?>

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
                        <div class="mini-turntable" onclick="selectPlaylistFromCrate('<?= htmlspecialchars($activePlaylistId) ?>')" title="<?= htmlspecialchars($activePlaylist['name'] ?? 'Now Playing') ?>">
                            <div class="turntable-base">
                                <div class="turntable-platter">
                                    <div class="mini-strobe-dots"></div>
                                    <div class="platter-vinyl" id="platterVinyl">
                                        <div class="platter-label" id="platterLabel" style="--label-color: <?= nt_safe_css_color($activePlaylist['color'] ?? '#d4a574') ?>">
                                            <?php if (!empty($current['cover'])): ?>
                                            <img src="<?= htmlspecialchars($current['cover']) ?>" alt="">
                                            <?php endif; ?>
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
                                <div class="amp-display"><span class="amp-display-text" id="ampDisplayText"><?= htmlspecialchars(($current['artist'] ?? '') . ' - ' . ($current['title'] ?? 'No song')) ?></span></div>
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
                    </div>
                </div>

                <!-- Center - Records -->
                <div class="room-center">
                    <div class="greeting-text">
                        <h1>My Collection</h1>
                        <p>pick something to play</p>
                    </div>

                    <div class="records-display">
                        <?php
                        $totalTracks = 0;
                        $usedCovers = [];
                        foreach ($playlists as $playlistId => $playlist):
                            $playlistSongs = $playlist['songs'] ?? [];
                            $songCount = count($playlistSongs);
                            $totalTracks += $songCount;
                            $playlistColor = nt_safe_css_color($playlist['color'] ?? '#d4a574');

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
                            $firstSong = $coverSong ?? $playlistSongs[0] ?? null;
                        ?>
                        <div class="record-card<?= $playlistId === $activePlaylistId ? ' now-playing' : '' ?>"
                             data-playlist="<?= htmlspecialchars($playlistId) ?>"
                             style="--card-color: <?= $playlistColor ?>"
                             onclick="selectPlaylistFromCrate('<?= htmlspecialchars($playlistId) ?>')">
                            <div class="record-card-vinyl">
                                <div class="vinyl-peek">
                                    <div class="vinyl-grooves"></div>
                                    <div class="vinyl-shine"></div>
                                    <div class="vinyl-label">
                                        <?php if ($coverUrl): ?>
                                        <img src="<?= htmlspecialchars($coverUrl) ?>" alt="">
                                        <?php endif; ?>
                                    </div>
                                    <div class="vinyl-hole"></div>
                                </div>
                            </div>
                            <div class="record-card-cover">
                                <div class="cover-art" style="background: linear-gradient(135deg, <?= $playlistColor ?> 0%, <?= $playlistColor ?>99 100%);">
                                    <?php if ($coverUrl): ?>
                                    <img src="<?= htmlspecialchars($coverUrl) ?>" alt="" class="cover-main">
                                    <?php endif; ?>
                                    <div class="cover-overlay"></div>
                                    <div class="cover-texture"></div>
                                </div>
                                <div class="cover-badge" style="background: <?= $playlistColor ?>;">
                                    <?= $songCount ?>
                                </div>
                                <div class="cover-info">
                                    <div class="cover-title"><?= htmlspecialchars($playlist['name']) ?></div>
                                    <div class="cover-preview">
                                        <?php if ($firstSong): ?>
                                        <span class="preview-track"><?= htmlspecialchars(substr($firstSong['title'], 0, 18)) ?><?= strlen($firstSong['title']) > 18 ? '...' : '' ?></span>
                                        <?php endif; ?>
                                    </div>
                                </div>
                                <div class="cover-glow"></div>
                            </div>
                            <div class="play-hint">
                                <span>&#9654;</span>
                            </div>
                            <button class="playlist-edit-btn" onclick="event.stopPropagation(); showPlaylistEditModal('<?= htmlspecialchars($playlistId) ?>')" title="Edit playlist">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
                                    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                                </svg>
                            </button>
                            <div class="card-reflection"></div>
                        </div>
                        <?php endforeach; ?>
                    </div>

                    <div class="collection-stats">
                        <div class="stat-item">
                            <span class="stat-icon">&#128191;</span>
                            <span class="stat-num"><?= $totalTracks ?></span>
                            <span class="stat-text">tracks</span>
                        </div>
                        <div class="stat-divider"></div>
                        <div class="stat-item">
                            <span class="stat-icon">&#128193;</span>
                            <span class="stat-num"><?= count($playlists) ?></span>
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
                                <?php
                                $recentlyPlayed = $music['recentlyPlayed'] ?? array_keys($playlists);
                                foreach ($recentlyPlayed as $crateId):
                                    if (!isset($playlists[$crateId])) continue;
                                    $cratePlaylist = $playlists[$crateId];
                                    $crateColor = nt_safe_css_color($cratePlaylist['color'] ?? '#d4a574');
                                    $crateName = $cratePlaylist['name'] ?? $crateId;
                                ?>
                                <div class="crate-record" data-crate-playlist="<?= htmlspecialchars($crateId) ?>" style="--r-color: <?= htmlspecialchars($crateColor) ?>;" onclick="selectPlaylistFromCrate('<?= htmlspecialchars($crateId) ?>')" title="<?= htmlspecialchars($crateName) ?>"></div>
                                <?php endforeach; ?>
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
                    <div class="music-sidebar-title" id="playlistTitle"><?= htmlspecialchars($activePlaylist['name'] ?? 'My Records') ?></div>
                    <button class="add-song-btn" onclick="showAddSongModal()" title="Add a song">+</button>
                </div>
                <div class="sidebar-track-count"><?= count($songs) ?> tracks</div>
            </div>
            <ul class="song-list" id="songList">
                <?php foreach ($songs as $index => $song): ?>
                <li class="song-list-item <?= $index === $currentIndex ? 'active' : '' ?>"
                    data-index="<?= $index ?>"
                    onclick="switchSong(<?= $index ?>)">
                    <div class="song-list-vinyl">
                        <div class="song-list-vinyl-groove"></div>
                        <?php if (!empty($song['cover'])): ?>
                        <img class="song-list-cover" src="<?= htmlspecialchars($song['cover']) ?>" alt="">
                        <?php else: ?>
                        <div class="song-list-cover song-list-cover-empty">&#9834;</div>
                        <?php endif; ?>
                        <div class="song-list-vinyl-hole"></div>
                    </div>
                    <div class="song-list-info">
                        <div class="song-list-title"><?= htmlspecialchars($song['title']) ?></div>
                        <div class="song-list-artist"><?= htmlspecialchars($song['artist']) ?></div>
                        <div class="song-list-playing-indicator">
                            <span></span><span></span><span></span><span></span>
                        </div>
                    </div>
                    <span class="song-list-num"><?= str_pad($index + 1, 2, '0', STR_PAD_LEFT) ?></span>
                    <div class="song-actions">
                        <button class="song-send-btn" onclick="event.stopPropagation(); showSendMenu(this, <?= $index ?>)" title="Send to playlist">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
                                <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
                            </svg>
                        </button>
                        <button class="song-delete-btn" onclick="event.stopPropagation(); deleteSong(<?= $index ?>)" title="Remove song">&times;</button>
                    </div>
                </li>
                <?php endforeach; ?>
            </ul>
        </div>

        <!-- Main record player area -->
        <div class="music-main">
            <div class="music-main-backdrop" id="musicBackdrop">
                <?php if (!empty($current['cover'])): ?>
                <img src="<?= htmlspecialchars($current['cover']) ?>" alt="" id="backdropImg">
                <?php else: ?>
                <img src="" alt="" id="backdropImg" style="display:none;">
                <?php endif; ?>
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
                    <?php if (!empty($current['cover'])): ?>
                        <img src="<?= htmlspecialchars($current['cover']) ?>" alt="Album Cover" id="sleeveArtImg">
                    <?php else: ?>
                        <img src="" alt="" id="sleeveArtImg" style="display:none;">
                        <div class="sleeve-art-placeholder" id="sleeveArtPlaceholder">&#9834;</div>
                    <?php endif; ?>
                </div>
                <div class="sleeve-lyrics" id="sleeveLyrics">
                    <div class="lyrics-placeholder">Play a song to see lyrics</div>
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
                    <span class="sleeve-track-num" id="sleeveTrackNum">TRACK <?= str_pad($currentIndex + 1, 2, '0', STR_PAD_LEFT) ?></span>
                </div>
            </div>

            <div class="record-player">
                <div class="record-player-body">
                    <div class="record-player-platter">
                        <div class="strobe-dots"></div>
                        <div class="record" id="vinyl">
                            <div class="record-label">
                                <?php if (!empty($current['cover'])): ?>
                                    <img src="<?= htmlspecialchars($current['cover']) ?>" alt="Album Cover">
                                <?php else: ?>
                                    <div class="record-label-placeholder">&#9834;</div>
                                <?php endif; ?>
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
                            <div class="song-title"><?= htmlspecialchars($current['title'] ?? 'No song playing') ?></div>
                            <div class="song-artist"><?= htmlspecialchars($current['artist'] ?? '') ?></div>
                            <div class="song-album"><?= htmlspecialchars($current['album'] ?? '') ?></div>
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
                    <label for="addSongYoutube">YouTube URL or ID</label>
                    <input type="text" id="addSongYoutube" placeholder="https://youtube.com/watch?v=... or video ID" required>
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
                <h2 class="add-song-modal-title">Edit Playlist</h2>
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
            <div class="add-song-form-group">
                <label>Cover Art</label>
                <div class="cover-picker-grid" id="coverPickerGrid"></div>
            </div>
            <div class="add-song-modal-buttons">
                <button type="button" class="add-song-btn-cancel" onclick="hidePlaylistEditModal()">Cancel</button>
                <button type="button" class="add-song-btn-save" onclick="savePlaylistEdit()">Save Changes</button>
            </div>
        </div>
    </div>

    <!-- PHP-injected data for JavaScript -->
    <script>
        let activePlaylistId = '<?= $activePlaylistId ?>';
        let songsData = <?= json_encode($songs) ?>;
        let currentSongIndex = <?= $currentIndex ?>;
        let playlistsMeta = <?php
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
            echo json_encode((object)$meta);
        ?>;
        let recentlyPlayed = <?= json_encode($music['recentlyPlayed'] ?? array_keys($playlists)) ?>;
    </script>
    <script src="script.js?v=<?= filemtime('script.js') ?>"></script>
</body>
</html>
