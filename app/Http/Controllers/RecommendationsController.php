<?php

namespace App\Http\Controllers;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * AI-curated song recommendations: sends the user's library (titles/artists
 * only) to Gemini and returns suggestions with a short reason each. The raw
 * model output is never echoed back (prompt-injection signal/oracle) — only
 * parsed, length-capped fields. Without a GEMINI_API_KEY the endpoint reports
 * enabled=false so the client falls back to the YouTube Mix engine alone.
 */
class RecommendationsController extends Controller
{
    private const MAX_LIBRARY_SONGS = 120;

    private const MAX_SUGGESTIONS = 10;

    public function __invoke(Request $request): JsonResponse
    {
        $apiKey = (string) config('services.gemini.key', '');
        if ($apiKey === '') {
            return response()->json(['success' => true, 'enabled' => false, 'suggestions' => []]);
        }

        // Distinct "artist – title" pairs across every playlist the user owns.
        $library = $request->user()->playlists()
            ->with('songs:id,playlist_id,title,artist')
            ->get()
            ->flatMap->songs
            ->map(fn ($s) => ['title' => trim((string) $s->title), 'artist' => trim((string) $s->artist)])
            ->filter(fn ($s) => $s['title'] !== '')
            ->unique(fn ($s) => mb_strtolower($s['artist'].'|'.$s['title']))
            ->take(self::MAX_LIBRARY_SONGS)
            ->values();

        if ($library->count() < 3) {
            return response()->json(['success' => true, 'enabled' => true, 'suggestions' => []]);
        }

        $list = $library
            ->map(fn ($s) => $s['artist'] !== '' ? "{$s['artist']} – {$s['title']}" : $s['title'])
            ->implode("\n");

        $prompt = <<<PROMPT
You are a music curator. Below is a listener's complete library, one song per line as "Artist – Title".

{$list}

Recommend exactly 10 real, existing songs this listener would love but does NOT already have. Mix familiar-adjacent picks with a few adventurous ones, covering the different moods present in the library. Return ONLY a JSON array, no other text, in this exact shape:
[{"title": "Song Title", "artist": "Artist Name", "reason": "why it fits, max 12 words"}]
PROMPT;

        $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='.urlencode($apiKey);

        try {
            $response = Http::timeout(30)->post($url, [
                'contents' => [['parts' => [['text' => $prompt]]]],
                'generationConfig' => [
                    'temperature' => 0.9,
                    'maxOutputTokens' => 1200,
                ],
            ]);
        } catch (ConnectionException) {
            $response = null;
        }

        if ($response === null || ! $response->successful()) {
            return response()->json(['success' => false, 'enabled' => true, 'error' => 'Failed to reach Gemini API']);
        }

        $text = trim((string) ($response->json()['candidates'][0]['content']['parts'][0]['text'] ?? ''));
        if (preg_match('/```(?:json)?\s*(.*?)\s*```/s', $text, $m)) {
            $text = $m[1];
        }

        $parsed = json_decode($text, true);
        if (! is_array($parsed)) {
            return response()->json(['success' => false, 'enabled' => true, 'error' => 'Could not parse recommendations']);
        }

        $owned = $library
            ->map(fn ($s) => mb_strtolower($s['artist'].'|'.$s['title']))
            ->flip();

        $suggestions = [];
        foreach ($parsed as $item) {
            if (! is_array($item)) {
                continue;
            }
            $title = trim((string) ($item['title'] ?? ''));
            $artist = trim((string) ($item['artist'] ?? ''));
            $reason = trim((string) ($item['reason'] ?? ''));
            if ($title === '' || $artist === '') {
                continue;
            }
            if ($owned->has(mb_strtolower($artist.'|'.$title))) {
                continue;
            }
            $suggestions[] = [
                'title' => mb_substr($title, 0, 120),
                'artist' => mb_substr($artist, 0, 120),
                'reason' => mb_substr($reason, 0, 140),
            ];
            if (count($suggestions) >= self::MAX_SUGGESTIONS) {
                break;
            }
        }

        return response()->json(['success' => true, 'enabled' => true, 'suggestions' => $suggestions]);
    }
}
