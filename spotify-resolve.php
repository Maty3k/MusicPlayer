<?php
// Resolve a Spotify track to a playable YouTube video id.
//
// Spotify imports store only spotify_id + metadata. Non-Premium users can't
// stream via the Web Playback SDK, so on first play we scrape a YouTube search
// for "<artist> <title>", cache the match by spotify_id, and write youtube_id
// back onto the song. Subsequent plays are instant.
header('Content-Type: application/json');
require_once __DIR__ . '/auth-guard.php';
mp_require_auth();
require_once __DIR__ . '/rate-limit.php';
require_once __DIR__ . '/data-io.php';
require_once __DIR__ . '/youtube-extract.php';
nt_rate_limit('spotify_resolve', 20, 800);

set_time_limit(15);

$DATA_DIR = __DIR__ . '/data';
$MUSIC_FILE = $DATA_DIR . '/music.json';
$YT_CACHE_FILE = $DATA_DIR . '/spotify-youtube-cache.json';

function search_youtube_id($query) {
    $url = 'https://www.youtube.com/results?' . http_build_query(['search_query' => $query]);
    $ctx = stream_context_create([
        'http' => [
            'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\nAccept-Language: en-US,en;q=0.9\r\n",
            'timeout' => 8
        ]
    ]);
    $html = @file_get_contents($url, false, $ctx);
    if (!$html) return null;
    return nt_yt_first_video_id($html);
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$spotifyId   = trim($input['spotify_id']   ?? '');
$playlistKey = trim($input['playlist_key'] ?? '');
$songIndex   = isset($input['song_index']) ? (int)$input['song_index'] : -1;
$title       = trim($input['title']  ?? '');
$artist      = trim($input['artist'] ?? '');

if (!$title) {
    echo json_encode(['success' => false, 'error' => 'Missing title']);
    exit;
}

// Fast path: cache hit (plain read, no lock needed).
$cache = file_exists($YT_CACHE_FILE) ? (json_decode(@file_get_contents($YT_CACHE_FILE), true) ?: []) : [];
if ($spotifyId && !empty($cache[$spotifyId])) {
    echo json_encode(['success' => true, 'youtube_id' => $cache[$spotifyId], 'cached' => true]);
    exit;
}

$query = trim($artist . ' ' . $title);
$ytId  = search_youtube_id($query);

// Only accept a well-formed 11-char YouTube video ID (the ytInitialData path
// can return arbitrary strings); never cache/persist anything else.
if (!$ytId || !preg_match('/^[A-Za-z0-9_-]{11}$/', $ytId)) {
    echo json_encode(['success' => false, 'error' => 'No YouTube result found', 'query' => $query]);
    exit;
}

// Persist in cache. Re-read under the lock and merge so a concurrent resolver's
// entry isn't clobbered (the slow YouTube scrape above ran without the lock).
if ($spotifyId) {
    $cache = nt_lock_json($YT_CACHE_FILE, []);
    $cache[$spotifyId] = $ytId;
    nt_save_json($YT_CACHE_FILE, $cache);
}

// Persist onto the specific song in music.json — but only when the stored song's
// spotify_id matches this request's, so playlist_key/song_index can't be used to
// overwrite an arbitrary (e.g. non-Spotify) song's youtube_id with a chosen video.
if ($playlistKey && $songIndex >= 0 && $spotifyId !== '' && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $playlistKey)) {
    $music = nt_lock_json($MUSIC_FILE, ['playlists' => []]);
    $song = $music['playlists'][$playlistKey]['songs'][$songIndex] ?? null;
    if ($song !== null && ($song['spotify_id'] ?? '') === $spotifyId) {
        $music['playlists'][$playlistKey]['songs'][$songIndex]['youtube_id'] = $ytId;
        nt_save_json($MUSIC_FILE, $music);
    }
}

echo json_encode(['success' => true, 'youtube_id' => $ytId, 'cached' => false]);
