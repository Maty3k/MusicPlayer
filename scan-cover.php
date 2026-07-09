<?php
// Identify an album cover image via Gemini and return artist/album/top-songs.
// Adapted for the standalone Music Player: gated by mp_require_auth(), reads
// the Gemini key from config.php via mp_config(), and rate-limited.
header('Content-Type: application/json');
require_once __DIR__ . '/auth-guard.php';
mp_require_auth();
require_once __DIR__ . '/rate-limit.php';
nt_rate_limit('scan-cover', 10, 200);

// Cap raw request size to ~6 MB to bound Gemini billing on a single call.
if (isset($_SERVER['CONTENT_LENGTH']) && (int)$_SERVER['CONTENT_LENGTH'] > 6_000_000) {
    http_response_code(413);
    echo json_encode(['success' => false, 'error' => 'Image too large']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
$imageData = $input['image'] ?? '';
$mimeType = $input['mimeType'] ?? 'image/jpeg';

if (!$imageData) {
    echo json_encode(['success' => false, 'error' => 'Missing image data']);
    exit;
}
if (strlen($imageData) > 6_000_000) {
    http_response_code(413);
    echo json_encode(['success' => false, 'error' => 'Image too large']);
    exit;
}
if (!in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
    echo json_encode(['success' => false, 'error' => 'Unsupported image type']);
    exit;
}

// Load API key from config.php (see config.php.example -> 'gemini_api_key').
$apiKey = (string)(mp_config()['gemini_api_key'] ?? '');

if (!$apiKey) {
    echo json_encode(['success' => false, 'error' => 'Gemini API key not configured. Add "gemini_api_key" to config.php']);
    exit;
}

$url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" . urlencode($apiKey);

$payload = [
    'contents' => [[
        'parts' => [
            [
                'text' => 'Identify this album cover image. Return ONLY a JSON object with these fields: {"artist": "Artist Name", "album": "Album Name", "songs": ["Song 1", "Song 2"]}. The "songs" field should contain the most well-known songs from this album (up to 5). If you cannot identify the album, return {"artist": "", "album": "", "songs": []}.'
            ],
            [
                'inlineData' => [
                    'mimeType' => $mimeType,
                    'data' => $imageData
                ]
            ]
        ]
    ]],
    'generationConfig' => [
        'temperature' => 0.1,
        'maxOutputTokens' => 500
    ]
];

$context = stream_context_create([
    'http' => [
        'method' => 'POST',
        'header' => "Content-Type: application/json\r\n",
        'content' => json_encode($payload),
        'timeout' => 30
    ]
]);

$response = @file_get_contents($url, false, $context);

if (!$response) {
    echo json_encode(['success' => false, 'error' => 'Failed to reach Gemini API']);
    exit;
}

$result = json_decode($response, true);

// Extract text from Gemini response
$text = $result['candidates'][0]['content']['parts'][0]['text'] ?? '';

if (!$text) {
    echo json_encode(['success' => false, 'error' => 'Empty response from Gemini']);
    exit;
}

// Parse JSON from response (may be wrapped in ```json ... ```)
$text = trim($text);
if (preg_match('/```(?:json)?\s*(.*?)\s*```/s', $text, $m)) {
    $text = $m[1];
}

$parsed = json_decode($text, true);

if ($parsed && !empty($parsed['artist'])) {
    echo json_encode([
        'success' => true,
        'artist' => $parsed['artist'] ?? '',
        'album' => $parsed['album'] ?? '',
        'songs' => $parsed['songs'] ?? []
    ]);
} else {
    // Don't echo the raw model output back (prompt-injection signal/oracle).
    echo json_encode(['success' => false, 'error' => 'Could not identify album cover']);
}
