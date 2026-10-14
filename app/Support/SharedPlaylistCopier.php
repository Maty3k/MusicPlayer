<?php

namespace App\Support;

use App\Models\Playlist;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Copies a playlist shared via /s/{token} into a user's library: the share
 * page's "Add" button, and the pending "save this playlist" that a guest
 * carries through sign-up. The copy never includes the owner's private
 * uploads, and only well-formed video ids cross the trust boundary.
 */
class SharedPlaylistCopier
{
    public const MAX_COPY = 1000;

    /** The status line the user sees afterwards. */
    public static function copy(User $user, Playlist $source): string
    {
        $source->loadMissing('songs');

        // The copier's own ceilings apply: a share must not be a way to push
        // more into someone's library than they could add themselves.
        if (LibraryLimits::playlistsLeft($user) < 1) {
            return LibraryLimits::playlistsFullMessage();
        }
        $take = min(self::MAX_COPY, LibraryLimits::songsLeft($user, null));
        if ($take < 1 && $source->songs->isNotEmpty()) {
            return LibraryLimits::songsFullMessage();
        }

        $new = DB::transaction(function () use ($user, $source, $take) {
            do {
                $slug = 'pl-'.strtolower(Str::random(10));
            } while ($user->playlists()->where('slug', $slug)->exists());

            $new = $user->playlists()->create([
                'slug' => $slug,
                'name' => Str::limit((string) $source->name, 90, ''),
                'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) $source->color) ? $source->color : '#d4a574',
                'current_index' => 0,
                'source' => 'user',
                'position' => ((int) ($user->playlists()->max('position') ?? -1)) + 1,
            ]);

            foreach ($source->songs->take($take)->values() as $i => $s) {
                // Accept only a canonical 11-char youtube_id (same guard
                // addBatch uses) so a crafted id from the sharer can't reach
                // the copier's player.
                $yt = (string) $s->youtube_id;
                $yt = preg_match('/^[A-Za-z0-9_-]{11}$/', $yt) ? $yt : '';
                $new->songs()->create([
                    'position' => $i,
                    'title' => (string) $s->title,
                    'artist' => (string) $s->artist,
                    'album' => (string) $s->album,
                    'cover' => self::publicCover($s->cover),
                    'youtube_id' => $yt,
                    'mp3_url' => '', // never copy the owner's private uploaded audio
                    'spotify_id' => (string) $s->spotify_id,
                ]);
            }

            return $new;
        });

        $total = $source->songs->count();

        return $total > $take
            ? 'Added “'.$new->name.'” to your library: the first '.$take.' of its '.$total.' songs.'
            : 'Added “'.$new->name.'” to your library.';
    }

    /**
     * Only external http(s) cover URLs — never the owner's private /media
     * uploads (they 404 for other users and shouldn't be referenced) — and
     * none longer than a song may carry: the sharer chose these, and the
     * copier's page has to load every one of them.
     */
    public static function publicCover(?string $cover): string
    {
        $cover = trim((string) $cover);

        return preg_match('#^https?://#i', $cover) && LibraryLimits::fits($cover) ? $cover : '';
    }
}
