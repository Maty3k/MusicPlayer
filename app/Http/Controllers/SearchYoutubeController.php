<?php

namespace App\Http\Controllers;

use App\Support\YoutubeExtractor;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Scrape YouTube search results and return the top matches as JSON.
 * Walks the brace-balanced ytInitialData object (shared with
 * SpotifyResolveController via YoutubeExtractor).
 */
class SearchYoutubeController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $query = trim((string) $request->input('query', ''));

        if ($query === '') {
            return response()->json(['success' => false, 'error' => 'Missing query']);
        }
        if (strlen($query) > 200) {
            $query = substr($query, 0, 200);
        }

        try {
            $response = Http::withHeaders([
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language' => 'en-US,en;q=0.9',
            ])->timeout(10)->get('https://www.youtube.com/results', ['search_query' => $query]);
        } catch (ConnectionException) {
            $response = null;
        }

        $html = ($response !== null && $response->successful()) ? $response->body() : '';
        if ($html === '') {
            return response()->json(['success' => false, 'error' => 'Failed to fetch YouTube results']);
        }

        $results = [];

        $data = YoutubeExtractor::extractObject($html);
        if ($data !== null) {
            // Navigate to video results.
            $contents = $data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'] ?? [];

            foreach ($contents as $section) {
                $items = $section['itemSectionRenderer']['contents'] ?? [];
                foreach ($items as $item) {
                    if (! isset($item['videoRenderer'])) {
                        continue;
                    }
                    $video = $item['videoRenderer'];
                    $videoId = $video['videoId'] ?? '';
                    $title = '';
                    $channel = '';

                    // Title (may span multiple runs).
                    if (isset($video['title']['runs'])) {
                        foreach ($video['title']['runs'] as $run) {
                            $title .= $run['text'];
                        }
                    }

                    // Channel name.
                    if (isset($video['ownerText']['runs'][0]['text'])) {
                        $channel = $video['ownerText']['runs'][0]['text'];
                    } elseif (isset($video['longBylineText']['runs'][0]['text'])) {
                        $channel = $video['longBylineText']['runs'][0]['text'];
                    }

                    // Only a well-formed id goes back: the page builds a
                    // thumbnail address and a player call from it.
                    if (is_string($videoId) && preg_match('/^[A-Za-z0-9_-]{11}$/', $videoId) && $title) {
                        $results[] = [
                            'videoId' => $videoId,
                            'title' => $title,
                            'channel' => $channel,
                            'thumbnail' => "https://i.ytimg.com/vi/$videoId/hqdefault.jpg",
                        ];
                    }

                    if (count($results) >= 12) {
                        break 2;
                    }
                }
            }
        }

        return response()->json(['success' => true, 'results' => $results]);
    }
}
