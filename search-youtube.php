<?php
// Scrape YouTube search results and return the top matches as JSON.
// Adapted for the standalone Music Player: gated by mp_require_auth() (loopback
// or shared-secret) instead of loopback-only, and shares the brace-balanced
// ytInitialData parser with youtube-extract.php.
header('Content-Type: application/json');
require_once __DIR__ . '/auth-guard.php';
mp_require_auth();
require_once __DIR__ . '/rate-limit.php';
require_once __DIR__ . '/youtube-extract.php';
nt_rate_limit('search-youtube', 20, 300);

$input = json_decode(file_get_contents('php://input'), true);
$query = trim($input['query'] ?? '');

if (!$query) {
    echo json_encode(['success' => false, 'error' => 'Missing query']);
    exit;
}
if (strlen($query) > 200) $query = substr($query, 0, 200);

$url = 'https://www.youtube.com/results?' . http_build_query(['search_query' => $query]);

$context = stream_context_create([
    'http' => [
        'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36\r\nAccept-Language: en-US,en;q=0.9\r\n",
        'timeout' => 10
    ]
]);

$html = @file_get_contents($url, false, $context);

if (!$html) {
    echo json_encode(['success' => false, 'error' => 'Failed to fetch YouTube results']);
    exit;
}

// Extract ytInitialData JSON from page (brace-balanced parser shared with
// youtube-extract.php — replaces the lazy regex that could mis-capture).
$results = [];

$data = nt_yt_extract_object($html);
if ($data !== null) {
    // Navigate to video results
    $contents = $data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'] ?? [];

    foreach ($contents as $section) {
        $items = $section['itemSectionRenderer']['contents'] ?? [];
        foreach ($items as $item) {
            if (isset($item['videoRenderer'])) {
                $video = $item['videoRenderer'];
                $videoId = $video['videoId'] ?? '';
                $title = '';
                $channel = '';

                // Get title
                if (isset($video['title']['runs'])) {
                    foreach ($video['title']['runs'] as $run) {
                        $title .= $run['text'];
                    }
                }

                // Get channel name
                if (isset($video['ownerText']['runs'][0]['text'])) {
                    $channel = $video['ownerText']['runs'][0]['text'];
                } elseif (isset($video['longBylineText']['runs'][0]['text'])) {
                    $channel = $video['longBylineText']['runs'][0]['text'];
                }

                if ($videoId && $title) {
                    $results[] = [
                        'videoId' => $videoId,
                        'title' => $title,
                        'channel' => $channel,
                        'thumbnail' => "https://i.ytimg.com/vi/$videoId/hqdefault.jpg"
                    ];
                }

                if (count($results) >= 12) break 2;
            }
        }
    }
}

echo json_encode(['success' => true, 'results' => $results]);
