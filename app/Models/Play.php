<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['dedupe_key', 'title', 'artist', 'album', 'cover', 'youtube_id', 'mp3_url', 'spotify_id', 'played_at', 'play_count'])]
class Play extends Model
{
    protected function casts(): array
    {
        return ['played_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Same song shape the frontend expects (mirrors Song::toFrontend), so a
     * recently-played entry can be rendered and replayed like any song.
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
