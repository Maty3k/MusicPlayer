<?php

namespace App\Http\Controllers;

use App\Models\YoutubeMatch;
use App\Support\YoutubeExtractor;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * Resolve a Spotify track to a playable YouTube video id.
 *
 * Spotify imports store only spotify_id + metadata. Non-Premium users can't
 * stream via the Web Playback SDK, so on first play we scrape a YouTube search
 * for "<artist> <title>", cache the match by spotify_id (youtube_matches
 * table), and write youtube_id back onto the song. Subsequent plays are
 * instant.
 */
class SpotifyResolveController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $spotifyId = trim((string) $request->input('spotify_id', ''));
        $playlistKey = trim((string) $request->input('playlist_key', ''));
        $songIndex = -1;
        if ($request->has('song_index')) {
            $validated = filter_var($request->input('song_index'), FILTER_VALIDATE_INT);
            $songIndex = $validated === false ? -1 : $validated;
        }
        $title = trim((string) $request->input('title', ''));
        $artist = trim((string) $request->input('artist', ''));

        if ($title === '') {
            return response()->json(['success' => false, 'error' => 'Missing title']);
        }

        // Fast path: cache hit.
        if ($spotifyId !== '') {
            $cached = YoutubeMatch::query()->where('spotify_id', $spotifyId)->first();
            if ($cached !== null) {
                return response()->json(['success' => true, 'youtube_id' => $cached->youtube_id, 'cached' => true]);
            }
        }

        $query = trim($artist.' '.$title);
        $ytId = $this->searchYoutubeId($query);

        // Only accept a well-formed 11-char YouTube video ID (the ytInitialData
        // path can return arbitrary strings); never cache/persist anything else.
        if (! $ytId || ! preg_match('/^[A-Za-z0-9_-]{11}$/', $ytId)) {
            return response()->json(['success' => false, 'error' => 'No YouTube result found', 'query' => $query]);
        }

        // Persist in the shared resolution cache.
        if ($spotifyId !== '') {
            YoutubeMatch::query()->updateOrCreate(
                ['spotify_id' => $spotifyId],
                ['youtube_id' => $ytId],
            );
        }

        // Persist onto the specific song — but only when the stored song's
        // spotify_id matches this request's, so playlist_key/song_index can't be
        // used to overwrite an arbitrary (e.g. non-Spotify) song's youtube_id
        // with a chosen video.
        if ($playlistKey !== '' && $songIndex >= 0 && $spotifyId !== ''
            && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $playlistKey)) {
            $playlist = $request->user()->playlists()->where('slug', $playlistKey)->first();
            $song = $playlist?->songs->values()->get($songIndex);
            if ($song !== null && ($song->spotify_id ?? '') === $spotifyId) {
                $song->youtube_id = $ytId;
                $song->save();
            }
        }

        return response()->json(['success' => true, 'youtube_id' => $ytId, 'cached' => false]);
    }

    private function searchYoutubeId(string $query): ?string
    {
        try {
            $response = Http::withHeaders([
                'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language' => 'en-US,en;q=0.9',
            ])->timeout(8)->get('https://www.youtube.com/results', ['search_query' => $query]);
        } catch (ConnectionException) {
            return null;
        }

        if (! $response->successful() || $response->body() === '') {
            return null;
        }

        return YoutubeExtractor::firstVideoId($response->body());
    }
}
