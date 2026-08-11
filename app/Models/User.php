<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

#[Fillable(['name', 'email', 'password', 'member_number', 'active_playlist_slug', 'recently_played'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'recently_played' => 'array',
        ];
    }

    /**
     * Member-number accounts never hit the email-verification wall: they
     * start with no email at all, and once one is attached in Settings it's
     * a recovery convenience, not a gate — blocking the player on a
     * verification mail (which prod can't always send) would lock them out.
     */
    public function hasVerifiedEmail(): bool
    {
        return $this->member_number !== null || $this->email_verified_at !== null;
    }

    /** Club-card presentation of the member number: 42 → "#0042". */
    public function formattedMemberNumber(): ?string
    {
        return $this->member_number === null
            ? null
            : '#'.str_pad((string) $this->member_number, 4, '0', STR_PAD_LEFT);
    }

    public function playlists(): HasMany
    {
        return $this->hasMany(Playlist::class)->orderBy('position');
    }

    /** Per-user recently-played song history (see the Play model / plays table). */
    public function plays(): HasMany
    {
        return $this->hasMany(Play::class);
    }

    /**
     * Most-recently-played songs, newest first, in the frontend song shape —
     * ready for the homescreen "recently played" shelf and for replay.
     *
     * @return array<int, array<string, string>>
     */
    public function recentSongs(int $limit = 12): array
    {
        // Order by id (monotonic per insert), not played_at — recordPlay
        // delete-inserts on replay, so the newest row always has the highest id
        // even when several plays share a clock second.
        return $this->plays()
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(fn (Play $p) => $p->toFrontend())
            ->all();
    }

    public function spotifyToken(): HasOne
    {
        return $this->hasOne(SpotifyToken::class);
    }

    /**
     * The playlist the player should show, falling back to the user's first
     * playlist (mirrors the legacy music.json activePlaylist fallback).
     */
    public function activePlaylist(): ?Playlist
    {
        $playlists = $this->playlists;
        if ($playlists->isEmpty()) {
            return null;
        }

        return $playlists->firstWhere('slug', $this->active_playlist_slug) ?? $playlists->first();
    }
}
