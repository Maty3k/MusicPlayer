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
