<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['slug', 'name', 'color', 'current_index', 'cover_song_index', 'source', 'position', 'share_token'])]
class Playlist extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function songs(): HasMany
    {
        return $this->hasMany(Song::class)->orderBy('position');
    }

    /**
     * Serialize to the exact playlist shape the frontend expects
     * (a value inside music.json's `playlists` map).
     *
     * @return array{name: string, color: string, songs: array<int, array<string, mixed>>, currentIndex: int, coverSongIndex?: int}
     */
    public function toFrontend(): array
    {
        $out = [
            'name' => $this->name,
            'color' => $this->color,
            'songs' => $this->songs->map(fn (Song $s) => $s->toFrontend())->values()->all(),
            'currentIndex' => (int) $this->current_index,
        ];
        if ($this->cover_song_index !== null) {
            $out['coverSongIndex'] = (int) $this->cover_song_index;
        }
        if ($this->source === 'spotify') {
            $out['source'] = 'spotify';
        }

        return $out;
    }
}
