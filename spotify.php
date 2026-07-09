<?php
session_start();

require_once __DIR__ . '/auth-guard.php';
require_once __DIR__ . '/rate-limit.php';

// Spotify credentials + api_token live in config.php (gitignored). Degrade
// gracefully if it's missing so `status` can report configured:false instead
// of a 500.
$config = mp_config();
$tokenFile = __DIR__ . '/data/spotify-tokens.json';

$action = $_GET['action'] ?? '';

// ============================================================
// SHARED HELPERS
// ============================================================

function loadTokens($file) {
    if (!file_exists($file)) return null;
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : null;
}

function saveTokens($file, $tokens) {
    file_put_contents($file, json_encode($tokens, JSON_PRETTY_PRINT));
}

function spotifyPost($url, $headers, $body) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_TIMEOUT => 15
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($code >= 200 && $code < 400) ? json_decode($resp, true) : null;
}

function spotifyGet($url, $token) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token],
        CURLOPT_TIMEOUT => 15
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ($code >= 200 && $code < 300) ? json_decode($resp, true) : null;
}

function spotifyPut($url, $token, $jsonBody = null) {
    $ch = curl_init($url);
    $headers = [
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json'
    ];
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => 'PUT',
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_TIMEOUT => 15
    ]);
    if ($jsonBody !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($jsonBody));
    }
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300;
}

function refreshAccessToken($config, $tokenFile) {
    $tokens = loadTokens($tokenFile);
    if (!$tokens || empty($tokens['refresh_token'])) return null;

    $data = spotifyPost('https://accounts.spotify.com/api/token', [
        'Content-Type: application/x-www-form-urlencoded',
        'Authorization: Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret'])
    ], http_build_query([
        'grant_type'    => 'refresh_token',
        'refresh_token' => $tokens['refresh_token']
    ]));

    if (!empty($data['access_token'])) {
        $tokens['access_token'] = $data['access_token'];
        $tokens['expires_at'] = time() + ($data['expires_in'] ?? 3600);
        if (!empty($data['refresh_token'])) {
            $tokens['refresh_token'] = $data['refresh_token'];
        }
        saveTokens($tokenFile, $tokens);
        return $tokens;
    }
    return null;
}

function getValidToken($config, $tokenFile) {
    $tokens = loadTokens($tokenFile);
    if (!$tokens) return null;
    if (($tokens['expires_at'] ?? 0) < time() + 60) {
        $tokens = refreshAccessToken($config, $tokenFile);
    }
    return $tokens ? ($tokens['access_token'] ?? null) : null;
}

function getClientToken($config) {
    $data = spotifyPost('https://accounts.spotify.com/api/token', [
        'Content-Type: application/x-www-form-urlencoded',
        'Authorization: Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret'])
    ], http_build_query(['grant_type' => 'client_credentials']));
    return $data['access_token'] ?? null;
}

function anyToken($config, $tokenFile) {
    return getValidToken($config, $tokenFile) ?? getClientToken($config);
}

function extractPlaylistId($url) {
    if (preg_match('/playlist\/([a-zA-Z0-9]+)/', $url, $m)) return $m[1];
    return '';
}

// Reject same-origin-required requests that didn't originate from this app's
// own pages. The token route hands out a Spotify bearer token; we don't want
// a stray <img>/<form> on another tab to hit it (or, with no auth on the host,
// random callers on the LAN to scrape it).
function requireSameOrigin() {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';
    $host = $_SERVER['HTTP_HOST'] ?? '';
    if ($host === '') return false;
    $check = function($url) use ($host) {
        if ($url === '') return false;
        $parts = parse_url($url);
        return isset($parts['host']) && strcasecmp($parts['host'], explode(':', $host)[0]) === 0;
    };
    return $check($origin) || $check($referer);
}

function fetchPlaylistTracks($playlistId, $token) {
    $songs = [];
    $offset = 0;
    $fields = 'items(track(id,name,artists,album(name,images),duration_ms)),total,next';

    do {
        $data = spotifyGet(
            "https://api.spotify.com/v1/playlists/{$playlistId}/tracks?offset={$offset}&limit=100&fields={$fields}",
            $token
        );
        if (!$data || empty($data['items'])) break;

        foreach ($data['items'] as $item) {
            $t = $item['track'] ?? null;
            if (!$t || empty($t['name'])) continue;

            $artists = array_map(fn($a) => $a['name'], $t['artists'] ?? []);
            $cover = '';
            foreach ($t['album']['images'] ?? [] as $img) {
                if (($img['width'] ?? 0) >= 300) { $cover = $img['url']; break; }
            }
            if (!$cover && !empty($t['album']['images'])) {
                $cover = $t['album']['images'][0]['url'] ?? '';
            }

            $songs[] = [
                'title'       => $t['name'],
                'artist'      => implode(', ', $artists),
                'album'       => $t['album']['name'] ?? '',
                'cover'       => $cover,
                'spotify_id'  => $t['id'] ?? '',
                'duration_ms' => $t['duration_ms'] ?? 0
            ];
        }
        $offset += 100;
    } while (!empty($data['next']));

    return $songs;
}

// ============================================================
// ROUTE: LOGIN — start OAuth flow
// ============================================================
if ($action === 'login') {
    header('Content-Type: application/json');
    mp_require_auth();
    nt_rate_limit('spotify_login', 20, 200);
    if (empty($config['client_id']) || empty($config['redirect_uri'])) {
        echo json_encode(['error' => 'Fill in config.php first']);
        exit;
    }
    $state = bin2hex(random_bytes(16));
    $_SESSION['spotify_state'] = $state;

    $authUrl = 'https://accounts.spotify.com/authorize?' . http_build_query([
        'client_id'     => $config['client_id'],
        'response_type' => 'code',
        'redirect_uri'  => $config['redirect_uri'],
        'scope'         => 'streaming user-read-email user-read-private playlist-read-private playlist-read-collaborative user-library-read',
        'state'         => $state
    ]);
    echo json_encode(['authUrl' => $authUrl]);
    exit;
}

// ============================================================
// ROUTE: CALLBACK — handle OAuth redirect from Spotify
// ============================================================
if ($action === 'callback') {
    $code  = $_GET['code'] ?? '';
    $error = $_GET['error'] ?? '';
    $state = $_GET['state'] ?? '';

    // Verify the CSRF state parameter we set on `login`.
    $expected = $_SESSION['spotify_state'] ?? '';
    unset($_SESSION['spotify_state']);
    if ($error || !$code || !$state || !$expected || !hash_equals($expected, $state)) {
        header('Location: index.php?app&spotify=error');
        exit;
    }

    $data = spotifyPost('https://accounts.spotify.com/api/token', [
        'Content-Type: application/x-www-form-urlencoded',
        'Authorization: Basic ' . base64_encode($config['client_id'] . ':' . $config['client_secret'])
    ], http_build_query([
        'grant_type'   => 'authorization_code',
        'code'         => $code,
        'redirect_uri' => $config['redirect_uri']
    ]));

    if (!empty($data['access_token'])) {
        saveTokens($tokenFile, [
            'access_token'  => $data['access_token'],
            'refresh_token' => $data['refresh_token'] ?? '',
            'expires_at'    => time() + ($data['expires_in'] ?? 3600)
        ]);
        header('Location: index.php?app&spotify=connected');
    } else {
        header('Location: index.php?app&spotify=error');
    }
    exit;
}

// ============================================================
// JSON API ROUTES (everything below returns JSON)
// ============================================================
header('Content-Type: application/json');
// All routes below either mutate token state (logout) or spend the owner's
// Spotify token on outbound calls (token/status/playlists/import) — gate them
// to loopback / token-bearing clients so a LAN peer can't drive the account.
mp_require_auth();
$input = json_decode(file_get_contents('php://input'), true) ?? [];

// ROUTE: TOKEN — return access token for Web Playback SDK
if ($action === 'token') {
    nt_rate_limit('spotify_token', 120, 5000);
    if (!requireSameOrigin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }
    $token = getValidToken($config, $tokenFile);
    if ($token) {
        echo json_encode(['access_token' => $token]);
    } else {
        http_response_code(401);
        echo json_encode(['error' => 'Not authenticated']);
    }
    exit;
}

// ROUTE: STATUS — check connection + user info
if ($action === 'status') {
    nt_rate_limit('spotify_status', 60, 1000);
    if (empty($config['client_id'])) {
        echo json_encode(['configured' => false, 'connected' => false]);
        exit;
    }
    $token = getValidToken($config, $tokenFile);
    if (!$token) {
        echo json_encode(['configured' => true, 'connected' => false]);
        exit;
    }
    $user = spotifyGet('https://api.spotify.com/v1/me', $token);
    if ($user) {
        echo json_encode([
            'configured' => true,
            'connected'  => true,
            'user' => [
                'name'    => $user['display_name'] ?? '',
                'image'   => $user['images'][0]['url'] ?? '',
                'premium' => ($user['product'] ?? '') === 'premium'
            ]
        ]);
    } else {
        echo json_encode(['configured' => true, 'connected' => false]);
    }
    exit;
}

// ROUTE: LOGOUT — clear tokens
if ($action === 'logout') {
    if (file_exists($tokenFile)) unlink($tokenFile);
    echo json_encode(['success' => true]);
    exit;
}

// ROUTE: PLAYLISTS — get user's playlists (OAuth required)
if ($action === 'playlists') {
    nt_rate_limit('spotify_playlists', 30, 300);
    $token = getValidToken($config, $tokenFile);
    if (!$token) {
        echo json_encode(['success' => false, 'error' => 'Not connected']);
        exit;
    }
    $playlists = [];
    $offset = 0;
    do {
        $data = spotifyGet("https://api.spotify.com/v1/me/playlists?offset={$offset}&limit=50", $token);
        if (!$data || empty($data['items'])) break;
        foreach ($data['items'] as $pl) {
            $playlists[] = [
                'id'     => $pl['id'],
                'name'   => $pl['name'],
                'image'  => $pl['images'][0]['url'] ?? '',
                'tracks' => $pl['tracks']['total'] ?? 0,
                'owner'  => $pl['owner']['display_name'] ?? ''
            ];
        }
        $offset += 50;
    } while (!empty($data['next']));

    echo json_encode(['success' => true, 'playlists' => $playlists]);
    exit;
}

// ROUTE: IMPORT_URL — import from public playlist URL (no OAuth needed)
if ($action === 'import_url') {
    nt_rate_limit('spotify_import', 20, 200);
    $url = $input['url'] ?? '';
    $playlistId = extractPlaylistId($url);
    if (!$playlistId) {
        echo json_encode(['success' => false, 'error' => 'Invalid Spotify playlist URL']);
        exit;
    }
    $token = anyToken($config, $tokenFile);
    if (!$token) {
        echo json_encode(['success' => false, 'error' => 'Spotify not configured']);
        exit;
    }
    $info = spotifyGet("https://api.spotify.com/v1/playlists/{$playlistId}?fields=name,images,tracks.total", $token);
    if (!$info) {
        echo json_encode(['success' => false, 'error' => 'Could not fetch playlist — is it public?']);
        exit;
    }
    $songs = fetchPlaylistTracks($playlistId, $token);
    echo json_encode([
        'success' => true,
        'name'    => $info['name'] ?? 'Untitled',
        'image'   => $info['images'][0]['url'] ?? '',
        'songs'   => $songs,
        'total'   => count($songs)
    ]);
    exit;
}

// ROUTE: PLAYLIST_TRACKS — get tracks from a specific playlist
if ($action === 'playlist_tracks') {
    nt_rate_limit('spotify_tracks', 30, 300);
    $playlistId = $input['playlist_id'] ?? '';
    if (!$playlistId) {
        echo json_encode(['success' => false, 'error' => 'No playlist ID']);
        exit;
    }
    $token = anyToken($config, $tokenFile);
    if (!$token) {
        echo json_encode(['success' => false, 'error' => 'Not authenticated']);
        exit;
    }
    $songs = fetchPlaylistTracks($playlistId, $token);
    echo json_encode(['success' => true, 'songs' => $songs]);
    exit;
}

echo json_encode(['error' => 'Unknown action']);
