<?php
// Extract the first YouTube video ID from a search-results HTML page.
//
// Locates the `ytInitialData = ` marker and scans a brace-balanced (and
// string-aware) JSON object, then falls back to a direct videoId match.
// Returns an 11-char video ID, or null if none is found.
function nt_yt_extract_object(string $html): ?array {
    $marker = 'ytInitialData = ';
    $pos = strpos($html, $marker);
    if ($pos === false) return null;
    $open = strpos($html, '{', $pos + strlen($marker));
    if ($open === false) return null;
    $depth = 0; $inStr = false; $esc = false; $end = -1;
    for ($i = $open, $n = strlen($html); $i < $n; $i++) {
        $ch = $html[$i];
        if ($inStr) {
            if ($esc)               { $esc = false; }
            elseif ($ch === '\\')   { $esc = true; }
            elseif ($ch === '"')    { $inStr = false; }
        } elseif ($ch === '"')      { $inStr = true; }
        elseif ($ch === '{')        { $depth++; }
        elseif ($ch === '}')        { $depth--; if ($depth === 0) { $end = $i; break; } }
    }
    if ($end <= $open) return null;
    $data = json_decode(substr($html, $open, $end - $open + 1), true);
    return is_array($data) ? $data : null;
}

function nt_yt_first_video_id(string $html): ?string {
    $data = nt_yt_extract_object($html);
    if ($data !== null) {
        $sections = $data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'] ?? [];
        foreach ($sections as $section) {
            foreach (($section['itemSectionRenderer']['contents'] ?? []) as $item) {
                if (isset($item['videoRenderer']['videoId'])) {
                    return $item['videoRenderer']['videoId'];
                }
            }
        }
    }
    // Fallback: first well-formed videoId anywhere in the HTML.
    if (preg_match('/"videoId":"([A-Za-z0-9_-]{11})"/', $html, $m)) {
        return $m[1];
    }
    return null;
}
