<?php
header('Content-Type: application/json');
require_once __DIR__ . '/auth-guard.php';
mp_require_auth();
require_once __DIR__ . '/data-io.php';

$input = json_decode(file_get_contents('php://input'), true);
$action = $input['action'] ?? '';

// Reject any URL that isn't plain http(s). Blocks javascript:, data:, file:,
// blob:, vbscript:, etc. — these are XSS / SSRF / exfil sinks once a song
// field is rendered into <img src> / <audio src>. Empty string is allowed.
function sanitizeUrl($value) {
    if ($value === null || $value === '') return '';
    $str = trim((string)$value);
    if ($str === '') return '';
    // Allow http(s) absolute URLs and root-relative paths only.
    if (preg_match('#^https?://[^\s<>"\']+$#i', $str)) return $str;
    if (preg_match('#^/[^\s<>"\']*$#', $str)) return $str;
    return '';
}

$filePath = __DIR__ . '/data/music.json';
// nt_lock_json takes an exclusive cross-process lock (held for the whole
// request) and returns the current contents; nt_save_json below completes the
// read-modify-write atomically. Guards against lost updates when the browser
// and the mobile app mutate music.json at the same time.
$music = nt_lock_json($filePath, [
    'activePlaylist' => 'favorites',
    'playlists' => [],
    'recentlyPlayed' => []
]);
$playlists = $music['playlists'] ?? [];
$defaultPlaylist = !empty($playlists) ? array_key_first($playlists) : 'favorites';

if ($action === 'switch') {
    // Switch to a different song within current playlist
    $index = (int)($input['index'] ?? 0);
    $activePlaylist = $music['activePlaylist'] ?? $defaultPlaylist;

    if (isset($music['playlists'][$activePlaylist]['songs'][$index])) {
        $music['playlists'][$activePlaylist]['currentIndex'] = $index;
        nt_save_json($filePath, $music);
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid song index']);
    }
} elseif ($action === 'switchPlaylist') {
    // Switch to a different playlist
    $playlistId = $input['playlist'] ?? '';

    if (isset($music['playlists'][$playlistId])) {
        $music['activePlaylist'] = $playlistId;

        // Update recentlyPlayed: move to front, keep max 4
        $recent = $music['recentlyPlayed'] ?? [];
        $recent = array_values(array_filter($recent, fn($id) => $id !== $playlistId));
        array_unshift($recent, $playlistId);
        $music['recentlyPlayed'] = array_slice($recent, 0, 4);

        nt_save_json($filePath, $music);
        echo json_encode([
            'success' => true,
            'playlist' => $music['playlists'][$playlistId],
            'playlistId' => $playlistId,
            'recentlyPlayed' => $music['recentlyPlayed']
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist']);
    }
} elseif ($action === 'add') {
    // Add a new song to current playlist
    $song = $input['song'] ?? null;
    $activePlaylist = $music['activePlaylist'] ?? $defaultPlaylist;

    if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', (string)$activePlaylist)
        || (!isset($music['playlists'][$activePlaylist]) && $activePlaylist !== 'favorites')) {
        // Only ever auto-create the default 'favorites' playlist (the bootstrap
        // case); never auto-vivify an unknown, attacker-chosen key.
        echo json_encode(['success' => false, 'error' => 'Invalid active playlist']);
    } elseif ($song && !empty($song['title'])) {
        $music['playlists'][$activePlaylist]['songs'][] = [
            'title' => $song['title'] ?? '',
            'artist' => $song['artist'] ?? '',
            'album' => $song['album'] ?? '',
            'cover' => sanitizeUrl($song['cover'] ?? ''),
            'youtube_id' => $song['youtube_id'] ?? '',
            'mp3_url' => sanitizeUrl($song['mp3_url'] ?? ''),
            'spotify_id' => $song['spotify_id'] ?? ''
        ];
        $newIndex = count($music['playlists'][$activePlaylist]['songs']) - 1;
        $music['playlists'][$activePlaylist]['currentIndex'] = $newIndex;
        nt_save_json($filePath, $music);
        echo json_encode(['success' => true, 'index' => $newIndex]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Missing song data']);
    }
} elseif ($action === 'delete') {
    $index = filter_var($input['index'] ?? null, FILTER_VALIDATE_INT);
    $activePlaylist = $input['playlist'] ?? $music['activePlaylist'] ?? $defaultPlaylist;

    if ($index !== false && $index >= 0 && isset($music['playlists'][$activePlaylist]['songs'][$index])) {
        array_splice($music['playlists'][$activePlaylist]['songs'], $index, 1);
        $music['playlists'][$activePlaylist]['songs'] = array_values($music['playlists'][$activePlaylist]['songs']);
        $total = count($music['playlists'][$activePlaylist]['songs']);
        $cur = $music['playlists'][$activePlaylist]['currentIndex'] ?? 0;
        if ($total === 0) {
            $newIndex = 0;
        } elseif ($index < $cur || $cur >= $total) {
            $newIndex = max(0, $cur - 1);
        } else {
            $newIndex = $cur;
        }
        $music['playlists'][$activePlaylist]['currentIndex'] = $newIndex;
        nt_save_json($filePath, $music);
        echo json_encode(['success' => true, 'newIndex' => $newIndex]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid song index']);
    }
} elseif ($action === 'rename') {
    $playlistId = $input['playlist'] ?? '';
    $name = trim($input['name'] ?? '');

    if (isset($music['playlists'][$playlistId]) && $name !== '') {
        $music['playlists'][$playlistId]['name'] = $name;
        nt_save_json($filePath, $music);
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or empty name']);
    }
} elseif ($action === 'recolor') {
    $playlistId = $input['playlist'] ?? '';
    $color = $input['color'] ?? '';

    if (isset($music['playlists'][$playlistId]) && preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
        $music['playlists'][$playlistId]['color'] = $color;
        nt_save_json($filePath, $music);
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or color format']);
    }
} elseif ($action === 'moveSong') {
    $fromPlaylist = $input['fromPlaylist'] ?? '';
    $toPlaylist = $input['toPlaylist'] ?? '';
    $songIndex = filter_var($input['songIndex'] ?? null, FILTER_VALIDATE_INT);

    if ($fromPlaylist === $toPlaylist) {
        echo json_encode(['success' => false, 'error' => 'Cannot move to same playlist']);
    } elseif ($songIndex !== false && $songIndex >= 0 && isset($music['playlists'][$fromPlaylist]['songs'][$songIndex]) && isset($music['playlists'][$toPlaylist])) {
        $song = $music['playlists'][$fromPlaylist]['songs'][$songIndex];

        // Add to target
        $music['playlists'][$toPlaylist]['songs'][] = $song;

        // Remove from source
        array_splice($music['playlists'][$fromPlaylist]['songs'], $songIndex, 1);
        $music['playlists'][$fromPlaylist]['songs'] = array_values($music['playlists'][$fromPlaylist]['songs']);

        // Fix currentIndex for source playlist
        $total = count($music['playlists'][$fromPlaylist]['songs']);
        $cur = $music['playlists'][$fromPlaylist]['currentIndex'] ?? 0;
        if ($total === 0) {
            $music['playlists'][$fromPlaylist]['currentIndex'] = 0;
        } elseif ($songIndex < $cur || $cur >= $total) {
            $music['playlists'][$fromPlaylist]['currentIndex'] = max(0, $cur - 1);
        }

        nt_save_json($filePath, $music);
        echo json_encode([
            'success' => true,
            'newIndex' => $music['playlists'][$fromPlaylist]['currentIndex'],
            'fromCount' => count($music['playlists'][$fromPlaylist]['songs']),
            'toCount' => count($music['playlists'][$toPlaylist]['songs'])
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or song index']);
    }
} elseif ($action === 'copySong') {
    $fromPlaylist = $input['fromPlaylist'] ?? '';
    $toPlaylist = $input['toPlaylist'] ?? '';
    $songIndex = filter_var($input['songIndex'] ?? null, FILTER_VALIDATE_INT);

    if ($fromPlaylist === $toPlaylist) {
        echo json_encode(['success' => false, 'error' => 'Cannot copy to same playlist']);
    } elseif ($songIndex !== false && $songIndex >= 0 && isset($music['playlists'][$fromPlaylist]['songs'][$songIndex]) && isset($music['playlists'][$toPlaylist])) {
        $song = $music['playlists'][$fromPlaylist]['songs'][$songIndex];
        $music['playlists'][$toPlaylist]['songs'][] = $song;

        nt_save_json($filePath, $music);
        echo json_encode([
            'success' => true,
            'toCount' => count($music['playlists'][$toPlaylist]['songs'])
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or song index']);
    }
} elseif ($action === 'setCover') {
    $playlistId = $input['playlist'] ?? '';
    $rawIndex = $input['songIndex'] ?? null;
    $songIndex = ($rawIndex === null) ? null : filter_var($rawIndex, FILTER_VALIDATE_INT);

    if (isset($music['playlists'][$playlistId])) {
        if ($songIndex === null || $songIndex === -1) {
            // Reset to auto-pick
            unset($music['playlists'][$playlistId]['coverSongIndex']);
        } elseif ($songIndex !== false && $songIndex >= 0 && isset($music['playlists'][$playlistId]['songs'][$songIndex])) {
            $music['playlists'][$playlistId]['coverSongIndex'] = $songIndex;
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid song index']);
            exit;
        }
        nt_save_json($filePath, $music);
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist']);
    }
} elseif ($action === 'getAll') {
    // Return all data in one call (for mobile app initial load)
    echo json_encode([
        'success' => true,
        'activePlaylist' => $music['activePlaylist'] ?? $defaultPlaylist,
        'recentlyPlayed' => $music['recentlyPlayed'] ?? [],
        'playlists' => $music['playlists'] ?? []
    ]);
} else {
    echo json_encode(['success' => false, 'error' => 'Invalid action']);
}
