<?php

namespace App\Support;

use App\Models\Playlist;
use App\Models\Song;
use App\Models\User;
use App\Models\YoutubeMatch;
use Illuminate\Support\Facades\DB;

/**
 * Mirror a user's whole Spotify library into their playlists here: Liked
 * Songs plus every playlist they own or follow, each as its own playlist
 * (source "spotify"). Mirrored playlists get stable slugs, so re-running an
 * import syncs them with Spotify instead of duplicating.
 *
 * Big libraries run to thousands of tracks, so the work is split into short
 * chunks the browser drives one after another: plan() (or, for a public
 * profile read with the app's own credentials, planPublicProfile()) lists the
 * sources, importChunk() pulls a few pages of one source per call.
 */
class SpotifyLibraryImporter
{
    /** Spotify pages fetched per importChunk() call; keeps each request short. */
    public const PAGES_PER_CHUNK = 2;

    public const LIKED_SLUG = 'spotify-liked';

    public const LIKED_NAME = 'Liked Songs';

    /** Page sizes are Spotify's maximums for each endpoint. */
    private const LIKED_PAGE_SIZE = 50;

    private const PLAYLIST_PAGE_SIZE = 100;

    private const DEFAULT_COLOR = '#d4a574';

    public function __construct(private SpotifyApi $spotify) {}

    /**
     * Everything the signed-in account exposes, in import order: Liked Songs
     * first (when there are any), then every playlist in Spotify's own order.
     *
     * @return array{sources: list<array{kind: string, id: string, name: string, total: int}>, skipped: int}|null null when Spotify could not be read
     */
    public function plan(string $token): ?array
    {
        $liked = $this->spotify->getPage(SpotifyApi::API_URL.'/me/tracks', $token, ['limit' => 1]);
        if ($liked === null) {
            return null;
        }

        $plan = $this->playlistSources(SpotifyApi::API_URL.'/me/playlists', $token);
        if ($plan === null) {
            return null;
        }

        if ((int) ($liked['total'] ?? 0) > 0) {
            array_unshift($plan['sources'], [
                'kind' => 'liked',
                'id' => '',
                'name' => self::LIKED_NAME,
                'total' => (int) $liked['total'],
            ]);
        }

        return $plan;
    }

    /**
     * A public profile's playlists, readable with the app's own credentials
     * (no sign-in): the ones its owner made public. Liked Songs and private
     * playlists are never visible this way.
     *
     * @return array{sources: list<array{kind: string, id: string, name: string, total: int}>, skipped: int}|null null when the profile could not be read
     */
    public function planPublicProfile(string $spotifyUserId, string $token): ?array
    {
        return $this->playlistSources(SpotifyApi::API_URL.'/users/'.rawurlencode($spotifyUserId).'/playlists', $token);
    }

    /**
     * The Spotify user id in a profile link (open.spotify.com/user/…), a
     * spotify:user: URI, or a bare id; null for anything else.
     */
    public static function profileIdFrom(string $input): ?string
    {
        $input = trim($input);
        if (preg_match('#open\.spotify\.com/user/([^/?\#\s]+)#i', $input, $match)) {
            $input = rawurldecode($match[1]);
        } elseif (preg_match('#^spotify:user:([^\s:]+)$#i', $input, $match)) {
            $input = $match[1];
        }

        return preg_match('/^[A-Za-z0-9._-]{1,64}$/', $input) === 1 ? $input : null;
    }

    /**
     * Page through a playlists endpoint. Spotify-made playlists (owner
     * "spotify", e.g. Discover Weekly) are counted but left out: the API
     * withholds them from apps in development mode, so importing them would
     * only fail later.
     *
     * @return array{sources: list<array{kind: string, id: string, name: string, total: int}>, skipped: int}|null
     */
    private function playlistSources(string $url, string $token): ?array
    {
        $sources = [];
        $skipped = 0;
        $offset = 0;
        do {
            $data = $this->spotify->getPage($url, $token, ['offset' => $offset, 'limit' => 50]);
            if ($data === null) {
                return null;
            }
            $items = is_array($data['items'] ?? null) ? $data['items'] : [];
            foreach ($items as $playlist) {
                if (! is_array($playlist) || empty($playlist['id'])) {
                    continue;
                }
                if (($playlist['owner']['id'] ?? '') === 'spotify') {
                    $skipped++;

                    continue;
                }
                $sources[] = [
                    'kind' => 'playlist',
                    'id' => (string) $playlist['id'],
                    'name' => $this->playlistName($playlist['name'] ?? null),
                    'total' => (int) ($playlist['tracks']['total'] ?? 0),
                ];
            }
            $offset += 50;
        } while (! empty($data['next']));

        return ['sources' => $sources, 'skipped' => $skipped];
    }

    /**
     * Import one chunk of a source. Offset 0 (re)creates the mirrored playlist
     * and clears its songs; later offsets append. Each call fetches at most
     * PAGES_PER_CHUNK pages and writes them in one transaction, so a failed
     * call can simply be retried with the same offset.
     *
     * @return array{done: bool, next_offset: int, imported: int, slug: string}|null null when the source could not be read
     */
    public function importChunk(User $user, string $token, string $kind, string $id, int $offset): ?array
    {
        [$url, $pageSize, $query, $slug] = match ($kind) {
            'liked' => [SpotifyApi::API_URL.'/me/tracks', self::LIKED_PAGE_SIZE, [], self::LIKED_SLUG],
            'playlist' => [
                SpotifyApi::API_URL."/playlists/{$id}/tracks",
                self::PLAYLIST_PAGE_SIZE,
                ['fields' => 'items(is_local,track(id,type,name,artists(name),album(name,images))),total,next'],
                'spotify-'.$id,
            ],
        };

        $name = null;
        if ($offset === 0) {
            $name = $kind === 'liked' ? self::LIKED_NAME : $this->fetchPlaylistName($id, $token);
            if ($name === null) {
                return null;
            }
        }

        $rows = [];
        $done = false;
        $cursor = $offset;
        for ($page = 0; $page < self::PAGES_PER_CHUNK; $page++) {
            $data = $this->spotify->getPage($url, $token, $query + ['offset' => $cursor, 'limit' => $pageSize]);
            if ($data === null) {
                return null;
            }
            $items = is_array($data['items'] ?? null) ? $data['items'] : [];
            foreach ($items as $item) {
                $row = $this->songRow(is_array($item) ? $item : []);
                if ($row !== null) {
                    $rows[] = $row;
                }
            }
            $cursor += count($items);
            if ($items === [] || empty($data['next'])) {
                $done = true;
                break;
            }
        }

        // The account's ceilings hold here too (config/library.php). A mirror
        // that cannot be made or cannot take every song stops with a sentence
        // instead of going past them.
        $mirror = $user->playlists()->where('slug', $slug)->first();
        if ($mirror === null && LibraryLimits::playlistsLeft($user) < 1) {
            return ['done' => true, 'next_offset' => $cursor, 'imported' => 0, 'slug' => $slug, 'error' => LibraryLimits::playlistsFullMessage()];
        }
        $inMirror = $mirror === null ? 0 : $mirror->songs()->count();
        $kept = $offset === 0 ? 0 : $inMirror; // offset 0 starts the mirror afresh
        $inLibrary = Song::whereIn('playlist_id', $user->playlists()->select('id'))->count() - ($inMirror - $kept);
        $room = max(0, min(LibraryLimits::max('playlist_songs') - $kept, LibraryLimits::max('songs') - $inLibrary));
        $error = null;
        if (count($rows) > $room) {
            $rows = array_slice($rows, 0, $room);
            $done = true;
            $error = LibraryLimits::songsFullMessage();
        }

        DB::transaction(function () use ($user, $slug, $name, $rows): void {
            $playlist = $this->preparePlaylist($user, $slug, $name);
            $this->appendSongs($playlist, $rows);
        });

        return ['done' => $done, 'next_offset' => $cursor, 'imported' => count($rows), 'slug' => $slug]
            + ($error === null ? [] : ['error' => $error]);
    }

    /**
     * The mirrored playlist for a source. With a name (offset 0) it is created
     * or reset to mirror Spotify afresh; without one it must already exist.
     */
    private function preparePlaylist(User $user, string $slug, ?string $name): Playlist
    {
        $playlist = $user->playlists()->where('slug', $slug)->first();

        if ($playlist === null) {
            return $user->playlists()->create([
                'slug' => $slug,
                'name' => $name ?? $slug,
                'color' => self::DEFAULT_COLOR,
                'current_index' => 0,
                'source' => 'spotify',
                'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
            ]);
        }

        if ($name !== null) {
            $playlist->songs()->delete();
            $playlist->fill([
                'name' => $name,
                'current_index' => 0,
                'cover_song_index' => null,
                'source' => 'spotify',
            ])->save();
        }

        return $playlist;
    }

    /**
     * @param  list<array{title: string, artist: string, album: string, cover: string, spotify_id: string}>  $rows
     */
    private function appendSongs(Playlist $playlist, array $rows): void
    {
        if ($rows === []) {
            return;
        }

        // Tracks someone already played here resolved to a YouTube video; reuse
        // that so those songs play instantly instead of resolving again.
        $keys = [];
        foreach ($rows as $i => $row) {
            if ($row['spotify_id'] !== '') {
                $keys[$i] = YoutubeMatch::cacheKey($row['spotify_id'], $row['title'], $row['artist']);
            }
        }
        $youtubeIds = $keys === []
            ? []
            : YoutubeMatch::query()->whereIn('spotify_id', array_values($keys))->pluck('youtube_id', 'spotify_id')->all();

        $position = ((int) ($playlist->songs()->max('position') ?? -1)) + 1;
        $now = now();
        $inserts = [];
        foreach ($rows as $i => $row) {
            $inserts[] = $row + [
                'playlist_id' => $playlist->id,
                'position' => $position++,
                'youtube_id' => isset($keys[$i]) ? ($youtubeIds[$keys[$i]] ?? null) : null,
                'mp3_url' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        Song::query()->insert($inserts);
    }

    /**
     * A song row for a playlist/liked item, or null for anything that isn't a
     * plain track: local files and podcast episodes have nothing to resolve.
     *
     * @return array{title: string, artist: string, album: string, cover: string, spotify_id: string}|null
     */
    private function songRow(array $item): ?array
    {
        $track = $item['track'] ?? null;
        if (! is_array($track) || ! empty($item['is_local']) || ($track['type'] ?? 'track') !== 'track') {
            return null;
        }

        $title = trim((string) ($track['name'] ?? ''));
        if ($title === '') {
            return null;
        }

        $artists = array_map(
            fn ($artist) => trim((string) (is_array($artist) ? ($artist['name'] ?? '') : '')),
            is_array($track['artists'] ?? null) ? $track['artists'] : [],
        );

        return [
            'title' => mb_substr($title, 0, 300),
            'artist' => mb_substr(implode(', ', array_filter($artists)), 0, 300),
            'album' => mb_substr(trim((string) ($track['album']['name'] ?? '')), 0, 300),
            'cover' => $this->coverFrom(is_array($track['album']['images'] ?? null) ? $track['album']['images'] : []),
            'spotify_id' => mb_substr(trim((string) ($track['id'] ?? '')), 0, 40),
        ];
    }

    /**
     * Prefer a cover of at least 300px, like the single-playlist import; only
     * plain http(s) URLs survive since covers land in <img src>.
     */
    private function coverFrom(array $images): string
    {
        $candidates = array_filter($images, fn ($image) => is_array($image) && ! empty($image['url']));
        foreach ($candidates as $image) {
            if (($image['width'] ?? 0) >= 300) {
                return $this->httpUrl($image['url']);
            }
        }
        foreach ($candidates as $image) {
            return $this->httpUrl($image['url']);
        }

        return '';
    }

    private function httpUrl(mixed $value): string
    {
        $url = is_scalar($value) ? trim((string) $value) : '';

        return preg_match('#^https?://[^\s<>"\']+$#i', $url) && LibraryLimits::fits($url) ? $url : '';
    }

    private function fetchPlaylistName(string $id, string $token): ?string
    {
        $data = $this->spotify->getPage(SpotifyApi::API_URL."/playlists/{$id}", $token, ['fields' => 'name']);

        return $data === null ? null : $this->playlistName($data['name'] ?? null);
    }

    /** Fit Spotify's up-to-100-character names into the same column limit. */
    private function playlistName(mixed $name): string
    {
        $name = is_scalar($name) ? trim((string) $name) : '';

        return $name === '' ? 'Untitled' : mb_substr($name, 0, 100);
    }
}
