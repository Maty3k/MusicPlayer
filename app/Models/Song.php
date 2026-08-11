<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['position', 'title', 'artist', 'album', 'cover', 'youtube_id', 'mp3_url', 'spotify_id'])]
class Song extends Model
{
    public function playlist(): BelongsTo
    {
        return $this->belongsTo(Playlist::class);
    }

    /**
     * Stable per-song identity used to match a song across playlists (favorites
     * membership, recently-played). MUST mirror the client songPlayKey() in
     * script.js exactly so both sides agree on what "the same song" is.
     */
    public static function keyFor(string $yt, string $spotify, string $mp3, string $title, string $artist): string
    {
        if ($yt !== '') {
            return 'yt:'.$yt;
        }
        if ($spotify !== '') {
            return 'sp:'.$spotify;
        }
        if ($mp3 !== '') {
            return 'mp3:'.trim($mp3);
        }

        return 'tt:'.mb_strtolower(trim($title)).'|'.mb_strtolower(trim($artist));
    }

    public function frontendKey(): string
    {
        return self::keyFor(
            (string) $this->youtube_id,
            (string) $this->spotify_id,
            (string) $this->mp3_url,
            (string) $this->title,
            (string) ($this->artist ?? '')
        );
    }

    /**
     * Serialize to the exact song shape the frontend expects
     * (an element of a playlist's `songs` array in music.json).
     *
     * @return array<string, string>
     */
    public function toFrontend(): array
    {
        return [
            'title' => $this->title,
            'artist' => $this->artist ?? '',
            'album' => $this->album ?? '',
            'cover' => $this->cover ?? '',
            'youtube_id' => $this->youtube_id ?? '',
            'mp3_url' => $this->mp3_url ?? '',
            'spotify_id' => $this->spotify_id ?? '',
        ];
    }
}
