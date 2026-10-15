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
        $text = fn (string $key) => is_string($value = $request->input($key, '')) ? trim($value) : '';
        $spotifyId = $text('spotify_id');
        $spotifyId = preg_match('/^[A-Za-z0-9]{22}$/', $spotifyId) ? $spotifyId : '';
        $playlistKey = $text('playlist_key');
        $songIndex = -1;
        if ($request->has('song_index')) {
            $validated = filter_var($request->input('song_index'), FILTER_VALIDATE_INT);
            $songIndex = $validated === false ? -1 : $validated;
        }
        $title = $text('title');
        $artist = $text('artist');

        if ($title === '') {
            return response()->json(['success' => false, 'error' => 'Missing title']);
        }

        $cacheKey = $spotifyId !== '' ? YoutubeMatch::cacheKey($spotifyId, $title, $artist) : null;

        // Fast path: cache hit.
        if ($cacheKey !== null) {
            $cached = YoutubeMatch::query()->where('spotify_id', $cacheKey)->first();
            if ($cached !== null) {
                $saved = $this->rememberOnSong($request, $playlistKey, $songIndex, $spotifyId, $title, $artist, $cached->youtube_id);

                return response()->json(['success' => true, 'youtube_id' => $cached->youtube_id, 'cached' => true, 'saved' => $saved]);
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
        if ($cacheKey !== null) {
            YoutubeMatch::query()->updateOrCreate(
                ['spotify_id' => $cacheKey],
                ['youtube_id' => $ytId],
            );
        }

        $saved = $this->rememberOnSong($request, $playlistKey, $songIndex, $spotifyId, $title, $artist, $ytId);

        return response()->json(['success' => true, 'youtube_id' => $ytId, 'cached' => false, 'saved' => $saved]);
    }

    /**
     * Persist the match onto the specific song — but only when the stored song
     * is the one this request describes, so playlist_key/song_index can't be
     * used to overwrite an arbitrary song's youtube_id with a chosen video: a
     * Spotify track by its spotify_id, or a title-only import (no source id at
     * all yet) by its exact title and artist. Whether it was saved goes back to
     * the page, which only then gives its own copy of the song the id: page and
     * server must agree on a song's key (MusicController::sameSong).
     */
    private function rememberOnSong(Request $request, string $playlistKey, int $songIndex, string $spotifyId, string $title, string $artist, string $ytId): bool
    {
        if ($playlistKey === '' || $songIndex < 0 || ! preg_match('/^[A-Za-z0-9_-]{1,64}$/', $playlistKey)) {
            return false;
        }
        $playlist = $request->user()->playlists()->where('slug', $playlistKey)->first();
        $song = $playlist?->songs->values()->get($songIndex);
        $sameSpotifyTrack = $spotifyId !== '' && ($song->spotify_id ?? '') === $spotifyId;
        $sameTitleOnlySong = $spotifyId === '' && $song !== null
            && ($song->spotify_id ?? '') === '' && ($song->youtube_id ?? '') === '' && ($song->mp3_url ?? '') === ''
            && trim((string) $song->title) === $title && trim((string) $song->artist) === $artist;
        if ($song === null || ! ($sameSpotifyTrack || $sameTitleOnlySong)) {
            return false;
        }
        $song->youtube_id = $ytId;
        $song->save();

        return true;
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
