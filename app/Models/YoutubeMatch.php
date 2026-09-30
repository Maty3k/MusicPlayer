<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * The shared "this Spotify track plays as that YouTube video" cache.
 */
#[Fillable(['spotify_id', 'youtube_id'])]
class YoutubeMatch extends Model
{
    /**
     * The cache key: the Spotify id plus a hash of the exact text searched.
     * The search text comes from the client, so keying by the id alone let
     * anyone pin a chosen video onto a real track for every other user; now
     * made-up text only ever fills a slot nobody else looks up. (22 + 1 + 16
     * characters fits the 40-character column.)
     */
    public static function cacheKey(string $spotifyId, string $title, string $artist): string
    {
        return $spotifyId.':'.substr(sha1(mb_strtolower(trim(trim($artist).' '.trim($title)))), 0, 16);
    }
}
