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
     * A playlist page's own title, so an import can be named after it. The
     * metadata renderer is the stable home; the header shapes are fallbacks.
     */
    public static function playlistTitle(array $data): ?string
    {
        $candidates = [
            $data['metadata']['playlistMetadataRenderer']['title'] ?? null,
            $data['header']['playlistHeaderRenderer']['title']['simpleText'] ?? null,
            $data['header']['pageHeaderRenderer']['pageTitle'] ?? null,
            $data['microformat']['microformatDataRenderer']['title'] ?? null,
        ];
        foreach ($candidates as $title) {
            if (is_string($title) && trim($title) !== '') {
                return trim($title);
            }
        }

        return null;
    }

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
     * Extract every video on a YouTube playlist page as
     * [['videoId' => ..., 'title' => ..., 'channel' => ...], ...].
     *
     * Walks the parsed ytInitialData for playlistVideoRenderer nodes anywhere
     * in the tree (robust to YouTube shuffling the surrounding structure).
     * Only the first page (~100 videos) renders server-side; the rest is
     * fetched via continuationToken() + the browse endpoint.
     */
    public static function playlistVideos(string $html): array
    {
        $data = self::extractObject($html);

        return $data === null ? [] : self::videosFromData($data);
    }

    /**
     * Playlist videos from already-parsed JSON — a page's ytInitialData or a
     * youtubei/v1/browse continuation response.
     *
     * @param  array<string,string>  $seen  videoIds to skip (shared across pages)
     */
    public static function videosFromData(array $data, array &$seen = []): array
    {
        $out = [];
        self::collectPlaylistVideos($data, $out, $seen);

        return $out;
    }

    /**
     * Token for the next page of a playlist, or null on the last page. Looks
     * only inside continuation items (current view model and legacy renderer)
     * so unrelated commands elsewhere in the tree are never picked up.
     */
    public static function continuationToken(mixed $node, bool $inContinuation = false): ?string
    {
        if (! is_array($node)) {
            return null;
        }
        if ($inContinuation && is_string($node['continuationCommand']['token'] ?? null)) {
            return $node['continuationCommand']['token'];
        }
        foreach ($node as $key => $value) {
            $inside = $inContinuation || $key === 'continuationItemViewModel' || $key === 'continuationItemRenderer';
            $token = self::continuationToken($value, $inside);
            if ($token !== null) {
                return $token;
            }
        }

        return null;
    }

    /** The web client version the page was served with (for browse calls). */
    public static function clientVersion(string $html): ?string
    {
        return preg_match('/"INNERTUBE_CLIENT_VERSION":"([0-9.]+)"/', $html, $m) ? $m[1] : null;
    }

    /** @param array<int,array<string,string>> $out */
    private static function collectPlaylistVideos(mixed $node, array &$out, array &$seen): void
    {
        if (! is_array($node)) {
            return;
        }

        // Current YouTube: items are lockupViewModel "view models".
        $lockup = $node['lockupViewModel'] ?? null;
        if (is_array($lockup)) {
            $videoId = (string) ($lockup['contentId'] ?? '');
            $type = (string) ($lockup['contentType'] ?? '');
            $isVideo = $type === '' || $type === 'LOCKUP_CONTENT_TYPE_VIDEO';
            if ($isVideo && preg_match('/^[A-Za-z0-9_-]{11}$/', $videoId) && ! isset($seen[$videoId])) {
                $meta = $lockup['metadata']['lockupMetadataViewModel'] ?? [];
                $title = (string) ($meta['title']['content'] ?? '');
                $channel = (string) (
                    $meta['metadata']['contentMetadataViewModel']['metadataRows'][0]['metadataParts'][0]['text']['content']
                    ?? ''
                );
                if ($title !== '') {
                    $seen[$videoId] = true;
                    $out[] = ['videoId' => $videoId, 'title' => $title, 'channel' => $channel];
                }
            }
        }

        // Legacy renderer (older pages / some regions still serve it).
        $renderer = $node['playlistVideoRenderer'] ?? null;
        if (is_array($renderer)) {
            $videoId = (string) ($renderer['videoId'] ?? '');
            if (preg_match('/^[A-Za-z0-9_-]{11}$/', $videoId) && ! isset($seen[$videoId])) {
                $title = '';
                foreach (($renderer['title']['runs'] ?? []) as $run) {
                    $title .= (string) ($run['text'] ?? '');
                }
                if ($title === '') {
                    $title = (string) ($renderer['title']['simpleText'] ?? '');
                }
                $channel = (string) (
                    $renderer['shortBylineText']['runs'][0]['text']
                    ?? $renderer['longBylineText']['runs'][0]['text']
                    ?? ''
                );
                if ($title !== '') {
                    $seen[$videoId] = true;
                    $out[] = ['videoId' => $videoId, 'title' => $title, 'channel' => $channel];
                }
            }
        }

        foreach ($node as $value) {
            if (is_array($value)) {
                self::collectPlaylistVideos($value, $out, $seen);
            }
        }
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
