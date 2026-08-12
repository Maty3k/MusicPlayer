<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per play — the append-only log behind time-ranged listening stats.
 * Distinct from Play (the one-row-per-song recently-played shelf).
 */
#[Fillable(['dedupe_key', 'title', 'artist', 'cover', 'played_at'])]
class PlayEvent extends Model
{
    public $timestamps = false;

    protected function casts(): array
    {
        return ['played_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
