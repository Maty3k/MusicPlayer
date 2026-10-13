<?php

namespace App\Support;

use App\Models\Playlist;
use App\Models\Song;
use App\Models\User;

/**
 * The ceilings from config/library.php, and the sentences that say one was
 * reached. Every path that adds a playlist or a song asks here first.
 */
class LibraryLimits
{
    public static function max(string $what): int
    {
        return (int) config('library.'.$what);
    }

    public static function playlistsLeft(User $user): int
    {
        return max(0, self::max('playlists') - $user->playlists()->count());
    }

    /**
     * How many more songs fit: into this playlist (a new one when null), and
     * into the account's library as a whole.
     */
    public static function songsLeft(User $user, ?Playlist $playlist): int
    {
        $inPlaylist = $playlist === null ? 0 : $playlist->songs()->count();
        $inLibrary = Song::whereIn('playlist_id', $user->playlists()->select('id'))->count();

        return max(0, min(
            self::max('playlist_songs') - $inPlaylist,
            self::max('songs') - $inLibrary,
        ));
    }

    /** An address short enough to store. */
    public static function fits(string $url): bool
    {
        return strlen($url) <= self::max('url_length');
    }

    public static function playlistsFullMessage(): string
    {
        return 'You have '.number_format(self::max('playlists')).' playlists, the most an account can hold. Delete one to make room.';
    }

    public static function songsFullMessage(): string
    {
        return 'No room for that: a playlist holds up to '.number_format(self::max('playlist_songs'))
            .' songs and a library '.number_format(self::max('songs')).'.';
    }
}
