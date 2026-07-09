<?php

namespace App\Support;

/**
 * Extract data from a YouTube search-results HTML page.
 *
 * Locates the `ytInitialData = ` marker and scans a brace-balanced (and
 * string-aware) JSON object, then falls back to a direct videoId match.
 */
class YoutubeExtractor
{
    /**
     * Parse the ytInitialData JSON object out of a search-results page.
     */
    public static function extractObject(string $html): ?array
    {
        $marker = 'ytInitialData = ';
        $pos = strpos($html, $marker);
        if ($pos === false) {
            return null;
        }
        $open = strpos($html, '{', $pos + strlen($marker));
        if ($open === false) {
            return null;
        }
        $depth = 0;
        $inStr = false;
        $esc = false;
        $end = -1;
        for ($i = $open, $n = strlen($html); $i < $n; $i++) {
            $ch = $html[$i];
            if ($inStr) {
                if ($esc) {
                    $esc = false;
                } elseif ($ch === '\\') {
                    $esc = true;
                } elseif ($ch === '"') {
                    $inStr = false;
                }
            } elseif ($ch === '"') {
                $inStr = true;
            } elseif ($ch === '{') {
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) {
                    $end = $i;
                    break;
                }
            }
        }
        if ($end <= $open) {
            return null;
        }
        $data = json_decode(substr($html, $open, $end - $open + 1), true);

        return is_array($data) ? $data : null;
    }

    /**
     * First YouTube video ID on a search-results page, or null if none found.
     */
    public static function firstVideoId(string $html): ?string
    {
        $data = self::extractObject($html);
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
}
