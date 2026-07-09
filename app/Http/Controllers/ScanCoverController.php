<?php

namespace App\Http\Controllers;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Identify an album cover image via Gemini and return artist/album/top-songs.
 * The raw model output is never echoed back to the client (prompt-injection
 * signal/oracle) — only the parsed, expected fields.
 */
class ScanCoverController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        // Cap raw request size to ~6 MB to bound Gemini billing on a single call.
        if ((int) $request->server('CONTENT_LENGTH', 0) > 6_000_000) {
            return response()->json(['success' => false, 'error' => 'Image too large'], 413);
        }

        $imageData = (string) $request->input('image', '');
        $mimeType = (string) $request->input('mimeType', 'image/jpeg');

        if ($imageData === '') {
            return response()->json(['success' => false, 'error' => 'Missing image data']);
        }
        if (strlen($imageData) > 6_000_000) {
            return response()->json(['success' => false, 'error' => 'Image too large'], 413);
        }
        if (! in_array($mimeType, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            return response()->json(['success' => false, 'error' => 'Unsupported image type']);
        }

        $apiKey = (string) config('services.gemini.key', '');
        if ($apiKey === '') {
            return response()->json(['success' => false, 'error' => 'Gemini API key not configured. Set GEMINI_API_KEY in .env']);
        }

        $url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='.urlencode($apiKey);

        $payload = [
            'contents' => [[
                'parts' => [
                    [
                        'text' => 'Identify this album cover image. Return ONLY a JSON object with these fields: {"artist": "Artist Name", "album": "Album Name", "songs": ["Song 1", "Song 2"]}. The "songs" field should contain the most well-known songs from this album (up to 5). If you cannot identify the album, return {"artist": "", "album": "", "songs": []}.',
                    ],
                    [
                        'inlineData' => [
                            'mimeType' => $mimeType,
                            'data' => $imageData,
                        ],
                    ],
                ],
            ]],
            'generationConfig' => [
                'temperature' => 0.1,
                'maxOutputTokens' => 500,
            ],
        ];

        try {
            $response = Http::timeout(30)->post($url, $payload);
        } catch (ConnectionException) {
            $response = null;
        }

        if ($response === null || ! $response->successful()) {
            return response()->json(['success' => false, 'error' => 'Failed to reach Gemini API']);
        }

        $result = $response->json();

        // Extract text from the Gemini response.
        $text = $result['candidates'][0]['content']['parts'][0]['text'] ?? '';
        if (! $text) {
            return response()->json(['success' => false, 'error' => 'Empty response from Gemini']);
        }

        // Parse JSON from the response (may be wrapped in ```json ... ```).
        $text = trim($text);
        if (preg_match('/```(?:json)?\s*(.*?)\s*```/s', $text, $m)) {
            $text = $m[1];
        }

        $parsed = json_decode($text, true);

        if ($parsed && ! empty($parsed['artist'])) {
            return response()->json([
                'success' => true,
                'artist' => $parsed['artist'] ?? '',
                'album' => $parsed['album'] ?? '',
                'songs' => $parsed['songs'] ?? [],
            ]);
        }

        // Don't echo the raw model output back (prompt-injection signal/oracle).
        return response()->json(['success' => false, 'error' => 'Could not identify album cover']);
    }
}
