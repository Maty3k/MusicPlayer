<?php

namespace App\Http\Controllers;

use App\Support\YoutubeExtractor;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Import a YouTube playlist by URL: scrape the playlist page (no API key,
 * same approach as SearchYoutubeController) and return its videos as songs.
 * Titles are split into artist/title on " - " like the radio/oEmbed path.
 */
class YoutubePlaylistController extends Controller
{
    private const MAX_TRACKS = 200;

    public function __invoke(Request $request): JsonResponse
    {
        $url = trim((string) $request->input('url', ''));
        $listId = $this->extractListId($url);
        if ($listId === null) {
            return response()->json(['success' => false, 'error' => 'Not a YouTube playlist link']);
        }

        try {
            $response = Http::withHeaders([
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language' => 'en-US,en;q=0.9',
                // Consent cookie: EU IPs otherwise get a "before you continue"
                // wall instead of the playlist. Harmless where no wall appears.
                'Cookie' => 'SOCS=CAI',
            ])->timeout(12)->get('https://www.youtube.com/playlist', ['list' => $listId]);
        } catch (ConnectionException) {
            $response = null;
        }

        $html = ($response !== null && $response->successful()) ? $response->body() : '';
        if ($html === '') {
            return response()->json(['success' => false, 'error' => 'Could not reach YouTube']);
        }

        $videos = YoutubeExtractor::playlistVideos($html);
        if ($videos === []) {
            return response()->json(['success' => false, 'error' => 'No videos found — is the playlist public?']);
        }

        $songs = [];
        foreach (array_slice($videos, 0, self::MAX_TRACKS) as $v) {
            [$artist, $title] = $this->splitTitle($v['title'], $v['channel']);
            $songs[] = [
                'title' => $title,
                'artist' => $artist,
                'album' => '',
                'cover' => 'https://i.ytimg.com/vi/'.$v['videoId'].'/hqdefault.jpg',
                'youtube_id' => $v['videoId'],
                'spotify_id' => '',
            ];
        }

        return response()->json([
            'success' => true,
            'name' => 'YouTube playlist',
            'songs' => $songs,
            'total' => count($songs),
        ]);
    }

    /** Accept a playlist URL or a bare list id. */
    private function extractListId(string $url): ?string
    {
        if ($url === '') {
            return null;
        }
        if (preg_match('/[?&]list=([A-Za-z0-9_-]+)/', $url, $m)) {
            return $m[1];
        }
        // A bare list id (PL…, OLAK5uy…, etc.) — not a plain 11-char video id.
        if (preg_match('/^[A-Za-z0-9_-]{13,42}$/', $url) && strlen($url) !== 11) {
            return $url;
        }

        return null;
    }

    /**
     * Split a YouTube video title into [artist, title]. "Artist - Title"
     * splits on the dash; otherwise the channel is the artist and junk
     * suffixes are trimmed from the title.
     *
     * @return array{0:string,1:string}
     */
    private function splitTitle(string $raw, string $channel): array
    {
        $raw = trim($raw);
        // Markers that identify which side of the dash is the SONG, not the
        // artist — YouTube titles come both ways ("Artist - Song (Video)" and
        // "Song (Official Video) - Artist").
        $junk = '/(official|lyrics?|visuali[sz]er|\baudio\b|\bvideo\b|performance|prod\.)/i';

        $parts = preg_split('/\s+[-–—]\s+/u', $raw, 2);
        if (is_array($parts) && count($parts) === 2 && trim($parts[0]) !== '' && trim($parts[1]) !== '') {
            $left = trim($parts[0]);
            $right = trim($parts[1]);
            if (preg_match($junk, $left) && ! preg_match($junk, $right)) {
                // "Song (Official Video) - Artist"
                $title = $left;
                $artist = $right;
            } else {
                // "Artist - Song"
                $artist = $left;
                $title = $right;
            }
        } else {
            $artist = $this->cleanChannel($channel);
            $title = $raw;
        }

        // Drop any parenthetical that contains a production keyword —
        // "(Official Video)", "(Video Oficial)", "( Video Lyric )",
        // "(Performance Video)" — but leave clean ones like "(feat. X)".
        $title = preg_replace(
            '/\s*[([][^)\]]*(official|lyrics?|visuali[sz]er|\baudio\b|\bvideo\b|performance)[^)\]]*[)\]]/iu',
            '',
            (string) $title
        );

        return [trim((string) $artist), trim((string) $title)];
    }

    /** Drop the trailing "- Topic" YouTube auto-channels add. */
    private function cleanChannel(string $channel): string
    {
        return trim(preg_replace('/\s*-\s*Topic$/i', '', trim($channel)) ?? '');
    }
}
