<?php
header('Content-Type: application/json');

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
$music = file_exists($filePath) ? json_decode(file_get_contents($filePath), true) : [
    'activePlaylist' => 'favorites',
    'playlists' => [],
    'recentlyPlayed' => []
];
$playlists = $music['playlists'] ?? [];
$defaultPlaylist = !empty($playlists) ? array_key_first($playlists) : 'favorites';

if ($action === 'switch') {
    // Switch to a different song within current playlist
    $index = (int)($input['index'] ?? 0);
    $activePlaylist = $music['activePlaylist'] ?? $defaultPlaylist;

    if (isset($music['playlists'][$activePlaylist]['songs'][$index])) {
        $music['playlists'][$activePlaylist]['currentIndex'] = $index;
        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
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

        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
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

    if ($song && !empty($song['title'])) {
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
        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
        echo json_encode(['success' => true, 'index' => $newIndex]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Missing song data']);
    }
} elseif ($action === 'delete') {
    $index = $input['index'] ?? null;
    $activePlaylist = $input['playlist'] ?? $music['activePlaylist'] ?? $defaultPlaylist;

    if ($index !== null && isset($music['playlists'][$activePlaylist]['songs'][$index])) {
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
        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
        echo json_encode(['success' => true, 'newIndex' => $newIndex]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid song index']);
    }
} elseif ($action === 'rename') {
    $playlistId = $input['playlist'] ?? '';
    $name = trim($input['name'] ?? '');

    if (isset($music['playlists'][$playlistId]) && $name !== '') {
        $music['playlists'][$playlistId]['name'] = $name;
        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or empty name']);
    }
} elseif ($action === 'recolor') {
    $playlistId = $input['playlist'] ?? '';
    $color = $input['color'] ?? '';

    if (isset($music['playlists'][$playlistId]) && preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
        $music['playlists'][$playlistId]['color'] = $color;
        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
        echo json_encode(['success' => true]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or color format']);
    }
} elseif ($action === 'moveSong') {
    $fromPlaylist = $input['fromPlaylist'] ?? '';
    $toPlaylist = $input['toPlaylist'] ?? '';
    $songIndex = $input['songIndex'] ?? null;

    if ($fromPlaylist === $toPlaylist) {
        echo json_encode(['success' => false, 'error' => 'Cannot move to same playlist']);
    } elseif (isset($music['playlists'][$fromPlaylist]['songs'][$songIndex]) && isset($music['playlists'][$toPlaylist])) {
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

        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
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
    $songIndex = $input['songIndex'] ?? null;

    if ($fromPlaylist === $toPlaylist) {
        echo json_encode(['success' => false, 'error' => 'Cannot copy to same playlist']);
    } elseif (isset($music['playlists'][$fromPlaylist]['songs'][$songIndex]) && isset($music['playlists'][$toPlaylist])) {
        $song = $music['playlists'][$fromPlaylist]['songs'][$songIndex];
        $music['playlists'][$toPlaylist]['songs'][] = $song;

        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
        echo json_encode([
            'success' => true,
            'toCount' => count($music['playlists'][$toPlaylist]['songs'])
        ]);
    } else {
        echo json_encode(['success' => false, 'error' => 'Invalid playlist or song index']);
    }
} elseif ($action === 'setCover') {
    $playlistId = $input['playlist'] ?? '';
    $songIndex = $input['songIndex'] ?? null;

    if (isset($music['playlists'][$playlistId])) {
        if ($songIndex === null || $songIndex === -1) {
            // Reset to auto-pick
            unset($music['playlists'][$playlistId]['coverSongIndex']);
        } elseif (isset($music['playlists'][$playlistId]['songs'][$songIndex])) {
            $music['playlists'][$playlistId]['coverSongIndex'] = (int)$songIndex;
        } else {
            echo json_encode(['success' => false, 'error' => 'Invalid song index']);
            exit;
        }
        file_put_contents($filePath, json_encode($music, JSON_PRETTY_PRINT));
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
