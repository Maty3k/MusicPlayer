<?php

namespace App\Http\Controllers;

use App\Models\Playlist;
use App\Models\Song;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Port of the legacy save-music.php action dispatcher, per authenticated user.
 * Response shapes (keys and success/error strings) are byte-compatible with
 * the legacy endpoint — the frontend JS depends on them.
 */
class MusicController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $action = $request->input('action', '');

        $payload = match ($action) {
            'switch' => DB::transaction(fn () => $this->switchSong($request, $user)),
            'switchPlaylist' => DB::transaction(fn () => $this->switchPlaylist($request, $user)),
            'add' => DB::transaction(fn () => $this->addSong($request, $user)),
            'addBatch' => DB::transaction(fn () => $this->addBatch($request, $user)),
            'delete' => DB::transaction(fn () => $this->deleteSong($request, $user)),
            'rename' => DB::transaction(fn () => $this->renamePlaylist($request, $user)),
            'recolor' => DB::transaction(fn () => $this->recolorPlaylist($request, $user)),
            'createPlaylist' => DB::transaction(fn () => $this->createPlaylist($request, $user)),
            'deletePlaylist' => DB::transaction(fn () => $this->deletePlaylist($request, $user)),
            'moveSong' => DB::transaction(fn () => $this->moveSong($request, $user)),
            'copySong' => DB::transaction(fn () => $this->copySong($request, $user)),
            'setCover' => DB::transaction(fn () => $this->setCover($request, $user)),
            'recordPlay' => DB::transaction(fn () => $this->recordPlay($request, $user)),
            'favorite' => DB::transaction(fn () => $this->favorite($request, $user)),
            'reorder' => DB::transaction(fn () => $this->reorderPlaylist($request, $user)),
            'share' => DB::transaction(fn () => $this->sharePlaylist($request, $user)),
            'unshare' => DB::transaction(fn () => $this->unsharePlaylist($request, $user)),
            'searchLibrary' => $this->searchLibrary($request, $user),
            'stats' => $this->stats($request, $user),
            'getAll' => $this->getAll($user),
            default => ['success' => false, 'error' => 'Invalid action'],
        };

        return response()->json($payload);
    }

    // ---- Actions -----------------------------------------------------------

    /** Switch to a different song within the current playlist. */
    private function switchSong(Request $request, User $user): array
    {
        $index = (int) $request->input('index', 0);
        $playlist = $this->findPlaylist($user, $this->activeSlug($user));

        if ($playlist !== null && $this->songAt($playlist, $index) !== null) {
            $playlist->update(['current_index' => $index]);

            return ['success' => true];
        }

        return ['success' => false, 'error' => 'Invalid song index'];
    }

    /** Switch to a different playlist; updates recently-played (front, max 4). */
    private function switchPlaylist(Request $request, User $user): array
    {
        $slug = $this->strInput($request, 'playlist');
        $playlist = $this->findPlaylist($user, $slug);

        if ($playlist === null) {
            return ['success' => false, 'error' => 'Invalid playlist'];
        }

        $recent = $user->recently_played ?? [];
        $recent = array_values(array_filter($recent, fn ($id) => $id !== $slug));
        array_unshift($recent, $slug);
        $recent = array_slice($recent, 0, 4);

        $user->active_playlist_slug = $slug;
        $user->recently_played = $recent;
        $user->save();

        return [
            'success' => true,
            'playlist' => $playlist->toFrontend(),
            'playlistId' => $slug,
            'recentlyPlayed' => $recent,
        ];
    }

    /**
     * Add a new song to the current playlist, or to the playlist `playlist`
     * names (the phone's "Add songs to" picker). Only a plain add moves the
     * playlist's resume point.
     */
    private function addSong(Request $request, User $user): array
    {
        $song = $request->input('song');
        $activeSlug = $this->activeSlug($user);
        $targeted = $request->has('playlist');
        $slug = $targeted ? $this->strInput($request, 'playlist') : $activeSlug;
        $playlist = $this->findPlaylist($user, $slug);

        if (! preg_match('/^[A-Za-z0-9_-]{1,64}$/', $slug)
            || ($playlist === null && $slug !== 'favorites')) {
            // Only ever auto-create the default 'favorites' playlist (the
            // bootstrap case); never auto-vivify an unknown, attacker-chosen key.
            return ['success' => false, 'error' => $targeted ? 'Invalid playlist' : 'Invalid active playlist'];
        }

        if (! is_array($song) || $this->songText($song['title'] ?? '') === '') {
            return ['success' => false, 'error' => 'Missing song data'];
        }

        if ($playlist === null) {
            $playlist = $user->playlists()->create([
                'slug' => 'favorites',
                'name' => 'Favorites',
                'color' => '#d4a574',
                'current_index' => 0,
                'source' => 'user',
                'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
            ]);
        }

        // Batch imports of downloaded files send link=true: when an uploaded
        // MP3 matches a song already in the playlist (same track, streaming
        // source), attach the file to that song as its offline copy instead
        // of creating a duplicate entry.
        $mp3Url = $this->sanitizeUrl($song['mp3_url'] ?? '');
        if ($request->boolean('link') && $mp3Url !== '') {
            $match = $this->findLinkableSong(
                $playlist,
                $this->songText($song['title'] ?? ''),
                $this->songText($song['artist'] ?? '')
            );
            if ($match !== null) {
                $match->update([
                    'mp3_url' => $mp3Url,
                    'album' => $match->album !== '' ? $match->album : $this->songText($song['album'] ?? ''),
                    'cover' => $match->cover !== '' ? $match->cover : $this->sanitizeUrl($song['cover'] ?? ''),
                ]);

                return ['success' => true, 'linked' => true, 'index' => (int) $match->position];
            }
        }

        // Only well-formed ids reach the players (a crafted value must never
        // land in the iframe / SDK), and a song needs at least one source or
        // it would sit in the playlist unplayable.
        $youtubeId = (string) ($song['youtube_id'] ?? '');
        $youtubeId = preg_match('/^[A-Za-z0-9_-]{11}$/', $youtubeId) ? $youtubeId : '';
        $spotifyId = (string) ($song['spotify_id'] ?? '');
        $spotifyId = preg_match('/^[A-Za-z0-9]{22}$/', $spotifyId) ? $spotifyId : '';
        if ($youtubeId === '' && $spotifyId === '' && $mp3Url === '') {
            return ['success' => false, 'error' => 'No playable source: paste a YouTube link, a Spotify track link, or an MP3 URL'];
        }

        $newIndex = $playlist->songs()->count();
        $playlist->songs()->create([
            'position' => $newIndex,
            'title' => $this->songText($song['title'] ?? ''),
            'artist' => $this->songText($song['artist'] ?? ''),
            'album' => $this->songText($song['album'] ?? ''),
            'cover' => $this->sanitizeUrl($song['cover'] ?? ''),
            'youtube_id' => $youtubeId,
            'mp3_url' => $mp3Url,
            'spotify_id' => $spotifyId,
        ]);
        // A plain add makes the new song current (the client plays it); a
        // targeted one (the phone's "Add songs to") leaves what's playing be.
        if (! $targeted) {
            $playlist->update(['current_index' => $newIndex]);
        }

        return ['success' => true, 'index' => $newIndex];
    }

    /** Max songs a single batch-import request may add. */
    private const BATCH_LIMIT = 200;

    /**
     * Add many songs in one transaction — the bulk import path (paste-a-list,
     * YouTube/Spotify playlist). Songs go to a new playlist when
     * `newPlaylist` names one, to the playlist `playlist` names (the later
     * chunks of that same import), or else to the current playlist. Skips
     * entries already in the target (same youtube_id, or same title+artist)
     * so re-running an import doesn't duplicate. Returns how many were added
     * vs skipped, and which playlist they went to.
     */
    private function addBatch(Request $request, User $user): array
    {
        $songs = $request->input('songs');
        if (! is_array($songs) || $songs === []) {
            return ['success' => false, 'error' => 'No songs to import'];
        }
        if (count($songs) > self::BATCH_LIMIT) {
            return ['success' => false, 'error' => 'Too many songs at once (max '.self::BATCH_LIMIT.')'];
        }

        if ($request->has('newPlaylist')) {
            $playlist = $this->createImportPlaylist($user, $this->strInput($request, 'newPlaylist'));
        } elseif ($request->has('playlist')) {
            $playlist = $this->findPlaylist($user, $this->strInput($request, 'playlist'));
            if ($playlist === null) {
                return ['success' => false, 'error' => 'Invalid playlist'];
            }
        } else {
            $activeSlug = $this->activeSlug($user);
            $playlist = $this->findPlaylist($user, $activeSlug);

            if (! preg_match('/^[A-Za-z0-9_-]{1,64}$/', $activeSlug)
                || ($playlist === null && $activeSlug !== 'favorites')) {
                return ['success' => false, 'error' => 'Invalid active playlist'];
            }
            if ($playlist === null) {
                $playlist = $user->playlists()->create([
                    'slug' => 'favorites',
                    'name' => 'Favorites',
                    'color' => '#d4a574',
                    'current_index' => 0,
                    'source' => 'user',
                    'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
                ]);
            }
        }

        // Existing songs, keyed for dedupe (by youtube_id and by title|artist).
        $existing = $playlist->songs()->get(['title', 'artist', 'youtube_id']);
        $haveYt = $existing->pluck('youtube_id')->filter()->map(fn ($v) => (string) $v)->flip();
        $haveKey = $existing
            ->mapWithKeys(fn ($s) => [mb_strtolower(trim($s->title).'|'.trim($s->artist)) => true]);

        $position = $playlist->songs()->count();
        $added = 0;
        $skipped = 0;
        $seenYt = [];
        $seenKey = [];

        foreach ($songs as $song) {
            $title = is_array($song) ? $this->songText($song['title'] ?? '') : '';
            if ($title === '') {
                $skipped++;

                continue;
            }
            $artist = $this->songText($song['artist'] ?? '');
            // Client-supplied ids (from search results) — accept only the
            // canonical forms (11-char YouTube, 22-char Spotify), blank anything
            // else so a crafted value can never reach the players.
            $yt = is_string($song['youtube_id'] ?? null) ? $song['youtube_id'] : '';
            $yt = preg_match('/^[A-Za-z0-9_-]{11}$/', $yt) ? $yt : '';
            $spotifyId = is_string($song['spotify_id'] ?? null) ? $song['spotify_id'] : '';
            $spotifyId = preg_match('/^[A-Za-z0-9]{22}$/', $spotifyId) ? $spotifyId : '';
            $key = mb_strtolower(trim($title).'|'.trim($artist));

            $dupeYt = $yt !== '' && ($haveYt->has($yt) || isset($seenYt[$yt]));
            $dupeKey = isset($haveKey[$key]) || isset($seenKey[$key]);
            if ($dupeYt || $dupeKey) {
                $skipped++;

                continue;
            }

            $playlist->songs()->create([
                'position' => $position,
                'title' => $title,
                'artist' => $artist,
                'album' => $this->songText($song['album'] ?? ''),
                'cover' => $this->sanitizeUrl($song['cover'] ?? ''),
                'youtube_id' => $yt,
                'mp3_url' => $this->sanitizeUrl($song['mp3_url'] ?? ''),
                'spotify_id' => $spotifyId,
            ]);
            if ($yt !== '') {
                $seenYt[$yt] = true;
            }
            $seenKey[$key] = true;
            $position++;
            $added++;
        }

        return [
            'success' => true,
            'added' => $added,
            'skipped' => $skipped,
            'total' => $position,
            'playlistId' => $playlist->slug,
        ];
    }

    /**
     * A playlist for an import, named after its source (a YouTube or Spotify
     * playlist title can run past the 30 characters a hand-made name gets,
     * so allow up to 90, like copying a shared playlist).
     */
    private function createImportPlaylist(User $user, string $name): Playlist
    {
        $name = Str::limit(trim(preg_replace('/\s+/u', ' ', $name) ?? ''), 90, '');

        do {
            $slug = 'pl-'.strtolower(Str::random(10));
        } while ($user->playlists()->where('slug', $slug)->exists());

        return $user->playlists()->create([
            'slug' => $slug,
            'name' => $name !== '' ? $name : 'Imported playlist',
            'color' => '#d4a574',
            'current_index' => 0,
            'source' => 'user',
            'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
        ]);
    }

    /** Delete a song and reindex; legacy 3-branch currentIndex adjustment. */
    private function deleteSong(Request $request, User $user): array
    {
        $index = filter_var($request->input('index'), FILTER_VALIDATE_INT);
        $slug = $request->input('playlist') ?? $this->activeSlug($user);
        $playlist = is_string($slug) ? $this->findPlaylist($user, $slug) : null;

        if ($index === false || $index < 0 || $playlist === null
            || ($victim = $this->songAt($playlist, $index)) === null) {
            return ['success' => false, 'error' => 'Invalid song index'];
        }

        $uploads = [$victim->mp3_url, $victim->cover];
        $victim->delete();
        $this->deleteOrphanedUploads($user, $uploads);
        $this->reindexSongs($playlist);

        $total = $playlist->songs()->count();
        $cur = (int) $playlist->current_index;
        if ($total === 0) {
            $newIndex = 0;
        } elseif ($index < $cur || $cur >= $total) {
            $newIndex = max(0, $cur - 1);
        } else {
            $newIndex = $cur;
        }
        $playlist->update(['current_index' => $newIndex]);

        return ['success' => true, 'newIndex' => $newIndex];
    }

    private function renamePlaylist(Request $request, User $user): array
    {
        $playlist = $this->findPlaylist($user, $this->strInput($request, 'playlist'));
        $name = trim($this->strInput($request, 'name'));

        if ($playlist !== null && $name !== '') {
            $playlist->update(['name' => $name]);

            return ['success' => true];
        }

        return ['success' => false, 'error' => 'Invalid playlist or empty name'];
    }

    private function recolorPlaylist(Request $request, User $user): array
    {
        $playlist = $this->findPlaylist($user, $this->strInput($request, 'playlist'));
        $color = $this->strInput($request, 'color');

        if ($playlist !== null && preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
            $playlist->update(['color' => $color]);

            return ['success' => true];
        }

        return ['success' => false, 'error' => 'Invalid playlist or color format'];
    }

    /** Create a new, empty user playlist with a generated slug. */
    private function createPlaylist(Request $request, User $user): array
    {
        $name = trim($this->strInput($request, 'name'));
        $color = $this->strInput($request, 'color');

        if ($name === '' || mb_strlen($name) > 30) {
            return ['success' => false, 'error' => 'Invalid playlist name'];
        }
        if (! preg_match('/^#[0-9a-fA-F]{6}$/', $color)) {
            $color = '#d4a574';
        }

        // A "Favorites" playlist (the welcome wizard's default) is the one the
        // heart button fills, so hearting a song later doesn't spawn a second
        // "Favorites" beside it.
        if (mb_strtolower($name) === 'favorites' && ! $user->playlists()->where('slug', 'favorites')->exists()) {
            $slug = 'favorites';
        } else {
            do {
                $slug = 'pl-'.strtolower(Str::random(10));
            } while ($user->playlists()->where('slug', $slug)->exists());
        }

        $playlist = $user->playlists()->create([
            'slug' => $slug,
            'name' => $name,
            'color' => $color,
            'current_index' => 0,
            'source' => 'user',
            'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
        ]);

        return ['success' => true, 'playlistId' => $slug, 'playlist' => $playlist->toFrontend()];
    }

    /** Delete a playlist (songs cascade); GC uploads; repoint active slug. */
    private function deletePlaylist(Request $request, User $user): array
    {
        $slug = $this->strInput($request, 'playlist');
        $playlist = $this->findPlaylist($user, $slug);

        if ($playlist === null) {
            return ['success' => false, 'error' => 'Invalid playlist'];
        }

        // Collect uploaded-file URLs before the song rows cascade away.
        $urls = [];
        foreach ($playlist->songs as $song) {
            $urls[] = $song->mp3_url;
            $urls[] = $song->cover;
        }

        $playlist->delete();
        $this->deleteOrphanedUploads($user, $urls);

        $remaining = $user->playlists()->orderBy('position')->value('slug');
        if ($user->active_playlist_slug === $slug) {
            $user->active_playlist_slug = $remaining;
        }
        $user->recently_played = array_values(array_filter(
            $user->recently_played ?? [], fn ($id) => $id !== $slug
        ));
        $user->save();

        return ['success' => true, 'activePlaylist' => $remaining ?? 'favorites'];
    }

    /** Move a song to the end of another playlist; fix source currentIndex. */
    private function moveSong(Request $request, User $user): array
    {
        $fromSlug = $request->input('fromPlaylist', '');
        $toSlug = $request->input('toPlaylist', '');
        $songIndex = filter_var($request->input('songIndex'), FILTER_VALIDATE_INT);

        if ($fromSlug === $toSlug) {
            return ['success' => false, 'error' => 'Cannot move to same playlist'];
        }

        $from = is_string($fromSlug) ? $this->findPlaylist($user, $fromSlug) : null;
        $to = is_string($toSlug) ? $this->findPlaylist($user, $toSlug) : null;

        if ($songIndex === false || $songIndex < 0 || $from === null || $to === null
            || ($song = $this->songAt($from, $songIndex)) === null) {
            return ['success' => false, 'error' => 'Invalid playlist or song index'];
        }

        // Append to target, remove from source.
        $song->playlist_id = $to->id;
        $song->position = $to->songs()->count();
        $song->save();
        $this->reindexSongs($from);

        // Fix currentIndex for the source playlist (legacy math: no change in
        // the remaining case).
        $total = $from->songs()->count();
        $cur = (int) $from->current_index;
        if ($total === 0) {
            $from->update(['current_index' => 0]);
        } elseif ($songIndex < $cur || $cur >= $total) {
            $from->update(['current_index' => max(0, $cur - 1)]);
        }

        return [
            'success' => true,
            'newIndex' => (int) $from->current_index,
            'fromCount' => $total,
            'toCount' => $to->songs()->count(),
        ];
    }

    /** Copy a song to the end of another playlist. */
    private function copySong(Request $request, User $user): array
    {
        $fromSlug = $request->input('fromPlaylist', '');
        $toSlug = $request->input('toPlaylist', '');
        $songIndex = filter_var($request->input('songIndex'), FILTER_VALIDATE_INT);

        if ($fromSlug === $toSlug) {
            return ['success' => false, 'error' => 'Cannot copy to same playlist'];
        }

        $from = is_string($fromSlug) ? $this->findPlaylist($user, $fromSlug) : null;
        $to = is_string($toSlug) ? $this->findPlaylist($user, $toSlug) : null;

        if ($songIndex === false || $songIndex < 0 || $from === null || $to === null
            || ($song = $this->songAt($from, $songIndex)) === null) {
            return ['success' => false, 'error' => 'Invalid playlist or song index'];
        }

        $to->songs()->create([
            'position' => $to->songs()->count(),
            'title' => $song->title,
            'artist' => $song->artist,
            'album' => $song->album,
            'cover' => $song->cover,
            'youtube_id' => $song->youtube_id,
            'mp3_url' => $song->mp3_url,
            'spotify_id' => $song->spotify_id,
        ]);

        return [
            'success' => true,
            'toCount' => $to->songs()->count(),
        ];
    }

    /**
     * Reorder a playlist's songs (drag-to-reorder). `order` is the new sequence
     * of current positions — order[i] is the old position of the song that
     * should end up at index i. Validated as a strict permutation of 0..n-1.
     */
    private function reorderPlaylist(Request $request, User $user): array
    {
        $slug = $this->strInput($request, 'playlist');
        if ($slug === '') {
            $slug = $this->activeSlug($user);
        }
        $playlist = $this->findPlaylist($user, $slug);
        if ($playlist === null) {
            return ['success' => false, 'error' => 'Invalid playlist'];
        }

        $order = $request->input('order');
        $songs = $playlist->songs()->orderBy('position')->get();
        $n = $songs->count();
        if ($n === 0) {
            return ['success' => true];
        }
        if (! is_array($order) || count($order) !== $n) {
            return ['success' => false, 'error' => 'Bad order'];
        }

        $ints = [];
        foreach ($order as $v) {
            $iv = filter_var($v, FILTER_VALIDATE_INT);
            if ($iv === false || $iv < 0 || $iv >= $n) {
                return ['success' => false, 'error' => 'Bad order'];
            }
            $ints[] = $iv;
        }
        $sorted = $ints;
        sort($sorted);
        if ($sorted !== range(0, $n - 1)) {
            return ['success' => false, 'error' => 'Bad order'];
        }

        foreach ($ints as $newPos => $oldPos) {
            $song = $songs[$oldPos];
            if ((int) $song->position !== $newPos) {
                $song->update(['position' => $newPos]);
            }
        }
        // Follow the currently-selected song AND the pinned cover to new slots
        // (both are positional indexes into the reordered songs).
        $oldCur = (int) $playlist->current_index;
        $newCur = array_search($oldCur, $ints, true);
        if ($newCur !== false && $newCur !== $oldCur) {
            $playlist->update(['current_index' => $newCur]);
        }
        if ($playlist->cover_song_index !== null) {
            $oldCover = (int) $playlist->cover_song_index;
            $newCover = array_search($oldCover, $ints, true);
            if ($newCover !== false && $newCover !== $oldCover) {
                $playlist->update(['cover_song_index' => $newCover]);
            }
        }

        return ['success' => true];
    }

    /** Create (or return the existing) public share link for a playlist. */
    private function sharePlaylist(Request $request, User $user): array
    {
        $playlist = $this->findPlaylist($user, $this->strInput($request, 'playlist'));
        if ($playlist === null) {
            return ['success' => false, 'error' => 'Invalid playlist'];
        }

        if (empty($playlist->share_token)) {
            do {
                $token = Str::random(24);
            } while (Playlist::where('share_token', $token)->exists());
            $playlist->update(['share_token' => $token]);
        }

        return [
            'success' => true,
            'token' => $playlist->share_token,
            'url' => url('/s/'.$playlist->share_token),
        ];
    }

    /** Revoke a playlist's public share link (old links stop working). */
    private function unsharePlaylist(Request $request, User $user): array
    {
        $playlist = $this->findPlaylist($user, $this->strInput($request, 'playlist'));
        if ($playlist === null) {
            return ['success' => false, 'error' => 'Invalid playlist'];
        }
        $playlist->update(['share_token' => null]);

        return ['success' => true];
    }

    /** Pin (or clear) a playlist's cover song. */
    private function setCover(Request $request, User $user): array
    {
        $playlist = $this->findPlaylist($user, $this->strInput($request, 'playlist'));
        $rawIndex = $request->input('songIndex');
        $songIndex = ($rawIndex === null) ? null : filter_var($rawIndex, FILTER_VALIDATE_INT);

        if ($playlist === null) {
            return ['success' => false, 'error' => 'Invalid playlist'];
        }

        if ($songIndex === null || $songIndex === -1) {
            // Reset to auto-pick
            $playlist->update(['cover_song_index' => null]);
        } elseif ($songIndex !== false && $songIndex >= 0 && $this->songAt($playlist, $songIndex) !== null) {
            $playlist->update(['cover_song_index' => $songIndex]);
        } else {
            return ['success' => false, 'error' => 'Invalid song index'];
        }

        return ['success' => true];
    }

    /**
     * Record that a song started playing. Upserts one row per distinct song
     * (dedupe_key), bumping played_at on a replay so "recently played" reorders
     * without piling up duplicate rows. Fires for playlist taps, autoplay, and
     * radio/discover previews (every real start funnels through here from JS).
     */
    private function recordPlay(Request $request, User $user): array
    {
        $song = $request->input('song');
        if (! is_array($song) || empty($song['title'])) {
            return ['success' => false, 'error' => 'Missing song data'];
        }

        // Clamp to the column limits — an over-length title/artist/album/
        // spotify_id would otherwise throw a QueryException (500) on a strict
        // DB like the prod Postgres; SQLite in tests silently truncates.
        $title = mb_substr((string) $song['title'], 0, 300);
        $artist = mb_substr((string) ($song['artist'] ?? ''), 0, 300);
        $album = mb_substr((string) ($song['album'] ?? ''), 0, 300);
        // Client-supplied id: accept only the canonical 11-char YouTube form,
        // blank anything else (same guard as addBatch) so a crafted value can
        // never reach the player/iframe when this song is replayed.
        $yt = (string) ($song['youtube_id'] ?? '');
        $yt = preg_match('/^[A-Za-z0-9_-]{11}$/', $yt) ? $yt : '';
        $spotify = mb_substr((string) ($song['spotify_id'] ?? ''), 0, 40);
        $mp3 = $this->sanitizeUrl($song['mp3_url'] ?? '');
        $cover = $this->sanitizeUrl($song['cover'] ?? '');
        $key = $this->playKey($yt, $spotify, $mp3, $title, $artist);

        // Delete-then-insert (not updateOrCreate) so a replay gets a fresh row
        // with a higher id — recentSongs tiebreaks on id, which stays correct
        // even when several plays land in the same clock second (played_at ties).
        // Carry the lifetime play_count across the delete so stats can rank by it.
        $existing = $user->plays()->where('dedupe_key', $key)->first();
        $playCount = ($existing !== null ? (int) $existing->play_count : 0) + 1;
        $user->plays()->where('dedupe_key', $key)->delete();
        $user->plays()->create([
            'dedupe_key' => $key,
            'title' => $title,
            'artist' => $artist,
            'album' => $album,
            'cover' => $cover,
            'youtube_id' => $yt,
            'mp3_url' => $mp3,
            'spotify_id' => $spotify,
            'played_at' => now(),
            'play_count' => $playCount,
        ]);

        // Append to the play-events log too (powers windowed stats).
        $user->playEvents()->create([
            'dedupe_key' => $key,
            'title' => $title,
            'artist' => $artist,
            'cover' => $cover,
            'played_at' => now(),
        ]);
        // Keep the log bounded — but only check occasionally: the offset lookup
        // is too costly to run on every play when pruning is needed at most
        // once per MAX_PLAY_EVENTS plays.
        if (random_int(1, 100) === 1) {
            $cutoffId = $user->playEvents()->orderByDesc('id')->skip(self::MAX_PLAY_EVENTS)->limit(1)->value('id');
            if ($cutoffId !== null) {
                $user->playEvents()->where('id', '<=', $cutoffId)->delete();
            }
        }

        return ['success' => true];
    }

    /** Cap on the per-user play-events log. */
    private const MAX_PLAY_EVENTS = 10000;

    /**
     * Stable per-song identity for dedupe: prefer the streaming id, fall back
     * to a hash of title|artist so songs with no id still collapse on replay.
     */
    private function playKey(string $yt, string $spotify, string $mp3, string $title, string $artist): string
    {
        if ($yt !== '') {
            return 'yt:'.$yt;
        }
        if ($spotify !== '') {
            return 'sp:'.$spotify;
        }
        if ($mp3 !== '') {
            return 'mp3:'.md5($mp3);
        }

        return 'tt:'.md5(mb_strtolower(trim($title).'|'.trim($artist)));
    }

    /** The 'favorites' playlist slug — the heart button's target. */
    private const FAVORITES_SLUG = 'favorites';

    /**
     * Toggle a song in the user's Favorites playlist (the heart button). Adds
     * it if absent, removes it if already there — matched by the shared song
     * key so the same track is recognised across playlists. Returns the new
     * favorited state.
     */
    private function favorite(Request $request, User $user): array
    {
        $song = $request->input('song');
        if (! is_array($song) || empty($song['title'])) {
            return ['success' => false, 'error' => 'Missing song data'];
        }

        $title = mb_substr((string) $song['title'], 0, 300);
        $artist = mb_substr((string) ($song['artist'] ?? ''), 0, 300);
        // Match by the song's real youtube_id (verbatim, column-bounded), NOT an
        // 11-char-only blank — the library stores ids verbatim, so blanking here
        // would make the favorite's key diverge from the row's and desync the heart.
        $yt = mb_substr((string) ($song['youtube_id'] ?? ''), 0, 20);
        $spotify = mb_substr((string) ($song['spotify_id'] ?? ''), 0, 40);
        $mp3 = $this->sanitizeUrl($song['mp3_url'] ?? '');
        $key = Song::keyFor($yt, $spotify, $mp3, $title, $artist);

        $fav = $this->findPlaylist($user, self::FAVORITES_SLUG);

        // Already a favorite? Remove it (unfavorite).
        if ($fav !== null) {
            foreach ($fav->songs as $existing) {
                if ($existing->frontendKey() === $key) {
                    $removedPos = (int) $existing->position;
                    $uploads = [$existing->mp3_url, $existing->cover];
                    $existing->delete();
                    $this->deleteOrphanedUploads($user, $uploads);
                    $this->reindexSongs($fav);

                    // Same current_index adjustment deleteSong makes: shift down
                    // when a song before the current one is removed, else clamp.
                    $total = $fav->songs()->count();
                    $cur = (int) $fav->current_index;
                    if ($total === 0) {
                        $newIndex = 0;
                    } elseif ($removedPos < $cur || $cur >= $total) {
                        $newIndex = max(0, $cur - 1);
                    } else {
                        $newIndex = $cur;
                    }
                    $fav->update(['current_index' => $newIndex]);

                    return ['success' => true, 'favorited' => false, 'key' => $key];
                }
            }
        }

        // Not a favorite yet — add it (creating the Favorites playlist if needed).
        if ($fav === null) {
            $fav = $user->playlists()->create([
                'slug' => self::FAVORITES_SLUG,
                'name' => 'Favorites',
                'color' => '#d4a574',
                'current_index' => 0,
                'source' => 'user',
                'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
            ]);
        }

        $fav->songs()->create([
            'position' => $fav->songs()->count(),
            'title' => $title,
            'artist' => $artist,
            'album' => mb_substr((string) ($song['album'] ?? ''), 0, 300),
            'cover' => $this->sanitizeUrl($song['cover'] ?? ''),
            'youtube_id' => $yt,
            'mp3_url' => $mp3,
            'spotify_id' => $spotify,
        ]);

        return ['success' => true, 'favorited' => true, 'key' => $key];
    }

    /**
     * Identity keys of every song in the user's Favorites playlist — the client
     * fills the heart when a row's key is in this set.
     *
     * @return array<int, string>
     */
    private function favoriteKeys(User $user): array
    {
        $fav = $this->findPlaylist($user, self::FAVORITES_SLUG);

        return $fav === null
            ? []
            : $fav->songs->map(fn (Song $s) => $s->frontendKey())->unique()->values()->all();
    }

    /**
     * Search every song in the user's library (across all playlists) by
     * title/artist — the global "find any song" box. Returns matches with their
     * home playlist + position so the client can jump to and play them.
     */
    private function searchLibrary(Request $request, User $user): array
    {
        $q = trim((string) $request->input('q', ''));
        if (mb_strlen($q) < 2) {
            return ['success' => true, 'results' => []];
        }
        // Escape LIKE wildcards so a literal % or _ in the query matches itself.
        // An explicit ESCAPE clause is required — SQLite has no default escape
        // char, so the backslashes would otherwise be matched literally.
        $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $q).'%';

        $songs = Song::whereIn('playlist_id', $user->playlists()->select('id'))
            ->where(fn ($query) => $query
                ->whereRaw('title LIKE ? ESCAPE ?', [$like, '\\'])
                ->orWhereRaw('artist LIKE ? ESCAPE ?', [$like, '\\']))
            ->with('playlist:id,slug,name,color')
            ->orderBy('title')
            ->limit(40)
            ->get();

        $results = $songs
            ->filter(fn (Song $s) => $s->playlist !== null)
            ->map(fn (Song $s) => $s->toFrontend() + [
                'position' => (int) $s->position,
                'playlistSlug' => $s->playlist->slug,
                'playlistName' => $s->playlist->name,
                'playlistColor' => $s->playlist->color,
            ])
            ->values()
            ->all();

        return ['success' => true, 'results' => $results];
    }

    /**
     * Listening stats for the profile panel. "All time" reads the persisted
     * plays table (backfilled, uncapped lifetime counts); week/month/year read
     * the play-events log so each play counts within its window. Either way:
     * top songs, top artists, and play/song/artist counts.
     */
    private function stats(Request $request, User $user): array
    {
        $range = (string) $request->input('range', 'all');
        if (! in_array($range, ['week', 'month', 'year', 'all'], true)) {
            $range = 'all';
        }

        $data = $range === 'all'
            ? $this->allTimeStats($user)
            : $this->windowStats($user, $range);

        return ['success' => true, 'range' => $range] + ['stats' => $data];
    }

    /** All-time stats from the plays table (lifetime play_count, uncapped). */
    private function allTimeStats(User $user): array
    {
        $counts = $user->plays()
            ->selectRaw("COALESCE(SUM(play_count), 0) as total, COUNT(*) as songs, COUNT(DISTINCT CASE WHEN artist <> '' THEN artist END) as artists")
            ->first();

        $topSongs = $user->plays()
            ->orderByDesc('play_count')
            ->orderByDesc('played_at')
            ->limit(8)
            ->get()
            ->map(fn ($p) => [
                'title' => (string) $p->title,
                'artist' => (string) ($p->artist ?? ''),
                'cover' => (string) ($p->cover ?? ''),
                'plays' => (int) $p->play_count,
            ])
            ->all();

        $topArtists = $user->plays()
            ->where('artist', '!=', '')
            ->selectRaw('artist, SUM(play_count) as plays')
            ->groupBy('artist')
            ->orderByDesc('plays')
            ->limit(6)
            ->get()
            ->map(fn ($r) => ['artist' => (string) $r->artist, 'plays' => (int) $r->plays])
            ->all();

        return [
            'totalPlays' => (int) ($counts->total ?? 0),
            'distinctSongs' => (int) ($counts->songs ?? 0),
            'distinctArtists' => (int) ($counts->artists ?? 0),
            'topSongs' => $topSongs,
            'topArtists' => $topArtists,
        ];
    }

    /** Windowed stats (week/month/year) from the play-events log. */
    private function windowStats(User $user, string $range): array
    {
        // NoOverflow so month-end/leap-day don't shift the window forward.
        $start = match ($range) {
            'week' => now()->subWeek(),
            'month' => now()->subMonthNoOverflow(),
            default => now()->subYearNoOverflow(),
        };
        $scoped = fn () => $user->playEvents()->where('played_at', '>=', $start);

        $counts = $scoped()
            ->selectRaw("COUNT(*) as total, COUNT(DISTINCT dedupe_key) as songs, COUNT(DISTINCT CASE WHEN artist <> '' THEN artist END) as artists")
            ->first();

        $songRows = $scoped()
            ->selectRaw('dedupe_key, COUNT(*) as plays, MAX(played_at) as last_played')
            ->groupBy('dedupe_key')
            ->orderByDesc('plays')
            ->orderByDesc('last_played')
            ->limit(8)
            ->get();

        // Enrich display fields from the plays snapshot (latest cover/title),
        // so a per-event MAX(cover) can't surface a stale/wrong thumbnail.
        $snap = $user->plays()
            ->whereIn('dedupe_key', $songRows->pluck('dedupe_key')->all())
            ->get()
            ->keyBy('dedupe_key');
        $topSongs = $songRows->map(function ($r) use ($snap) {
            $p = $snap->get($r->dedupe_key);

            return [
                'title' => (string) ($p->title ?? ''),
                'artist' => (string) ($p->artist ?? ''),
                'cover' => (string) ($p->cover ?? ''),
                'plays' => (int) $r->plays,
            ];
        })->all();

        $topArtists = $scoped()
            ->where('artist', '!=', '')
            ->selectRaw('artist, COUNT(*) as plays, MAX(played_at) as last_played')
            ->groupBy('artist')
            ->orderByDesc('plays')
            ->orderByDesc('last_played')
            ->limit(6)
            ->get()
            ->map(fn ($r) => ['artist' => (string) $r->artist, 'plays' => (int) $r->plays])
            ->all();

        return [
            'totalPlays' => (int) ($counts->total ?? 0),
            'distinctSongs' => (int) ($counts->songs ?? 0),
            'distinctArtists' => (int) ($counts->artists ?? 0),
            'topSongs' => $topSongs,
            'topArtists' => $topArtists,
        ];
    }

    /** Return all data in one call (for the initial load). */
    private function getAll(User $user): array
    {
        $user->load('playlists.songs');

        $playlists = [];
        foreach ($user->playlists as $playlist) {
            $playlists[$playlist->slug] = $playlist->toFrontend();
        }

        // Derive favorite keys from the already-loaded collection (no extra queries).
        $favPlaylist = $user->playlists->firstWhere('slug', self::FAVORITES_SLUG);
        $favoriteKeys = $favPlaylist
            ? $favPlaylist->songs->map(fn (Song $s) => $s->frontendKey())->unique()->values()->all()
            : [];

        return [
            'success' => true,
            'activePlaylist' => $this->activeSlug($user),
            'recentlyPlayed' => $user->recently_played ?? [],
            'recentSongs' => $user->recentSongs(),
            'favoriteKeys' => $favoriteKeys,
            'playlists' => $playlists,
        ];
    }

    // ---- Helpers -----------------------------------------------------------

    /**
     * Legacy active-playlist resolution: the stored active slug, else the
     * user's first playlist key, else 'favorites'.
     */
    private function activeSlug(User $user): string
    {
        if (is_string($user->active_playlist_slug) && $user->active_playlist_slug !== '') {
            return $user->active_playlist_slug;
        }

        return $user->playlists()->value('slug') ?? 'favorites';
    }

    private function findPlaylist(User $user, string $slug): ?Playlist
    {
        if ($slug === '') {
            return null;
        }

        return $user->playlists()->where('slug', $slug)->first();
    }

    /** Songs keep contiguous 0..n-1 positions, so position == legacy index. */
    private function songAt(Playlist $playlist, int $index): ?Song
    {
        if ($index < 0) {
            return null;
        }

        return $playlist->songs()->where('position', $index)->first();
    }

    /** Rewrite positions to 0..n-1 after a removal. */
    private function reindexSongs(Playlist $playlist): void
    {
        foreach ($playlist->songs()->get()->values() as $i => $song) {
            if ((int) $song->position !== $i) {
                $song->update(['position' => $i]);
            }
        }
    }

    /**
     * Remove uploaded files (/media/{uuid}.{ext} URLs) that no remaining song
     * of this user references — keeps per-user storage from growing forever.
     * Runs after the deleting song row is gone; copies share the same URL, so
     * a file survives as long as any copy still points at it.
     */
    private function deleteOrphanedUploads(User $user, array $urls): void
    {
        foreach ($urls as $url) {
            if (! is_string($url) || ! preg_match('#^/media/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,5})$#', $url, $m)) {
                continue;
            }

            $stillUsed = Song::whereIn('playlist_id', $user->playlists()->select('id'))
                ->where(fn ($q) => $q->where('mp3_url', $url)->orWhere('cover', $url))
                ->exists();

            if (! $stillUsed) {
                Storage::disk((string) config('filesystems.uploads', 'local'))
                    ->delete('music/'.$user->id.'/'.$m[1]);
            }
        }
    }

    /**
     * Find a song in the playlist that an uploaded file can attach to:
     * same track by normalized title/artist, no local copy yet. Titles
     * must match exactly (post-normalization); artists match loosely —
     * "Shakira" from an ID3 tag should hit "Shakira ft. Wyclef Jean".
     */
    private function findLinkableSong(Playlist $playlist, string $title, string $artist): ?Song
    {
        $wantTitle = $this->normalizeForMatch($title);
        if ($wantTitle === '') {
            return null;
        }
        $wantArtist = $this->normalizeForMatch($artist);

        foreach ($playlist->songs()->where('mp3_url', '')->get() as $candidate) {
            if ($this->normalizeForMatch($candidate->title) !== $wantTitle) {
                continue;
            }
            $haveArtist = $this->normalizeForMatch($candidate->artist);
            if ($wantArtist === '' || $haveArtist === ''
                || $wantArtist === $haveArtist
                || str_contains($haveArtist, $wantArtist)
                || str_contains($wantArtist, $haveArtist)) {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Fold a title/artist down to its comparable core: lowercase, bracketed
     * qualifiers and trailing feat. credits dropped, punctuation collapsed.
     */
    private function normalizeForMatch(string $value): string
    {
        $value = mb_strtolower(trim($value));
        $value = preg_replace('/[\(\[][^\)\]]*[\)\]]/u', ' ', $value) ?? $value;
        $value = preg_replace('/\b(feat|ft)\.?\s+.*$/u', ' ', $value) ?? $value;
        $value = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $value) ?? $value;

        return trim(preg_replace('/\s+/', ' ', $value) ?? $value);
    }

    /** String-or-empty request input (legacy treated non-strings as invalid). */
    /**
     * A song text field as the songs table can hold it: a string, trimmed,
     * at most 300 characters. One over-long or malformed title from an
     * import must not fail the whole batch it arrived in.
     */
    private function songText(mixed $value): string
    {
        return is_scalar($value) ? mb_substr(trim((string) $value), 0, 300) : '';
    }

    private function strInput(Request $request, string $key): string
    {
        $value = $request->input($key, '');

        return is_string($value) ? $value : '';
    }

    /**
     * Reject any URL that isn't plain http(s) or root-relative. Blocks
     * javascript:, data:, file:, blob:, vbscript:, etc. — these are
     * XSS / SSRF / exfil sinks once a song field is rendered into
     * <img src> / <audio src>. Empty string is allowed.
     */
    private function sanitizeUrl(mixed $value): string
    {
        if ($value === null || $value === '' || ! is_scalar($value)) {
            return '';
        }
        $str = trim((string) $value);
        if ($str === '') {
            return '';
        }
        // Allow http(s) absolute URLs and root-relative paths only.
        if (preg_match('#^https?://[^\s<>"\']+$#i', $str)) {
            return $str;
        }
        if (preg_match('#^/[^\s<>"\']*$#', $str)) {
            return $str;
        }

        return '';
    }
}
